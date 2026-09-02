import React, { useMemo } from 'react';
import { format } from 'date-fns';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import UpcomingPaymentsCalendar from '../../components/UpcomingPaymentsCalendar';
import useCreditCards from '../../hooks/useCreditCards';
import { nextDueDate } from '../../lib/cardGuard';
import { useI18n } from '../../i18n';

// Bills tab: a single home for what is due, what recurs, and what is coming
// next. It reuses the same UpcomingPaymentsCalendar as Cash Flow. Card
// statement due dates are surfaced here as read-only "extra" events so the
// calendar shows a complete picture without duplicating card logic.
//
// This mirrors the small cardCalendarEvents block already used by Cash Flow.
// Deeper consolidation of card obligations (e.g. minimum-vs-statement,
// financing warnings) lives on the Cards tab and remains a follow-up.
const Bills = () => {
  const { cards } = useCreditCards();
  const { t } = useI18n();

  const cardCalendarEvents = useMemo(
    () =>
      (cards || [])
        .filter(
          (card) => (Number(card.statement_balance) || 0) > 0 && card.due_day
        )
        .map((card) => {
          const due = nextDueDate(card.due_day);
          if (!due) return null;

          return {
            id: `card-${card.id}`,
            entity: `${card.card_name} ${t('bills.statementSuffix')}`,
            amount: Number(card.statement_balance) || 0,
            payment_date: format(due, 'yyyy-MM-dd'),
            status: card.statement_paid ? 'paid' : 'pending',
            readOnly: true,
          };
        })
        .filter(Boolean),
    [cards]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">{t('bills.title')}</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            {t('bills.subtitle')}
          </p>
        </div>

        <UpcomingPaymentsCalendar extraEvents={cardCalendarEvents} />
      </div>
    </div>
  );
};

export default Bills;
