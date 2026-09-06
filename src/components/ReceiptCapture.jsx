import React, { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { authHeader } from '../lib/apiClient';
import {
  sanitizeReceiptImageResult, parsePanamaInvoiceXml,
  matchReceiptToTransactions, isHighConfidenceMatch,
} from '../lib/receiptIntelligence';
import { fetchMatchWindowTransactions, saveReceipt, receiptExistsByFingerprint } from '../lib/receiptStore';
import { classifyForInsert } from '../lib/transactionRules';

// Receipt & Invoice Intelligence V1 — capture + preview + match + confirm modal.
// Two entry points feed it: Activity (no preselected transaction) and a specific
// transaction (preselectedTransaction). READ/extract does not write; only an
// explicit "Confirm match" persists (structured extraction only). Image → Gemini
// (scanReceipt mode:'receipt_v1'); XML → deterministic local parse (never Gemini).
//
// Props: open, onClose, preselectedTransaction?, onSaved?
export default function ReceiptCapture({ open, onClose, preselectedTransaction = null, onSaved }) {
  const { t, formatCurrency, formatDate } = useI18n();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [isXml, setIsXml] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [chosenTxId, setChosenTxId] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const imgInput = useRef(null);
  const xmlInput = useRef(null);

  const reset = () => { setReceipt(null); setIsXml(false); setCandidates([]); setChosenTxId(null); setSuggestion(null); setNote(''); setError(''); };
  const close = () => { reset(); onClose?.(); };

  const readFileAs = (file, as) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    if (as === 'text') r.readAsText(file); else r.readAsDataURL(file);
  });

  // After extraction: compute match candidates + a category suggestion (display
  // only — never written here). Preselected transaction is verified for coherence.
  const afterExtract = async (r) => {
    setReceipt(r);
    // Category suggestion from the improved merchant/context (display only).
    try {
      const cls = classifyForInsert({ merchant: r.merchantDisplayName || r.legalEntityName || '', description: r.merchantDisplayName || '', amount: -(r.total || 0) }).classification;
      if (cls && cls.category && cls.category !== 'Uncategorized') setSuggestion({ category: cls.category, bucket: cls.bucket, nature: cls.nature });
    } catch { /* suggestion is best-effort */ }
    // Matching.
    try {
      if (preselectedTransaction) {
        const cands = matchReceiptToTransactions(r, [preselectedTransaction], { windowDays: 2 });
        setCandidates(cands);
        setChosenTxId(preselectedTransaction.id);
      } else {
        const txns = await fetchMatchWindowTransactions(null, { date: r.transactionDate, windowDays: 2 });
        const cands = matchReceiptToTransactions(r, txns, { windowDays: 2 });
        setCandidates(cands);
        if (cands.length && isHighConfidenceMatch(cands[0])) setChosenTxId(cands[0].transactionId);
      }
    } catch { setCandidates([]); }
    // Duplicate hint (safe if table missing).
    try { if (await receiptExistsByFingerprint(null, r.fingerprint)) setNote(t('activity.receipt.duplicateWarning')); } catch { /* ignore */ }
  };

  const onImage = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setError(''); setNote('');
    try {
      const dataUrl = await readFileAs(file, 'dataurl');
      const res = await fetch('/api/scanReceipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ image: dataUrl, mode: 'receipt_v1' }),
      });
      if (!res.ok) throw new Error('scan failed');
      const json = await res.json();
      const r = sanitizeReceiptImageResult(json?.receipt);
      if (!r) { setError(t('activity.receipt.noExtraction')); return; }
      setIsXml(false);
      await afterExtract(r);
    } catch {
      setError(t('activity.receipt.noExtraction'));
    } finally { setBusy(false); if (imgInput.current) imgInput.current.value = ''; }
  };

  const onXml = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setError(''); setNote('');
    try {
      const text = await readFileAs(file, 'text');
      const r = parsePanamaInvoiceXml(text);
      if (!r) { setError(t('activity.receipt.noExtraction')); return; }
      setIsXml(true);
      await afterExtract(r);
    } catch {
      setError(t('activity.receipt.noExtraction'));
    } finally { setBusy(false); if (xmlInput.current) xmlInput.current.value = ''; }
  };

  const confirm = async (transactionId) => {
    setBusy(true); setError('');
    try {
      const out = await saveReceipt(null, { receipt, transactionId: transactionId || null });
      if (out.ok) { setNote(transactionId ? t('activity.receipt.saved') : t('activity.receipt.savedNoMatch')); onSaved?.(); setTimeout(close, 900); }
      else if (out.pendingMigration) setError(t('activity.receipt.saveError'));
      else setError(t('activity.receipt.saveError'));
    } catch {
      setError(t('activity.receipt.saveError'));
    } finally { setBusy(false); }
  };

  if (!open) return null;
  const money = (n, cur) => formatCurrency(Number(n) || 0, cur || 'USD');
  const top = candidates[0] || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground mb-3">{preselectedTransaction ? t('activity.receipt.attach') : t('activity.receipt.scan')}</h2>

        {!receipt && (
          <div className="space-y-2">
            <input ref={imgInput} type="file" accept="image/*" capture="environment" onChange={onImage} className="hidden" />
            <input ref={xmlInput} type="file" accept=".xml,text/xml,application/xml" onChange={onXml} className="hidden" />
            <button onClick={() => imgInput.current?.click()} disabled={busy} className="w-full py-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">
              {busy ? t('activity.receipt.extracting') : t('activity.receipt.takePhoto')}
            </button>
            <button onClick={() => xmlInput.current?.click()} disabled={busy} className="w-full py-3 rounded-lg border border-border text-sm font-semibold text-foreground disabled:opacity-50">
              {t('activity.receipt.uploadXml')}
            </button>
          </div>
        )}

        {receipt && (
          <div className="space-y-3">
            {isXml && <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">{t('activity.receipt.panamaInvoiceDetected')}</p>}
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1">
              <p><span className="text-muted-foreground">{t('activity.receipt.merchant')}: </span><span className="font-semibold">{receipt.merchantDisplayName || receipt.legalEntityName || '—'}</span></p>
              <p><span className="text-muted-foreground">{t('activity.receipt.date')}: </span>{receipt.transactionDate || '—'}</p>
              {receipt.subtotal != null && <p><span className="text-muted-foreground">{t('activity.receipt.subtotal')}: </span>{money(receipt.subtotal, receipt.currency)}</p>}
              {receipt.discountTotal != null && receipt.discountTotal > 0 && <p><span className="text-muted-foreground">{t('activity.receipt.discount')}: </span>-{money(receipt.discountTotal, receipt.currency)}</p>}
              {receipt.tax != null && <p><span className="text-muted-foreground">{t('activity.receipt.tax')}: </span>{money(receipt.tax, receipt.currency)}</p>}
              <p><span className="text-muted-foreground">{t('activity.receipt.total')}: </span><span className="font-bold">{money(receipt.total, receipt.currency)}</span></p>
              {receipt.lineItems?.length > 0 && <p className="text-xs text-muted-foreground">{t('activity.receipt.itemsCount', { count: receipt.lineItems.length })}</p>}
              {suggestion && <p className="text-xs text-muted-foreground">{t('activity.receipt.suggestedCategory')}: {suggestion.category} · {suggestion.bucket}</p>}
            </div>

            {top && (
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('activity.receipt.possibleMatch')}</p>
                <p className="mt-1">{(preselectedTransaction || {}).merchant || ''} · {Math.round(top.confidence * 100)}%</p>
                <button onClick={() => confirm(top.transactionId)} disabled={busy} className="mt-2 w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">
                  {t('activity.receipt.confirmMatch')}
                </button>
              </div>
            )}

            <button onClick={() => confirm(null)} disabled={busy} className="w-full py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground disabled:opacity-50">
              {t('activity.receipt.noMatch')}
            </button>

            {note && <p className="text-sm font-semibold text-emerald-700">{note}</p>}
          </div>
        )}

        {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button onClick={close} className="px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">{t('activity.receipt.close')}</button>
        </div>
      </div>
    </div>
  );
}
