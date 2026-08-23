import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const ContributionHistory = ({ contributions }) => {
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterCategory, setFilterCategory] = useState('all');

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const filteredContributions = contributions?.filter(c => filterCategory === 'all' || c?.goalCategory === filterCategory)?.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date) - new Date(b.date);
          break;
        case 'amount':
          comparison = a?.amount - b?.amount;
          break;
        case 'goal':
          comparison = a?.goalName?.localeCompare(b?.goalName);
          break;
        default:
          comparison = 0;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const getTypeIcon = (type) => {
    switch (type) {
      case 'deposit': return 'ArrowDownCircle';
      case 'payment': return 'ArrowUpCircle';
      case 'transfer': return 'ArrowRightLeft';
      default: return 'Circle';
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'deposit': return 'text-success';
      case 'payment': return 'text-error';
      case 'transfer': return 'text-primary';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 border border-border">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 md:mb-6">
        <h3 className="text-lg md:text-xl font-semibold text-foreground">Contribution History</h3>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e?.target?.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">All Categories</option>
            <option value="savings">Savings</option>
            <option value="debt">Debt</option>
            <option value="investment">Investment</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-2 md:px-4">
                <button
                  onClick={() => handleSort('date')}
                  className="flex items-center gap-1 text-xs md:text-sm font-medium text-muted-foreground hover:text-foreground transition-smooth"
                >
                  Date
                  <Icon name={sortBy === 'date' ? (sortOrder === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'ChevronsUpDown'} size={14} />
                </button>
              </th>
              <th className="text-left py-3 px-2 md:px-4">
                <button
                  onClick={() => handleSort('goal')}
                  className="flex items-center gap-1 text-xs md:text-sm font-medium text-muted-foreground hover:text-foreground transition-smooth"
                >
                  Goal
                  <Icon name={sortBy === 'goal' ? (sortOrder === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'ChevronsUpDown'} size={14} />
                </button>
              </th>
              <th className="text-left py-3 px-2 md:px-4">
                <span className="text-xs md:text-sm font-medium text-muted-foreground">Type</span>
              </th>
              <th className="text-right py-3 px-2 md:px-4">
                <button
                  onClick={() => handleSort('amount')}
                  className="flex items-center gap-1 ml-auto text-xs md:text-sm font-medium text-muted-foreground hover:text-foreground transition-smooth"
                >
                  Amount
                  <Icon name={sortBy === 'amount' ? (sortOrder === 'asc' ? 'ChevronUp' : 'ChevronDown') : 'ChevronsUpDown'} size={14} />
                </button>
              </th>
              <th className="text-right py-3 px-2 md:px-4">
                <span className="text-xs md:text-sm font-medium text-muted-foreground">Progress</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredContributions?.map((contribution, index) => (
              <tr
                key={index}
                className="border-b border-border last:border-b-0 hover:bg-muted/50 transition-smooth"
              >
                <td className="py-3 px-2 md:px-4">
                  <div className="text-xs md:text-sm text-foreground">
                    {new Date(contribution.date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(contribution.date)?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </td>
                <td className="py-3 px-2 md:px-4">
                  <div className="text-xs md:text-sm font-medium text-foreground">{contribution?.goalName}</div>
                  <div className="text-xs text-muted-foreground capitalize mt-0.5">{contribution?.goalCategory}</div>
                </td>
                <td className="py-3 px-2 md:px-4">
                  <div className="flex items-center gap-2">
                    <Icon name={getTypeIcon(contribution?.type)} size={16} className={getTypeColor(contribution?.type)} />
                    <span className="text-xs md:text-sm text-foreground capitalize">{contribution?.type}</span>
                  </div>
                </td>
                <td className="py-3 px-2 md:px-4 text-right">
                  <span className={`text-sm md:text-base font-semibold data-text ${getTypeColor(contribution?.type)}`}>
                    {contribution?.type === 'payment' ? '-' : '+'}${contribution?.amount?.toLocaleString()}
                  </span>
                </td>
                <td className="py-3 px-2 md:px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden md:block">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${contribution?.progressImpact}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">+{contribution?.progressImpact}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredContributions?.length === 0 && (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
            <Icon name="History" size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No contributions found</p>
          <p className="text-xs text-muted-foreground mt-1">Start contributing to your goals</p>
        </div>
      )}
    </div>
  );
};

export default ContributionHistory;