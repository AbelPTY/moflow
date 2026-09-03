// Flow "Available cash" persistence (V2.7.1) — pure helper tests with an
// injected fake storage (no DOM, no DB). FICTIONAL amounts only.
//
// Run (where Node exists) from repo root:  node tests/availableCash.test.mjs
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

// A minimal localStorage-shaped fake. `throwing` simulates private-mode/quota.
function fakeStorage(initial = {}, { throwing = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) { if (throwing) throw new Error('blocked'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (throwing) throw new Error('blocked'); map.set(k, String(v)); },
    removeItem(k) { if (throwing) throw new Error('blocked'); map.delete(k); },
    _dump: () => Object.fromEntries(map),
    _has: (k) => map.has(k),
  };
}

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const AC = await vite.ssrLoadModule('/src/lib/availableCash.js');
  const { readAvailableCash, writeAvailableCash, hasConfirmedAvailableCash, AVAILABLE_CASH_KEY } = AC;
  const K = AVAILABLE_CASH_KEY;

  // A. no stored value -> unset/default (''), and nothing was persisted as zero.
  {
    const s = fakeStorage();
    ok('A: absent key -> unset ""', readAvailableCash(s) === '');
    ok('A: absent key -> not confirmed', hasConfirmedAvailableCash(s) === false);
    ok('A: reading did NOT create a persisted 0', !s._has(K));
  }

  // B. stored 2700 -> restores exactly.
  {
    const s = fakeStorage({ [K]: '2700' });
    ok('B: restores 2700', readAvailableCash(s) === '2700');
    ok('B: is confirmed', hasConfirmedAvailableCash(s) === true);
  }

  // C. stored '0' -> restores a CONFIRMED zero (distinct from unset).
  {
    const s = fakeStorage({ [K]: '0' });
    ok('C: restores confirmed 0', readAvailableCash(s) === '0');
    ok('C: confirmed zero is "confirmed"', hasConfirmedAvailableCash(s) === true);
  }

  // D. explicit confirmation persists the exact value.
  {
    const s = fakeStorage();
    writeAvailableCash('2700', s);
    ok('D: persists confirmed value', s._dump()[K] === '2700' && readAvailableCash(s) === '2700');
  }

  // E. navigation/remount restores value (a fresh read from the same storage).
  {
    const s = fakeStorage();
    writeAvailableCash('1850.50', s);
    // simulate a remount: brand-new lazy init reads the same storage
    ok('E: remount restores value', readAvailableCash(s) === '1850.50');
  }

  // F/G. scanner balance update / account-total change do NOT touch available
  // cash — the module has NO path that writes from balances. Confirm that
  // writing account data under other keys leaves the confirmed value intact.
  {
    const s = fakeStorage({ [K]: '2700' });
    s.setItem('some_account_balance', '5000'); // scanner/account writes elsewhere
    ok('F/G: confirmed cash unchanged by other-key writes', readAvailableCash(s) === '2700');
  }

  // H. invalid/corrupt stored value fails safe to unset, WITHOUT overwriting it.
  {
    const s = fakeStorage({ [K]: 'not-a-number' });
    ok('H: corrupt -> unset ""', readAvailableCash(s) === '');
    ok('H: corrupt value NOT overwritten/zeroed', s._dump()[K] === 'not-a-number');
  }
  {
    // storage that throws on access -> unset, no crash.
    const s = fakeStorage({}, { throwing: true });
    let threw = false;
    let val;
    try { val = readAvailableCash(s); } catch { threw = true; }
    ok('H2: throwing storage read -> "" and no crash', val === '' && threw === false);
    let threw2 = false;
    try { writeAvailableCash('100', s); } catch { threw2 = true; }
    ok('H2: throwing storage write -> no crash', threw2 === false);
  }

  // I. manual confirmed update persists (overwrite an earlier value).
  {
    const s = fakeStorage({ [K]: '2700' });
    writeAvailableCash('3125.75', s);
    ok('I: manual update persists', readAvailableCash(s) === '3125.75');
  }

  // Confirmed ZERO round-trips; and a blank confirmation CLEARS (never stores 0).
  {
    const s = fakeStorage();
    writeAvailableCash('0', s);
    ok('C2: writing 0 stores a confirmed zero', s._dump()[K] === '0' && readAvailableCash(s) === '0');
    writeAvailableCash('', s);
    ok('J-clear: blank clears back to unset (not 0)', !s._has(K) && readAvailableCash(s) === '');
    writeAvailableCash('   ', s); // whitespace-only also clears
    ok('J-clear2: whitespace clears to unset', !s._has(K));
    writeAvailableCash(null, s);
    ok('J-clear3: null clears to unset', !s._has(K));
  }

  // J. FlowLite / any remount does not reset a confirmed balance: reading never
  // mutates, so repeated reads (as remounts would do) are stable.
  {
    const s = fakeStorage({ [K]: '2700' });
    readAvailableCash(s); readAvailableCash(s); readAvailableCash(s);
    ok('J: repeated reads (remounts) never mutate the confirmed value', readAvailableCash(s) === '2700' && s._dump()[K] === '2700');
  }

  // K. the projection consumes the restored value: parseFloat(restored) is the
  // number the engine uses; a confirmed 2700 yields 2700, unset yields 0.
  {
    ok('K: restored 2700 -> projection cash 2700', (parseFloat(readAvailableCash(fakeStorage({ [K]: '2700' }))) || 0) === 2700);
    ok('K: unset -> projection cash 0 (but persistence stays unset)', (parseFloat(readAvailableCash(fakeStorage())) || 0) === 0);
  }

  // L. no migration required: persistence is a single localStorage key.
  ok('L: key is a localStorage key (no DB)', AVAILABLE_CASH_KEY === 'cashflow_available_cash');

  // M. /api unchanged.
  ok('M: /api count remains 12', readdirSync('api').filter((f) => f.endsWith('.js')).length === 12);

  console.log(`\nAvailable-cash persistence tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}
