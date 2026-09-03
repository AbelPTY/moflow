import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from '../server/rateLimit.js';
import { safeError } from '../server/safeError.js';
import { buildImageParts } from '../server/imageParts.js';
import { handleClassify } from '../server/classifyTransactions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const { mode } = req.body || {};

  // V1.2 Transaction Intelligence AI fallback: a TEXT-only classify job that
  // reuses this Gemini-capable function (so /api stays at 12) but its OWN cheaper
  // cost bucket (gemini_text) and no image path. Existing (non-classify) calls
  // are untouched below and remain byte-for-byte compatible.
  if (mode === 'classify') {
    if (!(await applyRateLimit({ req, res, user, scope: 'gemini_text' }))) return;
    return handleClassify(req, res);
  }

  // Durable per-user + per-IP rate limit BEFORE any image decode / Gemini work.
  if (!(await applyRateLimit({ req, res, user, scope: 'gemini_vision' }))) return;

  try {
    // Accept a single `image` (legacy) or `images: []` (multi-screenshot).
    const imageParts = buildImageParts(req.body);
    if (imageParts.length === 0) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Explicit mode keeps this one function serving two vision jobs so we stay
    // within the Vercel Hobby function limit. Absent/receipt => unchanged
    // legacy behavior. 'activity' => recent-activity transaction-list extraction.
    const isActivity = mode === 'activity' || mode === 'recent_activity';

    // Initialize Gemini with your secure Vercel key
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-flash" });

    // Recent-activity screenshot: a banking-app transaction list.
    const activityPrompt = `
      You are reading a SCREENSHOT of a banking-app RECENT ACTIVITY /
      transaction list (Panamanian bank in Spanish or a US institution in
      English). Extract each visible transaction row.

      Return ONLY valid JSON, no markdown:
      {
        "transactions": [
          {
            "date": "YYYY-MM-DD",
            "description": "<merchant / description text as shown>",
            "amount": -42.35,
            "type": "debit",
            "reference": "<transaction/reference number if visible, else ''>",
            "account_hint": "<account label if the screenshot shows one, else ''>"
          }
        ]
      }

      Rules:
      - Expenses/debits are NEGATIVE numbers; income/credits are POSITIVE.
      - "type" is "debit" for money out, "credit" for money in.
      - Extract ONLY rows that are actually visible transactions. Do NOT invent
        dates or amounts.
      - IGNORE running/available balances, column headers, section titles,
        date-group headers, and subtotals -- these are NOT transactions.
      - Preserve useful merchant/description text; strip currency symbols and
        thousands separators from amounts.
      - If a row shows a date without a year, infer the most likely recent year;
        if truly unknown, use the current year.
      - reference/account_hint are empty strings when not clearly visible.
      - You may be given MULTIPLE screenshots of the same activity list (scrolled
        pages). Treat them as ONE list and combine every visible transaction. If
        the SAME transaction row appears in more than one screenshot (overlap),
        include it only ONCE.
      - If nothing is clearly a transaction, return {"transactions": []}.
      - Return JSON only. No explanation.
    `;

    // The AI Prompt: handles BOTH a simple single-item receipt (restaurant,
    // grocery store, etc.) AND a multi-line-item payment voucher (like a
    // Cooperativa Profesionales "Papeleta Única de Transacciones", which can
    // list many distinct payments -- Aportaciones, insurance, loan payment,
    // etc. -- in one image). Always returns a JSON ARRAY, with one item per
    // real line item, so a multi-payment voucher isn't collapsed into a
    // single lump sum and loses the detail that makes it worth capturing.
    const receiptPrompt = `
      You are an expert Panamanian accountant analyzing a photo that could be
      EITHER a simple single-item retail receipt, OR a multi-line-item
      payment voucher (like a "Papeleta Única de Transacciones" from a
      Panamanian cooperativa, showing several different payments in one
      transaction: membership contributions, insurance premiums, a loan
      payment, etc., each usually with its own account number).

      Look carefully at the whole image first to determine which type it is,
      then extract EVERY distinct real line item as its own entry -- do NOT
      collapse multiple different payments into one combined total.

      Return ONLY a JSON array (even if there's just one item), no markdown:
      [
        {
          "date": "YYYY-MM-DD",
          "merchant": "Store name, or for a voucher: '<Institution> - <Transaction Type> (<Account Number>)' e.g. 'Cooperativa Profesionales - SEG.AUTO (3001788058)'",
          "amount": 0.00,
          "category": "Category Name",
          "reference": "Voucher/receipt number if visible, else empty string"
        }
      ]

      Rules for a simple receipt (one merchant, one total):
      - If it is Super 99, Riba Smith, or a grocery store, category is "Groceries".
      - If it is gas, auto parts, or mechanic work, category is "Transportation".
      - If it is a restaurant, fast food, or similar, category is "Dining Out".
      - If it is school supplies, uniforms, or kids' activities, category is "Education".
      - Otherwise, use your best judgment or "Uncategorized".

      Rules for a multi-line-item voucher (e.g. a cooperativa payment slip):
      - Use the SAME date for every line item (the voucher's processing date, e.g. "Fecha Proceso").
      - Use the voucher number (e.g. top-right of the slip) as "reference" for every line item, since they're all part of the same transaction.
      - Categorize each line by its own "Transacción" type, not the voucher as a whole:
        - "APORTACIONES", "CAPITAL EXTERNO", or similar membership contribution/capital lines -> category "Savings"
        - "FONDO DE INCAPACIDAD", "SERVICIO DE MORTUORIA", "PLAN SOLIDARIO", "SEG.AUTO", "SEG.VIDA", "PLAN ADMINISTRADO DE SALUD", or any other insurance-style line -> category "Insurance"
        - A loan payment (e.g. "PAGO PRESTAMO", a loan code like "AUTOECO2F") -> category "Loan Payment"
        - A credit card payment line -> category "Credit Card Payment"
      - All amounts should be NEGATIVE (money paid out), even though the voucher shows them as plain positive figures.
      - Use each line's own account number (the "Cuenta" column) in the merchant field, exactly as shown.
      - If the SAME transaction type (e.g. "SEG.AUTO") appears more than once with DIFFERENT account numbers, keep them as separate line items -- do not merge them, since they're genuinely different policies/accounts.
    `;

    const prompt = isActivity ? activityPrompt : receiptPrompt;

    // Send to Gemini (one or more image parts).
    const result = await model.generateContent([prompt, ...imageParts]);
    let responseText = result.response.text();

    // Clean up the response
    responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    let parsedData = JSON.parse(responseText);

    // Activity mode returns a normalized { transactions: [...] } envelope with
    // signed amounts, defensively shaped so the client never trusts raw model output.
    if (isActivity) {
      const rawTx = Array.isArray(parsedData?.transactions)
        ? parsedData.transactions
        : Array.isArray(parsedData)
          ? parsedData
          : [];

      const transactions = rawTx
        .map((t) => {
          const amount = Number(t?.amount) || 0;
          return {
            date: String(t?.date || '').trim(),
            description: String(t?.description || t?.merchant || '').trim(),
            amount,
            type: t?.type === 'credit' || amount > 0 ? 'credit' : 'debit',
            reference: String(t?.reference || '').trim(),
            account_hint: String(t?.account_hint || '').trim(),
          };
        })
        .filter((t) => t.description || t.amount);

      return res.status(200).json({ transactions });
    }

    // Receipt mode (default): always return an array, even if the model
    // returned a single object (backward-compatible with the old shape).
    if (!Array.isArray(parsedData)) {
      parsedData = [parsedData];
    }

    // Send the extracted data back to your React app
    return res.status(200).json(parsedData);

  } catch (error) {
    console.error('scanReceipt failed', safeError(error));
    return res.status(500).json({ error: 'Failed to process image' });
  }
}
