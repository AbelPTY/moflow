import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from '../server/rateLimit.js';
import { safeError } from '../server/safeError.js';

// Reads a screenshot of a banking-app ACCOUNT SUMMARY and extracts the visible
// account names + balances so the user can review them and (explicitly) apply a
// total to "available cash". Mirrors scanCardStatement.js / scanReceipt.js
// exactly for security: requireUser auth, the shared gemini_vision rate-limit
// scope, safe logging, and the same server-side Gemini config. This is
// screenshot extraction only -- NOT a live bank connection.
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
      You are reading a SCREENSHOT of a banking-app account-summary / dashboard
      screen. It may be from a Panamanian bank (Spanish) or a US institution
      (English) and can list several accounts (checking, savings, and possibly
      credit cards).

      Extract ONLY the accounts and balances that are CLEARLY VISIBLE. Return
      ONLY valid JSON, no markdown:
      {
        "accounts": [
          {
            "name": "<account name/label as shown>",
            "balance": <number>,
            "currency": "<ISO code like USD, or a symbol-derived guess>",
            "type": "<checking | savings | cash | credit_card | loan | other>",
            "is_credit": <true if this is a credit card / line of credit / loan, else false>
          }
        ]
      }

      Rules:
      - Extract only balances clearly visible in the image. Do NOT invent or
        infer accounts that are not shown.
      - "balance" is a NUMBER. Strip currency symbols and thousands separators.
        Use a plain positive number for deposit balances.
      - Label hints: "Saldo", "Saldo Disponible", "Balance", "Available
        Balance", "Current Balance" for deposit balances.
      - currency: default to "USD" only when the screenshot clearly shows dollars
        (US$, B/., $) or there is no conflicting currency. If a different
        currency is clearly indicated, preserve it (e.g. "EUR"). Never guess a
        currency that is not supported by the image.
      - Credit cards / lines of credit / loans: set is_credit=true and type
        "credit_card" or "loan". For these, report the OUTSTANDING BALANCE OWED
        as a positive number if clearly shown. NEVER report available credit as a
        balance, and never treat available credit as cash.
      - Deposit/cash accounts (checking, savings, cash): is_credit=false.
      - If the account type is not identifiable, use type "other" and
        is_credit=false unless it is clearly a credit product.
      - If no accounts are clearly visible, return {"accounts": []}.
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

    // Normalize defensively: always return an { accounts: [...] } shape with
    // numeric balances, so the client never has to trust the model's structure.
    const rawAccounts = Array.isArray(parsed?.accounts)
      ? parsed.accounts
      : Array.isArray(parsed)
        ? parsed
        : [];

    const accounts = rawAccounts
      .map((a) => ({
        name: String(a?.name || '').trim(),
        balance: Number(a?.balance) || 0,
        currency: String(a?.currency || 'USD').trim().toUpperCase() || 'USD',
        type: String(a?.type || 'other').trim().toLowerCase(),
        is_credit: Boolean(a?.is_credit),
      }))
      .filter((a) => a.name || a.balance);

    return res.status(200).json({ accounts });
  } catch (error) {
    console.error('scanAccountBalances failed', safeError(error));
    return res.status(500).json({ error: 'Failed to process balances image' });
  }
}
