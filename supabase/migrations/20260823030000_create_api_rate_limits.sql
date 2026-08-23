-- =============================================================================
-- api_rate_limit_buckets  +  consume_api_rate_limit(...)
-- -----------------------------------------------------------------------------
-- Durable, concurrency-safe rate-limit foundation for the authenticated
-- Gemini/upload endpoints (P0 Phase C1). Foundation ONLY -- no endpoint is
-- wired to it yet (that is Phase C2), and no rows are seeded.
--
-- DESIGN
--   * One bounded row PER (scope, subject_type, subject_key) -- a fixed-size
--     sliding-window bucket, never one row per request.
--   * Concurrency safety: the consume RPC upserts the bucket then locks it with
--     SELECT ... FOR UPDATE, so parallel requests for the same subject serialize
--     and cannot both bypass the limit. First-use races are absorbed by
--     INSERT ... ON CONFLICT DO NOTHING.
--   * Expired windows reset atomically inside the same locked transaction.
--   * A DENIED request never resets or extends its window (only updated_at moves).
--
-- PRIVACY / SECURITY
--   * subject_key holds a caller-provided opaque key only: the authenticated
--     user id for 'user', or an HMAC-SHA256 digest of the client IP for 'ip'.
--     Raw IPs and any financial/user content are NEVER stored here.
--   * RLS is enabled with NO client policies; all privileges are revoked from
--     public/anon/authenticated. Only service_role (trusted server code) may
--     touch the table or execute the RPC. Server-side isolation never relies on
--     RLS -- it relies on explicit keys supplied by the server.
--
-- Contains NO personal data, IPs, secrets, or seed rows.
-- =============================================================================

BEGIN;

create table public.api_rate_limit_buckets (
    scope              text        not null,
    subject_type       text        not null,
    subject_key        text        not null,
    window_started_at  timestamptz not null,
    request_count      integer     not null,
    updated_at         timestamptz not null,

    -- Exactly one current bucket per scope + subject_type + subject_key.
    constraint api_rate_limit_buckets_pkey
        primary key (scope, subject_type, subject_key),

    constraint api_rate_limit_buckets_scope_not_blank
        check (btrim(scope) <> ''),
    constraint api_rate_limit_buckets_subject_key_not_blank
        check (btrim(subject_key) <> ''),
    -- Only the subject kinds needed now.
    constraint api_rate_limit_buckets_subject_type_valid
        check (subject_type in ('user', 'ip')),
    constraint api_rate_limit_buckets_count_nonneg
        check (request_count >= 0)
);

-- =============================================================================
-- RLS / privileges: server-only.
-- =============================================================================
alter table public.api_rate_limit_buckets enable row level security;
-- (Intentionally NO policies for anon or authenticated.)

revoke all on table public.api_rate_limit_buckets from public, anon, authenticated;

grant select, insert, update, delete
on table public.api_rate_limit_buckets
to service_role;

-- =============================================================================
-- Atomic consume RPC.
-- -----------------------------------------------------------------------------
-- Returns (allowed, remaining, retry_after_seconds). SECURITY DEFINER with a
-- locked-down search_path; every application object is fully qualified. No
-- dynamic SQL. EXECUTE is granted to service_role only.
-- =============================================================================
create or replace function public.consume_api_rate_limit(
    p_scope          text,
    p_subject_type   text,
    p_subject_key    text,
    p_limit          integer,
    p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now          timestamptz := now();
    v_window_start timestamptz;
    v_count        integer;
    v_expired      boolean;
    v_new_count    integer;
begin
    -- Reject nonsensical inputs (fail closed at the caller).
    if p_scope is null or btrim(p_scope) = '' then
        raise exception 'invalid rate limit scope';
    end if;
    if p_subject_type is null or p_subject_type not in ('user', 'ip') then
        raise exception 'invalid rate limit subject_type';
    end if;
    if p_subject_key is null or btrim(p_subject_key) = '' then
        raise exception 'invalid rate limit subject_key';
    end if;
    if p_limit is null or p_limit < 1 then
        raise exception 'invalid rate limit limit';
    end if;
    if p_window_seconds is null or p_window_seconds < 1 then
        raise exception 'invalid rate limit window';
    end if;

    -- Ensure the bucket row exists (absorbs first-use insert races).
    insert into public.api_rate_limit_buckets
        (scope, subject_type, subject_key, window_started_at, request_count, updated_at)
    values
        (p_scope, p_subject_type, p_subject_key, v_now, 0, v_now)
    on conflict (scope, subject_type, subject_key) do nothing;

    -- Lock the single bucket row so concurrent consumers serialize.
    select bucket.window_started_at, bucket.request_count
      into v_window_start, v_count
    from public.api_rate_limit_buckets as bucket
    where bucket.scope = p_scope
      and bucket.subject_type = p_subject_type
      and bucket.subject_key = p_subject_key
    for update;

    -- Reset the window atomically if it has elapsed.
    v_expired := (v_now - v_window_start) >= make_interval(secs => p_window_seconds);
    if v_expired then
        v_window_start := v_now;
        v_count := 0;
    end if;

    if v_count < p_limit then
        -- Allowed: count this request within the (possibly reset) window.
        v_new_count := v_count + 1;
        update public.api_rate_limit_buckets as bucket
           set request_count = v_new_count,
               window_started_at = v_window_start,
               updated_at = v_now
         where bucket.scope = p_scope
           and bucket.subject_type = p_subject_type
           and bucket.subject_key = p_subject_key;

        allowed := true;
        remaining := p_limit - v_new_count;
        retry_after_seconds := 0;
    else
        -- Denied: never reset or extend the window, only updated_at moves.
        update public.api_rate_limit_buckets as bucket
           set updated_at = v_now
         where bucket.scope = p_scope
           and bucket.subject_type = p_subject_type
           and bucket.subject_key = p_subject_key;

        allowed := false;
        remaining := 0;
        retry_after_seconds := greatest(
            1,
            ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::integer
        );
    end if;

    return next;
end;
$$;

-- Only verified server code (service_role) may execute the RPC.
revoke all on function public.consume_api_rate_limit(text, text, text, integer, integer) from public;
revoke all on function public.consume_api_rate_limit(text, text, text, integer, integer) from anon;
revoke all on function public.consume_api_rate_limit(text, text, text, integer, integer) from authenticated;
grant execute on function public.consume_api_rate_limit(text, text, text, integer, integer) to service_role;

COMMIT;
