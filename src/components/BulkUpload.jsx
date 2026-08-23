import React, { useState } from 'react';
import { supabase } from '../lib/supabase'; // Asegúrate de que esta ruta sea la correcta en tu proyecto
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import rulesData from '../rules/merchant_rules.json';
import { classifyTransaction } from '../lib/engine/ruleMatcher';
import useUserMerchantRules from '../hooks/useUserMerchantRules';
import { authHeader } from '../lib/apiClient';

// --- UTILIDADES ---
function safeParseDate(rawDate) {
  if (!rawDate) return null;
  const cleaned = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return new Date(`${cleaned}T12:00:00`).toISOString();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
    const [dd, mm, yyyy] = cleaned.split('/');
    return new Date(`${yyyy}-${mm}-${dd}T12:00:00`).toISOString();
  }
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(`${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}T12:00:00`).toISOString();
  }
  return null;
}

function parseAmount(value) {
  if (value === null || value === undefined) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const negative = raw.includes('(') && raw.includes(')');
  const cleaned = raw.replace(/[,$()\s]/g, '');
  const number = Number(cleaned);
  if (Number.isNaN(number)) return 0;
  return negative ? -Math.abs(number) : number;
}

function normalizeParsedTransaction(t) {
  const transactionDate = safeParseDate(t.date || t.transaction_date || new Date().toISOString().split('T')[0]);
  const description = t.description_raw || t.description || t.merchant_extracted || t.merchant || 'Imported transaction';
  const merchant = t.merchant_extracted || t.merchant || description;
  const amount = parseAmount(t.amount);
  const reference = t.reference ? String(t.reference).trim() : '';

  return {
    transaction_date: transactionDate,
    description: String(description).trim(),
    amount,
    merchant_display: String(merchant).trim(),
    category_guess: t.category || 'Uncategorized',
    reference
  };
}

function excelDateToString(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    // Excel stores dates as a serial number of days since 1899-12-30
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = value * 24 * 60 * 60 * 1000;
    return new Date(excelEpoch.getTime() + ms).toISOString().split('T')[0];
  }
  return String(value);
}

