// Flow Account Balance Scan UX V1 — pure targeted-scan logic + i18n parity.
// FICTIONAL data only. Proves write-safety (target account id only), conflict
// detection (exact-normalized, no fuzzy), no-batch-write in targeted mode, and
// that Available Cash is never touched by these helpers.
//
// Run (where Node exists) from repo root:  node tests/balanceScan.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const {
    isCreditScanRow, targetedCandidateRows, detectTargetConflict, buildTargetedBalanceUpdate,
  } = await vite.ssrLoadModule('/src/lib/balanceScan.js');
  const { matchAccountByName } = await vite.ssrLoadModule('/src/lib/accountOptions.js');
  const { translate } = await vite.ssrLoadModule('/src/i18n/core.js');
  const en = (k, v) => translate('en-US', k, v);
  const es = (k, v) => translate('es-PA', k, v);
  const differs = (k, v) => en(k, v) !== es(k, v) && en(k, v) !== k && es(k, v) !== k;

  const today = '2026-09-15';
  // Fictional first-class accounts.
  const bgChecking = { id: 'acc-1', account_name: 'Banco General Checking', account_type: 'checking', currency: 'USD', is_active: true };
  const bgSavings  = { id: 'acc-2', account_name: 'Banco General Savings',  account_type: 'savings',  currency: 'USD', is_active: true };
  const unfcu      = { id: 'acc-3', account_name: 'UNFCU Checking',         account_type: 'checking', currency: 'USD', is_active: true };
  const accounts = [bgChecking, bgSavings, unfcu];

  // ---- C. Targeted persistence writes ONLY targetAccount.id ----
  {
    const u = buildTargetedBalanceUpdate(bgChecking, '1250', today);
    ok('C: writes target id only', u && u.id === 'acc-1');
    ok('C: writes the confirmed balance', u.current_balance === 1250);
    ok('C: L balance_as_of written', u.balance_as_of === today);
  }

  // ---- D. Targeted helper never yields anything cash-related (no setCash path) ----
  {
    const u = buildTargetedBalanceUpdate(bgChecking, '1250', today);
    const keys = Object.keys(u).sort().join(',');
    ok('D: only id/current_balance/balance_as_of returned (no cash field)', keys === 'balance_as_of,current_balance,id');
  }

  // ---- G. Same-account targeted scan: no conflict ----
  {
    const detected = { name: 'Banco General Checking', balance: 1250, type: 'checking', is_credit: false };
    ok('G: exact match to target = no conflict', detectTargetConflict(detected, bgChecking, accounts) === null);
  }

  // ---- H. Conflicting identity does NOT silently write; flags the conflict ----
  {
    const detected = { name: 'Banco General Savings', balance: 3400, type: 'savings', is_credit: false };
    const c = detectTargetConflict(detected, bgChecking, accounts);
    ok('H: conflict detected when detected name matches a DIFFERENT account', !!c && c.matchedId === 'acc-2');
    ok('H: conflict names both sides', c.detectedName === 'Banco General Savings' && c.targetName === 'Banco General Checking');
    // The write, if the user still confirms, always targets the ORIGINAL account.
    const u = buildTargetedBalanceUpdate(bgChecking, '3400', today);
    ok('H: even on conflict, write targets the ORIGINAL target id', u.id === 'acc-1');
  }
  {
    // An unknown detected name (no existing account) is not a conflict.
    const detected = { name: 'Some New Wallet', balance: 50, type: 'cash', is_credit: false };
    ok('H: unknown name is not a conflict', detectTargetConflict(detected, bgChecking, accounts) === null);
  }

  // ---- I. Multiple extracted accounts in targeted mode do NOT batch-write ----
  {
    const rows = [
      { id: 'r1', name: 'Banco General Checking', balance: 1250, type: 'checking', is_credit: false },
      { id: 'r2', name: 'Banco General Savings',  balance: 3400, type: 'savings',  is_credit: false },
      { id: 'r3', name: 'Visa',                   balance: 900,  type: 'credit_card', is_credit: true },
    ];
    const candidates = targetedCandidateRows(rows);
    ok('I: credit rows excluded from candidates', candidates.length === 2 && !candidates.some((r) => r.id === 'r3'));
    // Targeted mode builds ONE write from the user-picked balance — never a batch.
    const u = buildTargetedBalanceUpdate(bgChecking, candidates[0].balance, today);
    ok('I: single write object (not an array/batch)', !Array.isArray(u) && u.id === 'acc-1');
  }

  // ---- J. Cancel produces no write: no update is built without a confirmed value ----
  {
    ok('J: null balance -> no write', buildTargetedBalanceUpdate(bgChecking, '', today) === null);
    ok('J: non-numeric -> no write', buildTargetedBalanceUpdate(bgChecking, 'abc', today) === null);
    ok('J: no target account -> no write', buildTargetedBalanceUpdate(null, '10', today) === null);
  }

  // ---- K. current_balance = 0 is a VALID write ----
  {
    const u = buildTargetedBalanceUpdate(bgChecking, '0', today);
    ok('K: zero balance is a valid write', u && u.current_balance === 0);
    const u2 = buildTargetedBalanceUpdate(bgChecking, 0, today);
    ok('K: numeric zero also valid', u2 && u2.current_balance === 0);
  }

  // ---- credit-row classification ----
  {
    ok('credit: credit_card is credit', isCreditScanRow({ type: 'credit_card' }) === true);
    ok('credit: is_credit flag respected', isCreditScanRow({ type: 'other', is_credit: true }) === true);
    ok('credit: checking is not credit', isCreditScanRow({ type: 'checking' }) === false);
  }

  // ---- exact-normalized matching reused (no fuzzy) ----
  {
    ok('match: case/spacing-insensitive exact match', matchAccountByName('banco  general   checking', accounts)?.id === 'acc-1');
    ok('match: bare "checking" does not resolve to one of several', matchAccountByName('checking', accounts) === null);
  }

  // ---- N. EN/ES parity for new/changed keys ----
  const keys = [
    'flow.scanBalances', 'flow.scanAccount', 'flow.editAccount',
    'balanceScanner.detectedBalance', 'balanceScanner.confirmUpdate',
  ];
  keys.forEach((k) => ok(`N: EN/ES differ for ${k}`, differs(k)));
  ok('N: targetHeader interpolates account (EN)', en('balanceScanner.targetHeader', { account: 'Banco General Checking' }) === 'Update balance: Banco General Checking');
  ok('N: targetHeader interpolates account (ES)', es('balanceScanner.targetHeader', { account: 'Banco General Checking' }) === 'Actualizar saldo: Banco General Checking');
  ok('N: targetMismatch interpolates both (EN)', /Banco General Savings/.test(en('balanceScanner.targetMismatch', { detected: 'Banco General Savings', target: 'Banco General Checking' })) && /Banco General Checking/.test(en('balanceScanner.targetMismatch', { detected: 'Banco General Savings', target: 'Banco General Checking' })));
  ok('N: targetMismatch ES differs from EN', differs('balanceScanner.targetMismatch', { detected: 'X', target: 'Y' }));
  // Success-message pluralization routed through i18n.
  ok('N: savedOne EN/ES', en('balanceScanner.savedOne') === 'Saved 1 account balance.' && es('balanceScanner.savedOne') === 'Se guardó 1 saldo de cuenta.');
  ok('N: savedMany interpolates count', en('balanceScanner.savedMany', { count: 3 }) === 'Saved 3 account balances.' && es('balanceScanner.savedMany', { count: 3 }) === 'Se guardaron 3 saldos de cuenta.');
  ok('N: scanBalances relabeled to account balances', en('flow.scanBalances') === 'Scan account balances' && es('flow.scanBalances') === 'Escanear saldos de cuentas');

  // ---- B/O. targetAccount is optional; bulk callers unaffected. The bulk path
  //      does not use these helpers, and no helper requires a target to exist for
  //      the module to load. (Component-level bulk behavior is unchanged.) ----
  ok('B/O: helpers tolerate absent target (optional prop contract)', buildTargetedBalanceUpdate(undefined, '10', today) === null && detectTargetConflict({ name: 'x' }, null, accounts) === null);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
