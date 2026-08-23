import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';

const TopMerchantsTable = ({ merchants }) => {
  const [sortBy, setSortBy] = useState('amount');
  const [sortOrder, setSortOrder] = useState('desc');

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const sortedMerchants = [...merchants]?.sort((a, b) => {
    const multiplier = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'amount') {
      return (a?.totalSpent - b?.totalSpent) * multiplier;
    } else if (sortBy === 'frequency') {
      return (a?.transactions - b?.transactions) * multiplier;
    } else if (sortBy === 'average') {
      return (a?.avgTransaction - b?.avgTransaction) * multiplier;
    }
    return 0;
  });

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <Icon name="ChevronsUpDown" size={14} className="text-muted-foreground" />;
    return sortOrder === 'asc'
      ? <Icon name="ChevronUp" size={14} className="text-primary" />
      : <Icon name="ChevronDown" size={14} className="text-primary" />;
  };

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-1">Top Merchants</h2>
          <p className="text-sm text-muted-foreground">Your most frequent spending destinations</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
          <Icon name="TrendingUp" size={16} className="text-success" />
          <span className="text-sm font-medium text-foreground">Last 30 Days</span>
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-2 text-xs font-semibold text-muted-foreground uppercase">
                Merchant
              </th>
              <th
                className="text-right py-3 px-2 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:text-foreground transition-smooth"
                onClick={() => handleSort('amount')}
              >
                <div className="flex items-center justify-end gap-1">
                  Total Spent
                  <SortIcon field="amount" />
                </div>
              </th>
              <th
                className="text-right py-3 px-2 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:text-foreground transition-smooth"
                onClick={() => handleSort('frequency')}
              >
                <div className="flex items-center justify-end gap-1">
                  Transactions
                  <SortIcon field="frequency" />
                </div>
              </th>
              <th
                className="text-right py-3 px-2 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:text-foreground transition-smooth"
                onClick={() => handleSort('average')}
              >
                <div className="flex items-center justify-end gap-1">
                  Avg Amount
                  <SortIcon field="average" />
                </div>
              </th>
              <th className="text-right py-3 px-2 text-xs font-semibold text-muted-foreground uppercase">
                Category
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedMerchants?.map((merchant, index) => (
              <tr
                key={merchant?.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/50 transition-smooth"
              >
                <td className="py-4 px-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                      <Image
                        src={merchant?.logo}
                        alt={merchant?.logoAlt}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{merchant?.name}</p>
                      <p className="text-xs text-muted-foreground">Last: {merchant?.lastTransaction}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-2 text-right">
                  <p className="text-sm font-semibold text-foreground data-text">${merchant?.totalSpent?.toLocaleString()}</p>
                </td>
                <td className="py-4 px-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-sm font-medium text-foreground data-text">{merchant?.transactions}</span>
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${(merchant?.transactions / 50) * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
                <td className="py-4 px-2 text-right">
                  <p className="text-sm font-medium text-foreground data-text">${merchant?.avgTransaction?.toFixed(2)}</p>
                </td>
                <td className="py-4 px-2 text-right">
                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-muted text-foreground">
                    {merchant?.category}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border">
        <p className="text-sm text-muted-foreground">
          Showing top {sortedMerchants?.length} merchants by spending
        </p>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-smooth">
          <Icon name="Download" size={16} />
          Export Report
        </button>
      </div>
    </div>
  );
};

export default TopMerchantsTable;