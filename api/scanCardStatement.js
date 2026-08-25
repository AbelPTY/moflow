import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from './rateLimit.js';
import { safeError } from '../server/safeError.js';

// Reads a photo of a credit-card statement's payment summary and extracts the
// figures the financing guard needs. Mirrors scanReceipt.js (Gemini vision,
// same GEMINI_API_KEY, model gemini-2.5-flash). Handles Panamanian banks in
// Spanish (Banco General, Davivienda, Cooperativa) and UNFCU in English.
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

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const prompt = `
      You are reading a photo of a CREDIT CARD STATEMENT payment summary. It may
      be from a Panamanian bank in Spanish (Banco General, Davivienda,
      Cooperativa de Profesionales) or from UNFCU in English.

      Extract the payment summary and return ONLY valid JSON, no markdown:
      {
        "card_name_hint": "<issuer/product name if clearly visible, else empty string>",
        "current_balance": <number, current total card balance if clearly visible, else 0>,
        "statement_balance": <number, the balance due for this statement>,
        "minimum_payment": <number, the minimum payment due>,
        "apr": <number, annual percentage rate as a percent such as 24.99, or null>,
        "due_day": <integer day-of-month 1-31 the payment is due, or null>,
        "statement_close_day": <integer day-of-month 1-31 the statement closes, or null>
      }

      Field-name hints (labels vary by bank/language):
      - current_balance: "Current Balance", "Saldo Actual", "Saldo Corriente", "Balance Actual". Use only when the document clearly identifies it as the live/current account balance.
      - statement_balance: "Nuevo Saldo", "Saldo del Estado de Cuenta", "New Balance", "Statement Balance", "Total Amount Due". Do NOT infer it from current_balance unless the document clearly states they are the same.
      - minimum_payment: "Pago Minimo", "Pago Mínimo", "Minimum Payment Due", "Minimum Amount Due".
      - apr: "APR", "Annual Percentage Rate", "Tasa de Interes Anual", "Tasa de Interés Anual", "Tasa Anual", "Interest Rate". Return the annual percentage number only, e.g. 24.99.
      - due_day: from "Fecha de Pago", "Fecha Limite de Pago", "Fecha de Vencimiento", "Payment Due Date", "Due Date" -- return ONLY the day number.
      - statement_close_day: from "Fecha de Corte", "Fecha de Cierre", "Statement Date", "Closing Date", "Cierre" -- return ONLY the day number.

      Rules:
      - Amounts are POSITIVE numbers. Strip currency symbols and thousands separators.
      - apr is a percentage number such as 24.99, not 0.2499.
      - due_day and statement_close_day are integers 1-31, or null if not visible.
      - If current_balance is not clearly visible, use 0.
      - If statement_balance is not clearly visible, use 0.
      - If minimum_payment is not clearly visible, use 0.
      - If apr is not clearly visible, use null.
      - If due_day or statement_close_day is not visible, use null.
      - Do not guess values that are not clearly supported by the image.
      - Return JSON only. No explanation.
    `;

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: 'image/jpeg',
      },
    };

    const result = await model.generateContent([prompt, imagePart]);

    let responseText = result.response.text();
    responseText = responseText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(responseText);

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('scanCardStatement failed', safeError(error));
    return res.status(500).json({ error: 'Failed to process statement image' });
  }
}
