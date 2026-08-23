// Pure, data-agnostic static-rule matcher shared by every consumer of the
// merchant rule set. It contains NO merchant data and NO personal constants --
// the caller injects the `rules` array. This is the injection seam that will
// LATER let us pass multiple concatenated rule tiers, e.g.
//   findMatchingRule(description, [...userRules, ...institutionRules,
//                                 ...marketRules, ...globalRules])
// without touching the matching engine again. (Those tiers are NOT built yet;
// today every caller keeps passing the existing merchant_rules.json in its
// original order.)
//
// Semantics are preserved EXACTLY as the three original inline loops in
// normalize.js, BulkUpload.jsx and financial-overview/index.jsx:
//   - substring match: description.includes(keyword)
//   - the caller controls description SOURCE and CASING (each caller upper-cases
//     its own description, and the rule tokens are already upper-case); the
//     matcher does not re-case anything
//   - FIRST rule whose matchAny contains ANY matching keyword wins (array order)
//   - returns the matched rule object (carrying .id and .assign), or null
//
// Return the rule itself so existing callers keep reading rule.id / rule.assign
// unchanged. (`assign` and `ruleId` are reachable as matched.assign / matched.id.)
export function findMatchingRule(description, rules) {
  const desc = description == null ? '' : String(description);
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (rule && Array.isArray(rule.matchAny) && rule.matchAny.some((keyword) => desc.includes(keyword))) {
      return rule;
    }
  }
  return null;
}

// USER-tier matcher. Unlike the static rules (substring on a caller-uppercased
// description), user rules carry their own match_field (merchant|description)
// and match_type (exact|contains). This helper is still PURE and data-free:
// callers inject the field values and the already-priority-sorted userRules
// array. It normalizes both sides itself (trim + upper-case) so DB patterns of
// any case compare consistently. FIRST matching rule wins (array order =
// priority order). Returns the matched engine-shaped user rule, or null.
//   - exact:    normalized(field) === normalized(pattern)
//   - contains: normalized(field).includes(normalized(pattern))
// No fuzzy, no regex, no AI.
function normToken(v) {
  return v == null ? '' : String(v).trim().toUpperCase();
}

