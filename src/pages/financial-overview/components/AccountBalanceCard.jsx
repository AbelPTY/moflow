import React from 'react';
import Icon from '../../../components/AppIcon';

const AccountBalanceCard = ({ accounts }) => {
  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h2 className="text-lg md:text-xl font-semibold text-foreground">Account Balances</h2>
        <button className="text-sm text-primary font-medium hover:underline transition-smooth">
          View All
        </button>
      </div>
      <div className="space-y-3 md:space-y-4">
        {accounts?.map((account) => (
          <div
            key={account?.id}
            className="flex items-center justify-between p-3 md:p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth cursor-pointer"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${account?.color}15` }}
              >
                <Icon name={account?.icon} size={20} color={account?.color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm md:text-base font-medium text-foreground truncate">
                  {account?.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">{account?.type}</p>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-2">
              <p className="text-sm md:text-base font-semibold text-foreground data-text whitespace-nowrap">
                ${account?.balance?.toLocaleString()}
              </p>
              <p className={`text-xs ${
                account?.change?.startsWith('+') ? 'text-success' : 'text-error'
              }`}>
                {account?.change}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 md:mt-6 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total Balance</span>
          <span className="text-lg md:text-xl font-semibold text-foreground data-text">
            ${accounts?.reduce((sum, acc) => sum + acc?.balance, 0)?.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="mt-4 md:mt-6 grid grid-cols-2 gap-2 md:gap-3">
        <button className="px-4 py-2 md:py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-smooth hover:opacity-90 flex items-center justify-center gap-2">
          <Icon name="Plus" size={16} />
          <span>Add Account</span>
        </button>
        <button className="px-4 py-2 md:py-2.5 bg-muted text-foreground rounded-lg text-sm font-medium transition-smooth hover:bg-muted/80 flex items-center justify-center gap-2">
          <Icon name="RefreshCw" size={16} />
          <span>Sync</span>
        </button>
      </div>
    </div>
  );
};

export default AccountBalanceCard;