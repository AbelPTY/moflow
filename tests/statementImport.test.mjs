// Statement Import UX Regression Fix V1 — proves the Activity statement-import
// workflow communicates BOTH scan and upload, that the file picker advertises
// every format the EXISTING parsers support (with mobile-safe MIME types), that
// unsupported formats are not advertised, and that the Flow BalanceScanner and
// the /api surface are untouched. FICTIONAL/UI-contract assertions only.
//
// These are picker-contract + routing + i18n assertions (exactly what the
// regression is about) — NOT fake parser-success tests. The spreadsheet parser
// (XLSX.read on .csv/.xls/.xlsx) and the PDF/UNFCU endpoints already exist and
// are asserted by their wiring, not re-implemented here.
//
// Run (where Node exists) from repo root:  node tests/statementImport.test.mjs
import { createServer } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const bulk = read('src/components/BulkUpload.jsx');
const balanceScanner = read('src/components/BalanceScanner.jsx');
const activityScanner = read('src/components/RecentActivityScanner.jsx');
const activityPage = read('src/pages/financial-overview/index.jsx');

// The spreadsheet <input accept="..."> line (csv/xls/xlsx).
const spreadsheetAccept = (bulk.match(/accept="([^"]*spreadsheetml[^"]*)"/) || [])[1] || '';
// The two PDF inputs (statement + UNFCU).
const pdfAcceptMatches = [...bulk.matchAll(/accept="(\.pdf[^"]*)"/g)].map((m) => m[1]);

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { translate } = await vite.ssrLoadModule('/src/i18n/core.js');
  const en = (k, v) => translate('en-US', k, v);
  const es = (k, v) => translate('es-PA', k, v);
  const differs = (k) => en(k) !== es(k) && en(k) !== k && es(k) !== k;

  // ---- A. Activity statement action communicates Scan + Upload ----
  ok('A: activity.scanOrUploadStatement EN says scan + upload', /scan/i.test(en('activity.scanOrUploadStatement')) && /upload/i.test(en('activity.scanOrUploadStatement')));
  ok('A: activity.scanOrUploadStatement ES says escanear + subir', /escanear/i.test(es('activity.scanOrUploadStatement')) && /subir/i.test(es('activity.scanOrUploadStatement')));
  ok('A: Activity page uses the scanOrUploadStatement label', activityPage.includes("t('activity.scanOrUploadStatement')"));
  ok('A: Activity page exposes an upload-file action', activityPage.includes("t('activity.uploadStatementFile')") && activityPage.includes('<BulkUpload'));

  // ---- B. EN/ES parity for new/changed keys ----
  ['activity.scanOrUploadStatement', 'activity.uploadStatementFile', 'bulkUpload.selectCsv'].forEach((k) =>
    ok(`B: EN/ES differ for ${k}`, differs(k)));

  // ---- C. Supported spreadsheet extensions present in the Activity picker ----
  ok('C: .csv advertised', spreadsheetAccept.includes('.csv'));
  ok('C: .xls advertised', /(^|,)\.xls(,|$)/.test(spreadsheetAccept));
  ok('C: .xlsx advertised', spreadsheetAccept.includes('.xlsx'));
  // Mobile-safe: MIME types alongside extensions so iOS Safari does not grey them out.
  ok('C: text/csv MIME present', spreadsheetAccept.includes('text/csv'));
  ok('C: xls MIME present', spreadsheetAccept.includes('application/vnd.ms-excel'));
  ok('C: xlsx MIME present', spreadsheetAccept.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  ok('C: selectCsv label names XLSX', /xlsx/i.test(en('bulkUpload.selectCsv')) && /xlsx/i.test(es('bulkUpload.selectCsv')));

  // ---- D. Unsupported spreadsheet formats are NOT advertised ----
  ok('D: .ods not advertised (no parser)', !spreadsheetAccept.includes('.ods'));
  ok('D: .numbers not advertised (no parser)', !spreadsheetAccept.includes('.numbers'));

  // ---- E. CSV routes to the spreadsheet (XLSX.read) handler, unchanged ----
  ok('E: spreadsheet input wired to handleSpreadsheetUpload', /accept="[^"]*spreadsheetml[^"]*"\s+onChange=\{handleSpreadsheetUpload\}/.test(bulk));
  ok('E/H/I: handleSpreadsheetUpload parses csv/xls/xlsx via XLSX.read', /handleSpreadsheetUpload[\s\S]*XLSX\.read/.test(bulk));

  // ---- F/J. PDF supported and routed to the PDF statement endpoint ----
  ok('F: at least one .pdf input advertised', pdfAcceptMatches.length >= 1);
  ok('F: PDF inputs carry application/pdf MIME (mobile-safe)', pdfAcceptMatches.every((a) => a.includes('application/pdf')));
  ok('J: PDF routes to /api/parsePdfStatement', /handlePdfUpload[\s\S]*\/api\/parsePdfStatement/.test(bulk));

  // ---- K. UNFCU path intact and routed to its dedicated endpoint ----
  ok('K: UNFCU routes to /api/parseUNFCUStatement', /handleUnfcuPdfUpload[\s\S]*\/api\/parseUNFCUStatement/.test(bulk));
  ok('K: UNFCU picker still present', en('bulkUpload.selectUnfcu').length > 0 && bulk.includes('handleUnfcuPdfUpload'));

  // ---- G. Activity screenshot scan (image) path preserved ----
  ok('G: RecentActivityScanner still image/*', /accept="image\/\*"/.test(activityScanner));
  ok('G: scan path uses /api/scanReceipt mode activity', /\/api\/scanReceipt/.test(activityScanner) && /mode:\s*'activity'/.test(activityScanner));

  // ---- L. Flow BalanceScanner accept UNCHANGED (image/* only; never spreadsheets) ----
  ok('L: BalanceScanner accept is image/* only', /accept="image\/\*"/.test(balanceScanner));
  ok('L: BalanceScanner does NOT accept spreadsheets', !/\.xlsx|\.xls|\.csv|spreadsheetml/.test(balanceScanner));

  // ---- M. Cards keeps its already-honest "scan or upload" wording ----
  ok('M: cards.scanOrUpload present EN/ES', /scan|upload/i.test(en('cards.scanOrUpload')) && es('cards.scanOrUpload').length > 0);

  // ---- N. No API endpoint added: exactly 12 top-level /api functions ----
  const apiCount = readdirSync(new URL('../api', import.meta.url)).filter((f) => f.endsWith('.js')).length;
  ok('N: /api count is exactly 12', apiCount === 12);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
