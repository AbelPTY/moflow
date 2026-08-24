import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from './rateLimit.js';
import { safeError } from '../server/safeError.js';

// Turns a spoken/typed money brain-dump into a categorized task list. The
// browser does speech-to-text (Web Speech API) and sends the transcript here;
// Gemini splits it into discrete tasks, categorizes them, and resolves any
// spoken due dates against today. Same GEMINI_API_KEY as the other scanners.

const CATEGORIES = ['Bills & Payments', 'Savings & Goals', 'Admin & Calls', 'Errands & Shopping', 'Other'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  // Durable per-user + per-IP rate limit BEFORE any Gemini work.
  if (!(await applyRateLimit({ req, res, user, scope: 'gemini_text' }))) return;

  try {
    const { text, today } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });

    const todayStr = today || new Date().toISOString().split('T')[0];

    const prompt = `
      You turn a spoken, money-related brain-dump into a clean, actionable task
      list. Today's date is ${todayStr}. The note may be in Spanish or English.

      Split the note into DISCRETE tasks. For each task return:
      - "title": a short imperative task in the note's language (e.g. "Pagar tarjeta Banco General Star", "Call UNFCU about the fee").
      - "category": EXACTLY one of: ${CATEGORIES.map((c) => `"${c}"`).join(', ')}.
      - "due_date": "YYYY-MM-DD" if a date or deadline is mentioned or clearly implied (resolve relative expressions like "el viernes", "next week", "the 15th", "mañana" against today's date). Otherwise null.

      Return ONLY a JSON array, no markdown:
      [ { "title": "...", "category": "...", "due_date": "YYYY-MM-DD" | null } ]

      Rules:
      - Keep tasks concise and money-focused.
      - Financial errands, bill payments, calls to banks, moving money, and steps
        toward savings goals are the priority.
      - If the note contains a non-financial item, still include it under "Other".
      - If nothing actionable is found, return [].

      Note:
      ${text}
    `;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text();
    responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const start = responseText.indexOf('[');
      const end = responseText.lastIndexOf(']');
      parsed = start !== -1 && end !== -1 ? JSON.parse(responseText.slice(start, end + 1)) : [];
    }

    const tasks = (Array.isArray(parsed) ? parsed : [])
      .map((t) => ({
        title: String(t?.title || '').trim(),
        category: CATEGORIES.includes(t?.category) ? t.category : 'Other',
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(t?.due_date) ? t.due_date : null,
      }))
      .filter((t) => t.title);

    return res.status(200).json(tasks);
  } catch (error) {
    console.error('voiceToTasks failed', safeError(error));
    return res.status(500).json({ error: 'Failed to process the note' });
  }
}
