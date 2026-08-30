// Synthetic tests for the privacy-preserving analytics guard (src/lib/analytics.js).
// FICTIONAL values only -- no real personal or financial data.
//
// Loads the REAL module through Vite's SSR pipeline (so import.meta.env is
// transformed as in the build). analytics.js imports Supabase LAZILY, so the
// module evaluates without any env/Supabase dependency.
//
// Run (where Node exists) from repo root:  node tests/analytics.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { sanitizeEvent, trackProductEvent, ALLOWED_EVENTS, ALLOWED_SOURCE_SCREENS } =
    await vite.ssrLoadModule('/src/lib/analytics.js');

  // 0. The client allowlist must match the approved taxonomy EXACTLY (this same
  // list is enforced by the product_events CHECK constraint in the migration,
  // so keeping them identical keeps the DB and client in lockstep).
  const EXPECTED_EVENTS = [
    'card_scan_started', 'card_scan_completed', 'card_saved',
    'flow_opened', 'flow_setup_completed', 'balance_scan_started',
    'balance_scan_applied', 'extra_income_added', 'custom_horizon_used',
    'activity_scan_started', 'activity_scan_completed', 'activity_import_completed',
    'onboarding_flow_bridge_clicked', 'onboarding_activity_prompt_clicked',
    'loan_section_opened', 'loan_added', 'loan_edited', 'loan_simulator_opened',
    'loan_extra_payment_tested', 'loan_recurring_extra_tested', 'loan_payment_added_to_flow',
  ];
  ok('allowlist size matches taxonomy', ALLOWED_EVENTS.size === EXPECTED_EVENTS.length);
  ok('every approved event is allowlisted', EXPECTED_EVENTS.every((e) => ALLOWED_EVENTS.has(e)));
  ok('no unexpected events in allowlist',
    [...ALLOWED_EVENTS].every((e) => EXPECTED_EVENTS.includes(e)));

  // source_screen enum matches the DB CHECK: exactly cards/flow/activity, no 'loans'.
  ok('source_screen enum is cards/flow/activity',
    ALLOWED_SOURCE_SCREENS.size === 3 &&
    ['cards', 'flow', 'activity'].every((s) => ALLOWED_SOURCE_SCREENS.has(s)));
  ok('loans is NOT an accepted source_screen', !ALLOWED_SOURCE_SCREENS.has('loans'));

  // 1. Allowed event succeeds and yields exactly event_name.
  const a = sanitizeEvent('card_saved');
  ok('allowed event -> row', a && a.event_name === 'card_saved');
  ok('allowed event has no extra keys', a && Object.keys(a).length === 1);

  // 2. Unknown event is rejected.
  ok('unknown event -> null', sanitizeEvent('definitely_not_allowed') === null);
  ok('non-string event -> null', sanitizeEvent(42) === null);

  // 3. Allowed source_screen survives.
  const b = sanitizeEvent('flow_opened', { source_screen: 'flow' });
  ok('allowed source_screen survives', b && b.source_screen === 'flow');

  // 4. Invalid source_screen value is dropped (e.g. 'loans' not yet allowed).
  const c = sanitizeEvent('flow_opened', { source_screen: 'loans' });
  ok('unlisted source_screen dropped', c && c.source_screen === undefined);
  const c2 = sanitizeEvent('flow_opened', { source_screen: 'evil' });
  ok('arbitrary source_screen dropped', c2 && c2.source_screen === undefined);

  // 5. Invalid metadata keys are stripped.
  const d = sanitizeEvent('card_saved', { foo: 'bar', source_screen: 'cards' });
  ok('extra metadata keys stripped', d && Object.keys(d).length === 2 && d.source_screen === 'cards' && !('foo' in d));

  // 6. Financial keys cannot pass through.
  const fin = sanitizeEvent('card_saved', {
    amount: 842.37, balance: 1000, principal: 5000, apr: 24.99, income: 3000,
    card_name: 'Secret Card', account_name: 'Secret Acct', last_four: '1309',
    merchant: 'Super 99', description: 'groceries', email: 'a@b.com',
    user_id: 'uuid-123', source_screen: 'cards',
  });
  ok('financial keys stripped (only event_name + source_screen)',
    fin && Object.keys(fin).sort().join(',') === 'event_name,source_screen'
    && fin.event_name === 'card_saved' && fin.source_screen === 'cards');

  // 7. Arbitrary objects cannot pass through (a whole "card object").
  const cardObject = { id: 'x', statement_balance: 500, apr: 22.5, card_name: 'Visa 1309' };
  const e = sanitizeEvent('card_saved', cardObject);
  ok('arbitrary object -> only event_name', e && Object.keys(e).length === 1 && e.event_name === 'card_saved');

  // 8. Arrays and primitives as metadata are ignored safely.
  ok('array metadata ignored', sanitizeEvent('card_saved', [1, 2, 3]).source_screen === undefined);
  ok('primitive metadata ignored', sanitizeEvent('card_saved', 'cards').source_screen === undefined);

  // 9. trackProductEvent NEVER throws, for allowed, unknown, or hostile input.
  let threw = false;
  try {
    trackProductEvent('card_saved', { source_screen: 'cards' });     // valid -> lazy insert (errors swallowed)
    trackProductEvent('not_allowed', { source_screen: 'cards' });    // rejected
    trackProductEvent(null);                                         // hostile
    trackProductEvent('card_saved', cardObject);                     // hostile metadata
  } catch {
    threw = true;
  }
  ok('trackProductEvent never throws', threw === false);

  // 10. Every allowlisted name sanitizes to itself (sanity on the allowlist).
  let allRoundtrip = true;
  for (const name of ALLOWED_EVENTS) {
    const r = sanitizeEvent(name);
    if (!r || r.event_name !== name) allRoundtrip = false;
  }
  ok('all allowlisted events round-trip', allRoundtrip);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
