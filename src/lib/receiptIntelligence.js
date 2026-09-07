// Receipt & Invoice Intelligence V1 — pure, deterministic core.
//
// Handles TWO V1 inputs: a receipt/invoice IMAGE (extracted by Gemini on the
// server, then sanitized here) and a Panama electronic-invoice XML (parsed here,
// deterministically, NEVER sent to Gemini). Both converge on ONE normalized
// receipt object. Also provides pure receipt→transaction matching, a duplicate
// fingerprint, and a privacy-safe analytics payload.
//
// PRIVACY: the normalized object and analytics payload never carry customer
// identity, account/card numbers (card digits are stripped), or raw file bytes.
// Everything here is pure (no DB, no network) so it is fully unit-testable.

import { normalizeMerchant } from './transactionIntelligence.js';

export const DOCUMENT_TYPES = ['receipt', 'invoice'];
export const SOURCE_TYPES = ['image', 'xml', 'pdf'];
export const DEFAULT_MATCH_WINDOW_DAYS = 2;

// ---------------------------------------------------------------------------
// Small safe helpers
// ---------------------------------------------------------------------------
const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const str = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
};
// Strip anything that looks like card digits (masked or full) from a string.
const stripCardDigits = (v) => {
  if (v == null) return null;
  return String(v)
    .replace(/\d(?:[ -]?\d){12,18}/g, '')      // full PAN (13-19 digits, any boundary)
    .replace(/\*{2,}\s*\d{2,4}/g, '')          // "**** 1234"
    .replace(/x{2,}\s*\d{2,4}/gi, '')          // "xxxx1234"
    .replace(/\s{2,}/g, ' ')
    .trim() || null;
};
const pad2 = (n) => String(n).padStart(2, '0');

