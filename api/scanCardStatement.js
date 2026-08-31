import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from '../server/rateLimit.js';
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
    const { image, mode } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Explicit mode keeps this one function serving both the credit-card
    // statement scan (default / absent mode -- unchanged) and the loan statement
    // scan (mode === 'loan'), so we stay within the Vercel Hobby function limit.
    const isLoan = mode === 'loan';

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const loanPrompt = `
      You are reading a photo of a LOAN STATEMENT (mortgage, auto, personal,
      student, or other installment loan). It may be from a Panamanian bank in
      Spanish or a US institution in English.

      Extract ONLY details clearly present. Return ONLY valid JSON, no markdown:
      {
        "loan_name_hint": "<lender/product name if clearly visible, else ''>",
        "loan_type": "<one of: mortgage, auto, personal, student, other, or '' if unclear>",
        "remaining_principal": <number, current outstanding principal/loan balance, else 0>,
        "apr": <number percent such as 6.25, or null>,
        "monthly_payment": <number, the regular required monthly payment, else 0>,
        "next_payment_date": <"YYYY-MM-DD" if clearly shown, else null>,
        "maturity_date": <"YYYY-MM-DD" if clearly shown, else null>,
        "remaining_months": <integer only if directly stated or safely derivable from explicit current + maturity dates, else null>
      }

      Field hints (labels vary by language):
      - remaining_principal: "Principal Balance", "Outstanding Principal", "Current Balance", "Saldo de Capital", "Saldo a Capital", "Saldo Insoluto", "Balance Pendiente". This is the loan balance still owed -- NOT available credit and NOT the sum of all remaining payments.
      - apr: "APR", "Interest Rate", "Tasa de Interes", "Tasa de Interés", "Tasa Anual". Return the annual percentage number only (e.g. 6.25), never a fraction.
      - monthly_payment: "Monthly Payment", "Payment Amount", "Cuota Mensual", "Pago Mensual", "Letra". The regular required payment.
      - next_payment_date: "Payment Due Date", "Next Payment", "Proximo Pago", "Fecha de Pago".
      - maturity_date: "Maturity Date", "Fecha de Vencimiento Final", "Fecha de Cancelacion".

      Rules:
      - Do NOT invent missing values. Use the stated null/0 defaults above when a field is not clearly present.
      - Money values are POSITIVE numbers; strip currency symbols and thousands separators.
      - Do NOT treat escrow, taxes, or insurance as principal.
      - If loan_type is unclear, return "" rather than guessing.
      - remaining_months only when directly stated or safely derivable from explicit dates; otherwise null.
      - If the document shows MULTIPLE loans/accounts and the target is ambiguous, return the clearest single loan only and add "warning": "<short note>" to the JSON.
      - Do NOT include arbitrary OCR text. Return JSON only. No explanation.
    `;

    const cardPrompt = `
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

    const prompt = isLoan ? loanPrompt : cardPrompt;

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

    // Loan mode: normalize defensively into the loan shape so the client never
    // trusts raw model output. Missing fields become null/0 (not fake values).
    if (isLoan) {
      const ALLOWED_TYPES = ['mortgage', 'auto', 'personal', 'student', 'other'];
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const numOrNull = (v) =>
        v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
          ? null
          : Number(v);
      const type = String(parsed?.loan_type || '').trim().toLowerCase();

      const loan = {
        loan_name_hint: String(parsed?.loan_name_hint || '').trim(),
        loan_type: ALLOWED_TYPES.includes(type) ? type : '',
        remaining_principal: Math.max(0, num(parsed?.remaining_principal)),
        apr: parsed?.apr === null || parsed?.apr === undefined ? null : numOrNull(parsed.apr),
        monthly_payment: Math.max(0, num(parsed?.monthly_payment)),
        next_payment_date: parsed?.next_payment_date || null,
        maturity_date: parsed?.maturity_date || null,
        remaining_months:
          numOrNull(parsed?.remaining_months) === null
            ? null
            : Math.max(0, Math.trunc(numOrNull(parsed.remaining_months))) || null,
      };
      if (parsed?.warning) loan.warning = String(parsed.warning).slice(0, 200);

      return res.status(200).json(loan);
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('scanCardStatement failed', safeError(error));
    return res.status(500).json({ error: 'Failed to process statement image' });
  }
}
