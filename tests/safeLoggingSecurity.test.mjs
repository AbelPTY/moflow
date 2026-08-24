// Synthetic tests for Phase D1: safe server error logging.
//
// No network. Behavioral tests exercise the safeError() helper; static tests
// scan every server source's console.* calls to prove no raw error object or
// sensitive identifier is logged. Comments and string literals are stripped
// before the raw-identifier scan so an explanatory comment or a fixed label
// mentioning "error" does not cause a false positive.
//
// Run from repo root:
//   node tests/safeLoggingSecurity.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { safeError } from '../server/safeError.js';

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label); }
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// Remove block comments and line comments (but not the // in "https://").
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
// Blank the contents of every quoted string literal so labels can't trip scans.
function blankStrings(s) {
  return s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
}
// Extract the raw argument text of every console.* call in a source file.
function consoleCallArgs(src) {
  const s = stripComments(src);
  const out = [];
  const re = /console\.(log|error|warn|info|debug)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    const open = re.lastIndex - 1;
    let depth = 0, end = -1;
    for (let i = open; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) out.push(s.slice(open + 1, end));
  }
  return out;
}

const SERVER_FILES = [
  'api/identifyColumns.js',
  'api/parsePdfStatement.js',
  'api/parseStatement.js',
  'api/parseUNFCUStatement.js',
  'api/scanCardStatement.js',
  'api/scanReceipt.js',
  'api/voiceToTasks.js',
  'api/rateLimit.js',
  'api/telegramLink.js',
  'api/telegramWebhook.js',
  'api/sendPaymentReminders.js',
  'server/auth.js',
  'server/safeError.js',
];

const FORBIDDEN_TOKENS = [
  'req.body', 'req.query', 'req.headers', 'authorization',
  '.message', '.stack', 'json.stringify', 'process.env',
  'rawtext', 'base64', 'responsetext', 'filepath', 'filebuffer',
  'imagepart', 'pdftext', 'chat_id', 'telegram_user_id', 'telegram_chat_id',
];

// A console arg carries a RAW error object if, after removing safeError(...) and
// the allowlisted `x?.code || x?.name || '...'` pattern and blanking strings, a
// bare error identifier remains.
function logsRawError(argText) {
  let a = blankStrings(argText);
  a = a.replace(/safeError\([^)]*\)/g, '');
  a = a.replace(/[A-Za-z_]+\?\.code\s*\|\|\s*[A-Za-z_]+\?\.name\s*\|\|\s*''/g, '');
  return /\b(error|err|e)\b/.test(a);
}

// ---------------------------------------------------------------------------
// 1. safeError() helper behavior
// ---------------------------------------------------------------------------
{
  const r = safeError({ name: 'TypeError', code: 'ERR_X', message: 'super-secret-user-data', stack: 'at foo secret' });
  ok('safeError returns name', r.name === 'TypeError');
  ok('safeError returns code', r.code === 'ERR_X');
  ok('safeError omits message key', !('message' in r));
  ok('safeError omits stack key', !('stack' in r));
  ok('safeError never contains message text', !JSON.stringify(r).includes('super-secret-user-data'));
  ok('safeError never contains stack text', !JSON.stringify(r).includes('at foo secret'));
  ok('safeError has exactly name+code keys', JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['code', 'name']));
}
ok('safeError handles null', (() => { const r = safeError(null); return r.name === 'Error' && r.code === undefined; })());
ok('safeError handles string', (() => { const r = safeError('boom: user@example.com'); return r.name === 'Error' && !JSON.stringify(r).includes('user@example.com'); })());
ok('safeError handles number', (() => { const r = safeError(42); return r.name === 'Error'; })());
ok('safeError bounds long name', (() => { const r = safeError({ name: 'A'.repeat(200) }); return r.name === 'Error'; })());
ok('safeError rejects name with spaces/message', (() => { const r = safeError({ name: 'Error: leaked secret here' }); return r.name === 'Error'; })());
ok('safeError rejects unsafe code (message-like)', (() => { const r = safeError({ name: 'E', code: 'contains user secret data!' }); return r.code === undefined; })());
ok('safeError stringifies numeric code', (() => { const r = safeError({ name: 'E', code: 23505 }); return r.code === '23505'; })());
ok('safeError does not spread arbitrary props', (() => { const r = safeError({ name: 'E', hint: 'H', detail: 'D', query: 'Q' }); return !('hint' in r) && !('detail' in r) && !('query' in r); })());

// ---------------------------------------------------------------------------
// 2. Static: no server console.* logs a raw error or a sensitive identifier
// ---------------------------------------------------------------------------
for (const f of SERVER_FILES) {
  const args = consoleCallArgs(read(f));
  const name = f.replace(/^.*\//, '');
  for (const a of args) {
    ok(`${name} console arg has no raw error object`, !logsRawError(a));
    const low = blankStrings(a).toLowerCase();
    ok(`${name} console arg has no sensitive token`, !FORBIDDEN_TOKENS.some((t) => low.includes(t)));
  }
  // (Files with no console calls simply pass vacuously.)
}

// ---------------------------------------------------------------------------
// 3. Static: hardened responses no longer echo error.message to clients
// ---------------------------------------------------------------------------
for (const f of ['api/identifyColumns.js', 'api/parseStatement.js', 'api/parsePdfStatement.js', 'api/parseUNFCUStatement.js']) {
  const s = stripComments(read(f));
  ok(`${f.replace('api/', '')} response omits error.message`, !/error\?\.message/.test(s));
}

// ---------------------------------------------------------------------------
// 4. Regression: rate-limit scopes/order unchanged; Telegram/reminder untouched
// ---------------------------------------------------------------------------
const scopeByFile = {
  'api/identifyColumns.js': 'gemini_text',
  'api/parseStatement.js': 'gemini_text',
  'api/voiceToTasks.js': 'gemini_text',
  'api/scanCardStatement.js': 'gemini_vision',
  'api/scanReceipt.js': 'gemini_vision',
  'api/parsePdfStatement.js': 'gemini_pdf',
  'api/parseUNFCUStatement.js': 'local_pdf',
};
for (const [f, scope] of Object.entries(scopeByFile)) {
  const s = read(f);
  const iAuth = s.indexOf('requireUser(req, res)');
  const iRL = s.indexOf('applyRateLimit({');
  ok(`${f.replace('api/', '')} keeps scope ${scope}`, s.includes(`scope: '${scope}'`));
  ok(`${f.replace('api/', '')} keeps auth->limit order`, iAuth !== -1 && iRL !== -1 && iAuth < iRL);
}
// Telegram/reminder files must not have been pulled into the safe-error refactor.
for (const f of ['api/telegramWebhook.js', 'api/telegramLink.js', 'api/sendPaymentReminders.js']) {
  ok(`${f.replace('api/', '')} not importing safeError`, !read(f).includes('safeError'));
}

console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail === 0 ? 0 : 1);