// Normalize a date-ish value to yyyy-MM-dd (local), or null.
export function normalizeDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);            // ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);          // dd/mm or mm/dd
  if (m) {
    let p1 = Number(m[1]); let p2 = Number(m[2]); const yyyy = m[3];
    // Disambiguate: a part > 12 is unambiguously the day; otherwise assume
    // day/month (Panama convention).
    let day; let month;
    if (p2 > 12 && p1 <= 12) { month = p1; day = p2; }   // mm/dd/yyyy (US)
    else { day = p1; month = p2; }                        // dd/mm/yyyy (PA)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${yyyy}-${pad2(month)}-${pad2(day)}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return null;
}
function normalizeTime(value) {
  const s = String(value || '');
  const m = s.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1]}:${m[2]}${m[3] ? ':' + m[3] : ''}` : null;
}

// ---------------------------------------------------------------------------
// Panama electronic-invoice XML parser (deterministic, safe, no network/Gemini)
// ---------------------------------------------------------------------------

// Decode a bounded set of XML entities. Numeric char refs are size-bounded; NO
// named external entities are ever resolved (XXE-safe).
function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d{1,6});/g, (_, d) => { const n = Number(d); return n <= 0x10ffff ? String.fromCodePoint(n) : ''; })
    .replace(/&amp;/g, '&')
    .trim();
}

// First value of any of `names` (namespace-prefix tolerant, case-insensitive).
function xmlTag(src, names) {
  for (const n of names) {
    const re = new RegExp(`<(?:[\\w.-]+:)?${n}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${n}>`, 'i');
    const m = src.match(re);
    if (m && m[1] != null) {
      const v = decodeXml(m[1]);
      if (v !== '' && !/^<.*>$/.test(v)) return v; // skip nested-only blocks
    }
  }
  return null;
}

// All inner blocks for any of `names`.
function xmlBlocks(src, names) {
  const out = [];
  for (const n of names) {
    const re = new RegExp(`<(?:[\\w.-]+:)?${n}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${n}>`, 'gi');
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
    if (out.length) break; // first recognized item tag name wins
  }
  return out;
}

// Parse a Panama FE-style invoice XML into the normalized receipt object, or null
// if it is malformed / unsafe / unusable. Tolerant of missing optional fields.
export function parsePanamaInvoiceXml(xml) {
  const s = String(xml == null ? '' : xml);
  if (!s.trim()) return null;
  // XXE / unsafe-feature guard: reject any DTD / entity declaration outright.
  if (/<!DOCTYPE/i.test(s) || /<!ENTITY/i.test(s)) return null;
  // Must actually look like XML.
  if (!/<[A-Za-z][\s\S]*>/.test(s)) return null;

  // Issuer identity — dNombEm/dRuc live nested under gEmis>gRucEmi; the block-
  // scoped tag search finds them regardless of nesting depth.
  const legalEntityName = str(xmlTag(s, ['dNombEm', 'razonSocial', 'nombreEmisor', 'emisorNombre', 'issuerName']));
  const merchantDisplayName = str(xmlTag(s, ['dNombComercial', 'nombreComercial', 'tradeName'])) || legalEntityName;
  const taxId = str(xmlTag(s, ['dRuc', 'ruc', 'rucEmisor', 'taxId', 'nit']));
  const branchName = str(xmlTag(s, ['dNombSuc', 'sucursal', 'branchName']));
  const branchCode = str(xmlTag(s, ['dSucEm', 'dSuc', 'dPtoFacDF', 'codSuc', 'branchCode']));
  const dateRaw = xmlTag(s, ['dFechaEm', 'fechaEmision', 'fechaEmi', 'issueDate', 'fecha']);
  const transactionDate = normalizeDate(dateRaw);
  // Time may be its own tag OR embedded in an ISO dFechaEm datetime.
  const transactionTime = normalizeTime(xmlTag(s, ['dHoraEm', 'horaEmision', 'issueTime', 'hora']) || dateRaw || '');
  // Totals: dTotNeto = pre-discount subtotal, dTotDesc = discount, dVTot = final
  // total. These are NOT interchangeable and subtotal !== total - tax (discounts).
  const subtotal = num(xmlTag(s, ['dTotNeto', 'subtotal', 'totalNeto', 'montoNeto']));
  const tax = num(xmlTag(s, ['dTotITBMS', 'totalITBMS', 'itbms', 'totalImpuesto', 'tax']));
  const discountTotal = num(xmlTag(s, ['dTotDesc', 'totalDescuento', 'descuento', 'discount']));
  const total = num(xmlTag(s, ['dVTot', 'dTotRec', 'totalFactura', 'total', 'montoTotal', 'granTotal']));
  const currency = str(xmlTag(s, ['dCodMoneda', 'moneda', 'currency'])) || 'USD';
  // Payment: real FE exposes a CODE (iFormaPago) + amount (dVlrCuota); we do NOT
  // invent a human-readable label. Keep a neutral code + amount.
  const paymentMethod = str(xmlTag(s, ['dFormaPagoDesc', 'formaPagoDesc', 'medioPago', 'paymentMethod']));
  const paymentMethodCode = str(xmlTag(s, ['iFormaPago', 'formaPago', 'paymentMethodCode']));
  const paymentAmount = num(xmlTag(s, ['dVlrCuota', 'valorCuota', 'paymentAmount']));
  const invoiceNumber = str(xmlTag(s, ['dNroDF', 'numeroFactura', 'invoiceNumber', 'nroFactura']));
  // documentId = CUFE only. dId is deliberately NOT read (it can carry the giant
  // QR/JWT payload).
  const documentId = str(xmlTag(s, ['dCufe', 'cufe', 'CUFE']));

  const itemBlocks = xmlBlocks(s, ['gItem', 'item', 'detalle', 'lineItem', 'linea']);
  const lineItems = itemBlocks.map((b) => ({
    description: str(xmlTag(b, ['dDescProd', 'descripcion', 'description', 'nombre'])),
    quantity: num(xmlTag(b, ['dCantCodInt', 'cantidad', 'quantity', 'qty'])),
    unitPrice: num(xmlTag(b, ['dPrUnit', 'precioUnitario', 'unitPrice'])),
    lineTotal: num(xmlTag(b, ['dValTotItem', 'valorTotal', 'lineTotal', 'total'])),
    productCode: str(xmlTag(b, ['dCodProd', 'codigo', 'productCode', 'sku'])),
    taxAmount: num(xmlTag(b, ['dValITBMS', 'itbms', 'taxAmount'])),
  })).filter((li) => li.description || li.lineTotal != null);

  // Unusable if we couldn't extract any anchor field.
  if (total == null && !legalEntityName && lineItems.length === 0) return null;

  return normalizeReceipt({
    documentType: 'invoice',
    sourceType: 'xml',
    merchantDisplayName, legalEntityName, taxId, branchName, branchCode,
    transactionDate, transactionTime, subtotal, tax, discountTotal, total, currency,
    paymentMethod, paymentMethodCode, paymentAmount,
    lineItems, invoiceNumber, documentId,
    extractionConfidence: 1, // deterministic parse
  });
}

// ---------------------------------------------------------------------------
// Panama DGI PDF ("Comprobante Auxiliar de Factura Electrónica") text parser.
// DETERMINISTIC — operates on already-extracted PDF text (via unpdf), never
// Gemini. Handles both observed layout families and excludes recipient identity.
// ---------------------------------------------------------------------------

// Detect a Panama DGI electronic-invoice PDF from its extracted text. Requires
// MULTIPLE strong signals so arbitrary PDFs are never misclassified.
export function isPanamaDgiPdf(text) {
  const s = String(text || '').toUpperCase();
  if (!s) return false;
  let signals = 0;
  if (/\bDGI\b/.test(s) || /DIRECCION\s+GENERAL\s+DE\s+INGRESOS/.test(s)) signals += 1;
  if (/COMPROBANTE\s+AUXILIAR\s+DE\s+FACTURA\s+ELECTR/.test(s)) signals += 1;
  if (/\bCUFE\b/.test(s)) signals += 1;
  if (/RUC/.test(s) && /EMISOR/.test(s)) signals += 1;
  if (/FORMA\s+PAGO|MEDIOS?\s+DE\s+PAGO/.test(s)) signals += 1;
  if ((/SUBTOTAL|SUB\s*TOTAL/.test(s)) && /\bTOTAL\b/.test(s)) signals += 1;
  return signals >= 3;
}

// Real DGI PDF text (via unpdf) comes back as ONE flat, single-spaced string —
// column boundaries and line breaks are lost — so parsing is inline-label based.
const flat = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const grab = (s, re) => { const m = String(s).match(re); return m && m[1] != null ? m[1].trim() : null; };
const money = (v) => (v == null ? null : num(v));
const NUM_TOKEN = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;
const UNIT_TOKEN = /^(UND|UNID|UN|U|C\/U|PZA|EA|SERV)$/i;

const MONTHS_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
// Parse a Spanish long date ("27 de agosto de 2026") -> yyyy-MM-dd, else fall back.
function normalizeSpanishDate(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i);
  if (m) {
    const mo = MONTHS_ES[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${pad2(mo)}-${pad2(Number(m[1]))}`;
  }
  return normalizeDate(value);
}

