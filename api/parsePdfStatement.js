import { GoogleGenerativeAI } from '@google/generative-ai';
import { extractText, getDocumentProxy } from 'unpdf';
import formidable from 'formidable';
import fs from 'fs';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from './rateLimit.js';
import { safeError } from '../server/safeError.js';

// Disable Vercel's default body parser so formidable can process the multipart/form-data stream
export const config = {
  api: {
    bodyParser: false,
  },
};

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

  // Authenticate BEFORE reading the uploaded file, so anonymous requests never
  // reach the parser/Gemini.
  const user = await requireUser(req, res);
  if (!user) return;

  // Durable per-user + per-IP rate limit BEFORE formidable reads the multipart
  // upload or any PDF/Gemini work begins.
  if (!(await applyRateLimit({ req, res, user, scope: 'gemini_pdf' }))) return;

  try {
    const form = formidable({ multiples: false });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve({ fields, files });
      });
    });

    const file = files.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = Array.isArray(file) ? file[0].filepath : file.filepath;
    const fileBuffer = fs.readFileSync(filePath);

    let pdfText = '';
    try {
      const pdf = await getDocumentProxy(new Uint8Array(fileBuffer));
      const { text } = await extractText(pdf, { mergePages: true });
      pdfText = text;
    } catch (e) {
      console.error('parsePdfStatement pdf decode failed', safeError(e));
      return res.status(400).json({ error: "Failed to parse PDF binary. Make sure the file is a valid PDF." });
    }

    if (!pdfText || !pdfText.trim()) {
      return res.status(400).json({ error: 'Could not extract text from PDF' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY environment variable' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const prompt = `
You are a financial statement parser.

The text below was extracted from a PDF bank or credit card statement.
Extract every valid transaction line and return ONLY a valid JSON array.

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
- Use negative amounts for expenses and positive amounts for income when the text makes that clear (e.g. "Cargo", "Debit", "Withdrawal" are negative).
- Preserve the raw description as accurately as possible.
- If merchant is unclear, use a short best guess.
- If a reference, authorization, or confirmation number is visible for a transaction, include it in "reference". If none is visible, use an empty string -- do not invent one.
- Ignore blank or malformed lines, or lines that are just headers/footers/balances.
- If no valid transactions are found, return [].

Extracted PDF text:
${pdfText}
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const parsed = extractJsonArray(text);
    const normalized = normalizeAiRows(parsed);

    return res.status(200).json(normalized);
  } catch (error) {
    console.error('parsePdfStatement failed', safeError(error));
    return res.status(500).json({ error: 'Failed to parse PDF statement' });
  }
}
