import React, { useEffect, useMemo, useState } from 'react';
import Icon from './AppIcon';
import { useI18n } from '../i18n';
import { trackProductEvent } from '../lib/analytics';
import {
  fetchReviewCount, fetchNeedsReview, saveUserClassification,
  rememberLearnedRule, applyToSimilar, fetchImproveCandidates, applyBackfill,
  loadUserRules, previewBackfill,
  selectAiReviewCandidates, aiClassifyReviewRows, aiMetadataFor,
} from '../lib/transactionRules';
import { normalizeMerchant, classificationState, THRESHOLD, reasonKeyForClassification } from '../lib/transactionIntelligence';

// Transaction Intelligence V1 — Activity review surface. NOT a primary nav item;
// it renders as a "Needs review · N" control in the Activity toolbar plus an
// "Improve categorization" entry, and opens an in-place review panel. Fully
// bilingual via useI18n. All writes go through the RLS-scoped helpers.
//
// Props: onChanged() — called after any write so the parent can refetch.
export default function TransactionReview({ onChanged }) {
  const { t, formatCurrency, formatDate } = useI18n();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null); // { id, category, bucket }
  const [improve, setImprove] = useState(null); // { counts, plan } preview

  const refreshCount = async () => setCount(await fetchReviewCount());
  useEffect(() => { refreshCount(); }, []);

  const confidenceLabel = (c) => {
    const s = classificationState(Number(c) || 0);
    return s === 'auto' ? t('txIntel.highConfidence') : s === 'suggested' ? t('txIntel.suggested') : t('txIntel.needsReview');
  };

  // Plain-language reason derived from the PERSISTED classification (source +
  // nature) — never re-classified, so it can never contradict the stored
  // category/bucket even if rules changed after the row was classified.
  const reasonFor = (row) => t(`txIntel.reasons.${reasonKeyForClassification(row.classification_source, row.transaction_nature)}`);

  const openInbox = async () => {
    setOpen(true); setNote(''); setImprove(null);
    trackProductEvent('categorization_review_opened', { source_screen: 'activity' });
    setBusy(true);
    try {
      const [r, ur] = await Promise.all([fetchNeedsReview(), loadUserRules()]);
      setRules(ur); setRows(r);
    } finally { setBusy(false); }
  };

  const removeRow = (id) => setRows((rs) => (rs || []).filter((x) => x.id !== id));

  const accept = async (row) => {
    setBusy(true);
    try {
      await saveUserClassification(null, row.id, { category: row.category, bucket: row.budget_bucket });
      trackProductEvent('transaction_suggestion_accepted', { source_screen: 'activity' });
      removeRow(row.id); await refreshCount(); onChanged?.();
    } finally { setBusy(false); }
  };

  const skip = (row) => removeRow(row.id); // session-only; needs_review stays true

  const saveChange = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await saveUserClassification(null, editing.id, { category: editing.category, bucket: editing.bucket });
      trackProductEvent('transaction_suggestion_changed', { source_screen: 'activity' });
      const row = (rows || []).find((x) => x.id === editing.id);
      setEditing(null); removeRow(editing.id); await refreshCount(); onChanged?.();
      // Offer learn / apply-to-similar on the just-changed row.
      if (row) setNote('changed:' + JSON.stringify({ m: normalizeMerchant(row.merchant || row.description), c: editing.category, b: editing.bucket }));
    } finally { setBusy(false); }
  };

  const changed = note.startsWith('changed:') ? JSON.parse(note.slice(8)) : null;

  const remember = async () => {
    if (!changed) return;
    setBusy(true);
    try {
      await rememberLearnedRule(null, { normalizedMerchant: changed.m, category: changed.c, bucket: changed.b });
      trackProductEvent('transaction_rule_created', { source_screen: 'activity' });
      setNote(t('txIntel.ruleRemembered'));
    } finally { setBusy(false); }
  };

  const applySimilar = async () => {
    if (!changed) return;
    setBusy(true);
    try {
      const { count: n } = await applyToSimilar(null, { normalizedMerchant: changed.m, category: changed.c, bucket: changed.b });
      trackProductEvent('transaction_bulk_reclassified', { source_screen: 'activity' });
      setNote(t('txIntel.appliedToSimilar', { count: n }));
      await refreshCount(); onChanged?.();
    } finally { setBusy(false); }
  };

  const acceptAllHigh = async () => {
    const eligible = (rows || []).filter((r) => Number(r.classification_confidence) >= THRESHOLD.SUGGESTED && !isDefault(r));
    if (eligible.length === 0) return;
    setBusy(true);
    try {
      for (const r of eligible) await saveUserClassification(null, r.id, { category: r.category, bucket: r.budget_bucket });
      trackProductEvent('transaction_suggestion_accepted', { source_screen: 'activity' });
      setRows((rs) => (rs || []).filter((r) => !eligible.includes(r)));
      await refreshCount(); onChanged?.();
    } finally { setBusy(false); }
  };

  const runImprovePreview = async () => {
    setBusy(true); setNote(''); setImprove(null);
    try {
      const [cands, ur] = await Promise.all([fetchImproveCandidates(), loadUserRules()]);
      setRules(ur);
      const preview = previewBackfill(cands, ur);

      // V1.2 AI fallback: for rows the deterministic engine STILL leaves in
      // review, ask the AI as a last resort — during PREVIEW only (no writes
      // happen until the user confirms). Successful AI rows become SUGGESTED
      // (source='ai', needs_review=true), never auto. Any AI failure leaves them
      // exactly as review candidates, so Improve still works fully offline.
      if (preview.plan.review.length > 0) {
        const candidates = selectAiReviewCandidates(cands, ur);
        const byNorm = new Map(candidates.map((c) => [String(c.id), c.normalizedMerchant]));
        const { byId, aiCount } = await aiClassifyReviewRows(candidates);
        if (aiCount > 0) {
          const stillReview = [];
          for (const entry of preview.plan.review) {
            const cls = byId[String(entry.id)];
            if (cls) {
              preview.plan.suggested.push({
                id: entry.id,
                metadata: aiMetadataFor(cls, byNorm.get(String(entry.id))),
              });
            } else {
              stillReview.push(entry);
            }
          }
          preview.plan.review = stillReview;
          preview.counts.suggested = preview.plan.suggested.length;
          preview.counts.review = preview.plan.review.length;
        }
      }

      setImprove(preview);
    } finally { setBusy(false); }
  };

  const confirmImprove = async () => {
    if (!improve) return;
    setBusy(true);
    try {
      await applyBackfill(null, improve.plan);
      trackProductEvent('transaction_bulk_reclassified', { source_screen: 'activity' });
      setNote(t('txIntel.backfillDone', { auto: improve.counts.auto, review: improve.counts.review + improve.counts.suggested }));
      setImprove(null); await refreshCount(); onChanged?.();
    } finally { setBusy(false); }
  };

  const highCount = useMemo(
    () => (rows || []).filter((r) => Number(r.classification_confidence) >= THRESHOLD.SUGGESTED && !isDefault(r)).length,
    [rows]
  );

  const btn = 'px-3 py-2 min-h-[40px] rounded-lg text-sm font-semibold';

  return (
    <div className="inline-flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button onClick={openInbox} className={`${btn} border border-border text-foreground hover:bg-muted inline-flex items-center gap-2`}>
          <Icon name="ListChecks" size={16} />
          {t('txIntel.needsReview')}{count > 0 ? ` · ${count}` : ''}
        </button>
        <button onClick={() => { setOpen(true); runImprovePreview(); }} className={`${btn} text-primary hover:opacity-80`}>
          {t('txIntel.improveCategorization')}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-card text-card-foreground rounded-2xl border border-border shadow-xl w-full max-w-2xl mt-10 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">{improve ? t('txIntel.improveCategorization') : t('txIntel.reviewTitle')}</h2>
              <button onClick={() => setOpen(false)} aria-label={t('txIntel.close')} className="p-1 text-muted-foreground hover:text-foreground"><Icon name="X" size={18} /></button>
            </div>

            {/* IMPROVE CATEGORIZATION PREVIEW */}
            {improve && (
              <div className="mb-4 rounded-xl border border-border bg-background p-4">
                <p className="text-sm">{t('txIntel.canAutoCategorize', { count: improve.counts.auto })}</p>
                <p className="text-sm">{t('txIntel.needReview', { count: improve.counts.review + improve.counts.suggested })}</p>
                <p className="text-sm text-muted-foreground">{t('txIntel.alreadyCategorized', { count: improve.counts.alreadyResolved + improve.counts.protected })}</p>
                <p className="text-xs text-muted-foreground mt-2">{t('txIntel.confirmImprove')}</p>
                {(improve.counts.auto + improve.counts.suggested + improve.counts.review) === 0 ? (
                  <p className="text-sm mt-2">{t('txIntel.improveNoCandidates')}</p>
                ) : (
                  <button onClick={confirmImprove} disabled={busy} className={`${btn} bg-primary text-primary-foreground mt-3 disabled:opacity-50`}>
                    {busy ? t('txIntel.improving') : t('txIntel.runBackfill')}
                  </button>
                )}
              </div>
            )}

            {note && <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-400">{note.startsWith('changed:') ? '' : note}</p>}

            {/* POST-CHANGE ACTIONS */}
            {changed && (
              <div className="mb-4 rounded-xl border border-border bg-background p-3 flex flex-wrap gap-2">
                <button onClick={remember} disabled={busy} className={`${btn} border border-border hover:bg-muted`}>{t('txIntel.rememberForFuture')}</button>
                <button onClick={applySimilar} disabled={busy} className={`${btn} border border-border hover:bg-muted`}>{t('txIntel.applyToMatching')}</button>
              </div>
            )}

            {/* REVIEW LIST */}
            {!improve && (
              <>
                {highCount > 0 && (
                  <button onClick={acceptAllHigh} disabled={busy} className={`${btn} bg-primary text-primary-foreground mb-3 disabled:opacity-50`}>
                    {t('txIntel.acceptAllHigh')} ({highCount})
                  </button>
                )}
                {busy && !rows && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
                {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">{t('txIntel.nothingToReview')}</p>}
                <div className="space-y-2">
                  {(rows || []).map((row) => (
                    <div key={row.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">{normalizeMerchant(row.merchant || row.description) || row.description}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(row.date)} · {row.account_name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{reasonFor(row)} · {confidenceLabel(row.classification_confidence)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold">{formatCurrency(row.amount)}</p>
                          <p className="text-xs text-muted-foreground">{row.category} · {row.budget_bucket}</p>
                        </div>
                      </div>

                      {editing && editing.id === row.id ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input value={editing.category} onChange={(e) => setEditing((s) => ({ ...s, category: e.target.value }))} placeholder={t('txIntel.category')} className="border border-border rounded-md p-2 text-sm bg-background flex-1 min-w-[120px]" />
                          <input value={editing.bucket} onChange={(e) => setEditing((s) => ({ ...s, bucket: e.target.value }))} placeholder={t('txIntel.bucket')} className="border border-border rounded-md p-2 text-sm bg-background w-32" />
                          <button onClick={saveChange} disabled={busy} className={`${btn} bg-primary text-primary-foreground disabled:opacity-50`}>{t('txIntel.save')}</button>
                          <button onClick={() => setEditing(null)} className={`${btn} text-muted-foreground hover:bg-muted`}>{t('common.cancel')}</button>
                        </div>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => accept(row)} disabled={busy} className={`${btn} bg-primary text-primary-foreground disabled:opacity-50`}>{t('txIntel.accept')}</button>
                          <button onClick={() => setEditing({ id: row.id, category: row.category === 'Uncategorized' ? '' : row.category, bucket: row.budget_bucket === 'Unsorted' ? '' : row.budget_bucket })} className={`${btn} border border-border hover:bg-muted`}>{t('txIntel.change')}</button>
                          <button onClick={() => skip(row)} className={`${btn} text-muted-foreground hover:bg-muted`}>{t('txIntel.skip')}</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isDefault(r) {
  const c = String(r.category ?? '').trim().toLowerCase();
  const b = String(r.budget_bucket ?? '').trim().toLowerCase();
  return c === '' || c === 'uncategorized' || b === '' || b === 'unsorted';
}