// Parse one DGI item row (flat). `codeFirst` (Layout A: header starts "Código")
// means the leading token is the product code; otherwise (Layout B: "Ítem Código
// Descripción") the leading integer is a sequence number and code/description
// columns cannot be separated from single-spaced text (kept together — see report).
function parseItemRow(line, codeFirst) {
  let toks = flat(line).split(' ');
  if (toks.length < 3) return null;
  let productCode;
  if (codeFirst) {
    productCode = toks[0]; toks = toks.slice(1);
  } else if (/^\d+$/.test(toks[0])) {
    toks = toks.slice(1); // drop the Ítem sequence number
  }
  const descTok = [];
  let i = 0;
  for (; i < toks.length; i += 1) {
    if (NUM_TOKEN.test(toks[i]) || UNIT_TOKEN.test(toks[i])) break;
    descTok.push(toks[i]);
  }
  const description = str(descTok.join(' '));
  const nums = toks.slice(i).filter((x) => NUM_TOKEN.test(x)).map((x) => num(x));
  if (!description || nums.length < 2) return null;
  return {
    description,
    quantity: nums[0],
    unitPrice: nums[1],
    lineTotal: nums[nums.length - 1],
    productCode: productCode || undefined,
    taxAmount: nums.length >= 4 ? nums[nums.length - 2] : undefined,
  };
}

