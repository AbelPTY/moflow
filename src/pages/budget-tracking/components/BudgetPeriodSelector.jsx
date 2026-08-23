import React from 'react';
import Icon from '../../../components/AppIcon';

const BudgetPeriodSelector = ({ selectedPeriod, onPeriodChange }) => {
  const periods = [
    { id: 'monthly', label: 'Monthly', icon: 'Calendar' },
    { id: 'quarterly', label: 'Quarterly', icon: 'CalendarRange' },
    { id: 'yearly', label: 'Yearly', icon: 'CalendarDays' }
  ];

  return (
    <div className="flex items-center gap-2 bg-card rounded-lg p-1 shadow-elevation-1">
      {periods?.map((period) => (
        <button
          key={period?.id}
          onClick={() => onPeriodChange(period?.id)}
          className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-250 ${
            selectedPeriod === period?.id
              ? 'bg-primary text-primary-foreground shadow-elevation-2'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Icon name={period?.icon} size={16} />
          <span className="text-sm font-medium">{period?.label}</span>
        </button>
      ))}
    </div>
  );
};

export default BudgetPeriodSelector;