// Flow "Available cash" persistence (V2.7.1). Pure, storage-injectable helpers
// for the ONE central confirmed starting-balance scalar the Flow projection uses.
//
// SEMANTICS (the point of this module):
//   * There is exactly one confirmed value, changed ONLY by an explicit user
//     action ("Use $X as available cash", or a manual entry). Scanning account
//     balances, account refreshes, and re-renders must NEVER change it.
//   * The value is restored EXACTLY on relaunch/refresh/reopen. Restoration is
//     synchronous (lazy state init) so it can't be lost to effect ordering.
//   * "NO VALUE SET" (key absent) is DISTINCT from "user confirmed $0.00":
//       - key absent            -> '' (unset/default; projection treats as 0)
//       - stored '0'            -> '0' (a real confirmed zero, survives relaunch)
//   * A `|| 0` fallback is NEVER persisted: an empty/blank confirmation CLEARS
//     the key (back to unset), it is not written as 0.
//   * Corrupt/invalid stored data fails SAFE to unset — without overwriting or
//     zeroing the stored value — and never throws (private mode / quota / no DOM).

export const AVAILABLE_CASH_KEY = 'cashflow_available_cash';

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage access itself can throw (sandboxed/blocked)
  }
}

// Read the confirmed available-cash value as a string.
//   -> ''          when NO value is set, or the stored value is invalid/corrupt
//   -> the stored numeric string (INCLUDING '0') for a valid confirmed value
// Never throws; never rewrites storage.
export function readAvailableCash(storage) {
  const s = storage || safeStorage();
  if (!s) return '';
  let raw;
  try {
    raw = s.getItem(AVAILABLE_CASH_KEY);
  } catch {
    return ''; // storage unavailable -> unset/default, don't crash
  }
  if (raw === null || raw === undefined) return ''; // NO VALUE SET
  const str = String(raw).trim();
  if (str === '') return ''; // treat a stored blank as unset
  const n = Number(str);
  if (!Number.isFinite(n)) return ''; // corrupt -> unset (do NOT overwrite it)
  return str; // valid confirmed value, including '0'
}

// Persist an explicitly confirmed value. An empty/blank value CLEARS the key
// (unset) rather than storing 0; any real value — INCLUDING '0' — is stored
// verbatim so a confirmed $0.00 survives relaunch. Never throws.
export function writeAvailableCash(value, storage) {
  const s = storage || safeStorage();
  if (!s) return;
  const str = value == null ? '' : String(value).trim();
  try {
    if (str === '') s.removeItem(AVAILABLE_CASH_KEY);
    else s.setItem(AVAILABLE_CASH_KEY, str);
  } catch {
    // Private mode / quota — keep the in-session React state; nothing else to do.
  }
}

// True only when a value has been explicitly confirmed (including a confirmed
// $0.00). Distinguishes an intentional zero from "never set".
export function hasConfirmedAvailableCash(storage) {
  return readAvailableCash(storage) !== '';
}
