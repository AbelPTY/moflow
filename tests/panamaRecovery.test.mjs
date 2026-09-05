// Panama Recovery Pass V1 — anonymized real-world golden regression + coverage.
// FICTIONAL / anonymized data ONLY: no personal names, account numbers, bank
// references, balances, or private memos. Loaded through Vite SSR (no DB/network/AI).
//
// Coverage philosophy: we reward correct deterministic classification AND correct
// abstention. A safe "unresolved" on an ambiguous Yappy is CORRECT behavior; a
// confident wrong guess is the only failure.
//
// Run (where Node exists) from repo root:  node tests/panamaRecovery.test.mjs
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const TI = await vite.ssrLoadModule('/src/lib/transactionIntelligence.js');
  const { classifyTransaction, normalizeMerchant, UNCATEGORIZED } = TI;
  const clf = (description, amount = -20) => classifyTransaction({ description, merchant: description, amount });

  // ---- Anonymized golden fixtures. kind: 'nature' | 'category' | 'abstain' | 'safe'
  const FIX = [
    // Nature — credit card payment
    { id: 'A', description: 'PAGO VISA ****', amount: -500, kind: 'nature', nature: 'credit_card_payment' },
    { id: 'B', description: 'GRACIAS POR SU PAGO - BANCA MOVIL', amount: 500, kind: 'nature', nature: 'credit_card_payment' },
    { id: 'A2', description: 'PAGO MASTERCARD', amount: -300, kind: 'nature', nature: 'credit_card_payment' },
    // Interest
    { id: 'C', description: 'INTERES CUENTA DE AHORROS', amount: 3.25, kind: 'nature', nature: 'interest' },
    { id: 'C2', description: 'INTERESES CUENTA', amount: 1.1, kind: 'nature', nature: 'interest' },
    // Fees / financial charges
    { id: 'D', description: 'COMISION MANEJO DE CUENTA', amount: -5, kind: 'nature', nature: 'fee' },
    { id: 'E1', description: 'SEGURO DE DESGRAVAMEN', amount: -7, kind: 'nature', nature: 'fee' },
    { id: 'E2', description: 'ITBMS CARGO POR SEGURO', amount: -1, kind: 'nature', nature: 'fee' },
    { id: 'E3', description: 'ANUALIDAD TARJETA', amount: -40, kind: 'nature', nature: 'fee' },
    { id: 'E4', description: 'RECARGO POR DEVOLUCION', amount: -6, kind: 'nature', nature: 'fee' },
    // Reversals / refunds (positive must NOT become ordinary income)
    { id: 'F', description: 'DEV ACH - PROVEEDOR', amount: 40, kind: 'nature', nature: 'refund' },
    { id: 'G', description: 'REVERSA ACH', amount: 30, kind: 'nature', nature: 'refund' },
    { id: 'H', description: 'DEVOLUCION', amount: 22, kind: 'category', category: 'Refund/Reimbursement' },
    // ATM / cash withdrawal -> transfer (not consumer expense)
    { id: 'I', description: 'RETIRO ATM VIA ESPANA', amount: -100, kind: 'nature', nature: 'transfer' },
    // Explicit transfers
    { id: 'J1', description: 'TRANSFERENCIA A CUENTA', amount: -50, kind: 'nature', nature: 'transfer' },
    { id: 'J2', description: 'TRANSFERENCIA DE TERCERO', amount: 50, kind: 'nature', nature: 'transfer' },
    { id: 'J3', description: 'ENTRE CUENTAS', amount: -80, kind: 'nature', nature: 'transfer' },
    // Yappy — generic stays safe; memo context may classify; reimbursement = refund
    { id: 'K', description: 'YAPPY BG A PERSONA', amount: -25, kind: 'abstain' },
    { id: 'L', description: 'YAPPY - Servicio electrico ENSA', amount: -30, kind: 'category', category: 'Household/Utilities' },
    { id: 'L2', description: 'YAPPY Servicio Agua IDAAN', amount: -18, kind: 'category', category: 'Household/Utilities' },
    { id: 'L3', description: 'YAPPY Servicio Cable y telefonia casa', amount: -55, kind: 'category', category: 'Household/Utilities' },
    { id: 'M', description: 'YAPPY MM Bash en Zielo restaurant', amount: -40, kind: 'category', category: 'Dining Out' },
    { id: 'N', description: 'YAPPY Reembolso Lunch Tre Scalini', amount: 35, kind: 'nature', nature: 'refund' },
    // Merchants
    { id: 'O', description: 'SUPER KOSHER', amount: -60, kind: 'category', category: 'Groceries' },
    { id: 'P', description: 'FARMACIA EL JAVILLO', amount: -12, kind: 'category', category: 'Medical/Health' },
    { id: 'Q', description: 'FARMA VALUE', amount: -8, kind: 'category', category: 'Medical/Health' },
    { id: 'R', description: 'PANAMA EYE CENTER', amount: -90, kind: 'category', category: 'Medical/Health' },
    { id: 'S', description: 'ATHANASIOU', amount: -25, kind: 'category', category: 'Dining Out' },
    { id: 'T', description: 'LUNG FUNG', amount: -30, kind: 'category', category: 'Dining Out' },
    { id: 'U', description: 'DON LEE', amount: -15, kind: 'category', category: 'Dining Out' },
    { id: 'V', description: 'FACTORY FASHION', amount: -45, kind: 'category', category: 'Shopping' },
    { id: 'W', description: 'ESTACION OLIMPICA', amount: -30, kind: 'category', category: 'Fuel' },
    { id: 'X', description: 'COL. LAS ESCLAVAS', amount: -200, kind: 'category', category: 'Education' },
    { id: 'Y', description: 'WORLDWIDE MEDICAL ASSURANCE', amount: -120, kind: 'category', category: 'Insurance' },
    { id: 'Z', description: 'NETFLIX.COM', amount: -13, kind: 'category', category: 'Subscriptions' },
    { id: 'AA', description: 'GOOGLE *Google One', amount: -2, kind: 'category', category: 'Subscriptions' },
    // ASSA: debit = insurance; DEV/reversal context = refund wins
    { id: 'AD', description: 'ASSA COMPANIA DE SEGUROS', amount: -80, kind: 'category', category: 'Insurance' },
    { id: 'AE', description: 'DEV ACH - ASSA COMPANIA DE SEGUROS', amount: 80, kind: 'nature', nature: 'refund' },
    // Do-not-overclassify guards (safe abstain)
    { id: 'AF', description: 'HOSPITAL NACIONAL', amount: -100, kind: 'abstain', notCategory: 'Medical/Health' },
    { id: 'AG', description: 'YAPPY A PERSONA', amount: -25, kind: 'safe', safe: ['Transfer', UNCATEGORIZED] },
    { id: 'AH', description: 'DELTA AIRLINES TICKET', amount: -300, kind: 'abstain', notCategory: 'Fuel' },
    { id: 'AI', description: 'PUMA STORE MULTIPLAZA', amount: -80, kind: 'abstain', notCategory: 'Fuel' },
    { id: 'AJ', description: 'PRENSA DIGITAL', amount: -10, kind: 'abstain', notCategory: 'Household/Utilities' },
    { id: 'AK', description: 'ASSAULT DEFENSE COURSE', amount: -60, kind: 'abstain', notCategory: 'Insurance' },
  ];

  const cov = { correct: 0, safeAbstain: 0, incorrect: 0 };
  for (const f of FIX) {
    const r = clf(f.description, f.amount);
    let good = false;
    if (f.kind === 'nature') good = r.nature === f.nature;
    else if (f.kind === 'category') good = r.category === f.category;
    else if (f.kind === 'abstain') good = r.category === UNCATEGORIZED && (!f.notCategory || r.category !== f.notCategory);
    else if (f.kind === 'safe') good = f.safe.includes(r.category);
    ok(`${f.id}: ${f.description.slice(0, 32)}`, good);
    if (!good) cov.incorrect += 1;
    else if (f.kind === 'abstain' || (f.kind === 'safe' && r.category === UNCATEGORIZED)) cov.safeAbstain += 1;
    else cov.correct += 1;
  }

  // PayPal wrapper (AB) + PayPal-alone (AC)
  ok('AB: PayPal wrapper exposes underlying merchant', normalizeMerchant('PAYPAL *GENUINEPART') === 'Genuinepart');
  ok('AC: PayPal alone not categorized', clf('PAYPAL', -10).category === UNCATEGORIZED);

  // AL: no private/personal identifiers in the fixture (no long digit runs; uses
  // anonymized "PERSONA"/"PROVEEDOR"/"TERCERO" placeholders only).
  const fixtureDump = JSON.stringify(FIX);
  ok('AL: no account/reference-like digit runs in fixture', !/\d{6,}/.test(fixtureDump));
  ok('AL2: P2P uses anonymized placeholder', /PERSONA/.test(fixtureDump) && /PROVEEDOR/.test(fixtureDump));

  // Coverage metric — reward correct classification + correct abstention; ZERO
  // confident-wrong guesses is the acceptance bar.
  console.log(`\nGolden coverage: ${cov.correct} correctly resolved, ${cov.safeAbstain} safe-abstain, ${cov.incorrect} incorrect (of ${FIX.length})`);
  ok('coverage: zero confident-wrong classifications', cov.incorrect === 0);
  ok('coverage: strong deterministic resolution present', cov.correct >= 25);

  // AM: /api unchanged.
  ok('AM: /api count remains 12', readdirSync('api').filter((f) => f.endsWith('.js')).length === 12);

  console.log(`\nPanama recovery tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
} finally {
  await vite.close();
}