export function parsePanamaDgiPdfText(text) {
  if (!isPanamaDgiPdf(text)) return null;
  const s = flat(text);
  if (!s) return null;

  // ISSUER identity only. Layout A uses explicit "Nombre Emisor:" / "Ruc Emisor:".
  // Layout B interleaves emisor+receptor columns ("Emisor Receptor Nombre: <issuer>
  // Tipo de receptor: … Nombre: <recipient> …"): the issuer name is bounded BEFORE
  // "Tipo de receptor", and the issuer RUC is the FIRST "RUC:" (recipient's comes
  // after). Recipient name/RUC/address/email/phone are therefore never extracted.
  const legalEntityName = str(
    grab(s, /Nombre Emisor:\s*(.+?)\s+(?:Ruc Emisor:|DV:|Direcci[oó]n Emisor:)/i)
    || grab(s, /Emisor\s+Receptor\s+Nombre:\s*(.+?)\s+Tipo de receptor:/i)
    || grab(s, /\bEmisor\b\s+Nombre:\s*(.+?)\s+(?:Tipo|Receptor|RUC|Direcci[oó]n)/i),
  );
  const taxId = str(
    grab(s, /Ruc Emisor:\s*([\d-]+)/i)
    || grab(s, /\bR\.?U\.?C\.?:\s*([\d-]+)/i),
  );
  const branchCode = str(grab(s, /Sucursal\/Punto:\s*([\w/-]+)/i) || grab(s, /Sucursal:\s*([\w-]+)/i));
  const transactionDate = normalizeSpanishDate(
    grab(s, /Fecha emisi[oó]n:\s*(.+?)\s+(?:N[uú]mero|Protocolo|Consulte|Hora|Sucursal)/i)
    || grab(s, /\bFecha:\s*(.+?)\s+(?:Hora|Sucursal|Consulte|N[uú]mero|Protocolo)/i),
  );
  const transactionTime = normalizeTime(grab(s, /\bHora:\s*([\d:]+)/i) || '');
  const invoiceNumber = str(grab(s, /N[uú]mero:\s*(\d+)/i));
  const documentId = str(grab(s, /CUFE:\s*([A-Z0-9-]{20,})/i));
  const subtotal = money(
    grab(s, /Subtotal sin impuestos\s+([\d.,]+)/i)
    || grab(s, /Sub\s?Total\s+([\d.,]+)/i)
    || grab(s, /Subtotal\s+([\d.,]+)/i),
  );
  // Tax: "Total Impuesto <n>" (Layout A) or a STANDALONE "Impuestos <n>" (Layout
  // B) — the negative lookbehind avoids matching "Subtotal sin impuestos <n>".
  const tax = money(
    grab(s, /Total Impuesto\s+([\d.,]+)/i)
    || grab(s, /(?<!sin\s)\bImpuestos\b\s+(\d[\d.,]*\.\d{2})/i),
  );
  const discountTotal = money(grab(s, /(?:Total )?Descuento\s+([\d.,]+)/i));
  // Final total: the LAST bare "Total <money>" — skips the ITBMS-breakdown
  // "Total 0.00", and "Total Impuesto/Recibido/de pago/ítem" never match (a word
  // follows "Total", not a number).
  const totalMatches = [...s.matchAll(/\bTotal\s+(\d[\d,]*\.\d{2})\b/gi)];
  const total = totalMatches.length ? num(totalMatches[totalMatches.length - 1][1]) : null;
  const paymentMethod = str(
    grab(s, /Forma Pago\s+(.+?)\s+[\d.,]+\.\d{2}/i)
    || grab(s, /Medios de Pago\s+(?:Tipo\s+B\/?\.?\s+Valor\s+Observaci[oó]n\s+)?(.+?)\s+[\d.,]+\.\d{2}/i),
  );

  // Line items: text between the column header and the "Cantidad (Items|Total…)"
  // marker. codeFirst distinguishes the two layout families by their header.
  const codeFirst = !/[íi]tem\s+c[óo]digo/i.test(s);
  const itemBlock = grab(s, /(?:Valor Total|Total [íi]tem)\s+([\s\S]+?)\s+Cantidad\s+(?:Items|Total)/i);
  const lineItems = [];
  if (itemBlock) {
    const item = parseItemRow(itemBlock, codeFirst);
    if (item) lineItems.push(item);
  }

  if (total == null && !legalEntityName && lineItems.length === 0) return null;

  return normalizeReceipt({
    documentType: 'invoice',
    sourceType: 'pdf',
    merchantDisplayName: legalEntityName,
    legalEntityName, taxId, branchCode, transactionDate, transactionTime,
    subtotal, tax, discountTotal, total,
    currency: 'USD', paymentMethod,
    lineItems, invoiceNumber, documentId,
    extractionConfidence: 0.9, // deterministic text, layout-heuristic
  });
}

