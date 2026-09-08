// Robust PDF → plain-text extraction for Receipt Intelligence.
//
// unpdf's `extractText(pdf, { mergePages: true })` resolves to
// `{ totalPages, text: string }` (whitespace collapsed), while
// `{ mergePages: false }` gives `{ totalPages, text: string[] }`. The browser and
// Node bundles share one build, so the shape is the same — but to be defensive
// against any bundler/version variance we normalize EVERY plausible return shape
// (string | { text } | { text: [] } | array | { text: { str } }) into ONE plain
// string. `normalizeUnpdfResult` is pure so it can be unit-tested with fake
// shapes; `extractPdfText` does the dynamic import + pdfjs call.

// Normalize any unpdf extractText return value into a single plain string.
export function normalizeUnpdfResult(result) {
  if (result == null) return '';
  // { totalPages, text } envelope -> unwrap to the text field.
  let text = (typeof result === 'object' && !Array.isArray(result) && 'text' in result)
    ? result.text
    : result;
  // Array of page strings (or page items) -> join with newlines.
  if (Array.isArray(text)) {
    text = text
      .map((p) => {
        if (typeof p === 'string') return p;
        if (Array.isArray(p)) return p.map((x) => (typeof x === 'string' ? x : (x && x.str) || '')).join('');
        if (p && typeof p === 'object' && typeof p.str === 'string') return p.str;
        return '';
      })
      .join('\n');
  }
  if (typeof text === 'string') return text;
  return String(text ?? '');
}

// Extract text from PDF bytes (ArrayBuffer | Uint8Array). Returns a plain string
// (possibly empty). Throws only if unpdf/pdfjs itself fails to load or parse the
// document — the caller distinguishes that from an empty/unreadable result.
export async function extractPdfText(data) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const pdf = await getDocumentProxy(bytes);
  const result = await extractText(pdf, { mergePages: true });
  return normalizeUnpdfResult(result);
}
