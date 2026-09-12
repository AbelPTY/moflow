// Action Plan — note (task title + due date) editing helpers.
//
// Pure, side-effect-free logic behind the "Edit" flow. An edit is a direct
// correction of the SAME task row's `title` and `due_date` and nothing else. It
// never re-runs voice transcription or AI interpretation, never creates a second
// record, and never touches the other task fields (category, done, id,
// created_at, user_id).
//
// The `tasks` table (see supabase/migrations/20260818000000_tasks.sql) has no
// `updated_at` column, so no such field is written; adding one is intentionally
// out of scope (a text/date correction does not justify a migration).
//
// due_date is a CALENDAR date stored as 'YYYY-MM-DD'. An <input type="date">
// already yields that exact string with no timezone component, so it is stored
// verbatim — never parsed into a Date and re-serialized (which would risk a
// UTC day shift). Clearing the field stores NULL (the column is nullable).

// Trim surrounding whitespace only (interior spacing is the user's to keep).
export function sanitizeNoteText(text) {
  return String(text == null ? '' : text).trim();
}

// A note must have visible, non-whitespace content.
export function isValidNote(text) {
  return sanitizeNoteText(text).length > 0;
}

// Sanitize a due-date input to the canonical stored form: a 'YYYY-MM-DD'
// calendar string, or null when cleared/absent/invalid. Kept VERBATIM (no Date
// round-trip) so there is never a timezone/UTC day shift. Rejects '', undefined,
// timestamps ('2026-09-15T…'), and impossible calendar dates → null (never '',
// undefined, or "Invalid Date").
export function sanitizeDueDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null; // anything but a bare calendar date (incl. timestamps)
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Reject impossible calendar dates (e.g. 2026-02-30) without shifting the day.
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
    return null;
  }
  return s; // stored exactly as received
}

// Build the DB patch for an Action Plan edit: title (text correction) + due date
// (calendar date, or null when cleared). Returns EXACTLY { title, due_date } —
// so the update cannot alter id/user_id/category/done/created_at and can never
// re-trigger extraction (no transcript/extract fields are included). Throws on a
// blank-only title so a destructive empty overwrite is impossible.
export function buildTaskEditPatch({ title, dueDate }) {
  const cleanTitle = sanitizeNoteText(title);
  if (!cleanTitle) {
    const err = new Error('EMPTY_NOTE');
    err.code = 'EMPTY_NOTE';
    throw err;
  }
  return { title: cleanTitle, due_date: sanitizeDueDate(dueDate) };
}

// True when the edited text is a real change from the original (after trim).
// A no-op edit (or Cancel) needs no write.
export function noteChanged(original, edited) {
  return sanitizeNoteText(original) !== sanitizeNoteText(edited);
}

// Apply a successful patch to a task in local state. Preserves id, created_at,
// user_id and every other field; only the patched keys change.
export function mergeUpdatedTask(task, patch) {
  return { ...task, ...patch };
}
