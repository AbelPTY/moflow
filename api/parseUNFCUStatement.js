import { extractText, getDocumentProxy } from 'unpdf';
import formidable from 'formidable';
import fs from 'fs';
import { requireUser } from '../server/auth.js';
import { applyRateLimit } from '../server/rateLimit.js';
import { safeError } from '../server/safeError.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

// ============================================================
// UNFCU STATEMENT PARSER
//
// Supports:
// 1. Traditional UNFCU Visa statements.
// 2. UNFCU Accounts Record / MiniSummary combined statements.
// 3. Individual MiniSummary PDFs for Savings, Checking,
//    Personal Loan, LOC, Membership Share or Visa.
//
// Important:
// unpdf can flatten PDF tables into a single stream of text.
// Therefore this parser does not depend on reliable line breaks.
// ============================================================

function parseMoney(text) {
  if (text === null || text === undefined) return 0;

  const raw = String(text).trim();
  const negative =
    raw.includes('(') &&
    raw.includes(')');

  const cleaned = raw
    .replace(/,/g, '')
    .replace(/\$/g, '')
    .replace(/[()]/g, '')
    .trim();

  const value = parseFloat(cleaned);

  if (Number.isNaN(value)) return 0;

  return negative
    ? -Math.abs(value)
    : value;
}

