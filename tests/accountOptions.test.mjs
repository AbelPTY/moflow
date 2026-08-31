// Synthetic tests for account identity + multi-image merge/dedupe helpers.
// FICTIONAL data only. Loaded through Vite SSR (pure modules, no Supabase/env).
//
// Run (where Node exists) from repo root:  node tests/accountOptions.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { mergeAccountOptions, dedupeDetectedAccounts, normalizeAccountName, isEligibleCashType, accountNameChanged, transactionMatchesAccountName, matchAccountByName } =
    await vite.ssrLoadModule('/src/lib/accountOptions.js');
  const { flagDuplicateActivityRows } =
    await vite.ssrLoadModule('/src/lib/dedupeTransactions.js');

  // 1. Multiple same-type accounts remain distinct.
  const accts = [
    { id: 'a1', account_name: 'Banco General Checking', account_type: 'checking', is_active: true },
    { id: 'a2', account_name: 'UNFCU Checking', account_type: 'checking', is_active: true },
    { id: 'a3', account_name: 'BG Savings', account_type: 'savings', is_active: true },
    { id: 'a4', account_name: 'UNFCU Savings', account_type: 'savings', is_active: true },
    { id: 'a5', account_name: 'Emergency Fund', account_type: 'savings', is_active: true },
  ];
  const opts = mergeAccountOptions(accts, []);
  ok('five distinct accounts stay five', opts.length === 5);
  ok('two checking coexist', opts.filter((o) => o.type === 'checking').length === 2);
  ok('three savings coexist', opts.filter((o) => o.type === 'savings').length === 3);

  // 2. Normalization keeps different names distinct.
  ok('BG Savings != UNFCU Savings',
    normalizeAccountName('BG Savings') !== normalizeAccountName('UNFCU Savings'));
  ok('normalization only case/space-folds',
    normalizeAccountName('  BG   Savings ') === normalizeAccountName('bg savings'));

  // Backward compatibility: legacy transaction names appear; first-class wins on dup name.
  const merged = mergeAccountOptions(
    [{ id: 'x', account_name: 'UNFCU Savings', account_type: 'savings', is_active: true }],
    ['UNFCU Savings', 'Banco General', 'Cash']
  );
  ok('legacy names preserved', merged.some((o) => o.name === 'Banco General' && o.source === 'legacy'));
  ok('dup name deduped to first-class', merged.filter((o) => normalizeAccountName(o.name) === 'unfcu savings').length === 1);
  ok('first-class wins the dup', merged.find((o) => normalizeAccountName(o.name) === 'unfcu savings').source === 'account');

  // Eligible cash types.
  ok('checking eligible', isEligibleCashType('checking'));
  ok('savings eligible', isEligibleCashType('savings'));
  ok('cash eligible', isEligibleCashType('cash'));
  ok('investment NOT eligible', !isEligibleCashType('investment'));
  ok('credit_card NOT eligible', !isEligibleCashType('credit_card'));

  // 5. Multi-image balances: same account across screenshots is NOT summed; distinct kept.
  const detected = [
    { name: 'BG Savings', balance: 5000, currency: 'USD', type: 'savings' }, // screenshot 1
    { name: 'BG Savings', balance: 5000, currency: 'USD', type: 'savings' }, // screenshot 2 (same acct)
    { name: 'UNFCU Savings', balance: 3200, currency: 'USD', type: 'savings' },
  ];
  const deduped = dedupeDetectedAccounts(detected);
  ok('duplicate account collapses to one', deduped.filter((d) => normalizeAccountName(d.name) === 'bg savings').length === 1);
  ok('BG Savings not summed (stays 5000)', Number(deduped.find((d) => normalizeAccountName(d.name) === 'bg savings').balance) === 5000);
  ok('distinct savings kept separate', deduped.length === 2);

  // dedupe prefers the record that actually has a balance.
  const withZero = dedupeDetectedAccounts([
    { name: 'Checking A', balance: 0, currency: 'USD', type: 'checking' },
    { name: 'Checking A', balance: 1200, currency: 'USD', type: 'checking' },
  ]);
  ok('prefers the populated balance', withZero.length === 1 && Number(withZero[0].balance) === 1200);

  // 3 + 4. Multi-image Activity: concatenated screenshots with an overlapping row -> one importable.
  const shot1 = [{ date: '2026-08-10', description: 'Super 99', amount: -42.35, reference: '' }];
  const shot2 = [
    { date: '2026-08-10', description: 'Super 99', amount: -42.35, reference: '' }, // overlap w/ shot1
    { date: '2026-08-11', description: 'Cafe', amount: -6.5, reference: '' },
  ];
  const flagged = flagDuplicateActivityRows([...shot1, ...shot2], []);
  const importable = flagged.filter((r) => !r.willFailSave);
  ok('overlapping row not imported twice', importable.length === 2);
  ok('overlap flagged as hard duplicate', flagged.filter((r) => r.willFailSave).length === 1);
  ok('the unique Cafe row survives', importable.some((r) => r.description === 'Cafe'));

  // 6. Single-image backward compat: empty first-class accounts -> legacy only.
  const legacyOnly = mergeAccountOptions([], ['UNFCU', 'Banco General']);
  ok('empty accounts -> legacy names', legacyOnly.length === 2 && legacyOnly.every((o) => o.source === 'legacy'));

  // C/D. Account rename targets only the OLD exact name; other accounts untouched.
  ok('rename detected (name changed)', accountNameChanged('BG Savings', 'Emergency Savings') === true);
  ok('type/institution-only edit is NOT a rename', accountNameChanged('BG Savings', 'BG Savings') === false);
  ok('empty old name is not a rename', accountNameChanged('', 'BG Savings') === false);
  const rowBG = { account_name: 'BG Savings', source_account: 'BG Savings' };
  const rowUNFCU = { account_name: 'UNFCU Savings', source_account: 'UNFCU Savings' };
  ok('rename matches the old exact account', transactionMatchesAccountName(rowBG, 'BG Savings') === true);
  ok('rename does NOT touch another same-type account', transactionMatchesAccountName(rowUNFCU, 'BG Savings') === false);
  ok('rename also matches on source_account', transactionMatchesAccountName({ account_name: 'x', source_account: 'BG Savings' }, 'BG Savings') === true);

  // E. Deactivate keeps history accessible: an inactive first-class account drops
  // from selectors, but its name still surfaces via the legacy transaction path.
  const withInactive = mergeAccountOptions(
    [{ id: 'i', account_name: 'Old Savings', account_type: 'savings', is_active: false }],
    ['Old Savings']
  );
  ok('inactive account name still available', withInactive.some((o) => o.name === 'Old Savings'));
  ok('inactive first-class dropped, legacy retained', withInactive.find((o) => o.name === 'Old Savings').source === 'legacy');

  // A/F. First-class + legacy merge into ONE selector list (AddTransaction/BulkUpload pattern).
  const selector = mergeAccountOptions(
    [
      { id: 'c1', account_name: 'Banco General Checking', account_type: 'checking', is_active: true },
      { id: 's1', account_name: 'Emergency Savings', account_type: 'savings', is_active: true },
    ],
    ['Old UNFCU Account'] // legacy transaction-only name
  );
  const selectorNames = selector.map((o) => o.name);
  ok('selector has first-class + legacy-only', selectorNames.includes('Banco General Checking') && selectorNames.includes('Emergency Savings') && selectorNames.includes('Old UNFCU Account'));

  // D. A bare "savings" does NOT resolve to one of several savings accounts.
  const savingsAccts = [
    { id: 'a', account_name: 'BG Savings', account_type: 'savings', is_active: true },
    { id: 'b', account_name: 'UNFCU Savings', account_type: 'savings', is_active: true },
    { id: 'c', account_name: 'Emergency Savings', account_type: 'savings', is_active: true },
  ];
  ok('bare "savings" resolves to nothing', matchAccountByName('savings', savingsAccts) === null);
  ok('bare "checking" resolves to nothing', matchAccountByName('checking', savingsAccts) === null);

  // E. A strong (normalized) name match identifies the correct account.
  ok('strong name match identifies account', matchAccountByName('bg savings', savingsAccts)?.id === 'a');
  ok('strong match is exact-normalized, not fuzzy', matchAccountByName('UNFCU Savings', savingsAccts)?.id === 'b');
  ok('inactive accounts are not matched', matchAccountByName('Dead', [{ id: 'z', account_name: 'Dead', account_type: 'savings', is_active: false }]) === null);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
