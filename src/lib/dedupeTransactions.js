// Account-aware duplicate-flagging for transaction imports, mirroring the DB's
// partial unique indexes (which are account-aware after the account-dedupe
// migration):
//   * rows WITH a reference collide only on account + date + description + amount + reference
//   * rows WITHOUT a reference collide on account + date + description + amount
//
// Account identity is normalized from account_name (then source_account, then
// blank). Different accounts therefore allow identical-looking transactions;
// duplicates WITHIN the same account are still flagged. Legacy blank-account
// rows collide only with other blank-account rows (conservative, not exempt).
//
// It flags, but never deletes or blocks: callers decide what to do (e.g. default
// likely duplicates to unselected). It is NOT a fuzzy amount-only deduper.
//
// Candidate row shape: { date, description, amount, reference, account? }
//   (account = the chosen destination; falls back to account_name/source_account)
// Existing DB row shape: { date, amount, bank_reference, description, merchant, account_name, source_account }
//
// Returns each candidate row with: isDuplicate, duplicateNote, willFailSave.

const dateKeyOf = (d) => String(d || '').slice(0, 10);
const amountKeyOf = (a) => Number(a || 0).toFixed(2);
const textKeyOf = (s) => String(s || '').trim().toLowerCase();
// Deterministic account identity for dedupe: trim + case-fold + space-collapse.
// No personal canonicalization aliases -- "UNFCU Savings" and "BG Savings" stay
// distinct. Source order is the first NON-BLANK of: account (explicit
// destination) -> account_name -> source_account, else '' (blank fallback). A
// blank/whitespace-only earlier field falls through to the next, matching the
// SQL identity coalesce(nullif(btrim(account_name),''), nullif(btrim(source_account),''), '').
const acctKeyOf = (row) => {
  for (const v of [row?.account, row?.account_name, row?.source_account]) {
    const s = String(v ?? '').trim();
    if (s) return s.toLowerCase().replace(/\s+/g, ' ');
  }
  return '';
};

export function flagDuplicateActivityRows(rows, existingRows = []) {
  const cleanRows = Array.isArray(rows) ? rows : [];
  if (cleanRows.length === 0) return [];

  const existingWithRef = new Set(); // acct|date|desc|amount|ref
  const existingWithoutRef = new Set(); // acct|date|desc|amount
  const existingByAcctDateAmount = new Map();

  for (const row of existingRows || []) {
    const acct = acctKeyOf(row);
    const dateKey = dateKeyOf(row.date);
    const amountKey = amountKeyOf(row.amount);
    // Existing rows may carry the description in either description or merchant.
    const descKey = textKeyOf(row.description || row.merchant);
    const refKey = row.bank_reference ? textKeyOf(row.bank_reference) : '';

    if (refKey) existingWithRef.add(`${acct}|${dateKey}|${descKey}|${amountKey}|${refKey}`);
    else existingWithoutRef.add(`${acct}|${dateKey}|${descKey}|${amountKey}`);

    const key = `${acct}|${dateKey}|${amountKey}`;
    if (!existingByAcctDateAmount.has(key)) existingByAcctDateAmount.set(key, []);
    existingByAcctDateAmount.get(key).push(row);
  }

  // Pass 1: against saved history (scoped to the candidate's account).
  const withHistory = cleanRows.map((t) => {
    const acct = acctKeyOf(t);
    const dateKey = dateKeyOf(t.date);
    const amountKey = amountKeyOf(t.amount);
    const descKey = textKeyOf(t.description);
    const refKey = t.reference ? textKeyOf(t.reference) : '';

    const hardMatch = refKey
      ? existingWithRef.has(`${acct}|${dateKey}|${descKey}|${amountKey}|${refKey}`)
      : existingWithoutRef.has(`${acct}|${dateKey}|${descKey}|${amountKey}`);

    if (hardMatch) {
      return {
        ...t,
        isDuplicate: true,
        duplicateNote: 'Exact match already saved',
        willFailSave: true,
      };
    }

    // Soft match: same account + date + amount and a similar description already saved.
    const candidates = existingByAcctDateAmount.get(`${acct}|${dateKey}|${amountKey}`);
    if (candidates && candidates.length > 0) {
      const looksSame = candidates.some((c) => {
        const cDesc = textKeyOf(c.description);
        const cMerchant = textKeyOf(c.merchant);
        return (
          (cDesc && (cDesc === descKey || cDesc.includes(descKey) || descKey.includes(cDesc))) ||
          (cMerchant && (cMerchant === descKey || cMerchant.includes(descKey) || descKey.includes(cMerchant)))
        );
      });
      if (looksSame && descKey) {
        return {
          ...t,
          isDuplicate: true,
          duplicateNote: 'Same date, amount & description already saved',
          willFailSave: false,
        };
      }
    }

    return { ...t, isDuplicate: false, duplicateNote: '', willFailSave: false };
  });

  // Pass 2: collisions WITHIN this batch (same account-aware, reference-aware logic).
  const seenWithRef = new Set();
  const seenWithoutRef = new Set();
  return withHistory.map((t) => {
    if (t.willFailSave) return t;
    const acct = acctKeyOf(t);
    const dateKey = dateKeyOf(t.date);
    const amountKey = amountKeyOf(t.amount);
    const descKey = textKeyOf(t.description);
    const refKey = t.reference ? textKeyOf(t.reference) : '';

    if (refKey) {
      const key = `${acct}|${dateKey}|${descKey}|${amountKey}|${refKey}`;
      if (seenWithRef.has(key)) {
        return {
          ...t,
          isDuplicate: true,
          duplicateNote: 'Duplicate of another row in this import',
          willFailSave: true,
        };
      }
      seenWithRef.add(key);
    } else {
      const key = `${acct}|${dateKey}|${descKey}|${amountKey}`;
      if (seenWithoutRef.has(key)) {
        return {
          ...t,
          isDuplicate: true,
          duplicateNote: 'Same date, description & amount as another row here',
          willFailSave: true,
        };
      }
      seenWithoutRef.add(key);
    }
    return t;
  });
}

export default flagDuplicateActivityRows;
