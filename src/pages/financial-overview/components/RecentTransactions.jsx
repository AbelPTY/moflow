import React from 'react';
import { AlertCircle } from 'lucide-react';

const RecentTransactions = ({ transactions, onUpdate }) => {
  if (!transactions || transactions.length === 0) {
    return (
      <div className="bg-card rounded-xl shadow-sm border border-border p-8 text-center">
        <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-3">
          <AlertCircle className="text-muted-foreground" size={24} />
        </div>
        <h3 className="text-foreground font-medium">No transactions found</h3>
        <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters.</p>
      </div>
    );
  }

  // The real transaction categories in use (source of truth — see CLAUDE.md /
  // merchant_rules.json). Manual edits must pick from these so a transaction
  // can't be assigned a name no rule or budget recognizes.
  const CATEGORIES = [
    'Bank Adjustment', 'Cash Withdrawal', 'Credit Card Payment', 'Dining Out',
    'Education', 'Groceries', 'Household/Utilities', 'Income', 'Insurance',
    'Loan Payment', 'Medical/Health', 'Office/Social Events', 'Reimbursements',
    'Savings', 'Shopping', 'Sports', 'Subscriptions', 'Transfer',
    'Transportation', 'Work Expenses'
  ];

  const BUCKETS = ['NEEDS', 'WANTS', 'SAVINGS', 'DEBT_FUNDING', 'INCOME'];

  const handleCategoryChange = (id, newCategory) => {
    if (onUpdate) {
      onUpdate(id, { category: newCategory });
    }
  };

  const handleBucketChange = (id, newBucket) => {
    if (onUpdate) {
      onUpdate(id, { budget_bucket: newBucket });
    }
  };

  return (
    <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground font-semibold border-b border-border">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Merchant / Description</th>
              <th className="px-6 py-4">Category (Edit)</th>
              <th className="px-6 py-4">Bucket (Edit)</th>
              <th className="px-6 py-4 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {transactions.slice(0, 50).map((t) => (
              <tr key={t.id} className="hover:bg-muted transition-colors group">
                {/* DATE */}
                <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                  {t.dateString}
                </td>

                {/* MERCHANT */}
                <td className="px-6 py-4">
                  <div className="font-bold text-foreground">{t.merchant}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={t.description}>
                    {t.description}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t.account}</div>
                </td>

                {/* EDITABLE CATEGORY */}
                <td className="px-6 py-4">
                  <select
                    value={t.category}
                    onChange={(e) => handleCategoryChange(t.id, e.target.value)}
                    className="bg-card border border-border text-foreground text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2 font-medium shadow-sm hover:border-blue-300 cursor-pointer"
                  >
                    {/* Ensure current value is always an option even if weird */}
                    {!CATEGORIES.includes(t.category) && <option value={t.category}>{t.category}</option>}
                    {CATEGORIES.sort().map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </td>

                {/* EDITABLE BUCKET */}
                <td className="px-6 py-4">
                  <select
                    value={t.budgetBucket}
                    onChange={(e) => handleBucketChange(t.id, e.target.value)}
                    className={`border border-border text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2 font-bold shadow-sm cursor-pointer ${
                      t.budgetBucket === 'NEEDS' ? 'text-blue-700 bg-blue-50' :
                      t.budgetBucket === 'WANTS' ? 'text-orange-700 bg-orange-50' :
                      t.budgetBucket === 'SAVINGS' ? 'text-green-700 bg-green-50' :
                      'text-foreground bg-card'
                    }`}
                  >
                    {!BUCKETS.includes(t.budgetBucket) && <option value={t.budgetBucket}>{t.budgetBucket}</option>}
                    {BUCKETS.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </td>

                {/* AMOUNT */}
                <td className={`px-6 py-4 text-right font-bold ${
                  t.amount > 0 ? 'text-green-600' : 'text-foreground'
                }`}>
                  {t.amount > 0 ? '+' : ''}{t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {transactions.length > 50 && (
        <div className="p-4 text-center border-t border-border bg-muted text-muted-foreground text-xs">
          Showing first 50 of {transactions.length} transactions. Use filters to see more.
        </div>
      )}
    </div>
  );
};

export default RecentTransactions;