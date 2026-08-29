import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from '../server/rateLimit.js';
import { safeError } from '../server/safeError.js';

function normalizeAiRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((item) => {
      const date = item?.date ? String(item.date).trim() : '';
      const description_raw = item?.description_raw
        ? String(item.description_raw).trim()
        : '';
      const merchant_extracted = item?.merchant_extracted
        ? String(item.merchant_extracted).trim()
        : '';
      const reference = item?.reference ? String(item.reference).trim() : '';
      const amount = Number(
        String(item?.amount ?? 0).replace(/[^0-9.\-()]/g, '').replace(/[()]/g, '')
      );

      return {
        date,
        description_raw,
        merchant_extracted,
        reference,
        amount: Number.isNaN(amount) ? 0 : amount
      };
    })
    .filter((row) => row.description_raw || row.merchant_extracted || row.amount !== 0);
}

function extractJsonArray(text) {
  if (!text) {
    throw new Error('Empty AI response');
  }

  const cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');

    if (start !== -1 && end !== -1 && end > start) {
      const sliced = cleaned.slice(start, end + 1);
      return JSON.parse(sliced);
    }

    throw new Error('AI response was not valid JSON');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  // Durable per-user + per-IP rate limit BEFORE any Gemini work.
  if (!(await applyRateLimit({ req, res, user, scope: 'gemini_text' }))) return;

  try {
    const { rawText } = req.body || {};

    if (!rawText || !String(rawText).trim()) {
      return res.status(400).json({ error: 'rawText is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const prompt = `
You are a financial statement parser.

The input text contains unstructured transactions.
Extract every valid line and return ONLY a valid JSON array.

Return schema:
[
  {
    "date": "YYYY-MM-DD",
    "description_raw": "full raw transaction text",
    "merchant_extracted": "best merchant name",
    "reference": "reference/authorization/confirmation number if visible, else empty string",
    "amount": 0.00
  }
]

Rules:
- Return JSON only. No markdown. No explanation.
- Read each line independently.
- Use negative amounts for expenses and positive amounts for income when the text makes that clear.
- Preserve the raw description as accurately as possible.
- If merchant is unclear, use a short best guess.
- If a reference, authorization, or confirmation number is visible for a transaction, include it in "reference". If none is visible, use an empty string -- do not invent one.
- Ignore blank or malformed lines.
- If no valid transactions are found, return [].

Statement text:
${rawText}
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const parsed = extractJsonArray(text);
    const normalized = normalizeAiRows(parsed);

    return res.status(200).json(normalized);
  } catch (error) {
    console.error('parseStatement failed', safeError(error));
    return res.status(500).json({ error: 'Failed to parse statement' });
  }
}
