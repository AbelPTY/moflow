import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase'; // Asegurate de que esta ruta sea la correcta en tu proyecto
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import rulesData from '../rules/merchant_rules.json';
import { classifyTransaction } from '../lib/engine/ruleMatcher';
import useUserMerchantRules from '../hooks/useUserMerchantRules';
import AccountSelect from './AccountSelect';
import ImageScanTray from './ImageScanTray';
import { useI18n } from '../i18n';
import { classifyTransaction as classifyIntel, normalizeMerchant } from '../lib/transactionIntelligence';
import { trackProductEvent } from '../lib/analytics';
import { analyzeDetectedImportAccounts, prepareImportAccountAssignment, normalizeAccountName } from '../lib/accountOptions';
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
    bucket_guess: t.bucket_guess || t.budget_bucket || 'Unsorted',
    reference,
    account_name: t.account_name || '',
    source_account: t.source_account || t.account_name || '',
    source_institution: t.source_institution || ''
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
  extractSection('PRESTAMOS', 'Prestamos', 13, 7, 'Loan Payment', 'DEBT_FUNDING');
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
  const { t } = useI18n();
  const { userRules } = useUserMerchantRules(); // active user rules (empty today)
  const closeModal = () => { if (onClose) onClose(); };
  const [activeTab, setActiveTab] = useState('text');
  const [selectedAccount, setSelectedAccount] = useState('Cash/Manual');
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsedTransactions, setParsedTransactions] = useState([]);
  // Photo/Screenshot mode: multiple images scanned as ONE statement (shared
  // ImageScanTray + /api/scanReceipt images[], same receipt mode as before).
  const [images, setImages] = useState([]);

  // When a parse yields exactly ONE detected account, prefill it as the
  // destination (a suggestion) and clear the per-row override so the user's
  // explicit selection controls the save. Genuine multi-account batches keep
  // their per-row accounts. Runs once per parse session.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (parsedTransactions.length === 0) { prefilledRef.current = false; return; }
    if (prefilledRef.current) return;
    prefilledRef.current = true;
    const { mode, suggestedAccount } = analyzeDetectedImportAccounts(parsedTransactions);
    if (mode === 'single' && suggestedAccount) {
      setSelectedAccount(suggestedAccount);
      setParsedTransactions((prev) => prev.map((r) => ({ ...r, account_name: '', source_account: '' })));
    }
  }, [parsedTransactions]);

  // Duplicate identity is scoped to the destination account, so when the user
  // changes the destination (or the prefill above sets it) the preview's
  // duplicate flags must be recomputed against that final account. Keyed on
  // selectedAccount only (a ref holds the latest rows) so re-flagging never
  // loops on its own setParsedTransactions.
  const latestParsedRef = useRef([]);
  latestParsedRef.current = parsedTransactions;
  useEffect(() => {
    const rows = latestParsedRef.current;
    if (!rows || rows.length === 0) return;
    let cancelled = false;
    (async () => {
      const stripped = rows.map(({ isDuplicate, duplicateNote, willFailSave, ...rest }) => rest);
      const reflagged = await flagPossibleDuplicates(stripped);
      if (!cancelled) setParsedTransactions(reflagged);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount]);

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
  // ONE coherent classification decision per row (Transaction Intelligence).
  // Runs AFTER static + learned-history guesses. The final category_guess/
  // bucket_guess shown in the preview become the persisted category, and the
  // aligned provenance/confidence/nature/normalized_merchant are stamped on `_ti`
  // so the save writes a single consistent decision (no mismatched provenance).
  const finalizeClassification = (rows) => rows.map((t) => {
    const cls = classifyIntel({
      description: t.description || '',
      merchant: t.merchant_display || t.merchant || '',
      amount: Number(t.amount) || 0,
      learned_rules: [],
    });
    const normalized_merchant = cls.normalizedMerchant || null;
    let category = t.category_guess || 'Uncategorized';
    let bucket = t.bucket_guess || 'Unsorted';
    let source; let confidence; let needsReview;
    const nature = cls.nature && cls.nature !== 'unknown' ? cls.nature : null;
    if (t.matchedRule) {
      source = t.matchedRuleSource === 'static' ? 'merchant_rule'
        : t.matchedRuleSource === 'learned' ? 'learned_rule' : 'manual_rule';
      confidence = source === 'merchant_rule' ? 0.9 : 1;
      needsReview = false;
    } else if (t.learnedFromHistory) {
      source = 'learned_rule'; confidence = 0.9; needsReview = false;
    } else {
      // No rule matched -> take the engine's deterministic decision so the
      // preview and the save agree even for cc-payment/transfer/fee/etc.
      category = cls.category; bucket = cls.bucket;
      source = cls.source === 'deterministic' ? 'deterministic'
        : cls.source === 'merchant_rule' ? 'merchant_rule' : 'import';
      confidence = cls.source === 'none' ? null : cls.confidence;
      needsReview = cls.state !== 'auto';
    }
    return {
      ...t,
      category_guess: category,
      bucket_guess: bucket,
      _origCat: category,
      _origBucket: bucket,
      _ti: { source, confidence, nature, normalized_merchant, needsReview },
    };
  });

  const applyLearnedCategorization = async (transactions) => {
    if (!user?.id || transactions.length === 0) return finalizeClassification(transactions);

    try {
      const { data: historyRows, error } = await supabase
        .from('transactions')
        .select('merchant, description, category, budget_bucket')
        .eq('user_id', user.id)
        .not('category', 'is', null)
        .neq('category', 'Uncategorized');

      if (error || !historyRows || historyRows.length === 0) return finalizeClassification(transactions);

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

      return finalizeClassification(transactions.map((t) => {
        // A static rule already matched this one -- don't override it
        if (t.matchedRule) return t;

        const key = String(t.merchant_display || t.description || '').trim().toLowerCase();
        const learned = learnedByMerchant.get(key);
        if (learned) {
          return { ...t, category_guess: learned.category, bucket_guess: learned.bucket, learnedFromHistory: true };
        }
        return { ...t, bucket_guess: t.bucket_guess || 'Unsorted', learnedFromHistory: false };
      }));
    } catch (err) {
      console.error('Learned categorization failed (non-blocking):', err);
      return finalizeClassification(transactions.map((t) => ({ ...t, bucket_guess: t.bucket_guess || 'Unsorted' })));
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

      // Duplicate identity is scoped to the FINAL destination account, mirroring
      // the account-aware DB unique indexes. Resolve each row's destination the
      // same way the save does (prepareImportAccountAssignment): 'none'/'single'
      // -> the user's selectedAccount; 'multi' -> the per-row detected account.
      // This must use the final destination, NOT a stale parser hint, so the
      // same-looking transaction imported into a DIFFERENT account is allowed.
      const assigned = prepareImportAccountAssignment(transactions, selectedAccount);
      const acctKeyOfAssigned = (i) => normalizeAccountName(assigned[i]?.account_name || assigned[i]?.source_account || '');

      // Account is part of identity, so only pull existing rows for the accounts
      // this batch actually targets (still bounded by the date range).
      const targetAccts = new Set(assigned.map((_, i) => acctKeyOfAssigned(i)));

      const { data: existing, error } = await supabase
        .from('transactions')
        .select('date, amount, bank_reference, description, merchant, account_name, source_account')
        .eq('user_id', user.id)
        .gte('date', minDate)
        .lte('date', maxDate);

      const existingWithRef = new Set();    // acct|date|merchant|amount|reference
      const existingWithoutRef = new Set(); // acct|date|merchant|amount
      const existingByAcctDateAmount = new Map();

      if (!error && existing) {
        for (const row of existing) {
          const acctKey = normalizeAccountName(row.account_name || row.source_account || '');
          // Skip history for accounts this batch never touches.
          if (!targetAccts.has(acctKey)) continue;
          const dateKey = String(row.date || '').slice(0, 10);
          const amountKey = Number(row.amount).toFixed(2);
          const merchantKey = String(row.merchant || '').trim().toLowerCase();
          const refKey = row.bank_reference ? String(row.bank_reference).trim().toLowerCase() : '';

          if (refKey) {
            existingWithRef.add(`${acctKey}|${dateKey}|${merchantKey}|${amountKey}|${refKey}`);
          } else {
            existingWithoutRef.add(`${acctKey}|${dateKey}|${merchantKey}|${amountKey}`);
          }

          const key = `${acctKey}|${dateKey}|${amountKey}`;
          if (!existingByAcctDateAmount.has(key)) existingByAcctDateAmount.set(key, []);
          existingByAcctDateAmount.get(key).push(row);
        }
      }

      // First pass: check against saved history (scoped to the row's destination).
      const withHistoryFlags = transactions.map((t, i) => {
        const acctKey = acctKeyOfAssigned(i);
        const dateKey = t.transaction_date ? t.transaction_date.slice(0, 10) : '';
        const amountKey = Number(t.amount).toFixed(2);
        const merchantKey = (t.merchant_display || '').trim().toLowerCase();
        const refKey = t.reference ? t.reference.trim().toLowerCase() : '';

        // Hard match: mirrors exactly which of the two DB partial indexes applies
        const hardMatch = refKey
          ? existingWithRef.has(`${acctKey}|${dateKey}|${merchantKey}|${amountKey}|${refKey}`)
          : existingWithoutRef.has(`${acctKey}|${dateKey}|${merchantKey}|${amountKey}`);

        if (hardMatch) {
          return { ...t, isDuplicate: true, duplicateNote: 'Exact match already saved -- will fail to save', willFailSave: true };
        }

        // Soft match: same account+date+amount and a similar description/merchant,
        // but NOT an exact reference-aware match above -- worth a look, but
        // won't actually fail on save, so it's flagged for review only.
        const key = `${acctKey}|${dateKey}|${amountKey}`;
        const candidates = existingByAcctDateAmount.get(key);
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

      // Second pass: collisions WITHIN this batch itself, scoped by destination
      // account. Same reference-aware logic as above -- rows WITH a reference
      // only collide if account+date+merchant+amount+reference ALL match (so
      // three drinks at the same bar, same price, same day, are correctly left
      // alone as long as each has its own reference number). Rows with NO
      // reference use the stricter account+date+merchant+amount-only check.
      // Identical rows headed to DIFFERENT accounts stay independent.
      const seenWithRef = new Set();
      const seenWithoutRef = new Set();
      return withHistoryFlags.map((t, i) => {
        if (t.willFailSave) return t; // already flagged as a definite history collision
        const acctKey = acctKeyOfAssigned(i);
        const dateKey = t.transaction_date ? t.transaction_date.slice(0, 10) : '';
        const amountKey = Number(t.amount).toFixed(2);
        const merchantKey = (t.merchant_display || '').trim().toLowerCase();
        const refKey = t.reference ? t.reference.trim().toLowerCase() : '';

        if (refKey) {
          const key = `${acctKey}|${dateKey}|${merchantKey}|${amountKey}|${refKey}`;
          if (seenWithRef.has(key)) {
            return { ...t, isDuplicate: true, duplicateNote: 'Same account, date, merchant, amount & reference as another row in this batch -- only one can be saved', willFailSave: true };
          }
          seenWithRef.add(key);
        } else {
          const key = `${acctKey}|${dateKey}|${merchantKey}|${amountKey}`;
          if (seenWithoutRef.has(key)) {
            return { ...t, isDuplicate: true, duplicateNote: 'Same account, date, merchant & amount as another row in this batch (no reference number to tell them apart) -- only one can be saved', willFailSave: true };
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
      alert(t('bulkUpload.parseFailedText', { msg: error.message }));
    } finally {
      setLoading(false);
    }
  };

  // 2. Manejo de Hojas de Calculo
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
      alert(t('bulkUpload.parseFailedSheet', { msg: error.message }));
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
    } catch (error) { alert(t('bulkUpload.parseFailedPdf', { msg: error.message })); }
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
      alert(t('bulkUpload.parseFailedUnfcu', { msg: error.message }));
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
      alert(t('bulkUpload.parseFailedCoop', { msg: error.message }));
    } finally {
      setLoading(false);
    }
  };

  // 4. Manejo de Fotos -- multi-image parity with Flow's scanners. The selected
  // screenshots/photos (up to MAX_SCAN_IMAGES, enforced by ImageScanTray) are
  // sent as ONE receipt-mode scan (images[]), so multi-page receipts/vouchers
  // or a statement split across screenshots parse into ONE combined list. One
  // image is unchanged (buildImageParts still accepts a single-element array).
  // Overlapping rows across screenshots are caught by the account-aware
  // within-batch duplicate logic in flagPossibleDuplicates.
  const scanImages = async () => {
    if (images.length === 0) return;
    setLoading(true);
    try {
      const response = await fetch('/api/scanReceipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ images })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to parse Image');
      // scanReceipt returns an array -- one item for a simple receipt, multiple
      // for a voucher/statement with several line items across the images.
      const items = Array.isArray(data) ? data : [data];
      const normalized = items.map(normalizeParsedTransaction).filter((t) => t.description && !Number.isNaN(Number(t.amount)));
      if (normalized.length === 0) throw new Error('No transactions could be read from these images.');
      setParsedTransactions(await flagPossibleDuplicates(await applyLearnedCategorization(applyStaticRules(normalized))));
      setImages([]);
    } catch (error) { alert(t('bulkUpload.parseFailedImage', { msg: error.message })); }
    finally { setLoading(false); }
  };
  // 5. Guardado en Base de Datos (Corregido)
  const handleSaveToDatabase = async () => {
    if (!user?.id) return alert(t('bulkUpload.mustSignIn'));
    if (parsedTransactions.length === 0) return;
    setLoading(true);

    try {
      const toSave = parsedTransactions.filter((t) => !t.willFailSave);
      const skipped = parsedTransactions.filter((t) => t.willFailSave);

      if (toSave.length === 0) {
        alert(t('bulkUpload.allDuplicates'));
        setLoading(false);
        return;
      }

      // Assign the destination account with the single centralized rule:
      // 'none'/'single' -> the explicit selectedAccount controls every row;
      // 'multi' -> preserve genuinely distinct per-row accounts.
      const assigned = prepareImportAccountAssignment(toSave, selectedAccount);

      // Transaction Intelligence: persist ONE coherent decision per row. The
      // category/bucket shown & editable in the preview (finalizeClassification
      // already made these the engine decision) are saved together with aligned
      // provenance from `_ti`. An explicit preview edit becomes 'user'
      // provenance. Raw/identity/account fields are never touched.
      let autoCount = 0;
      const formattedData = assigned.map((t) => {
        const base = {
          user_id: user.id,
          date: t.transaction_date || new Date().toISOString(),
          description: t.description,
          description_raw: t.description,
          merchant: t.merchant_display,
          amount: t.amount,
          category: t.category_guess || 'Uncategorized',
          budget_bucket: t.bucket_guess || 'Unsorted',
          account_name: t.account_name,
          source_account: t.source_account,
          bank_reference: t.reference || null,
          notes: `Imported via bulk upload`,
        };
        const ti = t._ti || {};
        let meta;
        if (t._userEditedClass === true) {
          meta = {
            classification_source: 'user',
            classification_confidence: 1,
            user_categorized: true,
            needs_review: false,
            transaction_nature: ti.nature || null,
            normalized_merchant: ti.normalized_merchant || null,
          };
        } else {
          meta = {
            classification_source: ti.source || 'import',
            classification_confidence: typeof ti.confidence === 'number' ? ti.confidence : null,
            transaction_nature: ti.nature || null,
            normalized_merchant: ti.normalized_merchant || null,
            user_categorized: false,
            needs_review: ti.needsReview === true,
          };
          if (!meta.needs_review) autoCount += 1;
        }
        return { ...base, ...meta };
      });
      if (autoCount > 0) trackProductEvent('transaction_auto_categorized', { source_screen: 'activity' });

      const { error } = await supabase.from('transactions').insert(formattedData);
      if (error) throw error;

      if (skipped.length > 0) {
        const savedAccounts = [...new Set(formattedData.map((row) => row.account_name))].join(', ');
        alert(t('bulkUpload.savedWithSkipped', { count: formattedData.length, accounts: savedAccounts, skipped: skipped.length }));
        setParsedTransactions(skipped);
      } else {
        const savedAccounts = [...new Set(formattedData.map((row) => row.account_name))].join(', ');
        alert(t('bulkUpload.savedSuccess', { count: formattedData.length, accounts: savedAccounts }));
        setParsedTransactions([]);
        setRawText('');
        closeModal();
      }
      if (onTransactionsAdded) onTransactionsAdded();
    } catch (error) {
      alert(t('bulkUpload.dbError', { msg: error.message }));
    } finally {
      setLoading(false);
    }
  };

  const removeTransaction = (index) => setParsedTransactions((prev) => prev.filter((_, i) => i !== index));
  const updateTransactionField = (index, field, value) => {
    setParsedTransactions((prev) => prev.map((t, i) => {
      if (i !== index) return t;
      // Editing the category/bucket in the preview is an explicit human
      // classification — mark it so the save records 'user' provenance.
      const editedClass = field === 'category_guess' || field === 'bucket_guess';
      return { ...t, [field]: value, ...(editedClass ? { _userEditedClass: true } : {}) };
    }));
  };
  const BUCKET_OPTIONS = ['NEEDS', 'WANTS', 'SAVINGS', 'INCOME', 'TRANSFERS', 'DEBT_FUNDING', 'Unsorted'];

  if (!open) return null;
return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, overflowY: 'auto', padding: '20px' }}>
      <div style={{ backgroundColor: 'var(--color-card)', color: 'var(--color-card-foreground)', padding: '20px', borderRadius: '15px', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2>{t('bulkUpload.title')}</h2>
          <button onClick={closeModal} style={{ background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer' }}>X</button>
        </div>

        {/* IMPORT INTO ACCOUNT: select an existing account, Cash/Manual, or
            create/name the account this statement belongs to (inline). */}
        {parsedTransactions.length === 0 && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>{t('accounts.importIntoAccount')}</label>
            <AccountSelect value={selectedAccount} onChange={setSelectedAccount} />
            <p style={{ fontSize: '12px', color: 'var(--color-muted-foreground)', marginTop: '6px' }}>
              {t('bulkUpload.importIntoAccountHint')}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '5px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button onClick={() => setActiveTab('text')} style={{ flex: 1, padding: '10px', background: activeTab === 'text' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'text' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>{t('bulkUpload.tabText')}</button>
          <button onClick={() => setActiveTab('sheet')} style={{ flex: 1, padding: '10px', background: activeTab === 'sheet' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'sheet' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>{t('bulkUpload.tabSheet')}</button>
          <button onClick={() => setActiveTab('pdf')} style={{ flex: 1, padding: '10px', background: activeTab === 'pdf' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'pdf' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>{t('bulkUpload.tabPdf')}</button>
          <button onClick={() => setActiveTab('image')} style={{ flex: 1, padding: '10px', background: activeTab === 'image' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'image' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>{t('bulkUpload.tabImage')}</button>
          <button onClick={() => setActiveTab('coophtml')} style={{ flex: 1, padding: '10px', background: activeTab === 'coophtml' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'coophtml' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>{t('bulkUpload.tabCoop')}</button>
          <button onClick={() => setActiveTab('unfcu')} style={{ flex: 1, padding: '10px', background: activeTab === 'unfcu' ? '#007AFF' : 'var(--color-muted)', color: activeTab === 'unfcu' ? 'white' : 'var(--color-foreground)', border: 'none', borderRadius: '5px' }}>{t('bulkUpload.tabUnfcu')}</button>
        </div>

        {parsedTransactions.length === 0 && activeTab === 'text' && (
          <div>
            <textarea placeholder={t('bulkUpload.pasteTextPlaceholder')} value={rawText} onChange={(e) => setRawText(e.target.value)} style={{ width: '100%', height: '180px', padding: '10px', marginBottom: '10px', borderRadius: '5px', border: '1px solid var(--color-border)' }} />
            <button onClick={handleParseText} disabled={loading || !rawText.trim()} style={{ width: '100%', padding: '12px', background: '#007AFF', color: 'white', border: 'none', borderRadius: '5px' }}>{loading ? t('bulkUpload.parsing') : t('bulkUpload.parseText')}</button>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'sheet' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> {t('bulkUpload.selectCsv')} <input type="file" accept=".csv,.xls,.xlsx" onChange={handleSpreadsheetUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'pdf' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> {t('bulkUpload.selectPdf')} <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'image' && (
          <div style={{ padding: '16px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-muted-foreground)', marginBottom: '12px' }}>
              {t('bulkUpload.photoHint')}
            </p>
            <ImageScanTray
              images={images}
              setImages={setImages}
              onScan={scanImages}
              scanning={loading}
              addLabel={t('bulkUpload.addPhotos')}
            />
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'coophtml' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-muted-foreground)', marginBottom: '15px' }}>{t('bulkUpload.coopHint')}</p>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> {t('bulkUpload.selectHtml')} <input type="file" accept=".html,.htm" onChange={handleCooperativaHtmlUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length === 0 && activeTab === 'unfcu' && (
          <div style={{ textAlign: 'center', padding: '40px', border: '2px dashed var(--color-border)', borderRadius: '10px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-muted-foreground)', marginBottom: '15px' }}>{t('bulkUpload.unfcuHint')}</p>
            <label style={{ cursor: 'pointer', padding: '10px 20px', background: '#007AFF', color: 'white', borderRadius: '5px' }}> {t('bulkUpload.selectUnfcu')} <input type="file" accept=".pdf" onChange={handleUnfcuPdfUpload} style={{ display: 'none' }} /> </label>
          </div>
        )}

        {parsedTransactions.length > 0 && (
          <div>
            <h3>
              {t('bulkUpload.previewCount', { count: parsedTransactions.length })}
              {parsedTransactions.some((r) => r.willFailSave) && (
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#b91c1c', marginLeft: '10px' }}>
                  {t('bulkUpload.blockedBanner', { count: parsedTransactions.filter((r) => r.willFailSave).length })}
                </span>
              )}
              {parsedTransactions.some((r) => r.isDuplicate && !r.willFailSave) && (
                <span style={{ fontSize: '14px', fontWeight: 'normal', color: '#a16207', marginLeft: '10px' }}>
                  {(() => { const n = parsedTransactions.filter((r) => r.isDuplicate && !r.willFailSave).length; return n === 1 ? t('bulkUpload.reviewBanner', { count: n }) : t('bulkUpload.reviewBannerPlural', { count: n }); })()}
                </span>
              )}
            </h3>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '20px', border: '1px solid var(--color-border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ background: 'var(--color-muted)', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ padding: '8px', textAlign: 'left' }}>{t('bulkUpload.thDate')}</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>{t('bulkUpload.thDescription')}</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>{t('bulkUpload.thAccount')}</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>{t('bulkUpload.thCategory')}</th>
                    <th style={{ padding: '8px', textAlign: 'left' }}>{t('bulkUpload.thBucket')}</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>{t('bulkUpload.thAmount')}</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>{t('bulkUpload.thDel')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedTransactions.map((row, idx) => {
                    const looksSuspicious = Number(row.amount) === 0;
                    const rowBackground = row.willFailSave ? '#fde8e8' : (row.isDuplicate ? '#fff8e6' : (looksSuspicious ? '#fff3f3' : 'transparent'));
                    return (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)', background: rowBackground }}>
                      <td style={{ padding: '8px' }}>{row.transaction_date ? row.transaction_date.slice(0, 10) : ''}</td>
                      <td style={{ padding: '8px' }}>
                        {looksSuspicious && t('bulkUpload.warningPrefix')}
                        {row.willFailSave ? t('bulkUpload.blockedPrefix') : (row.isDuplicate && t('bulkUpload.reviewPrefix'))}
                        {row.description}
                        {row.isDuplicate && (
                          <div style={{ fontSize: '11px', color: row.willFailSave ? '#b91c1c' : '#a16207', marginTop: '2px', fontWeight: row.willFailSave ? 'bold' : 'normal' }}>
                            {row.willFailSave ? t('bulkUpload.willSkip') : t('bulkUpload.possibleDup')}{row.duplicateNote}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        {row.account_name || selectedAccount}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="text"
                          value={row.category_guess || 'Uncategorized'}
                          onChange={(ev) => updateTransactionField(idx, 'category_guess', ev.target.value)}
                          style={{ width: '100%', padding: '4px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '13px' }}
                        />
                        {row.matchedRule && (
                          <div style={{ fontSize: '10px', color: '#2563eb', marginTop: '2px' }}>{t('bulkUpload.matchedRule', { rule: row.matchedRule })}</div>
                        )}
                        {row.learnedFromHistory && !row.matchedRule && (
                          <div style={{ fontSize: '10px', color: '#15803d', marginTop: '2px' }}>{t('bulkUpload.learnedFromHistory')}</div>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select
                          value={row.bucket_guess || 'Unsorted'}
                          onChange={(ev) => updateTransactionField(idx, 'bucket_guess', ev.target.value)}
                          style={{ width: '100%', padding: '4px', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '13px' }}
                        >
                          {BUCKET_OPTIONS.map((b) => <option key={b} value={b}>{t(`buckets.${String(b).toLowerCase()}`)}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: row.amount < 0 ? 'red' : 'green' }}>${Number(row.amount).toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}><button onClick={() => removeTransaction(idx)} style={{ background: 'none', border: 'none', color: 'red', cursor: 'pointer' }}>{t('bulkUpload.delete')}</button></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setParsedTransactions([])} style={{ flex: 1, padding: '12px', background: 'var(--color-muted)', border: 'none', borderRadius: '5px' }}>{t('bulkUpload.discard')}</button>
              <button onClick={handleSaveToDatabase} disabled={loading} style={{ flex: 2, padding: '12px', background: '#34C759', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold' }}>{loading ? t('bulkUpload.saving') : (parsedTransactions.some((r) => r.account_name) ? t('bulkUpload.saveDetected') : t('bulkUpload.saveTo', { account: selectedAccount }))}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
