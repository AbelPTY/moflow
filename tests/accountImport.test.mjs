// Synthetic tests for statement-import account assignment + destination
// precedence. FICTIONAL data only. Loaded through Vite SSR (pure module).
//
// Run (where Node exists) from repo root:  node tests/accountImport.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const {
    mergeAccountOptions, normalizeAccountName, applyImportAccount,
    analyzeDetectedImportAccounts, prepareImportAccountAssignment,
  } = await vite.ssrLoadModule('/src/lib/accountOptions.js');

  // Existing-account selection + new-account creation surface in merged options.
  const existing = mergeAccountOptions(
    [{ id: 'c1', account_name: 'Banco General Checking', account_type: 'checking', is_active: true }],
    []
  ).map((o) => o.name);
  ok('existing account selectable', existing.includes('Banco General Checking'));
  const afterCreate = mergeAccountOptions(
    [{ id: 'n1', account_name: 'UNFCU Savings', account_type: 'savings', is_active: true }],
    []
  ).map((o) => o.name);
  ok('new free-form account appears in options', afterCreate.includes('UNFCU Savings'));

  // Two savings stay independent.
  const many = mergeAccountOptions(
    [
      { id: 's1', account_name: 'BG Savings', account_type: 'savings', is_active: true },
      { id: 's2', account_name: 'UNFCU Savings', account_type: 'savings', is_active: true },
    ],
    []
  );
  ok('two savings not collapsed', many.length === 2);

  // ---- Destination precedence ----

  // A. No detected account -> selectedAccount applies to all rows.
  const plain = [
    { date: '2026-09-01', amount: -42.35, category: 'Groceries' },
    { date: '2026-09-02', amount: 3000, category: 'Income' },
  ];
  ok('A: analyze(none)', analyzeDetectedImportAccounts(plain).mode === 'none');
  const aOut = prepareImportAccountAssignment(plain, 'UNFCU Savings');
  ok('A: selectedAccount applied to all', aOut.every((r) => r.account_name === 'UNFCU Savings' && r.source_account === 'UNFCU Savings'));
  ok('A: signs/categories preserved', aOut[0].amount === -42.35 && aOut[1].amount === 3000 && aOut[1].category === 'Income');

  // B. One detected account -> becomes the suggested/prefilled destination.
  const unfcu = [
    { amount: -12.5, category: 'Fees', account_name: 'UNFCU Statement' },
    { amount: 40, category: 'Interest Income', account_name: 'UNFCU Statement' },
  ];
  const analyzed = analyzeDetectedImportAccounts(unfcu);
  ok('B: analyze(single)', analyzed.mode === 'single');
  ok('B: suggestedAccount is the detected one', analyzed.suggestedAccount === 'UNFCU Statement');

  // C / E. User changes destination -> selectedAccount OVERRIDES detected on every row.
  const cOut = prepareImportAccountAssignment(unfcu, 'UNFCU Savings');
  ok('C/E: explicit destination overrides single detected', cOut.every((r) => r.account_name === 'UNFCU Savings' && r.source_account === 'UNFCU Savings'));
  ok('C/E: applyImportAccount overwrites when name set', applyImportAccount([{ account_name: 'UNFCU Statement' }], 'UNFCU Savings')[0].account_name === 'UNFCU Savings');
  // Interest credit still preserved (not converted / not forced expense).
  ok('C/E: interest credit sign preserved', cOut[1].amount === 40 && cOut[1].category === 'Interest Income');

  // D / F. Two+ distinct detected accounts (Cooperativa voucher) -> preserve per-row.
  const coop = [
    { amount: -100, category: 'Savings', account_name: 'Aportaciones' },
    { amount: -50, category: 'Insurance', account_name: 'Insurance' },
    { amount: -200, category: 'Loan Payment', account_name: 'Loan' },
  ];
  ok('D/F: analyze(multi)', analyzeDetectedImportAccounts(coop).mode === 'multi');
  const dOut = prepareImportAccountAssignment(coop, 'Checking');
  ok('D/F: per-row accounts preserved', dOut[0].account_name === 'Aportaciones' && dOut[1].account_name === 'Insurance' && dOut[2].account_name === 'Loan');
  ok('D/F: multi-account NOT merged into selectedAccount', !dOut.some((r) => r.account_name === 'Checking'));

  // G. Multi-page single-account statement (no per-row account) -> one destination.
  const page1 = [{ amount: -10, category: 'Dining Out' }];
  const page2 = [{ amount: -20, category: 'Transportation' }];
  const page3 = [{ amount: -30, category: 'Groceries' }];
  const gOut = prepareImportAccountAssignment([...page1, ...page2, ...page3], 'BG Savings');
  ok('G: multi-page all one destination', gOut.length === 3 && gOut.every((r) => r.account_name === 'BG Savings'));

  // Empty selection does not blank an existing detected account.
  ok('empty selection keeps detected', applyImportAccount([{ account_name: 'Kept' }], '')[0].account_name === 'Kept');
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
