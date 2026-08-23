import React from 'react';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import CreditCardsPanel from '../../components/CreditCardsPanel';
import Icon from '../../components/AppIcon';
import useCreditCards from '../../hooks/useCreditCards';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Dedicated Cards tab: the credit-card financing guard. Cards saved here also
// feed the Cash Flow coverage timeline (each statement balance becomes an
// obligation on its due date).
const Cards = () => {
  const { cards, loading, saveCard, deleteCard, setPaid, feeSavingsTotals } = useCreditCards();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Cards</h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Track each card's statement so you pay in full by the due date — no late or financing fees.
            These balances also feed your Cash Flow coverage.
          </p>
        </div>

        {/* FEES AVOIDED */}
        <div className="mb-6 flex items-center justify-between gap-4 bg-gradient-to-r from-emerald-50 to-emerald-100/40 border border-emerald-200 rounded-xl p-5">
          <div>
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Financing fees avoided</p>
            <p className="text-3xl font-extrabold text-emerald-700 mt-1">{money(feeSavingsTotals?.all)}</p>
            <p className="text-xs text-emerald-600 mt-1">
              {feeSavingsTotals?.count > 0
                ? `${money(feeSavingsTotals?.thisYear)} this year · ${feeSavingsTotals?.count} statement${feeSavingsTotals?.count === 1 ? '' : 's'} paid in full`
                : 'Mark a statement paid in full to start counting.'}
            </p>
          </div>
          <div className="text-emerald-500 shrink-0">
            <Icon name="PiggyBank" size={40} />
          </div>
        </div>

        <CreditCardsPanel cards={cards} loading={loading} onSave={saveCard} onDelete={deleteCard} onSetPaid={setPaid} />

        <p className="text-[11px] text-muted-foreground mt-3">
          Fees-avoided is an estimate of interest you'd have paid carrying each balance (~24% APR), credited when you mark a statement paid in full.
        </p>
      </div>
    </div>
  );
};

export default Cards;