// ---------------------------------------------------------------------------
// Normalization — shape any raw extraction (image, xml, or pdf) to the V1 schema.
// ---------------------------------------------------------------------------
export function normalizeReceipt(raw = {}) {
  const documentType = DOCUMENT_TYPES.includes(raw.documentType) ? raw.documentType : 'receipt';
  const sourceType = SOURCE_TYPES.includes(raw.sourceType) ? raw.sourceType : 'image';
  const lineItems = Array.isArray(raw.lineItems) ? raw.lineItems.map((li) => ({
    description: stripCardDigits(str(li.description)),
    quantity: num(li.quantity),
    unitPrice: num(li.unitPrice),
    lineTotal: num(li.lineTotal),
    productCode: str(li.productCode) || undefined,
    taxAmount: num(li.taxAmount) ?? undefined,
  })) : [];

  const receipt = {
    documentType,
    sourceType,
    merchantDisplayName: stripCardDigits(str(raw.merchantDisplayName)),
    legalEntityName: stripCardDigits(str(raw.legalEntityName)),
    taxId: str(raw.taxId),
    branchName: str(raw.branchName) || undefined,
    branchCode: str(raw.branchCode) || undefined,
    transactionDate: normalizeDate(raw.transactionDate),
    transactionTime: raw.transactionTime ? normalizeTime(raw.transactionTime) : undefined,
    subtotal: num(raw.subtotal),
    tax: num(raw.tax),
    discountTotal: num(raw.discountTotal) ?? undefined,
    total: num(raw.total),
    currency: str(raw.currency) || 'USD',
    paymentMethod: stripCardDigits(str(raw.paymentMethod)) || undefined,
    paymentMethodCode: str(raw.paymentMethodCode) || undefined,
    paymentAmount: num(raw.paymentAmount) ?? undefined,
    lineItems,
    invoiceNumber: str(raw.invoiceNumber) || undefined,
    documentId: str(raw.documentId) || undefined,
    extractionConfidence: typeof raw.extractionConfidence === 'number'
      ? Math.max(0, Math.min(1, Math.round(raw.extractionConfidence * 100) / 100)) : null,
  };
  receipt.fingerprint = receiptFingerprint(receipt);
  return receipt;
}

// Sanitize a Gemini image-mode JSON result into the normalized schema (defense in
// depth — the server also validates). Returns a normalized receipt or null.
export function sanitizeReceiptImageResult(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const r = normalizeReceipt({ ...obj, sourceType: 'image', documentType: obj.documentType || 'receipt' });
  if (r.total == null && !r.merchantDisplayName && r.lineItems.length === 0) return null;
  return r;
}