export function findMatchingUserRule(fields, userRules) {
  if (!Array.isArray(userRules) || userRules.length === 0) return null;
  const merchant = normToken(fields && fields.merchant);
  const description = normToken(fields && fields.description);
  for (const rule of userRules) {
    if (!rule) continue;
    const hay = rule.match_field === 'description' ? description : merchant;
    const needle = normToken(rule.pattern);
    if (!needle) continue;
    const hit = rule.match_type === 'exact' ? hay === needle : hay.includes(needle);
    if (hit) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tiered precedence engine
// ---------------------------------------------------------------------------
// Classification precedence is:
//   1. MANUAL user rules   (source='manual')   -- intentional overrides, run first
//   2. LEGACY ORDERED PASS: STATIC groups interleaved with MIGRATED user rules
//      (source='migrated') at their former static position, first-match-wins
//   3. (callers may add their own conditional fallbacks after this returns null)
//
// A migrated rule encodes its former static group position in `priority`:
//     priority = MIGRATED_PRIORITY_BASE + originalStaticOrder   (order is 1-based)
// so static group 11 -> priority 1011, group 17 -> 1017. Decoded here as
// priority - 1000. This keeps a migrated token AT its old position rather than
// promoting it ahead of earlier static groups (the promotion-regression the
// USER-before-STATIC model caused).
//
// STATIC order is derived at runtime from array index (index + 1); the static
// JSON is never annotated. `source='learned'` rows do NOT participate here.
const MIGRATED_PRIORITY_BASE = 1000;

// Returns the 1-based legacy order for a well-formed, IN-RANGE migrated rule,
// else null. Valid iff priority is an integer > 1000 AND the decoded order is
// within [1, staticCount] (the actual static array length). Out-of-range orders
// (e.g. 1037/1099 with 36 static groups) are rejected -- we never infer a
// larger iteration range from a malformed migrated row.
function legacyOrderOf(rule, staticCount) {
  const p = rule && rule.priority;
  if (!Number.isInteger(p) || p <= MIGRATED_PRIORITY_BASE) return null;
  const order = p - MIGRATED_PRIORITY_BASE; // >= 1
  if (!Number.isInteger(staticCount) || order > staticCount) return null;
  return order;
}

// De-duplicated warnings for malformed/out-of-range migrated rows. Logs id +
// source ONLY -- never the pattern/personal content.
const _warnedMalformedIds = new Set();
function warnMalformedMigrated(rule) {
  const id = rule && rule.id ? String(rule.id) : '(unknown id)';
  if (_warnedMalformedIds.has(id)) return;
  _warnedMalformedIds.add(id);
  // eslint-disable-next-line no-console
  console.warn(`user rule ${id} (source=migrated) has malformed or out-of-range priority; excluded from legacy pass.`);
}

// Splits already-loaded, globally-sorted user rules (by priority, created_at, id
// -- the order fetchActiveUserRules returns) into the manual list and a
// migrated-by-legacy-order map. Pure aside from the de-duplicated malformed
// warning. Does not mutate rows. Malformed/out-of-range migrated rules are
// excluded (never silently promoted to MANUAL). `staticCount` bounds the valid
// legacy-order range.
export function partitionUserRules(userRules, staticCount) {
  const manual = [];
  const migratedByOrder = new Map();
  const fallbackRules = [];
  if (Array.isArray(userRules)) {
    for (const r of userRules) {
      if (!r) continue;
      if (r.source === 'manual') {
        manual.push(r);
      } else if (r.source === 'migrated') {
        const order = legacyOrderOf(r, staticCount);
        if (order === null) { warnMalformedMigrated(r); continue; }
        if (!migratedByOrder.has(order)) migratedByOrder.set(order, []);
        migratedByOrder.get(order).push(r);
      } else if (r.source === 'fallback') {
        // Post-static owner fallback tier. Kept in the input's global order
        // (priority, created_at, id) for deterministic evaluation.
        fallbackRules.push(r);
      }
      // any other source (e.g. 'learned') does not participate.
    }
  }
  return { manual, migratedByOrder, fallbackRules };
}

// Reference-memoized partition: useTransactions passes the SAME userRules array
// to every row in a batch, so we partition once per (array identity, staticCount)
// pair (and warn at most once per malformed id per batch).
let _lastUserRules = null;
let _lastStaticCount = null;
let _lastPartition = null;
function partitionMemo(userRules, staticCount) {
  if (userRules === _lastUserRules && staticCount === _lastStaticCount && _lastPartition) return _lastPartition;
  _lastPartition = partitionUserRules(userRules, staticCount);
  _lastUserRules = userRules;
  _lastStaticCount = staticCount;
  return _lastPartition;
}

function staticGroupMatches(group, desc) {
  return !!(group && Array.isArray(group.matchAny) && group.matchAny.some((k) => desc.includes(k)));
}

// Legacy ordered pass: for order k = 1..max, evaluate migrated rules assigned to
// order k, then static group at index k-1. A migrated rule at order k therefore
// participates at group k's precedence position -- after groups 1..k-1 and
// before k+1.. -- reproducing the old static outcome. Returns {rule, kind} or null.
export function findByLegacyOrder(fields, staticRules, migratedByOrder) {
  const desc = fields == null || fields.description == null ? '' : String(fields.description);
  const n = Array.isArray(staticRules) ? staticRules.length : 0;
  // Bounded strictly by the actual static array; migratedByOrder only ever holds
  // in-range orders (partitionUserRules validates [1, staticCount]).
  for (let order = 1; order <= n; order++) {
    const migs = migratedByOrder && migratedByOrder.get(order);
    if (migs && migs.length) {
      const m = findMatchingUserRule(fields, migs);
      if (m) return { rule: m, kind: 'migrated' };
    }
    if (staticGroupMatches(staticRules[order - 1], desc)) {
      return { rule: staticRules[order - 1], kind: 'static' };
    }
  }
  return null;
}

// Full classification: MANUAL -> LEGACY(STATIC + MIGRATED). Pure/data-free:
// staticRules and userRules are injected. With empty userRules this reduces
// EXACTLY to the original static-only first-match behavior.
// Returns { rule, kind: 'manual'|'migrated'|'static' } or null.
// ---------------------------------------------------------------------------
// Conditional FALLBACK tier (source='fallback')
// ---------------------------------------------------------------------------
// A fallback rule has a single primary matcher (pattern/match_type/match_field,
// same semantics as any user rule) plus an ORDERED `branches` array. It is
// evaluated only AFTER manual + legacy(static/migrated) produce no match, and
// before the app's generic final fallback. First branch whose conditions hold
// wins. Branch grammar (all fields optional except category + budget_bucket):
//   amount_sign: 'any' | 'positive'(>0) | 'negative'(<0) | 'zero'(===0)
//   secondary_contains: string[] -> description must contain >= 1 (normalized)
//   category, subcategory, budget_bucket, is_transfer, merchant_label
const VALID_AMOUNT_SIGNS = new Set(['any', 'positive', 'negative', 'zero']);

function amountSignOk(sign, amount) {
  const a = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
  switch (sign) {
    case 'positive': return a > 0;
    case 'negative': return a < 0;
    case 'zero': return a === 0;
    case 'any':
    default: return true;
  }
}

const _warnedBadBranchIds = new Set();
function warnBadBranches(rule) {
  const id = rule && rule.id ? String(rule.id) : '(unknown id)';
  if (_warnedBadBranchIds.has(id)) return;
  _warnedBadBranchIds.add(id);
  // eslint-disable-next-line no-console
  console.warn(`user rule ${id} (source=fallback) has malformed branches; ignored.`);
}

// Pure, strict validator: returns a normalized branch array, or [] when the
// rule's branches are absent/malformed (malformed => safely ignored, no throw).
export function parseBranches(rule) {
  const raw = rule && rule.branches;
  if (!Array.isArray(raw)) { if (raw != null) warnBadBranches(rule); return []; }
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) { warnBadBranches(rule); return []; }
    const sign = b.amount_sign == null ? 'any' : b.amount_sign;
    if (!VALID_AMOUNT_SIGNS.has(sign)) { warnBadBranches(rule); return []; }
    let sec = null;
    if (b.secondary_contains != null) {
      if (!Array.isArray(b.secondary_contains)
          || !b.secondary_contains.every((s) => typeof s === 'string' && s.trim() !== '')) {
        warnBadBranches(rule); return [];
      }
      sec = b.secondary_contains;
    }
    if (typeof b.category !== 'string' || b.category.trim() === '') { warnBadBranches(rule); return []; }
    if (typeof b.budget_bucket !== 'string' || b.budget_bucket.trim() === '') { warnBadBranches(rule); return []; }
    if (!(b.is_transfer == null || typeof b.is_transfer === 'boolean')) { warnBadBranches(rule); return []; }
    if (!(b.subcategory == null || typeof b.subcategory === 'string')) { warnBadBranches(rule); return []; }
    if (!(b.merchant_label == null
          || (typeof b.merchant_label === 'string' && b.merchant_label.trim() !== ''))) {
      warnBadBranches(rule); return [];
    }
    out.push({
      amount_sign: sign,
      secondary_contains: sec,
      category: b.category,
      subcategory: b.subcategory == null ? null : b.subcategory,
      budgetBucket: b.budget_bucket,
      is_transfer: b.is_transfer == null ? null : b.is_transfer,
      merchant_label: b.merchant_label == null ? null : b.merchant_label,
    });
  }
  return out;
}

