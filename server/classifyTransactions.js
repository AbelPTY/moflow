// Transaction Intelligence V1.2 — server-side AI classify handler.
//
// A TEXT-only Gemini job invoked as scanReceipt `mode:'classify'` (so /api stays
// at 12). It is the LAST fallback for transactions the deterministic engine left
// unresolved. It is conservative by construction:
//   * accepts ONLY { id, normalizedMerchant, description, amountSign } per row —
//     no amount value, account, bank reference, user identity, or other rows;
//   * constrains Gemini to the canonical taxonomy and REJECTS anything else;
//   * caps confidence at 0.80 so an AI result can never reach the AUTO threshold;
//   * fails SAFE: any Gemini/parse/validation failure returns an empty result
//     set (HTTP 200) so the caller falls back to review — never a hard error.
//
// Auth + rate limiting are handled by the caller (requireUser + gemini_text).

import { GoogleGenerativeAI } from '@google/generative-ai';
import { safeError } from './safeError.js';

// Allowed canonical taxonomy — a server-side MIRROR of AI_ALLOWED_* in
// src/lib/transactionIntelligence.js. Kept inline on purpose so this server
// module has NO dependency on the client engine (which imports merchant_rules.json);
// that avoids any serverless-bundler JSON-import risk to scanReceipt. The client
// re-sanitizes every result against the same engine (defense in depth), so the
// two lists must stay in sync — update both if the taxonomy ever changes.
const AI_ALLOWED_CATEGORIES = [
  'salary', 'business_freelance', 'interest', 'investment_income', 'refund_reimbursement', 'other_income',
  'housing', 'groceries', 'dining', 'utilities', 'transportation', 'fuel', 'healthcare', 'insurance',
  'education', 'shopping', 'entertainment', 'travel', 'subscriptions', 'bank_fees', 'taxes', 'other_expense',
  'transfer', 'credit_card_payment', 'loan_payment', 'savings', 'investment',
  'uncategorized',
];
const AI_ALLOWED_BUCKETS = ['needs', 'wants', 'savings_debt', 'income', 'transfers', 'unsorted'];
const AI_ALLOWED_NATURES = [
  'expense', 'income', 'transfer', 'refund', 'credit_card_payment',
  'loan_payment', 'fee', 'interest', 'savings', 'investment', 'unknown',
];

const CAT_SET = new Set(AI_ALLOWED_CATEGORIES);
const BUCKET_SET = new Set(AI_ALLOWED_BUCKETS);
const NATURE_SET = new Set(AI_ALLOWED_NATURES);
const AI_CONFIDENCE_CAP = 0.8;
const AI_MAX_BATCH = 50;
const MAX_DESC_LEN = 80;

