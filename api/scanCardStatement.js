import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from './rateLimit.js';

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
        "statement_balance": <number, the total new balance owed this statement>,
        "minimum_payment": <number, the minimum payment due>,
        "due_day": <integer day-of-month 1-31 the payment is due, or null>,
        "statement_close_day": <integer day-of-month 1-31 the statement closes, or null>
      }

      Field-name hints (labels vary by bank/language):
      - statement_balance: "Nuevo Saldo", "Saldo Actual", "Saldo Total", "Saldo del Estado de Cuenta", "New Balance", "Statement Balance", "Total Amount Due", "Balance".
      - minimum_payment: "Pago Minimo", "Pago Mínimo", "Minimum Payment Due", "Minimum Amount Due".
      - due_day: from "Fecha de Pago", "Fecha Limite de Pago", "Fecha de Vencimiento", "Payment Due Date", "Due Date" -- return ONLY the day number.
      - statement_close_day: from "Fecha de Corte", "Fecha de Cierre", "Statement Date", "Closing Date", "Cierre" -- return ONLY the day number.

      Rules:
      - Amounts are POSITIVE numbers (strip currency symbols and thousands separators).
      - due_day and statement_close_day are integers 1-31, or null if not visible.
      - If a field is not visible, use 0 for amounts or null for the days.
      - Return JSON only. No explanation.
    `;

    const imagePart = {
      inlineData: { data: base64Data, mimeType: 'image/jpeg' },
    };

    const result = await model.generateContent([prompt, imagePart]);
    let responseText = result.response.text();
    responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(responseText);
    return res.status(200).json(parsed);
  } catch (error) {
    console.error('scanCardStatement error:', error);
    return res.status(500).json({ error: 'Failed to process statement image' });
  }
}
