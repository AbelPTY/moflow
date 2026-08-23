import { extractText, getDocumentProxy } from 'unpdf';
import formidable from 'formidable';
import fs from 'fs';
import { requireUser } from '../server/auth.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

// IMPORTANT: unpdf flattens PDF pages into text with very few real line
// breaks -- table rows that are visually stacked end up separated by a
// single space, not a newline. Every pattern below is written assuming
// NO reliable line structure exists, and was validated against real
// production unpdf output (not just a local approximation).

function cleanDescription(desc) {
  return desc.replace(/\s*\$[\d,]+\.\d{2}\s*$/, '').trim();
}

function parseMoney(text) {
  return parseFloat(String(text).replace(/,/g, '').replace(/\$/g, '').trim()) || 0;
}

// --- UNFCU Visa / credit card statement ---
// Validated directly against real production unpdf output: purchases are
// positive in the source, payments negative (UNFCU's own text states "An
// amount preceded by a minus sign (-) is a credit"). We flip both to match
// this app's convention (expenses negative, credits/payments positive).
function parseUnfcuVisaStatement(fullText) {
  const transactions = [];

  const yearMatch = fullText.match(/Statement Closing Date\s+\d{2}\/\d{2}\/(\d{4})/);
  const statementYear = yearMatch ? yearMatch[1] : String(new Date().getFullYear());

  // No ^ $ anchors -- the real text has no line breaks between transactions
  const txnPattern = /(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+([A-Z0-9]{10,})\s+(-?[\d,]+\.\d{2})/g;
  let m;
  while ((m = txnPattern.exec(fullText)) !== null) {
    const [, , postDate, desc, ref, amountStr] = m;
    const [mm, dd] = postDate.split('/');
    const rawAmount = parseMoney(amountStr);
    transactions.push({
      date: `${statementYear}-${mm}-${dd}`,
      description_raw: desc.trim(),
      merchant_extracted: desc.trim(),
      reference: ref,
      amount: -rawAmount
    });
  }

  const interestPattern = /(\d{2}\/\d{2})\s+\d{2}\/\d{2}\s+(Interest Charge on [A-Za-z ]+?)\s+(-?[\d,]+\.\d{2})/g;
  while ((m = interestPattern.exec(fullText)) !== null) {
    const [, date, desc, amountStr] = m;
    const amt = parseMoney(amountStr);
    if (amt > 0) {
      const [mm, dd] = date.split('/');
      transactions.push({
        date: `${statementYear}-${mm}-${dd}`,
        description_raw: desc.trim(),
        merchant_extracted: desc.trim(),
        reference: '',
        amount: -amt
      });
    }
  }

  return transactions;
}

// --- UNFCU General Statement (Membership Share, Savings, Checking, Loan, LOC) ---
// Validated against real production unpdf output for the deposit-type
// accounts, including a statement with multiple debits and credits in the
// same period, and against real loan payment activity.
function parseUnfcuGeneralStatement(fullText) {
  const depositTransactions = [];
  const loanPayments = []; // collected separately so they can be reconciled against deposit withdrawals

  const sectionPattern = /(Membership Share|Savings Account|Checking Account|Personal Loan|Checking Line of Credit) - (\d+)/g;
  const sections = [];
  let sm;
  while ((sm = sectionPattern.exec(fullText)) !== null) {
    sections.push({ name: sm[1], account: sm[2], start: sm.index });
  }

  // Deposit-type accounts (Membership Share, Savings, Checking). Each real
  // transaction row shows TWO dollar figures back-to-back once flattened
  // (the transaction amount, then the running balance) -- e.g.
  // "External Deposit UNDP - APR2026PY $500.00 $615.87". We always take the
  // LAST dollar figure as the balance and compute (thisBalance -
  // previousBalance) for the true signed amount, which sidesteps needing to
  // know which number is a debit vs credit at all. Validated against two
  // real statements including one with multiple debits and credits.
  const extractDepositAccount = (sectionText, sectionName, accountNumber) => {
    const activityIdx = sectionText.indexOf('Account Activity');
    if (activityIdx === -1) return;
    const activityText = sectionText.slice(activityIdx);

    const chunks = activityText.split(/(?=\d{2}\/\d{2}\/\d{4}\s)/);
    let prevBalance = null;

    for (const rawChunk of chunks) {
      const chunk = rawChunk.trim();
      if (!chunk) continue;
      const m = chunk.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
      if (!m) continue;
      const [, date, rest] = m;

      if (rest.includes('Beginning Balance')) {
        const bm = rest.match(/\$([\d,]+\.\d{2})/);
        if (bm) prevBalance = parseMoney(bm[1]);
        continue;
      }
      if (rest.includes('No activity this statement period')) continue;
      if (rest.includes('Ending Balance')) continue;

      const dollarMatches = [...rest.matchAll(/\$([\d,]+\.\d{2})/g)];
      if (dollarMatches.length > 0 && prevBalance !== null) {
        const last = dollarMatches[dollarMatches.length - 1];
        const balance = parseMoney(last[1]);
        const desc = cleanDescription(rest.slice(0, last.index));
        const signedAmount = Math.round((balance - prevBalance) * 100) / 100;
        if (signedAmount !== 0) {
          const [mm, dd, yyyy] = date.split('/');
          const description = `${sectionName} (${accountNumber}): ${desc}`;
          depositTransactions.push({
            date: `${yyyy}-${mm}-${dd}`,
            description_raw: description,
            merchant_extracted: description,
            reference: accountNumber,
            amount: signedAmount,
            rawDescLower: desc.toLowerCase()
          });
        }
        prevBalance = balance;
      }
    }
  };

  // Loan-type accounts (Personal Loan, Checking Line of Credit). Validated
  // against a real statement: "Regular Payment $X Principal $Y Interest $Z"
  // is matched as one atomic unit so the Principal/Interest breakdown never
  // gets mis-parsed as if it were a separate line.
  //
  // IMPORTANT: a loan payment made via internal transfer from UNFCU
  // Savings/Checking shows up TWICE in this statement -- once as a
  // Savings/Checking withdrawal, once as the loan's own "Regular Payment"
  // entry. Recording both would double the real amount paid. So these are
  // collected here and reconciled below: skipped if a matching internal
  // withdrawal already covers them, kept (and flagged) only if genuinely
  // unmatched -- e.g. a payment made from an external, non-UNFCU account.
  const extractLoanAccount = (sectionText, sectionName, accountNumber) => {
    const activityIdx = sectionText.indexOf('Account Activity');
    if (activityIdx === -1) return;
    const activityText = sectionText.slice(activityIdx);
    if (activityText.includes('No activity this statement period')) return;

    const regularPaymentPattern = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+Regular Payment\s+\$([\d,]+\.\d{2})\s+Principal\s+\$[\d,]+\.\d{2}\s+Interest\s+\$[\d,]+\.\d{2}/g;
    let m;
    let matchedAny = false;
    while ((m = regularPaymentPattern.exec(activityText)) !== null) {
      matchedAny = true;
      const [, , postDate, amountStr] = m;
      const amount = parseMoney(amountStr);
      if (amount !== 0) {
        const [mm, dd, yyyy] = postDate.split('/');
        loanPayments.push({
          date: `${yyyy}-${mm}-${dd}`,
          amount,
          sectionName,
          accountNumber
        });
      }
    }

    // Fallback for any loan activity that ISN'T the "Regular Payment"
    // format above (e.g. a different transaction type never seen in
    // testing) -- captured but clearly flagged as unverified.
    if (!matchedAny) {
      const genericPattern = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+\$(-?[\d,]+\.\d{2})(?=\s+\d{2}\/\d{2}\/\d{4}|\s*$)/g;
      while ((m = genericPattern.exec(activityText)) !== null) {
        const [, , postDate, rawDesc, amountStr] = m;
        const amount = parseMoney(amountStr);
        if (amount !== 0) {
          const [mm, dd, yyyy] = postDate.split('/');
          const description = `${sectionName} (${accountNumber}): ${cleanDescription(rawDesc)} [unverified format -- please check this one]`;
          depositTransactions.push({
            date: `${yyyy}-${mm}-${dd}`,
            description_raw: description,
            merchant_extracted: description,
            reference: accountNumber,
            amount: -Math.abs(amount),
            rawDescLower: ''
          });
        }
      }
    }
  };

  sections.forEach((section, i) => {
    const end = i + 1 < sections.length ? sections[i + 1].start : fullText.length;
    const sectionText = fullText.slice(section.start, end);

    if (['Membership Share', 'Savings Account', 'Checking Account'].includes(section.name)) {
      extractDepositAccount(sectionText, section.name, section.account);
    } else {
      extractLoanAccount(sectionText, section.name, section.account);
    }
  });

  // Reconcile: a loan payment is skipped if a same-amount, loan-labeled
  // withdrawal already exists among the deposit-account transactions
  // (confirmed internal transfer). Otherwise it's kept and flagged, since
  // that means it was likely paid from outside UNFCU entirely.
  const internalLoanWithdrawals = depositTransactions
    .filter((t) => t.amount < 0 && /loan/i.test(t.rawDescLower))
    .map((t) => Math.abs(t.amount));

  for (const lp of loanPayments) {
    const idx = internalLoanWithdrawals.indexOf(Math.round(lp.amount * 100) / 100);
    if (idx !== -1) {
      internalLoanWithdrawals.splice(idx, 1); // consume the match so it can't be reused
      continue; // already covered by a Savings/Checking withdrawal -- skip to avoid double-counting
    }
    const description = `${lp.sectionName} (${lp.accountNumber}): Regular Payment [no matching internal transfer found -- verify this was paid from outside UNFCU]`;
    depositTransactions.push({
      date: lp.date,
      description_raw: description,
      merchant_extracted: description,
      reference: lp.accountNumber,
      amount: -Math.abs(lp.amount)
    });
  }

  return depositTransactions.map(({ rawDescLower, ...t }) => t);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate BEFORE reading the uploaded file, so anonymous requests never
  // reach the parser.
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const form = formidable({ multiples: false });
    const { files } = await new Promise((resolve, reject) => {
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

    const pdf = await getDocumentProxy(new Uint8Array(fileBuffer));
    const { text } = await extractText(pdf, { mergePages: true });

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Could not extract text from PDF' });
    }

    let transactions;
    let detectedType = 'unknown';
    if (text.includes('TRANSACTIONS') && /Account Number Ending In/.test(text)) {
      detectedType = 'visa';
      transactions = parseUnfcuVisaStatement(text);
    } else if (text.includes('Summary of Accounts') && text.includes('Membership Share')) {
      detectedType = 'general';
      transactions = parseUnfcuGeneralStatement(text);
    } else {
      return res.status(400).json({
        error: 'This does not look like a recognized UNFCU statement format (expected either the Visa/credit card statement or the general Membership/Savings/Loan statement). DEBUG -- first 1500 chars: ' + text.slice(0, 1500)
      });
    }

    if (transactions.length === 0) {
      const anchorIndex = text.indexOf('BUFFET') >= 0 ? text.indexOf('BUFFET') : text.indexOf('TRANSACTIONS');
      const start = Math.max(0, anchorIndex - 200);
      const debugSnippet = anchorIndex >= 0 ? text.slice(start, start + 2500) : text.slice(0, 2500);
      return res.status(400).json({
        error: `Detected as "${detectedType}" format but found 0 transactions. DEBUG snippet: ${debugSnippet}`
      });
    }

    return res.status(200).json(transactions);
  } catch (error) {
    console.error('parseUNFCUStatement error:', error);
    return res.status(500).json({ error: error?.message || 'Unknown error parsing UNFCU statement' });
  }
}
