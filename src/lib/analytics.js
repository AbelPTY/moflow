// Privacy-preserving product analytics guard (first-party Supabase only).
//
// DENY BY DEFAULT. The ONLY things that can ever be persisted are:
//   * an allowlisted event NAME, and
//   * an optional, enum-checked `source_screen` label.
//
// It NEVER transmits amounts, balances, principal, payments, APR, interest,
// income, statement values, account/card/loan/bank/merchant names, transaction
// descriptions, references, last-four digits, financial dates, email, name,
// user_id, Telegram data, screenshot/OCR/AI-extracted content, or arbitrary
// objects. Any key that is not `source_screen` is silently dropped; any value
// that is not an allowed screen is silently dropped; any event that is not
// allowlisted is refused. Analytics can never throw into the product UI.

// Allowlisted product ACTION names. Anything not in this set is refused.
const ALLOWED_EVENTS = new Set([
  // Cards
  'card_scan_started',
  'card_scan_completed',
  'card_saved',
  // Flow
  'flow_opened',
  'flow_setup_completed',
  'balance_scan_started',
  'balance_scan_applied',
  'extra_income_added',
  'custom_horizon_used',
  // Activity
  'activity_scan_started',
  'activity_scan_completed',
  'activity_import_completed',
  // Onboarding
  'onboarding_flow_bridge_clicked',
  'onboarding_activity_prompt_clicked',
  // Loans (reserved for the upcoming Loans feature; safe to accept early)
  'loan_section_opened',
  'loan_added',
  'loan_edited',
  'loan_simulator_opened',
  'loan_extra_payment_tested',
  'loan_recurring_extra_tested',
  'loan_payment_added_to_flow',
  // Transaction Intelligence (aggregate product events only — never merchant,
  // amount, category, description, account, or user identity).
  'transaction_auto_categorized',
  'transaction_suggestion_accepted',
  'transaction_suggestion_changed',
  'transaction_rule_created',
  'transaction_bulk_reclassified',
  'categorization_review_opened',
]);

// The ONLY permitted metadata is `source_screen`, restricted to this enum.
// 'loans' is intentionally reserved for when Loans becomes its own screen; it
// is NOT accepted yet, so arbitrary strings can never pass through.
const ALLOWED_SOURCE_SCREENS = new Set(['cards', 'flow', 'activity']);

const isDev = () => {
  try {
    return !!(import.meta && import.meta.env && import.meta.env.DEV);
  } catch {
    return false;
  }
};

// Pure and side-effect-free. Returns the EXACT row that may be persisted, or
// null if the event is not allowlisted. Only `event_name` and an optional,
// enum-validated `source_screen` ever survive; everything else is discarded.
export function sanitizeEvent(eventName, metadata) {
  if (typeof eventName !== 'string' || !ALLOWED_EVENTS.has(eventName)) {
    return null;
  }

  const row = { event_name: eventName };

  // Read ONLY source_screen from a plain object; ignore every other key and any
  // non-object (arrays, financial objects, primitives) entirely.
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const screen = metadata.source_screen;
    if (typeof screen === 'string' && ALLOWED_SOURCE_SCREENS.has(screen)) {
      row.source_screen = screen;
    }
  }

  return row;
}

// Fire-and-forget event tracker. Never awaited into the UI, never throws, and
// swallows all insert/import failures so analytics can never break the app.
export function trackProductEvent(eventName, metadata) {
  try {
    const row = sanitizeEvent(eventName, metadata);
    if (!row) {
      if (isDev()) {
        // Safe: logs only the (non-financial) event name that was blocked.
        console.warn(`[analytics] blocked non-allowlisted event: ${String(eventName)}`);
      }
      return;
    }

    // Lazy import keeps analytics off the critical import path and keeps the
    // pure guard independently testable (no Supabase/env needed to test it).
    import('./supabase')
      .then(({ supabase }) => supabase.from('product_events').insert(row))
      .then(
        () => {},
        () => {} // swallow insert/import errors -- analytics is best-effort
      );
  } catch {
    // Absolutely never let analytics surface an error into the product UI.
  }
}

export { ALLOWED_EVENTS, ALLOWED_SOURCE_SCREENS };
export default trackProductEvent;
