import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const { headers, sampleRows } = req.body || {};

    if (!Array.isArray(headers) || headers.length === 0) {
      return res.status(400).json({ error: 'headers array is required' });
    }
    if (!Array.isArray(sampleRows) || sampleRows.length === 0) {
      return res.status(400).json({ error: 'sampleRows array is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const prompt = `
You are analyzing the structure of a bank or credit card statement spreadsheet (could be in any language, e.g. Spanish).

Column headers (zero-based index: name):
${headers.map((h, i) => `${i}: ${h}`).join('\n')}

Sample data rows (as arrays matching the header order above):
${sampleRows.map((row) => JSON.stringify(row)).join('\n')}

Identify which column index holds each piece of information. Some statements have one signed "amount" column (negative = expense); others split money out and money in into two separate columns.

Pay close attention to the column HEADER NAMES, not just the sample values -- a column for incoming money (credits/deposits) may not appear in every sample row, but its header name is still a reliable signal. Common header names to recognize:
- Single signed amount: "Amount", "Monto", "Valor"
- Money out / debit: "Debit", "Débito", "Cargo", "Retiro", "Withdrawal", "Débitos"
- Money in / credit: "Credit", "Crédito", "Abono", "Depósito", "Deposit", "Créditos"
- Reference/authorization number (used to detect duplicate transactions later): "Reference", "Referencia", "Ref", "Confirmation", "Confirmación", "Autorización", "Auth Code", "Transacción", "Número de Transacción"

If you see a plausible debit-style header AND a plausible credit-style header, you MUST set both debitColumn and creditColumn, even if every sample row shown only has a value in one of them -- that just means the sample happened to be all withdrawals or all deposits, not that the other column doesn't exist.

Return ONLY valid JSON, no markdown, matching this exact schema:
{
  "dateColumn": <column index or null>,
  "descriptionColumn": <column index or null>,
  "amountColumn": <column index or null>,
  "debitColumn": <column index or null>,
  "creditColumn": <column index or null>,
  "referenceColumn": <column index or null>
}

Rules:
- Indices are zero-based and must match the headers list above.
- If there is one signed amount column, set amountColumn and leave debitColumn/creditColumn null.
- If debits and credits are in separate columns, set debitColumn and creditColumn and leave amountColumn null.
- descriptionColumn is whichever column best identifies the merchant/transaction (could be "concept", "detalle", "descripcion", "detail", etc).
- referenceColumn is optional -- many statements don't have one. Only set it if a column clearly holds a reference/authorization/confirmation number, not a generic row number.
- If you cannot confidently identify a column, use null for it rather than guessing.
- Return JSON only, nothing else.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('identifyColumns error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error identifying columns' });
  }
}