// Evaluate fallback rules in order. For each rule whose PRIMARY matcher matches,
// walk its branches; the first satisfied branch wins. Returns a match shaped
// like the other tiers ({ rule:{id,assign}, kind:'fallback', merchant_label })
// or null.
export function findFallbackMatch(fields, fallbackRules) {
  if (!Array.isArray(fallbackRules) || fallbackRules.length === 0) return null;
  const description = normToken(fields && fields.description);
  const amount = fields ? fields.amount : undefined;
  for (const rule of fallbackRules) {
    if (!rule) continue;
    // Primary matcher: identical contains/exact x merchant/description semantics.
    if (!findMatchingUserRule(fields, [rule])) continue;
    const branches = parseBranches(rule);
    for (const br of branches) {
      if (!amountSignOk(br.amount_sign, amount)) continue;
      if (br.secondary_contains
          && !br.secondary_contains.some((s) => description.includes(normToken(s)))) continue;
      return {
        rule: {
          id: rule.id,
          assign: {
            category: br.category,
            subcategory: br.subcategory,
            budgetBucket: br.budgetBucket,
            is_transfer: br.is_transfer,
          },
        },
        kind: 'fallback',
        merchant_label: br.merchant_label,
      };
    }
    // primary matched but no branch satisfied -> try the next fallback rule
  }
  return null;
}

export function classifyTransaction(fields, staticRules, userRules) {
  const staticCount = Array.isArray(staticRules) ? staticRules.length : 0;
  const { manual, migratedByOrder, fallbackRules } = partitionMemo(userRules, staticCount);
  if (manual.length) {
    const m = findMatchingUserRule(fields, manual);
    if (m) return { rule: m, kind: 'manual' };
  }
  const legacy = findByLegacyOrder(fields, staticRules, migratedByOrder);
  if (legacy) return legacy;
  // Post-static owner fallback tier (empty today -> null -> unchanged behavior).
  return findFallbackMatch(fields, fallbackRules);
}