// Server-side description cleaner — mirrors cleanDescriptionForAi in the engine.
// Strips reference/identity noise; keeps merchant words. Never mutates raw data.
function cleanDescriptionForAi(input, maxLen = MAX_DESC_LEN) {
  let s = String(input == null ? '' : input);
  s = s.replace(/\*{2,}\s*\d+/g, ' ');
  s = s.replace(/x{4,}\s*\d+/gi, ' ');
  s = s.replace(/\b(?:REF|AUT|AUTH|AUTORIZACION|AUTORIZACIÓN|TRACE|BATCH|SEQ|FOLIO|CONF|TERM|TERMINAL)\b[:#.\s-]*[A-Z0-9-]*\d[A-Z0-9-]*/gi, ' ');
  s = s.replace(/[#*]\s*\d{2,}/g, ' ');
  s = s.replace(/\b\d{4,}\b/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

// Coerce/validate the submitted rows to the strict allowed shape. Anything extra
// a caller might send (amount, account, bank_reference, …) is dropped here, so
// even a misbehaving client cannot smuggle identity into the prompt.
function sanitizeInputRows(raw) {
  const rows = [];
  const ids = new Set();
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!it || it.id == null) continue;
    const id = String(it.id);
    if (ids.has(id)) continue;
    const normalizedMerchant = String(it.normalizedMerchant || '').slice(0, 60).trim();
    const description = cleanDescriptionForAi(it.description || '', MAX_DESC_LEN);
    const amountSign = it.amountSign === 'positive' ? 'positive' : 'negative';
    if (!normalizedMerchant && !description) continue;
    ids.add(id);
    rows.push({ id, normalizedMerchant, description, amountSign });
    if (rows.length >= AI_MAX_BATCH) break;
  }
  return rows;
}

function buildPrompt(rows) {
  return `You are a CONSERVATIVE personal-finance transaction classifier. You are
given a small batch of transactions that simpler rules could not classify. For
EACH row, decide its financial nature, spending category, and budget bucket,
using ONLY the limited context provided.

Rules:
- Use ONLY the allowed values below. NEVER invent a category, bucket, or nature.
- Classify only from the given merchant + description + amount sign. Do NOT infer
  who the person is, and do NOT invent merchants or details not present.
- If the row is ambiguous, LOWER the confidence (this is expected and fine).
- Payment rails are not spending categories by themselves: Yappy, ACH, wire, and
  generic "transfer" text usually mean nature "transfer" or "credit_card_payment"
  / "loan_payment" when the text says so — not a lifestyle category.
- A merchant proper name should NOT force a financial nature when it is ambiguous.
- confidence is 0..1 reflecting how sure you are.

Allowed nature: ${AI_ALLOWED_NATURES.join(', ')}
Allowed category: ${AI_ALLOWED_CATEGORIES.join(', ')}
Allowed bucket: ${AI_ALLOWED_BUCKETS.join(', ')}

Guidance: groceries=supermarkets/food shops (needs); dining=restaurants/fast food
(wants); utilities=power/water/internet/phone (needs); transportation=ride-hail/
tolls/transit (needs); fuel=gas stations (needs); healthcare=pharmacy/clinic
(needs); insurance=insurers (needs); shopping=retail goods (wants); subscriptions=
recurring digital services (wants); transfer/credit_card_payment/loan_payment/
savings/investment are movements, not lifestyle spending; use uncategorized +
low confidence when genuinely unclear.

Return STRICT JSON only, no markdown, exactly:
{"classifications":[{"id":"<same id>","nature":"...","category":"...","bucket":"...","confidence":0.0,"reason":"short"}]}

Transactions:
${JSON.stringify(rows.map((r) => ({ id: r.id, merchant: r.normalizedMerchant, description: r.description, amountSign: r.amountSign })))}`;
}

// Validate one model row against the taxonomy + the submitted id set. Returns a
// canonical, confidence-capped result or null. The client re-sanitizes too.
function validateResult(raw, submittedIds, usedIds) {
  if (!raw || raw.id == null) return null;
  const id = String(raw.id);
  if (!submittedIds.has(id) || usedIds.has(id)) return null;
  const nature = String(raw.nature || '').toLowerCase();
  const category = String(raw.category || '').toLowerCase();
  const bucket = String(raw.bucket || '').toLowerCase();
  if (!CAT_SET.has(category) || !BUCKET_SET.has(bucket)) return null;
  if (nature && !NATURE_SET.has(nature)) return null;
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) confidence = AI_CONFIDENCE_CAP;
  confidence = Math.min(confidence, AI_CONFIDENCE_CAP); // hard cap — never AUTO
  return {
    id,
    nature: nature && NATURE_SET.has(nature) ? nature : 'expense',
    category,
    bucket,
    confidence: Math.round(confidence * 100) / 100,
  };
}

export async function handleClassify(req, res) {
  const rows = sanitizeInputRows((req.body || {}).transactions);
  if (rows.length === 0) {
    return res.status(200).json({ classifications: [] });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });
    const result = await model.generateContent(buildPrompt(rows));
    let text = result.response.text();
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(200).json({ classifications: [] }); // safe fallback
    }

    const submittedIds = new Set(rows.map((r) => r.id));
    const usedIds = new Set();
    const classifications = [];
    for (const raw of Array.isArray(parsed?.classifications) ? parsed.classifications : []) {
      const ok = validateResult(raw, submittedIds, usedIds);
      if (ok) { usedIds.add(ok.id); classifications.push(ok); }
    }
    return res.status(200).json({ classifications });
  } catch (error) {
    // AI is a non-critical enhancement: never surface internals, never 5xx here.
    console.error('classifyTransactions failed', safeError(error));
    return res.status(200).json({ classifications: [] });
  }
}

export default handleClassify;
