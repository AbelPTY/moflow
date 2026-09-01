// Synthetic tests for ACCOUNT-AWARE duplicate detection. FICTIONAL data only.
// Loaded through Vite SSR (pure module).
//
// Run (where Node exists) from repo root:  node tests/accountDedupe.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { flagDuplicateActivityRows } = await vite.ssrLoadModule('/src/lib/dedupeTransactions.js');
  const { prepareImportAccountAssignment } = await vite.ssrLoadModule('/src/lib/accountOptions.js');

  const D = '2026-08-15';

  // Existing DB history: one Starbucks in "BG Checking".
  const existingBG = [{ date: D, merchant: 'Starbucks', amount: -9.5, bank_reference: null, account_name: 'BG Checking' }];

  // A. Same date/desc/amount in a DIFFERENT account -> NOT a hard duplicate.
  const a = flagDuplicateActivityRows(
    [{ date: D, description: 'Starbucks', amount: -9.5, account: 'UNFCU Checking' }],
    existingBG
  );
  ok('A: same tx, different account -> importable', a[0].willFailSave === false && a[0].isDuplicate === false);

  // B. Same date/desc/amount in the SAME account -> hard duplicate.
  const b = flagDuplicateActivityRows(
    [{ date: D, description: 'Starbucks', amount: -9.5, account: 'BG Checking' }],
    existingBG
  );
  ok('B: same tx, same account -> hard duplicate', b[0].willFailSave === true);
  // case/space-insensitive account match (no personal aliasing, just normalization)
  const bCase = flagDuplicateActivityRows(
    [{ date: D, description: 'Starbucks', amount: -9.5, account: '  bg   checking ' }],
    existingBG
  );
  ok('B: account match is trim/case/space-insensitive', bCase[0].willFailSave === true);

  // C. Same bank_reference in different accounts -> independent (not a collision).
  const existingRefA = [{ date: D, merchant: 'Wire', amount: -500, bank_reference: 'REF-1', account_name: 'Account A' }];
  const c = flagDuplicateActivityRows(
    [{ date: D, description: 'Wire', amount: -500, reference: 'REF-1', account: 'Account B' }],
    existingRefA
  );
  ok('C: same reference, different account -> importable', c[0].willFailSave === false);

  // D. Same bank_reference in the SAME account -> hard duplicate.
  const d = flagDuplicateActivityRows(
    [{ date: D, description: 'Wire', amount: -500, reference: 'REF-1', account: 'Account A' }],
    existingRefA
  );
  ok('D: same reference, same account -> hard duplicate', d[0].willFailSave === true);

  // E. Within-batch: two identical rows headed to the SAME account -> 2nd is a dup.
  const e = flagDuplicateActivityRows(
    [
      { date: D, description: 'Uber', amount: -12, account: 'BG Checking' },
      { date: D, description: 'Uber', amount: -12, account: 'BG Checking' },
    ],
    []
  );
  ok('E: within-batch same account -> 2nd blocked', e[0].willFailSave === false && e[1].willFailSave === true);

  // F. Within-batch: two identical rows headed to DIFFERENT accounts -> independent.
  const f = flagDuplicateActivityRows(
    [
      { date: D, description: 'Uber', amount: -12, account: 'BG Checking' },
      { date: D, description: 'Uber', amount: -12, account: 'UNFCU Checking' },
    ],
    []
  );
  ok('F: within-batch different accounts -> both importable', f[0].willFailSave === false && f[1].willFailSave === false);

  // G. BulkUpload FINAL destination: identity uses the assigned account, not a
  //    stale parser hint. A single-account statement detected as "UNFCU Statement"
  //    but redirected by the user to "BG Checking" must dedupe against BG Checking.
  const parsed = [{ date: D, description: 'Starbucks', amount: -9.5, account_name: 'UNFCU Statement' }];
  const assigned = prepareImportAccountAssignment(parsed, 'BG Checking'); // user override
  const gRows = assigned.map((r) => ({
    date: r.date, description: r.description, amount: r.amount,
    account: r.account_name || r.source_account,
  }));
  const g = flagDuplicateActivityRows(gRows, existingBG);
  ok('G: dedupe uses FINAL destination (redirected -> collides in BG)', g[0].willFailSave === true);

  // H. Same statement, user keeps it in a NEW account -> no false collision.
  const assignedH = prepareImportAccountAssignment(parsed, 'UNFCU Checking');
  const hRows = assignedH.map((r) => ({ date: r.date, description: r.description, amount: r.amount, account: r.account_name }));
  const h = flagDuplicateActivityRows(hRows, existingBG);
  ok('H: same statement into a different account -> importable', h[0].willFailSave === false);

  // I. Legacy blank-account rows stay conservative (collide only blank-vs-blank).
  const existingBlank = [{ date: D, merchant: 'Cash Withdrawal', amount: -100, bank_reference: null, account_name: '', source_account: '' }];
  const iBlank = flagDuplicateActivityRows(
    [{ date: D, description: 'Cash Withdrawal', amount: -100, account: '' }],
    existingBlank
  );
  ok('I: blank vs blank -> still deduped', iBlank[0].willFailSave === true);
  const iNamed = flagDuplicateActivityRows(
    [{ date: D, description: 'Cash Withdrawal', amount: -100, account: 'BG Checking' }],
    existingBlank
  );
  ok('I: named account vs legacy blank -> importable (not exempted globally)', iNamed[0].willFailSave === false);

  // ---- Blank account_name FALLTHROUGH to source_account (client == DB) ----

  // Existing row whose account_name is empty but source_account is set: its
  // identity must resolve to source_account, mirroring the SQL nullif/coalesce.

  // A. account_name = '' , source_account = 'UNFCU Savings' -> identity UNFCU Savings.
  const existingBlankName = [{ date: D, merchant: 'Interest', amount: 4, bank_reference: null, account_name: '', source_account: 'UNFCU Savings' }];
  const ftA = flagDuplicateActivityRows(
    [{ date: D, description: 'Interest', amount: 4, account: 'UNFCU Savings' }],
    existingBlankName
  );
  ok("A(fallthrough): blank account_name resolves to source_account", ftA[0].willFailSave === true);

  // B. account_name = '   ' (whitespace only), source_account = 'BG Checking' -> BG Checking.
  const existingWsName = [{ date: D, merchant: 'ATM', amount: -60, bank_reference: null, account_name: '   ', source_account: 'BG Checking' }];
  const ftB = flagDuplicateActivityRows(
    [{ date: D, description: 'ATM', amount: -60, account: 'BG Checking' }],
    existingWsName
  );
  ok("B(fallthrough): whitespace-only account_name resolves to source_account", ftB[0].willFailSave === true);
  // ...and a genuinely different account does NOT collide with it.
  const ftBneg = flagDuplicateActivityRows(
    [{ date: D, description: 'ATM', amount: -60, account: 'UNFCU Savings' }],
    existingWsName
  );
  ok("B(fallthrough): different account still importable", ftBneg[0].willFailSave === false);

  // C. Both blank -> conservative blank identity (blank collides only with blank).
  const existingBothBlank = [{ date: D, merchant: 'Fee', amount: -2, bank_reference: null, account_name: '', source_account: '' }];
  const ftC = flagDuplicateActivityRows(
    [{ date: D, description: 'Fee', amount: -2, account: '' }],
    existingBothBlank
  );
  ok("C(fallthrough): both blank -> blank-vs-blank still deduped", ftC[0].willFailSave === true);
  const ftCneg = flagDuplicateActivityRows(
    [{ date: D, description: 'Fee', amount: -2, account: 'UNFCU Savings' }],
    existingBothBlank
  );
  ok("C(fallthrough): named vs both-blank -> importable", ftCneg[0].willFailSave === false);

  // D. Non-empty account_name WINS over source_account.
  const existingNameWins = [{ date: D, merchant: 'Transfer', amount: -25, bank_reference: null, account_name: 'UNFCU Savings', source_account: 'BG Checking' }];
  const ftD = flagDuplicateActivityRows(
    [{ date: D, description: 'Transfer', amount: -25, account: 'UNFCU Savings' }],
    existingNameWins
  );
  ok("D(fallthrough): non-empty account_name wins (matches account_name)", ftD[0].willFailSave === true);
  const ftDneg = flagDuplicateActivityRows(
    [{ date: D, description: 'Transfer', amount: -25, account: 'BG Checking' }],
    existingNameWins
  );
  ok("D(fallthrough): source_account is NOT used when account_name set", ftDneg[0].willFailSave === false);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