// Parses Cooperativa Profesionales R.L. "Estado de cuenta" HTML exports.
// This is a fixed, predictable institutional template (not user-varying like
// a bank CSV), so it's parsed deterministically via real DOM structure --
// no AI involved, no cost per upload, and no risk of a model mis-reading a
// number. Validated against a real exported statement before shipping.
//
// Every transaction is tagged with BOTH its section name (Aportaciones,
// Seguros, Ahorros, etc.) AND its real account/policy number, since without
// this, genuinely distinct payments -- e.g. two dependents on the same
// insurance plan type, or two savings sub-accounts -- can look identical
// (same date, same description, same amount) and collide as duplicates.
function parseCooperativaHTML(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const bodyText = doc.body.textContent;

  const toISO = (ddmmyyyy) => {
    const [d, m, y] = ddmmyyyy.split('/');
    return `${y}-${m}-${d}`;
  };

  const saldoMatch = bodyText.match(/Saldo al:(\d{2})\/(\d{2})\/(\d{4})/);
  const statementDate = saldoMatch
    ? `${saldoMatch[3]}-${saldoMatch[2]}-${saldoMatch[1]}`
    : new Date().toISOString().split('T')[0];

  const parseMonto = (text) => parseFloat(String(text).replace(/,/g, '').trim()) || 0;
  const getCells = (tr) => Array.from(tr.children).filter((el) => el.tagName === 'TD');

  const transactions = [];

  const findSectionTable = (label) => {
    const header = Array.from(doc.querySelectorAll('strong')).find((s) => s.textContent.trim() === label);
    if (!header) return null;
    let tr = header.closest('tr');
    while (tr) {
      tr = tr.nextElementSibling;
      if (tr) {
        const table = tr.querySelector('table[border="1"]');
        if (table) return table;
      }
    }
    return null;
  };

  // --- Aportaciones & Capital Externo: ONE real payment per section per
  // statement, read directly from the summary row's "Recibido" column.
  //
  // IMPORTANT: the small table underneath (with "PAGO DE APORTES" and
  // "CUOTA MENSUAL DE APORTES" on different dates) is NOT two separate
  // charges -- both lines show the exact same amount as "Recibido" above
  // them, confirming they're two bookkeeping labels for the same single
  // monthly payment. Reading both would double the real amount paid.
  [
    { label: 'APORTACIONES', name: 'Aportaciones' },
    { label: 'CAPITAL EXTERNO', name: 'Capital Externo' }
  ].forEach(({ label, name }) => {
    const summaryTable = findSectionTable(label);
    if (!summaryTable) return;

    for (const tr of Array.from(summaryTable.querySelectorAll('tr'))) {
      const tds = getCells(tr);
      if (tds.length > 0 && tds[0].getAttribute('bgcolor') === '#FFFFFF') {
        const accountNumber = tds[0].textContent.trim();
        const recibido = parseMonto(tds[2] ? tds[2].textContent : '0');
        if (recibido > 0) {
          const description = `${name} (${accountNumber})`;
          transactions.push({
            transaction_date: statementDate,
            description,
            merchant_display: description,
            amount: -Math.abs(recibido),
            category_guess: 'Savings',
            bucket_guess: 'SAVINGS',
            reference: accountNumber
          });
        }
        break;
      }
    }
  });

  // --- Otros Compromisos, Prestamos, Seguros: no per-row date -- the
  // statement period end date is used, and each row's own account/policy
  // number keeps otherwise-identical line items (e.g. twins on the same
  // insurance plan) genuinely distinct ---
  const extractSection = (label, sectionName, expectedCols, amountIndex, category, bucket) => {
    const table = findSectionTable(label);
    if (!table) return;
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const tds = getCells(tr);
      if (tds.length === expectedCols && tds[0].getAttribute('bgcolor') === '#FFFFFF') {
        const tipo = tds[0].textContent.trim();
        const noCuenta = tds[1] ? tds[1].textContent.trim() : '';
        const amount = parseMonto(tds[amountIndex].textContent);
        if (amount > 0) {
          const description = noCuenta ? `${sectionName} - ${tipo} (${noCuenta})` : `${sectionName} - ${tipo}`;
          transactions.push({
            transaction_date: statementDate,
            description,
            merchant_display: description,
            amount: -Math.abs(amount),
            category_guess: category,
            bucket_guess: bucket,
            reference: noCuenta
          });
        }
      }
    }
  };

  extractSection('OTROS COMPROMISOS', 'Otros Compromisos', 7, 3, 'Insurance', 'NEEDS');
  extractSection('PRESTAMOS', 'Préstamos', 13, 7, 'Loan Payment', 'DEBT_FUNDING');
  extractSection('SEGUROS', 'Seguros', 8, 4, 'Insurance', 'NEEDS');

  // --- Ahorros: MULTIPLE sub-accounts, each with its own "Label : account
  // number" header (e.g. "DEPOSITO DISPONIBLE (ASOC) : 10-001-003886-0").
  // Each sub-account's transactions are tagged with that specific account
  // number, since there can be more than one sub-account of the same type. ---
  const subAccountHeaders = Array.from(doc.querySelectorAll('strong')).filter((s) => {
    const t = s.textContent.trim();
    return /:\s*[\d-]{5,}$/.test(t) && !t.includes('No.Cliente');
  });

  for (const header of subAccountHeaders) {
    const fullLabel = header.textContent.trim().replace(/\s+/g, ' ');
    const separatorIndex = fullLabel.indexOf(':');
    if (separatorIndex === -1) continue;
    const namePart = fullLabel.slice(0, separatorIndex).trim();
    const acctPart = fullLabel.slice(separatorIndex + 1).trim();

    let tr = header.closest('tr');
    let table = null;
    while (tr) {
      tr = tr.nextElementSibling;
      if (tr) {
        table = tr.querySelector('table[border="1"]');
        if (table) break;
      }
    }
    if (!table) continue;

    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const tds = getCells(row);
      if (tds.length === 5 && tds[0].getAttribute('bgcolor') === '#FFFFFF') {
        const fecha = tds[1].textContent.trim();
        const descRaw = tds[2].textContent.trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(fecha) && descRaw.toUpperCase() !== 'SIN MOVIMIENTO') {
          const amount = parseMonto(tds[3].textContent);
          if (amount > 0) {
            const isOutflow = /DEBITO|RETIRO/i.test(descRaw);
            const description = `Ahorros - ${namePart} (${acctPart}): ${descRaw}`;
            transactions.push({
              transaction_date: toISO(fecha),
              description,
              merchant_display: description,
              amount: isOutflow ? -Math.abs(amount) : Math.abs(amount),
              category_guess: 'Savings',
              bucket_guess: 'SAVINGS',
              reference: acctPart
            });
          }
        }
      }
    }
  }

  return transactions;
}

function parsePipeSeparatedText(rawText) {
  const lines = String(rawText || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const transactions = [];
  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 3) {
      const normalized = normalizeParsedTransaction({
        date: parts[0], merchant: parts[1], description_raw: parts[1], amount: parts[2], category: 'Uncategorized'
      });
      if (normalized.description && !Number.isNaN(Number(normalized.amount))) transactions.push(normalized);
    }
  }
  return transactions;
}