function cleanDescription(desc) {
  return String(desc || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function last4(accountNumber) {
  const digits = String(accountNumber || '')
    .replace(/\D/g, '');

  return digits.slice(-4);
}

function extractMaskedLast4(value) {
  const text = String(value || '');

  const match =
    text.match(/(\d{4})\s*$/);

  return match ? match[1] : '';
}

function canonicalUnfcuAccount(
  sectionName,
  accountNumber = ''
) {
  const suffix =
    last4(accountNumber) ||
    extractMaskedLast4(accountNumber);

  if (sectionName === 'Membership Share') {
    return 'UNFCU Membership Share';
  }

  if (sectionName === 'Savings Account') {
    return suffix
      ? `UNFCU Savings ${suffix}`
      : 'UNFCU Savings';
  }

  if (sectionName === 'Checking Account') {
    return suffix
      ? `UNFCU Checking ${suffix}`
      : 'UNFCU Checking';
  }

  if (sectionName === 'Personal Loan') {
    return suffix
      ? `UNFCU Personal Loan ${suffix}`
      : 'UNFCU Personal Loan';
  }

  if (
    sectionName ===
    'Checking Line of Credit'
  ) {
    return suffix
      ? `UNFCU Checking Line of Credit ${suffix}`
      : 'UNFCU Checking Line of Credit';
  }

  if (
    sectionName ===
    'UNFCU Visa Elite'
  ) {
    return suffix
      ? `UNFCU Visa Elite ${suffix}`
      : 'UNFCU Visa Elite';
  }

  return 'UNFCU';
}

function normalizeDateParts(
  day,
  monthText,
  year
) {
  const months = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };

  const month =
    months[
      String(monthText || '')
        .slice(0, 3)
        .toLowerCase()
    ];

  if (!month) return null;

  return (
    `${year}-` +
    `${month}-` +
    `${String(day).padStart(2, '0')}`
  );
}

function parseLongDate(text) {
  const match = String(text || '').match(
    /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/
  );

  if (!match) return null;

  return normalizeDateParts(
    match[1],
    match[2],
    match[3]
  );
}

function makeTransaction({
  date,
  description,
  reference = '',
  amount,
  accountName,
}) {
  const clean =
    cleanDescription(description);

  return {
    date,
    description_raw: clean,
    merchant_extracted: clean,
    reference:
      reference
        ? String(reference).trim()
        : '',
    amount,
    account_name: accountName,
    source_account: accountName,
    source_institution: 'UNFCU',
  };
}

// ============================================================
// TRADITIONAL VISA STATEMENT
// ============================================================

function detectTraditionalVisaAccountName(
  fullText
) {
  const match = fullText.match(
    /Account Number Ending In\s+(\d{4})/i
  );

  if (match) {
    return `UNFCU Visa Elite ${match[1]}`;
  }

  const masked = fullText.match(
    /UNFCU Visa Elite\s+([0-9xX*]+)/
  );

  if (masked) {
    const suffix =
      extractMaskedLast4(masked[1]);

    if (suffix) {
      return `UNFCU Visa Elite ${suffix}`;
    }
  }

  return 'UNFCU Visa Elite';
}

function parseTraditionalVisaStatement(
  fullText
) {
  const transactions = [];

  const accountName =
    detectTraditionalVisaAccountName(
      fullText
    );

  const yearMatch = fullText.match(
    /Statement Closing Date\s+\d{2}\/\d{2}\/(\d{4})/
  );

  const statementYear =
    yearMatch
      ? yearMatch[1]
      : String(
          new Date().getFullYear()
        );

  const txnPattern =
    /(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+([A-Z0-9]{10,})\s+(-?[\d,]+\.\d{2})/g;

  let match;

  while (
    (match =
      txnPattern.exec(fullText)) !== null
  ) {
    const [
      ,
      ,
      postDate,
      desc,
      ref,
      amountText,
    ] = match;

    const [mm, dd] =
      postDate.split('/');

    const rawAmount =
      parseMoney(amountText);

    transactions.push(
      makeTransaction({
        date:
          `${statementYear}-${mm}-${dd}`,
        description: desc,
        reference: ref,
        amount: -rawAmount,
        accountName,
      })
    );
  }

  const interestPattern =
    /(\d{2}\/\d{2})\s+\d{2}\/\d{2}\s+(Interest Charge on [A-Za-z ]+?)\s+(-?[\d,]+\.\d{2})/g;

  while (
    (match =
      interestPattern.exec(
        fullText
      )) !== null
  ) {
    const [
      ,
      dateText,
      desc,
      amountText,
    ] = match;

    const amount =
      Math.abs(
        parseMoney(amountText)
      );

    if (amount === 0) continue;

    const [mm, dd] =
      dateText.split('/');

    transactions.push(
      makeTransaction({
        date:
          `${statementYear}-${mm}-${dd}`,
        description: desc,
        amount: -amount,
        accountName,
      })
    );
  }

  return transactions;
}

// ============================================================
// ACCOUNTS RECORD / MINI SUMMARY
// ============================================================

function findMiniSummarySections(
  fullText
) {
  const definitions = [
    {
      name: 'Savings Account',
      regex:
        /Savings Account\s+(\d{5,})/g,
    },
    {
      name: 'Checking Account',
      regex:
        /Checking Account\s+(\d{5,})/g,
    },
    {
      name: 'Membership Share',
      regex:
        /Membership Share(?=\s+(?:Date|Ending Balance|No Transactions))/g,
    },
    {
      name:
        'Checking Line of Credit',
      regex:
        /Checking Line of Credit\s+(\d{5,})/g,
    },
    {
      name: 'Personal Loan',
      regex:
        /Personal Loan\s+(\d{5,})/g,
    },
    {
      name: 'UNFCU Visa Elite',
      regex:
        /UNFCU Visa Elite\s+([0-9xX*]+)/g,
    },
  ];

  const candidates = [];

  for (const definition of definitions) {
    let match;

    while (
      (match =
        definition.regex.exec(
          fullText
        )) !== null
    ) {
      const accountNumber =
        match[1] || '';

      // The same account name appears in the
      // summary table and again as the actual
      // activity section. We only want the
      // activity-section occurrence.
      const after = fullText.slice(
        match.index,
        match.index + 300
      );

      const looksLikeActivity =
        /Date\s+Description/i.test(
          after
        ) ||
        /Account Activity/i.test(
          after
        );

      if (!looksLikeActivity) {
        continue;
      }

      candidates.push({
        name: definition.name,
        account: accountNumber,
        start: match.index,
      });
    }
  }

  return candidates
    .sort(
      (a, b) =>
        a.start - b.start
    );
}

function extractMiniMoneyTokens(text) {
  const regex =
    /\(?\$[\d,]+\.\d{2}\)?/g;

  return [
    ...String(text || '').matchAll(
      regex
    ),
  ].map((match) => ({
    raw: match[0],
    index: match.index,
    amount: parseMoney(match[0]),
  }));
}

function parseMiniDepositSection({
  sectionText,
  sectionName,
  accountNumber,
}) {
  const transactions = [];

  const accountName =
    canonicalUnfcuAccount(
      sectionName,
      accountNumber
    );

  if (
    /No Transactions/i.test(
      sectionText
    )
  ) {
    return transactions;
  }

  const activityMatch =
    sectionText.match(
      /Date\s+Description\s+Debits\s+Credits\s+Balance/i
    );

  if (!activityMatch) {
    return transactions;
  }

  const activityStart =
    activityMatch.index +
    activityMatch[0].length;

  let activityText =
    sectionText.slice(
      activityStart
    );

  const endingIndex =
    activityText.search(
      /Ending Balance/i
    );

  if (endingIndex >= 0) {
    activityText =
      activityText.slice(
        0,
        endingIndex
      );
  }

  const chunks =
    activityText.split(
      /(?=\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s)/
    );

  for (const rawChunk of chunks) {
    const chunk =
      cleanDescription(rawChunk);

    if (!chunk) continue;

    const dateMatch =
      chunk.match(
        /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s+(.+)$/
      );

    if (!dateMatch) continue;

    const date =
      normalizeDateParts(
        dateMatch[1],
        dateMatch[2],
        dateMatch[3]
      );

    if (!date) continue;

    const rest =
      dateMatch[4];

    const money =
      extractMiniMoneyTokens(
        rest
      );

    if (money.length < 1) {
      continue;
    }

    // Deposit accounts normally have:
    // transaction amount + running balance.
    // The FIRST monetary value is therefore
    // the transaction itself.
    const txnMoney = money[0];

    const description =
      cleanDescription(
        rest.slice(
          0,
          txnMoney.index
        )
      );

    let amount =
      txnMoney.amount;

    // Some PDF extraction paths lose the
    // parentheses that indicate debits.
    // Description gives us a safe secondary
    // signal for withdrawals.
    if (
      /withdrawal|debit|payment|transfer to/i.test(
        description
      )
    ) {
      amount =
        -Math.abs(amount);
    } else if (
      /deposit|credit|interest/i.test(
        description
      )
    ) {
      amount =
        Math.abs(amount);
    }

    if (amount === 0) continue;

    const reference =
      accountNumber || '';

    const fullDescription =
      `${sectionName}` +
      `${accountNumber
        ? ` (${accountNumber})`
        : ''}: ` +
      description;

    transactions.push(
      makeTransaction({
        date,
        description:
          fullDescription,
        reference,
        amount,
        accountName,
      })
    );
  }

  return transactions;
}

function parseMiniLoanSection({
  sectionText,
  sectionName,
  accountNumber,
}) {
  const transactions = [];

  const accountName =
    canonicalUnfcuAccount(
      sectionName,
      accountNumber
    );

  if (
    /No Transactions/i.test(
      sectionText
    )
  ) {
    return transactions;
  }

  const activityMatch =
    sectionText.match(
      /Date\s+Description\s+Debits\s+Credits\s+Balance/i
    );

  if (!activityMatch) {
    return transactions;
  }

  const activityStart =
    activityMatch.index +
    activityMatch[0].length;

  let activityText =
    sectionText.slice(
      activityStart
    );

  const endingIndex =
    activityText.search(
      /Ending Balance/i
    );

  if (endingIndex >= 0) {
    activityText =
      activityText.slice(
        0,
        endingIndex
      );
  }

  const chunks =
    activityText.split(
      /(?=\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s)/
    );

  for (const rawChunk of chunks) {
    const chunk =
      cleanDescription(rawChunk);

    if (!chunk) continue;

    const dateMatch =
      chunk.match(
        /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s+(.+)$/
      );

    if (!dateMatch) continue;

    const date =
      normalizeDateParts(
        dateMatch[1],
        dateMatch[2],
        dateMatch[3]
      );

    if (!date) continue;

    const rest =
      dateMatch[4];

    const money =
      extractMiniMoneyTokens(
        rest
      );

    if (money.length < 1) {
      continue;
    }

    const txnMoney = money[0];

    const description =
      cleanDescription(
        rest.slice(
          0,
          txnMoney.index
        )
      );

    const amount =
      -Math.abs(
        txnMoney.amount
      );

    if (amount === 0) continue;

    const fullDescription =
      `${sectionName}` +
      `${accountNumber
        ? ` (${accountNumber})`
        : ''}: ` +
      description;

    transactions.push(
      makeTransaction({
        date,
        description:
          fullDescription,
        reference:
          accountNumber,
        amount,
        accountName,
      })
    );
  }

  return transactions;
}

function parseMiniVisaSection({
  sectionText,
  accountNumber,
}) {
  const transactions = [];

  const accountName =
    canonicalUnfcuAccount(
      'UNFCU Visa Elite',
      accountNumber
    );

  if (
    /No Transactions/i.test(
      sectionText
    )
  ) {
    return transactions;
  }

  const headerMatch =
    sectionText.match(
      /Date\s+Description\s+Debits\s+Credits/i
    );

  if (!headerMatch) {
    return transactions;
  }

  let activityText =
    sectionText.slice(
      headerMatch.index +
      headerMatch[0].length
    );

  const endingIndex =
    activityText.search(
      /Ending Balance/i
    );

  if (endingIndex >= 0) {
    activityText =
      activityText.slice(
        0,
        endingIndex
      );
  }

  const chunks =
    activityText.split(
      /(?=\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s)/
    );

  for (const rawChunk of chunks) {
    const chunk =
      cleanDescription(rawChunk);

    if (!chunk) continue;

    const dateMatch =
      chunk.match(
        /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\s+(.+)$/
      );

    if (!dateMatch) continue;

    const date =
      normalizeDateParts(
        dateMatch[1],
        dateMatch[2],
        dateMatch[3]
      );

    if (!date) continue;

    const rest =
      dateMatch[4];

    const money =
      extractMiniMoneyTokens(
        rest
      );

    if (money.length < 1) {
      continue;
    }

    const txnMoney =
      money[0];

    const description =
      cleanDescription(
        rest.slice(
          0,
          txnMoney.index
        )
      );

    let amount;

    // On a credit card:
    // purchases/interest increase debt => expense.
    // payments/credits reduce debt => positive.
    if (
      /payment|thank you|credit|refund/i.test(
        description
      ) ||
      txnMoney.raw.includes('(')
    ) {
      amount =
        Math.abs(
          txnMoney.amount
        );
    } else {
      amount =
        -Math.abs(
          txnMoney.amount
        );
    }

    if (amount === 0) continue;

    transactions.push(
      makeTransaction({
        date,
        description,
        amount,
        accountName,
      })
    );
  }

  return transactions;
}

function reconcileMiniLoanPayments(
  transactions
) {
  const result = [];
  const loanTransactions = [];
  const otherTransactions = [];

  for (const transaction of transactions) {
    if (
      transaction.account_name
        .startsWith(
          'UNFCU Personal Loan'
        ) ||
      transaction.account_name
        .startsWith(
          'UNFCU Checking Line of Credit'
        )
    ) {
      loanTransactions.push(
        transaction
      );
    } else {
      otherTransactions.push(
        transaction
      );
    }
  }

  const consumed =
    new Set();

  for (const loanTxn of loanTransactions) {
    const matchingIndex =
      otherTransactions.findIndex(
        (otherTxn, index) => {
          if (
            consumed.has(index)
          ) {
            return false;
          }

          const sameAmount =
            Math.abs(
              Number(
                otherTxn.amount
              )
            ).toFixed(2) ===
            Math.abs(
              Number(
                loanTxn.amount
              )
            ).toFixed(2);

          if (!sameAmount) {
            return false;
          }

          const looksLoanRelated =
            /loan/i.test(
              otherTxn.description_raw ||
                ''
            );

          if (!looksLoanRelated) {
            return false;
          }

          const otherDate =
            String(
              otherTxn.date || ''
            );

          const loanDate =
            String(
              loanTxn.date || ''
            );

          return (
            otherDate === loanDate
          );
        }
      );

    if (matchingIndex !== -1) {
      // Internal Savings/Checking withdrawal
      // already records the real cash movement.
      // Do not count the same loan payment twice.
      consumed.add(
        matchingIndex
      );
      continue;
    }

    result.push(
      loanTxn
    );
  }

  result.push(
    ...otherTransactions
  );

  return result;
}

function parseMiniSummaryStatement(
  fullText
) {
  const sections =
    findMiniSummarySections(
      fullText
    );

  if (
    sections.length === 0
  ) {
    return [];
  }

  const transactions = [];

  sections.forEach(
    (section, index) => {
      const next =
        sections[index + 1];

      const end =
        next
          ? next.start
          : fullText.length;

      const sectionText =
        fullText.slice(
          section.start,
          end
        );

      if (
        [
          'Savings Account',
          'Checking Account',
          'Membership Share',
        ].includes(
          section.name
        )
      ) {
        transactions.push(
          ...parseMiniDepositSection({
            sectionText,
            sectionName:
              section.name,
            accountNumber:
              section.account,
          })
        );

        return;
      }

      if (
        [
          'Personal Loan',
          'Checking Line of Credit',
        ].includes(
          section.name
        )
      ) {
        transactions.push(
          ...parseMiniLoanSection({
            sectionText,
            sectionName:
              section.name,
            accountNumber:
              section.account,
          })
        );

        return;
      }

      if (
        section.name ===
        'UNFCU Visa Elite'
      ) {
        transactions.push(
          ...parseMiniVisaSection({
            sectionText,
            accountNumber:
              section.account,
          })
        );
      }
    }
  );

  return reconcileMiniLoanPayments(
    transactions
  );
}

// ============================================================
// REQUEST HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({
        error:
          'Method not allowed',
      });
  }

  // Authenticate before reading or parsing
  // the uploaded PDF.
  const user =
    await requireUser(
      req,
      res
    );

  if (!user) return;

  if (
    !(await applyRateLimit({
      req,
      res,
      user,
      scope: 'local_pdf',
    }))
  ) {
    return;
  }

  try {
    const form =
      formidable({
        multiples: false,
      });

    const { files } =
      await new Promise(
        (
          resolve,
          reject
        ) => {
          form.parse(
            req,
            (
              err,
              fields,
              parsedFiles
            ) => {
              if (err) {
                reject(err);
                return;
              }

              resolve({
                fields,
                files:
                  parsedFiles,
              });
            }
          );
        }
      );

    const file =
      files.file;

    if (!file) {
      return res
        .status(400)
        .json({
          error:
            'No file uploaded',
        });
    }

    const filePath =
      Array.isArray(file)
        ? file[0].filepath
        : file.filepath;

    const fileBuffer =
      fs.readFileSync(
        filePath
      );

    const pdf =
      await getDocumentProxy(
        new Uint8Array(
          fileBuffer
        )
      );

    const { text } =
      await extractText(
        pdf,
        {
          mergePages: true,
        }
      );

    if (
      !text ||
      !text.trim()
    ) {
      return res
        .status(400)
        .json({
          error:
            'Could not extract text from PDF',
        });
    }

    let transactions = [];
    let detectedType =
      'unknown';

    // Traditional dedicated Visa
    // statement.
    if (
      text.includes(
        'TRANSACTIONS'
      ) &&
      /Account Number Ending In/i.test(
        text
      )
    ) {
      detectedType =
        'visa';

      transactions =
        parseTraditionalVisaStatement(
          text
        );
    } else {
      // Accounts Record / MiniSummary.
      //
      // This intentionally does NOT require
      // Membership Share because UNFCU also
      // produces individual-account PDFs such
      // as a Personal Loan-only MiniSummary.
      const looksLikeMiniSummary =
        /Accounts Record Ending/i.test(
          text
        ) ||
        /Summary of Deposit Accounts/i.test(
          text
        ) ||
        /Summary of Loan Accounts and Credit Cards/i.test(
          text
        );

      if (
        looksLikeMiniSummary
      ) {
        detectedType =
          'accounts-record';

        transactions =
          parseMiniSummaryStatement(
            text
          );
      }
    }

    if (
      transactions.length === 0
    ) {
      const debugSnippet =
        text.slice(0, 2500);

      return res
        .status(400)
        .json({
          error:
            `Detected as "${detectedType}" but found 0 transactions. ` +
            `DEBUG snippet: ${debugSnippet}`,
        });
    }

    return res
      .status(200)
      .json(
        transactions
      );
  } catch (error) {
    console.error(
      'parseUNFCUStatement failed',
      safeError(error)
    );

    return res
      .status(500)
      .json({
        error:
          'Failed to parse UNFCU statement',
      });
  }
}