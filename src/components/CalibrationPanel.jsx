import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { loadUserRules, fetchCalibrationSample } from '../lib/transactionRules';
import { runCalibration, CALIBRATION_SAMPLE_SIZES } from '../lib/calibration';

// Transaction Intelligence Calibration V1 — a READ-ONLY diagnostic modal on a
// HIDDEN DIAGNOSTIC SURFACE (revealed only by ?calibrate=1; there is NO separate
// authorization/admin check — RLS remains the only data boundary). It evaluates a
// bounded historical sample against the current engine and shows an aggregate
// quality report. It never writes, never calls AI, and never renders
// account/balance/reference/amount data. Not a normal consumer feature.
//
// Props: open, onClose, selectedIds (Set)
export default function CalibrationPanel({ open, onClose, selectedIds }) {
  const { t } = useI18n();
  const [size, setSize] = useState(250);
  const [scope, setScope] = useState('latest');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);

  const selectedCount = selectedIds ? selectedIds.size : 0;

  const run = async () => {
    setBusy(true); setReport(null);
    try {
      const [rows, learnedRules] = await Promise.all([
        fetchCalibrationSample(null, { size, scope, selectedIds }),
        loadUserRules(),
      ]);
      setReport(runCalibration(rows, learnedRules));
    } finally {
      setBusy(false);
    }
  };

  // Format a rate/accuracy that may be null (zero denominator) as N/A, and show
  // the explicit numerator/denominator for accuracy so nothing is hidden.
  const pctStr = (pct) => (pct == null ? t('calibration.na') : `${pct}%`);
  const accStr = (acc) => (acc.pct == null ? t('calibration.na') : `${acc.pct}% (${acc.correct}/${acc.denominator})`);

  if (!open) return null;

  const Line = ({ children }) => <p className="text-sm text-foreground">{children}</p>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card border border-border shadow-xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-foreground">{t('calibration.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1 mb-3">{t('calibration.readOnlyNote')}</p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={scope} onChange={(e) => { setScope(e.target.value); setReport(null); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="latest">{t('calibration.scopeLatest', { count: size })}</option>
            <option value="unresolved">{t('calibration.scopeUnresolved')}</option>
            <option value="selected">{t('calibration.scopeSelected', { count: selectedCount })}</option>
          </select>
          {scope !== 'selected' && (
            <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setReport(null); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              {CALIBRATION_SAMPLE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button onClick={run} disabled={busy || (scope === 'selected' && selectedCount === 0)} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">
            {busy ? t('calibration.running') : t('calibration.run')}
          </button>
        </div>

        {report && (
          report.sampleSize === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t('calibration.noData')}</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                <p className="text-sm font-bold text-foreground">{t('calibration.transactions', { count: report.sampleSize })}</p>
                <Line>{t('calibration.resolvedByRules', { pct: pctStr(report.operational.rates.resolved) })}</Line>
                <Line>{t('calibration.aiSuggestions', { pct: pctStr(report.operational.rates.aiCandidate) })}</Line>
                <Line>{t('calibration.stillUnresolved', { pct: pctStr(report.operational.rates.unresolved) })}</Line>
                <p className="text-xs text-muted-foreground">{t('calibration.protectedExcluded', { count: report.operational.protected })}</p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                <p className="text-sm font-bold text-foreground">{t('calibration.trustedSample', { count: report.benchmark.groundTruthCount })}</p>
                <p className="text-xs text-muted-foreground">{t('calibration.predictionsAvailable', { count: report.benchmark.predictedCount })}</p>
                <Line>{t('calibration.categoryAccuracy', { value: accStr(report.benchmark.categoryAccuracy) })}</Line>
                <Line>{t('calibration.bucketAccuracy', { value: accStr(report.benchmark.bucketAccuracy) })}</Line>
                <Line>{t('calibration.fullAccuracy', { value: accStr(report.benchmark.fullPairAccuracy) })}</Line>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{t('calibration.sourceHitRates')}</p>
                <div className="text-sm text-foreground space-y-0.5">
                  {Object.entries(report.sourceHitRates).map(([src, n]) => (
                    <p key={src}><span className="font-mono">{n}</span> · {src}</p>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{t('calibration.errorBuckets')}</p>
                <div className="text-sm text-foreground space-y-0.5">
                  {Object.entries(report.errorBuckets).filter(([, n]) => n > 0).map(([b, n]) => (
                    <p key={b}><span className="font-mono">{n}</span> · {b}</p>
                  ))}
                </div>
              </div>

              {report.topMissMerchants.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{t('calibration.topMisses')}</p>
                  <div className="text-sm text-foreground space-y-0.5">
                    {report.topMissMerchants.map((m) => (
                      <p key={m.merchant}>{m.merchant} — {t('calibration.occurrences', { count: m.count })}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">{t('calibration.close')}</button>
        </div>
      </div>
    </div>
  );
}