// --- COMPONENTE PRINCIPAL ---
// Controlled component: the parent (QuickActionsFab) owns open/close state so
// this action can share a single "+" speed-dial with Add Transaction.
export default function BulkUpload({ onTransactionsAdded, open = false, onClose }) {
  const { user } = useAuth();
  const { userRules } = useUserMerchantRules(); // active user rules (empty today)
  const closeModal = () => { if (onClose) onClose(); };
  const [activeTab, setActiveTab] = useState('text');
  const [selectedAccount, setSelectedAccount] = useState('Cuenta Principal'); // <-- INYECTADO
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsedTransactions, setParsedTransactions] = useState([]);

  // Applies your actual merchant_rules.json (the same rules that categorize
  // things on the main transaction list) at upload time. This is checked
  // FIRST, since it's your deliberately curated source of truth -- it's the
  // exact reason "INTERES CUENTA DE AHORROS" etc. already show as categorized
  // everywhere else in the app.
  const applyStaticRules = (transactions) => {
    return transactions.map((t) => {
      const description = String(t.description || '').toUpperCase();

      // MANUAL -> LEGACY(STATIC + MIGRATED). Empty userRules today -> pure static
      // (identical to before). Any match sets matchedRule so the learned-history
      // step below will NOT override it. matchedRuleSource records provenance.
      const match = classifyTransaction({ merchant: t.merchant_display || t.merchant, description }, rulesData?.rules, userRules);
      if (match) {
        return {
          ...t,
          category_guess: match.rule.assign.category,
          bucket_guess: match.rule.assign.budgetBucket,
          matchedRule: match.rule.id,
          matchedRuleSource: match.kind // 'manual' | 'migrated' | 'static'
        };
      }
      return t;
    });
  };

  // Learns from YOUR own categorization history: for each new transaction,
  // checks whether you've categorized this exact merchant/description before,
  // and if so, applies the most common category+bucket you've used for it.
  // Only fills gaps left by applyStaticRules -- never overrides a rule match.
  // Conservative on purpose (exact match only, not fuzzy) so it never
  // confidently mis-categorizes a genuinely different merchant.
  const applyLearnedCategorization = async (transactions) => {
    if (!user?.id || transactions.length === 0) return transactions;

    try {
      const { data: historyRows, error } = await supabase
        .from('transactions')
        .select('merchant, description, category, budget_bucket')
        .eq('user_id', user.id)
        .not('category', 'is', null)
        .neq('category', 'Uncategorized');

      if (error || !historyRows || historyRows.length === 0) return transactions;

      // Build merchant -> most common (category, bucket) pairing from history
      const frequency = new Map();
      for (const row of historyRows) {
        const key = String(row.merchant || row.description || '').trim().toLowerCase();
        if (!key) continue;
        const bucket = row.budget_bucket || 'Unsorted';
        const pairKey = `${row.category}|||${bucket}`;
        if (!frequency.has(key)) frequency.set(key, new Map());
        const pairCounts = frequency.get(key);
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }

      const learnedByMerchant = new Map();
      for (const [key, pairCounts] of frequency.entries()) {
        let bestPair = null;
        let bestCount = 0;
        for (const [pairKey, count] of pairCounts.entries()) {
          if (count > bestCount) {
            bestCount = count;
            bestPair = pairKey;
          }
        }
        if (bestPair) {
          const [category, bucket] = bestPair.split('|||');
          learnedByMerchant.set(key, { category, bucket });
        }
      }

      return transactions.map((t) => {
        // A static rule already matched this one -- don't override it
        if (t.matchedRule) return t;

        const key = String(t.merchant_display || t.description || '').trim().toLowerCase();
        const learned = learnedByMerchant.get(key);
        if (learned) {
          return { ...t, category_guess: learned.category, bucket_guess: learned.bucket, learnedFromHistory: true };
        }
        return { ...t, bucket_guess: t.bucket_guess || 'Unsorted', learnedFromHistory: false };
      });
    } catch (err) {
      console.error('Learned categorization failed (non-blocking):', err);
      return transactions.map((t) => ({ ...t, bucket_guess: t.bucket_guess || 'Unsorted' }));
    }
  };

  // Checks newly parsed transactions against what's already saved, and flags
  // likely duplicates for review. Never blocks or auto-removes anything --
  // just flags, so nothing real gets silently dropped.
  //
  // IMPORTANT: the database's actual uniqueness rule is
  // UNIQUE(date, merchant, amount, user_id) -- notice it is NOT scoped to
  // account_name and does not involve reference number at all. So this check
  // is deliberately NOT limited to the currently selected account, and a
  // second check below also looks for collisions WITHIN the batch itself
  // (two rows in the same upload that would collide with each other), since
  // that's invisible to a history-only check but still causes a real save
  // failure.
  // Checks newly parsed transactions against what's already saved, and flags
  // likely duplicates for review. Never blocks or auto-removes anything --
  // just flags, so nothing real gets silently dropped.
  //
  // IMPORTANT: the database's actual uniqueness rule is two-tier (via two
  // partial unique indexes): when a transaction HAS a reference number,
  // uniqueness requires date+merchant+amount+reference all matching --
  // so e.g. three drinks bought at the same bar, same price, same day, are
  // correctly treated as different real charges as long as each has its own
  // reference number. Only when a transaction has NO reference number does
  // the stricter date+merchant+amount-only rule apply (protecting manual
  // entries and receipt scans, where duplicate accidental entry is the real
  // risk). This logic mirrors that exactly, both against saved history and
  // for collisions WITHIN the batch itself (which a history-only check
  // can't see, but which still causes a real save failure).
  const flagPossibleDuplicates = async (transactions) => {
    if (!user?.id || transactions.length === 0) return transactions;

    try {
      const dates = transactions.map((t) => t.transaction_date).filter(Boolean).map((d) => d.slice(0, 10));
      if (dates.length === 0) return transactions.map((t) => ({ ...t, isDuplicate: false, duplicateNote: '', willFailSave: false }));

      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));

      // Not scoped by account_name -- the real DB constraint isn't either
      const { data: existing, error } = await supabase
        .from('transactions')
        .select('date, amount, bank_reference, description, merchant')
        .eq('user_id', user.id)
        .gte('date', minDate)
        .lte('date', maxDate);

      const existingWithRef = new Set();    // date|merchant|amount|reference -- for rows that HAVE a reference
      const existingWithoutRef = new Set(); // date|merchant|amount -- for rows with NO reference
      const existingByDateAmount = new Map();

      if (!error && existing) {
        for (const row of existing) {
          const dateKey = String(row.date || '').slice(0, 10);
          const amountKey = Number(row.amount).toFixed(2);
          const merchantKey = String(row.merchant || '').trim().toLowerCase();
          const refKey = row.bank_reference ? String(row.bank_reference).trim().toLowerCase() : '';

          if (refKey) {
            existingWithRef.add(`${dateKey}|${merchantKey}|${amountKey}|${refKey}`);
          } else {
            existingWithoutRef.add(`${dateKey}|${merchantKey}|${amountKey}`);
          }

          const key = `${dateKey}|${amountKey}`;
          if (!existingByDateAmount.has(key)) existingByDateAmount.set(key, []);
          existingByDateAmount.get(key).push(row);
        }
      }

      // First pass: check against saved history
      const withHistoryFlags = transactions.map((t) => {
        const dateKey = t.transaction_date ? t.transaction_date.slice(0, 10) : '';
        const amountKey = Number(t.amount).toFixed(2);
        const merchantKey = (t.merchant_display || '').trim().toLowerCase();
        const refKey = t.reference ? t.reference.trim().toLowerCase() : '';

        // Hard match: mirrors exactly which of the two DB partial indexes applies
        const hardMatch = refKey
          ? existingWithRef.has(`${dateKey}|${merchantKey}|${amountKey}|${refKey}`)
          : existingWithoutRef.has(`${dateKey}|${merchantKey}|${amountKey}`);

        if (hardMatch) {
          return { ...t, isDuplicate: true, duplicateNote: 'Exact match already saved -- will fail to save', willFailSave: true };
        }

        // Soft match: same date+amount and a similar description/merchant,
        // but NOT an exact reference-aware match above -- worth a look, but
        // won't actually fail on save, so it's flagged for review only.
        const key = `${dateKey}|${amountKey}`;
        const candidates = existingByDateAmount.get(key);
        if (candidates && candidates.length > 0) {
          const descNorm = t.description.trim().toLowerCase();
          const looksSame = candidates.some((c) => {
            const cDesc = String(c.description || '').trim().toLowerCase();
            const cMerchant = String(c.merchant || '').trim().toLowerCase();
            return (cDesc && (cDesc === descNorm || cDesc.includes(descNorm) || descNorm.includes(cDesc)))
                || (cMerchant && (cMerchant === merchantKey || cMerchant.includes(merchantKey) || merchantKey.includes(cMerchant)));
          });
          if (looksSame) {
            return { ...t, isDuplicate: true, duplicateNote: 'Same date, amount & merchant already saved', willFailSave: false };
          }
        }

        return { ...t, isDuplicate: false, duplicateNote: '', willFailSave: false };
      });

      // Second pass: check for collisions WITHIN this batch itself. Same
      // reference-aware logic as above -- rows WITH a reference only collide
      // if date+merchant+amount+reference ALL match (so three drinks at the
      // same bar, same price, same day, are correctly left alone as long as
      // each has its own reference number). Rows with NO reference use the
      // stricter date+merchant+amount-only check.
      const seenWithRef = new Set();
      const seenWithoutRef = new Set();
      return withHistoryFlags.map((t) => {
        if (t.willFailSave) return t; // already flagged as a definite history collision
        const dateKey = t.transaction_date ? t.transaction_date.slice(0, 10) : '';
        const amountKey = Number(t.amount).toFixed(2);
        const merchantKey = (t.merchant_display || '').trim().toLowerCase();
        const refKey = t.reference ? t.reference.trim().toLowerCase() : '';

        if (refKey) {
          const key = `${dateKey}|${merchantKey}|${amountKey}|${refKey}`;
          if (seenWithRef.has(key)) {
            return { ...t, isDuplicate: true, duplicateNote: 'Same date, merchant, amount & reference as another row in this batch -- only one can be saved', willFailSave: true };
          }
          seenWithRef.add(key);
        } else {
          const key = `${dateKey}|${merchantKey}|${amountKey}`;
          if (seenWithoutRef.has(key)) {
            return { ...t, isDuplicate: true, duplicateNote: 'Same date, merchant & amount as another row in this batch (no reference number to tell them apart) -- only one can be saved', willFailSave: true };
          }
          seenWithoutRef.add(key);
        }
        return t;
      });
    } catch (err) {
      console.error('Duplicate check failed (non-blocking):', err);
      return transactions.map((t) => ({ ...t, isDuplicate: false, duplicateNote: '', willFailSave: false }));
    }
  };

  // 1. Manejo de Texto
  const handleParseText = async () => {
    if (!rawText.trim()) return;
    setLoading(true);
    try {
      const directParsed = parsePipeSeparatedText(rawText);
      if (directParsed.length > 0) {
        setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(directParsed))));
        return;
      }
      const response = await fetch('/api/parseStatement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ rawText })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to parse text');
      const normalized = (Array.isArray(data) ? data : []).map(normalizeParsedTransaction).filter((t) => t.description && !Number.isNaN(Number(t.amount)));
      if (normalized.length === 0) throw new Error('No valid transactions were parsed from the text.');
      setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(normalized))));
    } catch (error) {
      alert(`Parsing failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 2. Manejo de Hojas de Cálculo
  // Reads real cell values (numbers stay numbers -- no text re-interpretation),
  // and only asks the AI to identify which columns are which from a small sample,
  // so accuracy and file size are never a problem.
  const handleSpreadsheetUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const fileName = file.name.toLowerCase();
      let workbook;

      if (fileName.endsWith('.csv')) {
        const text = await file.text();
        workbook = XLSX.read(text, { type: 'string' });
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const data = await file.arrayBuffer();
        workbook = XLSX.read(data, { type: 'array' });
      } else {
        throw new Error('Unsupported spreadsheet format.');
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

      if (!rows || rows.length < 2) {
        throw new Error('The file appears to be empty or missing data rows.');
      }

      // Don't assume row 1 is the header -- some bank exports have a title or
      // account-info block above the real header row. Find it by scanning for
      // whichever of the first ~20 rows has the most filled-in cells: a real
      // header row is fully populated across columns, while a title/account
      // line is sparse (usually just one cell).
      const scanLimit = Math.min(20, rows.length);
      let headerRowIndex = 0;
      let bestCount = -1;
      for (let i = 0; i < scanLimit; i++) {
        const count = rows[i].filter((cell) => cell !== '' && cell !== null && cell !== undefined).length;
        if (count > bestCount) {
          bestCount = count;
          headerRowIndex = i;
        }
      }

      const headers = rows[headerRowIndex].map((h) => String(h ?? '').trim());
      const headerSet = new Set(headers.map((h) => String(h ?? '').trim().toLowerCase()).filter(Boolean));
      const isRepeatedHeaderRow = (r) => {
        const values = r.map((cell) => String(cell ?? '').trim().toLowerCase());
        const nonEmpty = values.filter((v) => v);
        if (nonEmpty.length === 0) return false;
        const matches = nonEmpty.filter((v) => headerSet.has(v));
        // If most of this row's cells are literally header names, it's a repeated header, not data
        return matches.length >= Math.ceil(nonEmpty.length * 0.6);
      };
      const dataRows = rows.slice(headerRowIndex + 1)
        .filter((r) => r.some((cell) => cell !== '' && cell !== null && cell !== undefined))
        .filter((r) => !isRepeatedHeaderRow(r));

      if (dataRows.length === 0) {
        throw new Error('No data rows found under the header row.');
      }

      // Sample rows spread across the WHOLE file, not just the first few --
      // otherwise a statement where credits are rare/clustered can trick the
      // AI into missing the credit column entirely because it never saw one.
      const maxSamples = 15;
      let sampleRows;
      if (dataRows.length <= maxSamples) {
        sampleRows = dataRows;
      } else {
        const step = dataRows.length / maxSamples;
        sampleRows = Array.from({ length: maxSamples }, (_, i) => dataRows[Math.floor(i * step)]);
      }
      const mapResponse = await fetch('/api/identifyColumns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ headers, sampleRows })
      });
      const mapping = await mapResponse.json();
      if (!mapResponse.ok) throw new Error(mapping?.error || 'Could not identify spreadsheet columns');

      const { dateColumn, descriptionColumn, amountColumn, debitColumn, creditColumn, referenceColumn } = mapping;
      const validIndex = (i) => Number.isInteger(i) && i >= 0 && i < headers.length;

      if (!validIndex(descriptionColumn)) {
        throw new Error('Could not identify a description column in this file. Try the Text tab and paste the data instead.');
      }
      if (!validIndex(amountColumn) && !validIndex(debitColumn) && !validIndex(creditColumn)) {
        throw new Error('Could not identify an amount column in this file. Try the Text tab and paste the data instead.');
      }
      if (!validIndex(dateColumn)) {
        throw new Error('Could not identify a date column in this file. Try the Text tab and paste the data instead.');
      }

      // More precise than the earlier "row has something in it somewhere" check:
      // this drops rows that are blank in the SPECIFIC column we're using as the
      // description, even if some unrelated column has a stray leftover value.
      const usableDataRows = dataRows.filter((row) => {
        const desc = String(row[descriptionColumn] ?? '').trim();
        return desc !== '' && !headerSet.has(desc.toLowerCase());
      });

      if (usableDataRows.length === 0) {
        throw new Error('No rows with a usable description were found after mapping columns.');
      }

      // Deterministic parsing across ALL usable rows -- exact numbers preserved, no row-count limit
      const transactions = usableDataRows.map((row) => {
        let amount;
        if (validIndex(amountColumn)) {
          amount = parseAmount(row[amountColumn]);
        } else {
          const debit = validIndex(debitColumn) ? parseAmount(row[debitColumn]) : 0;
          const credit = validIndex(creditColumn) ? parseAmount(row[creditColumn]) : 0;
          amount = credit - Math.abs(debit || 0);
        }

        return normalizeParsedTransaction({
          date: excelDateToString(row[dateColumn]),
          description_raw: row[descriptionColumn],
          merchant: row[descriptionColumn],
          reference: validIndex(referenceColumn) ? row[referenceColumn] : '',
          amount
        });
      }).filter((t) => t.description && !Number.isNaN(Number(t.amount)) && !headerSet.has(t.description.trim().toLowerCase()));

      if (transactions.length === 0) {
        throw new Error('No valid transaction rows could be parsed with the identified columns.');
      }

      setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(transactions))));
    } catch (error) {
      alert(`Spreadsheet parsing failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 3. Manejo de PDFs
  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/parsePdfStatement', { method: 'POST', headers: { ...(await authHeader()) }, body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to parse PDF');
      const normalized = (Array.isArray(data) ? data : []).map(normalizeParsedTransaction).filter((t) => t.description && !Number.isNaN(Number(t.amount)));
      if (normalized.length === 0) throw new Error('No valid transactions found.');
      setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(normalized))));
    } catch (error) { alert(`PDF parsing failed: ${error.message}`); }
    finally { setLoading(false); }
  };

  // 4c. Manejo de Estados de Cuenta UNFCU (PDF -- Visa o General)
  const handleUnfcuPdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/parseUNFCUStatement', { method: 'POST', headers: { ...(await authHeader()) }, body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to parse UNFCU statement');
      const normalized = (Array.isArray(data) ? data : []).map(normalizeParsedTransaction).filter((t) => t.description && !Number.isNaN(Number(t.amount)));
      if (normalized.length === 0) throw new Error('No transactions found in this statement.');
      setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(normalized))));
    } catch (error) {
      alert(`UNFCU statement parsing failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 4b. Manejo de Estado de Cuenta HTML (Cooperativa Profesionales)
  const handleCooperativaHtmlUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const htmlText = await file.text();
      const extracted = parseCooperativaHTML(htmlText);

      if (extracted.length === 0) {
        throw new Error('No transactions could be extracted. This may not be a Cooperativa Profesionales statement, or the format has changed.');
      }

      setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(extracted))));
    } catch (error) {
      alert(`Cooperativa statement parsing failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 4. Manejo de Fotos (Reincorporado)
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const base64Image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
      });
      const response = await fetch('/api/scanReceipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ image: base64Image })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to parse Image');
      // scanReceipt now always returns an array -- one item for a simple
      // receipt, multiple for a voucher with several line items (e.g. a
      // Cooperativa payment slip covering insurance, a loan payment, etc.)
      const items = Array.isArray(data) ? data : [data];
      const normalized = items.map(normalizeParsedTransaction).filter((t) => t.description && !Number.isNaN(Number(t.amount)));
      if (normalized.length === 0) throw new Error('No transactions could be read from this image.');
      setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(normalized))));
    } catch (error) { alert(`Image parsing failed: ${error.message}`); }
    finally { setLoading(false); }
  };
  // 5. Guardado en Base de Datos (Corregido)
  const handleSaveToDatabase = async () => {
    if (!user?.id) return alert('You must be signed in before uploading transactions.');
    if (parsedTransactions.length === 0) return;
    setLoading(true);

    try {
      const toSave = parsedTransactions.filter((t) => !t.willFailSave);
      const skipped = parsedTransactions.filter((t) => t.willFailSave);

      if (toSave.length === 0) {
        alert('Every row in this batch is flagged as a definite duplicate -- nothing was saved. Review and delete the ones you don\'t need, or edit a description/amount slightly if you know it\'s genuinely a separate transaction, then try again.');
        setLoading(false);
        return;
      }

      const formattedData = toSave.map((t) => ({
        user_id: user.id,
        date: t.transaction_date || new Date().toISOString(),
        description: t.description,
        description_raw: t.description,
        merchant: t.merchant_display,
        amount: t.amount,
        category: t.category_guess || 'Uncategorized',
        budget_bucket: t.bucket_guess || 'Unsorted',
        account_name: selectedAccount,
        source_account: selectedAccount,
        bank_reference: t.reference || null,
        notes: `Imported via bulk upload`
      }));

      const { error } = await supabase.from('transactions').insert(formattedData);
      if (error) throw error;

      if (skipped.length > 0) {
        alert(`Saved ${formattedData.length} transactions to ${selectedAccount}.\n\nSkipped ${skipped.length} that would have failed as exact duplicates (same date, merchant & amount as another row already saved or elsewhere in this batch) -- they're still showing in the preview below for you to review, delete, or adjust manually.`);
        setParsedTransactions(skipped);
      } else {
        alert(`Successfully saved ${formattedData.length} transactions to ${selectedAccount}!`);
        setParsedTransactions([]);
        setRawText('');
        closeModal();
      }
      if (onTransactionsAdded) onTransactionsAdded();
    } catch (error) {
      alert(`Database Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const removeTransaction = (index) => setParsedTransactions((prev) => prev.filter((_, i) => i !== index));
  const updateTransactionField = (index, field, value) => {
    setParsedTransactions((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };
  const BUCKET_OPTIONS = ['NEEDS', 'WANTS', 'SAVINGS', 'INCOME', 'TRANSFERS', 'DEBT_FUNDING', 'Unsorted'];

  if (!open) return null;
return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, overflowY: 'auto', padding: '20px' }}>
      <div style={{ backgroundColor: 'var(--color-card)', color: 'var(--color-card-foreground)', padding: '20px', borderRadius: '15px', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2>Bulk Statement Upload</h2>
          <button onClick={closeModal} style={{ background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer' }}>❌</button>
        </div>

        {/* SELECTOR DE CUENTA INYECTADO */}
        {parsedTransactions.length === 0 && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Select Account / Card:</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid var(--color-border)' }}
            >
              <option value="Cuenta Principal">Cuenta Principal</option>
              <option value="Nueva Tarjeta Visa">Nueva Tarjeta Visa</option>
              <option value="Chase Checking">Chase Checking</option>
              <option value="Davivienda Credit Card">Davivienda Credit Card</option>
              <option value="Davivienda Checking">Davivienda Checking</option>
              <option value="UNFCU Credit Card">UNFCU Credit Card</option>
              <option value="UNFCU Loan">UNFCU Loan</option>
              <option value="UNFCU Statement">UNFCU Statement</option>
              <option value="Banco General Star Credit Card">Banco General Star Credit Card</option>
              <option value="Banco General Mileage Credit Card">Banco General Mileage Credit Card</option>
              <option value="Cooperativa de Profesionales Credit Card">Cooperativa de Profesionales Credit Card</option>
              <option value="Cooperativa de Profesionales Statement">Cooperativa de Profesionales Statement</option>
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: '5px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button onClick={() => setActiveTab('text')} style={{ flex: 1, padding: '10px', background: activeTab === 'text' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'text' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>📝 Text</button>
          <button onClick={() => setActiveTab('sheet')} style={{ flex: 1, padding: '10px', background: activeTab === 'sheet' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'sheet' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>📊 XLS/CSV</button>
          <button onClick={() => setActiveTab('pdf')} style={{ flex: 1, padding: '10px', background: activeTab === 'pdf' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'pdf' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>📄 PDF</button>
          <button onClick={() => setActiveTab('image')} style={{ flex: 1, padding: '10px', background: activeTab === 'image' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'image' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>📸 Photo</button>
          <button onClick={() => setActiveTab('coophtml')} style={{ flex: 1, padding: '10px', background: activeTab === 'coophtml' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'coophtml' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>🏦 Coop HTML</button>
          <button onClick={() => setActiveTab('unfcu')} style={{ flex: 1, padding: '10px', background: activeTab === 'unfcu' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'unfcu' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>🏛️ UNFCU PDF</button>
        </div>

        {parsedTransactions.length === 0 && activeTab === 'text' && (
          <div>
            <textarea placeholder="Paste your raw bank statement text here..." value={rawText} onChange={(e) => setRawText(e.target.value)} style={{ width: '100%', height: '180px', padding: '10px', marginBottom: '10px', borderRadius: '5px', border: '1px solid var(--color-border)' }} />
            <button onClick={handleParseText} disabled={loading || !rawText.trim()} style={{ width: '100%', padding: '12px', background: '#007AFF', color: 'white', border: 'none', borderRadius: '5px' }}>{loading ? '🧠 Parsing...' : 'Parse Text'}</button>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'sheet' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> Select CSV / XLS File <input type="file" accept=".csv,.xls,.xlsx" onChange={handleSpreadsheetUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'pdf' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> Select PDF <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'image' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> Upload Receipt Photo <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'coophtml' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-muted-foreground)', marginBottom: '15px' }}>For "Estado de cuenta" .html exports from Cooperativa Profesionales, R.L.</p>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> Select HTML Statement <input type="file" accept=".html,.htm" onChange={handleCooperativaHtmlUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'unfcu' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-muted-foreground)', marginBottom: '15px' }}>For UNFCU PDF statements -- either the Visa/credit card statement or the general Membership/Savings/Loan statement.</p>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> Select UNFCU PDF <input type="file" accept=".pdf" onChange={handleUnfcuPdfUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length > 0 && (
          <div>
            <h3>
              Preview ({parsedTransactions.length} found)
              {parsedTransactions.some((t) => t.willFailSave) && (
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#b91c1c', marginLeft: '10px' }}>
                  ⛔ {parsedTransactions.filter((t) => t.willFailSave).length} will be skipped (exact duplicate)
                </span>
              )}
              {parsedTransactions.some((t) => t.isDuplicate && !t.willFailSave) && (
                <span style={{ fontSize: '14px', fontWeight: 'normal', color: '#a16207', marginLeft: '10px' }}>
                  🔁 {parsedTransactions.filter((t) => t.isDuplicate && !t.willFailSave).length} possible duplicate{parsedTransactions.filter((t) => t.isDuplicate && !t.willFailSave).length === 1 ? '' : 's'} — review before saving
                </span>
              )}
            </h3>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '20px', border: '1px solid var(--color-border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ background: 'var(--color-muted)', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Date</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Category</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Bucket</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>Del</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedTransactions.map((t, idx) => {
                    const looksSuspicious = Number(t.amount) === 0;
                    const rowBackground = t.willFailSave ? '#fde8e8' : (t.isDuplicate ? '#fff8e6' : (looksSuspicious ? '#fff3f3' : 'transparent'));
                    return (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)', background: rowBackground }}>
                      <td style={{ padding: '8px' }}>{t.transaction_date ? t.transaction_date.slice(0, 10) : ''}</td>
                      <td style={{ padding: '8px' }}>
                        {looksSuspicious && '⚠️ '}
                        {t.willFailSave ? '⛔ ' : (t.isDuplicate && '🔁 ')}
                        {t.description}
                        {t.isDuplicate && (
                          <div style={{ fontSize: '11px', color: t.willFailSave ? '#b91c1c' : '#a16207', marginTop: '2px', fontWeight: t.willFailSave ? 'bold' : 'normal' }}>
                            {t.willFailSave ? 'Will be skipped on save — ' : 'Possible duplicate — '}{t.duplicateNote}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="text"
                          value={t.category_guess || 'Uncategorized'}
                          onChange={(ev) => updateTransactionField(idx, 'category_guess', ev.target.value)}
                          style={{ width: '100%', padding: '4px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '13px' }}
                        />
                        {t.matchedRule && (
                          <div style={{ fontSize: '10px', color: '#2563eb', marginTop: '2px' }}>✓ matched your rule ({t.matchedRule})</div>
                        )}
                        {t.learnedFromHistory && !t.matchedRule && (
                          <div style={{ fontSize: '10px', color: '#15803d', marginTop: '2px' }}>✓ learned from your history</div>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select
                          value={t.bucket_guess || 'Unsorted'}
                          onChange={(ev) => updateTransactionField(idx, 'bucket_guess', ev.target.value)}
                          style={{ width: '100%', padding: '4px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '13px' }}
                        >
                          {BUCKET_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: t.amount < 0 ? 'red' : 'green' }}>${Number(t.amount).toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}><button onClick={() => removeTransaction(idx)} style={{ background: 'none', border: 'none', color: 'red', cursor: 'pointer' }}>🗑</button></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setParsedTransactions([])} style={{ flex: 1, padding: '12px', background: 'var(--color-muted)', border: 'none', borderRadius: '5px' }}>Discard</button>
              <button onClick={handleSaveToDatabase} disabled={loading} style={{ flex: 2, padding: '12px', background: '#34C759', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold' }}>{loading ? 'Saving...' : `Save to ${selectedAccount}`}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
