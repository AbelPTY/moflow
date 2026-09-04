import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import {
  loadUserRules, fetchRowsByIds, fetchUnresolvedRows, fetchEligibleForReprocess,
  applyCategorizationPlan, aiClassifyReviewRows,
} from '../lib/transactionRules';
import {
  SCOPE, FILTER_SCOPE, MODE,
  resolveScopeRows, previewCategorization, planEntryForAi,
} from '../lib/categorizationScope';

// Activity Categorization Scope & Safety V1 — the scope + preview + apply dialog
// that now gates BOTH "Categorize from Rules" (mode='rules', no AI) and
// "Magic Sweep" (mode='magic', full pipeline incl. AI for review rows). Nothing
// writes until the user clicks Apply. Fully bilingual via useI18n.
//
// Props:
//   open, onClose, onApplied()
//   mode          'rules' | 'magic'
//   selectedIds   Set of currently-selected transaction ids (in the table)
//   filteredIds   array of currently-filtered transaction ids (the visible view)
//   filtersActive boolean — are any search/filter controls active right now?
export default function CategorizationScopeDialog({
  open, onClose, onApplied, mode = MODE.RULES,
  selectedIds, filteredIds = [], filtersActive = false,
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState(SCOPE.UNRESOLVED);
  const [filterScope, setFilterScope] = useState(filtersActive ? FILTER_SCOPE.FILTERED : FILTER_SCOPE.ALL);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const selectedCount = selectedIds ? selectedIds.size : 0;

  // Reset to the safe default each time the dialog opens (never persist advanced).
  useEffect(() => {
    if (open) {
      setScope(SCOPE.UNRESOLVED);
      setFilterScope(filtersActive ? FILTER_SCOPE.FILTERED : FILTER_SCOPE.ALL);
      setPreview(null); setNote('');
    }
  }, [open, filtersActive]);

  // Any scope/filter change invalidates a stale preview.
  useEffect(() => { setPreview(null); }, [scope, filterScope]);

  const selectionEmpty = scope === SCOPE.SELECTED && selectedCount === 0;
  const isMagic = mode === MODE.MAGIC;

  const num = (key, count) => t(`activity.scope.${key}`, { count });

  const fetchScopeRows = async () => {
    if (scope === SCOPE.SELECTED) return fetchRowsByIds(null, Array.from(selectedIds || []));
    if (scope === SCOPE.ALL_ELIGIBLE) return fetchEligibleForReprocess(null);
    // Default unresolved scope.
    if (filterScope === FILTER_SCOPE.FILTERED) return fetchRowsByIds(null, filteredIds);
    return fetchUnresolvedRows(null);
  };

  const runPreview = async () => {
    if (selectionEmpty) return;
    setBusy(true); setNote(''); setPreview(null);
    try {
      const [rows, learnedRules] = await Promise.all([fetchScopeRows(), loadUserRules()]);
      const scoped = resolveScopeRows(rows, { scope, selectedIds });
      setPreview(previewCategorization({ rows: scoped, mode, learnedRules }));
    } catch {
      setNote(t('activity.scope.willRemain', { count: 0 }));
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!preview) return;
    setBusy(true); setNote('');
    try {
      let written = await applyCategorizationPlan(null, preview.plan);

      // Magic Sweep: only the still-review rows go to AI (deterministic/rule rows
      // were already handled). AI failure leaves those rows unresolved — safe.
      if (isMagic && preview.aiCandidates.length > 0) {
        const { byId } = await aiClassifyReviewRows(preview.aiCandidates);
        const aiEntries = [];
        for (const cand of preview.aiCandidates) {
          const cls = byId[String(cand.id)];
          if (cls) {
            const entry = planEntryForAi(cand._row, cls);
            if (entry) aiEntries.push(entry);
          }
        }
        if (aiEntries.length) written += await applyCategorizationPlan(null, aiEntries);
      }

      setNote(t('activity.scope.done', { count: written }));
      onApplied?.();
    } finally {
      setBusy(false);
    }
  };

  const radio = (value, label, sub, badge) => (
    <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${scope === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}>
      <input type="radio" name="cat-scope" checked={scope === value} onChange={() => setScope(value)} className="mt-1 accent-emerald-600" />
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{label}</span>
          {badge && <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 rounded px-1.5 py-0.5">{badge}</span>}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </label>
  );

  const previewBody = useMemo(() => {
    if (!preview) return null;
    const c = preview.counts;
    const b = preview.breakdown;
    return (
      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
        <p className="text-sm font-bold text-foreground">{num('inScope', preview.total)}</p>
        <div className="text-xs text-muted-foreground space-y-0.5">
          {b.both > 0 && <p>{num('missingBoth', b.both)}</p>}
          {b.categoryOnly > 0 && <p>{num('missingCategory', b.categoryOnly)}</p>}
          {b.bucketOnly > 0 && <p>{num('missingBucket', b.bucketOnly)}</p>}
        </div>
        <div className="pt-1.5 border-t border-border text-sm space-y-0.5">
          {isMagic ? (
            <>
              <p className="text-emerald-700 font-semibold">{num('autoCategorized', c.canCategorize)}</p>
              <p className="text-indigo-700 font-semibold">{num('aiSuggestions', c.aiSuggestions)}</p>
            </>
          ) : (
            <p className="text-emerald-700 font-semibold">{num('canCategorize', c.canCategorize)}</p>
          )}
          <p className="text-muted-foreground">{num('willRemain', c.stillUnresolved)}</p>
          {c.protected > 0 && <p className="text-[11px] text-muted-foreground italic">{num('protectedNote', c.protected)}</p>}
        </div>
      </div>
    );
  }, [preview, isMagic]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold text-foreground">{t('activity.scope.title')}</h2>
          <span className="text-xs font-bold text-muted-foreground">{isMagic ? t('activity.magicSweep') : t('activity.categorizeFromRules')}</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{isMagic ? t('activity.magicSweepDesc') : t('activity.rulesDesc')}</p>

        <div className="space-y-2">
          {radio(SCOPE.UNRESOLVED, t('activity.scope.unresolvedOnly'), null, t('activity.scope.recommended'))}

          {/* Filtered-view sub-scope: only meaningful for the unresolved scope. */}
          {scope === SCOPE.UNRESOLVED && (
            <div className="ml-7 flex flex-col gap-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('activity.scope.applyTo')}</p>
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input type="radio" name="cat-filterscope" checked={filterScope === FILTER_SCOPE.FILTERED} onChange={() => setFilterScope(FILTER_SCOPE.FILTERED)} className="accent-emerald-600" disabled={!filtersActive} />
                <span className={filtersActive ? '' : 'text-muted-foreground/50'}>{t('activity.scope.filteredView')}</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input type="radio" name="cat-filterscope" checked={filterScope === FILTER_SCOPE.ALL} onChange={() => setFilterScope(FILTER_SCOPE.ALL)} className="accent-emerald-600" />
                <span>{t('activity.scope.allUnresolved')}</span>
              </label>
            </div>
          )}

          {radio(SCOPE.SELECTED, t('activity.scope.selected'), t('activity.scope.selectedCount', { count: selectedCount }))}
          {radio(SCOPE.ALL_ELIGIBLE, t('activity.scope.allEligible'), null, t('activity.scope.advanced'))}

          {scope === SCOPE.ALL_ELIGIBLE && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('activity.scope.advancedWarning')}</p>
          )}
          {selectionEmpty && (
            <p className="text-[11px] font-semibold text-red-600">{t('activity.scope.selectAtLeastOne')}</p>
          )}
        </div>

        {previewBody}
        {note && <p className="mt-3 text-sm font-semibold text-emerald-700">{note}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50">
            {t('activity.scope.cancel')}
          </button>
          {!preview ? (
            <button onClick={runPreview} disabled={busy || selectionEmpty} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">
              {busy ? t('activity.scope.previewing') : t('activity.scope.preview')}
            </button>
          ) : (
            <button onClick={runApply} disabled={busy} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">
              {busy ? t('activity.scope.applying') : t('activity.scope.apply')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