// ---------------------------------------------------------------------------
// Duplicate fingerprint — stable, from safe fields only (no raw content hash).
// ---------------------------------------------------------------------------
export function receiptFingerprint(receipt = {}) {
  const merchant = normalizeMerchant(receipt.merchantDisplayName || receipt.legalEntityName || '').toLowerCase();
  const date = normalizeDate(receipt.transactionDate) || '';
  const total = receipt.total == null ? '' : String(receipt.total);
  const docId = String(receipt.documentId || '').toLowerCase();
  return [merchant, date, total, docId].join('|');
}

// ---------------------------------------------------------------------------
// Receipt → transaction matching (pure). Signals: amount (heaviest), date
// proximity, merchant similarity. NEVER uses account/card/customer identity.
// ---------------------------------------------------------------------------
const daysApart = (a, b) => {
  const da = new Date(`${a}T00:00:00`); const db = new Date(`${b}T00:00:00`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(Math.round((da - db) / 86400000));
};
const tokenSet = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2));
function merchantSimilarity(a, b) {
  const A = tokenSet(normalizeMerchant(a)); const B = tokenSet(normalizeMerchant(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}
function amountScore(receiptTotal, txAmount) {
  if (receiptTotal == null || txAmount == null) return 0;
  const r = Math.abs(receiptTotal); const t = Math.abs(Number(txAmount));
  if (r === 0) return 0;
  const diff = Math.abs(r - t);
  if (diff < 0.005) return 1;
  if (diff <= Math.max(0.5, r * 0.01)) return 0.9; // within 1% or 50¢ (tip/rounding)
  if (diff <= r * 0.05) return 0.6;
  return 0;
}
function dateScore(receiptDate, txDate, windowDays) {
  const rd = normalizeDate(receiptDate); const td = normalizeDate(txDate);
  if (!rd || !td) return 0;
  const d = daysApart(rd, td);
  if (d > windowDays) return 0;
  return d === 0 ? 1 : d === 1 ? 0.8 : 0.6;
}

// Return ranked candidate matches (highest confidence first). Each:
// { transactionId, confidence, amountMatch, dateWithinWindow, merchantScore }.
export function matchReceiptToTransactions(receipt = {}, transactions = [], { windowDays = DEFAULT_MATCH_WINDOW_DAYS, limit = 5 } = {}) {
  const rDate = normalizeDate(receipt.transactionDate);
  const candidates = [];
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const txDate = normalizeDate(tx.date || tx.transaction_date || tx.dateString);
    if (rDate && txDate && daysApart(rDate, txDate) > windowDays) continue; // window guard
    const aScore = amountScore(receipt.total, tx.amount);
    const dScore = dateScore(receipt.transactionDate, txDate, windowDays);
    const mScore = merchantSimilarity(receipt.merchantDisplayName || receipt.legalEntityName, tx.merchant || tx.description);
    // Amount is the dominant signal; date + merchant refine it.
    const confidence = Math.round((aScore * 0.6 + dScore * 0.25 + mScore * 0.15) * 100) / 100;
    if (confidence <= 0) continue;
    candidates.push({
      transactionId: tx.id,
      confidence,
      amountMatch: aScore >= 0.9,
      dateWithinWindow: dScore > 0,
      merchantScore: Math.round(mScore * 100) / 100,
    });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, limit);
}

// V1 never auto-links; a match is only "high confidence" for UI emphasis.
export function isHighConfidenceMatch(candidate) {
  return !!candidate && candidate.confidence >= 0.9 && candidate.amountMatch === true;
}

// ---------------------------------------------------------------------------
// Privacy-safe analytics payload — counts/flags ONLY, never receipt contents.
// ---------------------------------------------------------------------------
export function receiptAnalyticsPayload(receipt = {}, { matched = false } = {}) {
  return {
    source_type: SOURCE_TYPES.includes(receipt.sourceType) ? receipt.sourceType : 'image',
    document_type: DOCUMENT_TYPES.includes(receipt.documentType) ? receipt.documentType : 'receipt',
    line_item_count: Array.isArray(receipt.lineItems) ? receipt.lineItems.length : 0,
    has_tax: receipt.tax != null && receipt.tax > 0,
    matched: !!matched,
  };
}
