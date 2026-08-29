import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import CreditCardsPanel from '../../components/CreditCardsPanel';
import Icon from '../../components/AppIcon';
import useCreditCards from '../../hooks/useCreditCards';
import {
  nextDueDate,
  daysUntil,
  estimateMonthlyFinancingCost,
} from '../../lib/cardGuard';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Dedicated Cards tab: the credit-card financing guard, and the lowest-friction
// first-value experience for a new MoFlow user. Cards saved here also feed the
// Flow (Cash Flow) coverage timeline (each statement balance becomes an
// obligation on its due date).
const Cards = () => {
  const { cards, loading, saveCard, deleteCard, setPaid, feeSavingsTotals } = useCreditCards();

  const navigate = useNavigate();

  // Ref to trigger the panel's EXISTING statement scanner from the hero CTA,
  // rather than duplicating the scan pipeline.
  const panelRef = useRef(null);
  const scanStatement = () => panelRef.current?.openScanner();

  // Post-save bridge to Flow: shown after a card is saved so the user can take
  // the next value step ("Can you comfortably cover this?"). The user chooses
  // the CTA; navigation is never automatic.
  const [showFlowBridge, setShowFlowBridge] = useState(false);

  const hasCards = !loading && cards.length > 0;

  // The next actionable obligation: the soonest-due unpaid statement with a
  // balance. Uses the shared date utilities so nothing about card math changes.
  const nextObligation = useMemo(() => {
    const candidates = (cards || [])
      .filter(
        (c) => !c.statement_paid && (Number(c.statement_balance) || 0) > 0 && c.due_day
      )
      .map((c) => ({ card: c, due: nextDueDate(c.due_day) }))
      .filter((x) => x.due)
      .sort((a, b) => a.due - b.due);

    return candidates[0] || null;
  }, [cards]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />
      {/* Extra bottom padding so the mobile BottomNav never covers content. */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">

        {/* POST-SAVE BRIDGE TO FLOW */}
        {showFlowBridge && (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/70 dark:bg-blue-950/20 shadow-sm p-5 relative">
            <button
              onClick={() => setShowFlowBridge(false)}
              aria-label="Dismiss"
              className="absolute top-3 right-3 p-1 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" size={18} />
            </button>
            <div className="flex items-start gap-3 pr-6">
              <div className="bg-blue-600/10 p-2.5 rounded-xl shrink-0">
                <Icon name="Waves" size={22} className="text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="font-extrabold text-foreground">
                  Can you comfortably cover this statement?
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Tell MoFlow what cash you have available and when money comes in next.
                </p>
                <button
                  onClick={() => navigate('/cash-flow?setup=1')}
                  className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
                >
                  <Icon name="ArrowRight" size={18} />
                  Check my Flow
                </button>
              </div>
            </div>
          </div>
        )}

        {/* HERO */}
        {loading ? (
          <div className="mb-6 h-40 rounded-2xl border border-border bg-card animate-pulse" />
        ) : hasCards ? (
          <ExistingUserHero
            nextObligation={nextObligation}
            onScan={scanStatement}
          />
        ) : (
          <EmptyStateHero onScan={scanStatement} />
        )}

        {/* ESTIMATED FINANCING AVOIDED (historical, estimate) */}
        {hasCards && (
          <div className="mb-6 flex items-center justify-between gap-4 bg-gradient-to-r from-emerald-50 to-emerald-100/40 dark:from-emerald-950/20 dark:to-emerald-900/10 border border-emerald-200 rounded-xl p-5">
            <div>
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Estimated financing avoided</p>
              <p className="text-3xl font-extrabold text-emerald-700 mt-1">{money(feeSavingsTotals?.all)}</p>
              <p className="text-xs text-emerald-600 mt-1">
                {feeSavingsTotals?.count > 0
                  ? `${money(feeSavingsTotals?.thisYear)} this year · ${feeSavingsTotals?.count} statement${feeSavingsTotals?.count === 1 ? '' : 's'} marked paid in full`
                  : 'Mark a statement paid in full to start estimating.'}
              </p>
            </div>
            <div className="text-emerald-500 shrink-0">
              <Icon name="PiggyBank" size={40} />
            </div>
          </div>
        )}

        <CreditCardsPanel ref={panelRef} cards={cards} loading={loading} onSave={saveCard} onDelete={deleteCard} onSetPaid={setPaid} onSaved={() => setShowFlowBridge(true)} />

        {hasCards && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Estimated financing avoided is an educational estimate of the interest you likely avoided by paying each
            statement in full — calculated from each card&apos;s APR when known (about 24% assumed otherwise), credited when
            you mark a statement paid in full. It is an estimate, not an audited amount of money saved.
          </p>
        )}
      </div>
    </div>
  );
};

// Zero-card onboarding hero: scan CTA is the first, most prominent thing.
const EmptyStateHero = ({ onScan }) => (
  <div className="mb-6 rounded-2xl border border-border bg-card shadow-sm p-6 sm:p-8">
    <div className="flex items-start gap-3">
      <div className="bg-primary/10 p-3 rounded-xl shrink-0">
        <Icon name="ShieldCheck" size={28} className="text-primary" />
      </div>
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">
          Never miss another credit-card payment.
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Scan your statement and MoFlow will help you understand what is due, when it is due,
          and what carrying the balance could cost.
        </p>
      </div>
    </div>

    <button
      onClick={onScan}
      className="mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[52px] rounded-xl bg-blue-600 text-white text-base font-bold hover:bg-blue-700 transition-colors"
    >
      <Icon name="Camera" size={20} />
      Scan statement
    </button>

    <p className="text-xs text-muted-foreground mt-3">
      Review everything before it is saved.
    </p>
  </div>
);

// Existing-user hero: compact summary emphasizing the next actionable payment.
const ExistingUserHero = ({ nextObligation, onScan }) => {
  const card = nextObligation?.card;
  const due = nextObligation?.due;
  const dLeft = daysUntil(due);
  const bal = Number(card?.statement_balance) || 0;
  const min = Number(card?.minimum_payment) || 0;
  const apr = Number(card?.apr) || 0;
  const financingEstimate = estimateMonthlyFinancingCost(bal, apr);

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card shadow-sm p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            {nextObligation ? 'Next card payment' : 'Your cards'}
          </p>

          {nextObligation ? (
            <>
              <p className="text-lg font-bold text-foreground mt-1 truncate">
                {card.card_name}
              </p>
              <p className="text-3xl font-extrabold text-foreground mt-1">
                {money(bal)}
                <span className="text-sm font-semibold text-muted-foreground ml-2">
                  statement balance
                </span>
              </p>
              <p className="text-sm text-foreground mt-1">
                Due <span className="font-bold">{format(due, 'MMM d')}</span>
                {dLeft !== null && (
                  <span className="text-muted-foreground">
                    {' '}
                    ({dLeft === 0 ? 'today' : dLeft === 1 ? 'tomorrow' : `in ${dLeft} days`})
                  </span>
                )}
              </p>
              {min > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  Minimum due: <span className="font-semibold">{money(min)}</span>
                </p>
              )}
              {financingEstimate !== null && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                  Paying the full statement by the due date may avoid an estimated{' '}
                  <span className="font-semibold">{money(financingEstimate)}</span> in financing
                  over one month at {apr}% APR — subject to your card&apos;s terms.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">
              All statements are marked paid or have no balance due. Scan a new statement when it arrives.
            </p>
          )}
        </div>

        <button
          onClick={onScan}
          className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors"
        >
          <Icon name="Camera" size={18} />
          Scan statement
        </button>
      </div>
    </div>
  );
};

export default Cards;
