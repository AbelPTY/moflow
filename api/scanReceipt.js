import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from '../server/rateLimit.js';
import { safeError } from '../server/safeError.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  // Durable per-user + per-IP rate limit BEFORE any image decode / Gemini work.
  if (!(await applyRateLimit({ req, res, user, scope: 'gemini_vision' }))) return;

  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Remove the data URL prefix so Gemini gets the raw base64 string
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // Initialize Gemini with your secure Vercel key
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-flash" });

    // The AI Prompt: handles BOTH a simple single-item receipt (restaurant,
    // grocery store, etc.) AND a multi-line-item payment voucher (like a
    // Cooperativa Profesionales "Papeleta Única de Transacciones", which can
    // list many distinct payments -- Aportaciones, insurance, loan payment,
    // etc. -- in one image). Always returns a JSON ARRAY, with one item per
    // real line item, so a multi-payment voucher isn't collapsed into a
    // single lump sum and loses the detail that makes it worth capturing.
    const prompt = `
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

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: "image/jpeg"
      }
    };

    // Send to Gemini
    const result = await model.generateContent([prompt, imagePart]);
    let responseText = result.response.text();

    // Clean up the response
    responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    let parsedData = JSON.parse(responseText);

    // Always return an array, even if the model returned a single object
    // (backward-compatible with the old single-object response shape)
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
