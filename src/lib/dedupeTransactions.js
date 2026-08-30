// Duplicate-flagging for transaction imports, mirroring the strategy already
// used by BulkUpload.jsx (which itself mirrors the DB's partial unique indexes):
//   * rows WITH a reference collide only on date + description + amount + reference
//   * rows WITHOUT a reference collide on date + description + amount
// It flags, but never deletes or blocks: callers decide what to do (e.g. default
// likely duplicates to unselected). It is intentionally NOT a fuzzy amount-only
// deduper, so genuine repeated same-amount purchases are preserved.
//
// Row shape (candidate): { date: 'YYYY-MM-DD', description, amount, reference }
// Existing DB row shape:  { date, amount, bank_reference, description, merchant }
//
// Returns each candidate row with: isDuplicate, duplicateNote, willFailSave.

const dateKeyOf = (d) => String(d || '').slice(0, 10);
const amountKeyOf = (a) => Number(a || 0).toFixed(2);
const textKeyOf = (s) => String(s || '').trim().toLowerCase();

export function flagDuplicateActivityRows(rows, existingRows = []) {
  const cleanRows = Array.isArray(rows) ? rows : [];
  if (cleanRows.length === 0) return [];

  const existingWithRef = new Set(); // date|desc|amount|ref
  const existingWithoutRef = new Set(); // date|desc|amount
  const existingByDateAmount = new Map();

  for (const row of existingRows || []) {
    const dateKey = dateKeyOf(row.date);
    const amountKey = amountKeyOf(row.amount);
    // Existing rows may carry the description in either description or merchant.
    const descKey = textKeyOf(row.description || row.merchant);
    const refKey = row.bank_reference ? textKeyOf(row.bank_reference) : '';

    if (refKey) existingWithRef.add(`${dateKey}|${descKey}|${amountKey}|${refKey}`);
    else existingWithoutRef.add(`${dateKey}|${descKey}|${amountKey}`);

    const key = `${dateKey}|${amountKey}`;
    if (!existingByDateAmount.has(key)) existingByDateAmount.set(key, []);
    existingByDateAmount.get(key).push(row);
  }

  // Pass 1: against saved history.
  const withHistory = cleanRows.map((t) => {
    const dateKey = dateKeyOf(t.date);
    const amountKey = amountKeyOf(t.amount);
    const descKey = textKeyOf(t.description);
    const refKey = t.reference ? textKeyOf(t.reference) : '';

    const hardMatch = refKey
      ? existingWithRef.has(`${dateKey}|${descKey}|${amountKey}|${refKey}`)
      : existingWithoutRef.has(`${dateKey}|${descKey}|${amountKey}`);

    if (hardMatch) {
      return {
        ...t,
        isDuplicate: true,
        duplicateNote: 'Exact match already saved',
        willFailSave: true,
      };
    }

    // Soft match: same date + amount and a similar description already saved.
    const candidates = existingByDateAmount.get(`${dateKey}|${amountKey}`);
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

  // Pass 2: collisions WITHIN this batch (same reference-aware logic).
  const seenWithRef = new Set();
  const seenWithoutRef = new Set();
  return withHistory.map((t) => {
    if (t.willFailSave) return t;
    const dateKey = dateKeyOf(t.date);
    const amountKey = amountKeyOf(t.amount);
    const descKey = textKeyOf(t.description);
    const refKey = t.reference ? textKeyOf(t.reference) : '';

    if (refKey) {
      const key = `${dateKey}|${descKey}|${amountKey}|${refKey}`;
      if (seenWithRef.has(key)) {
        return {
          ...t,
          isDuplicate: true,
          duplicateNote: 'Duplicate of another row in this screenshot',
          willFailSave: true,
        };
      }
      seenWithRef.add(key);
    } else {
      const key = `${dateKey}|${descKey}|${amountKey}`;
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
