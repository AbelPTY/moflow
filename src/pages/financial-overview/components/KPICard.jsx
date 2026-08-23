import React from 'react';
import Icon from '../../../components/AppIcon';

const KPICard = ({ title, value, change, changeType, icon, iconColor }) => {
  const isPositive = changeType === 'positive';
  const isNegative = changeType === 'negative';
  const isNeutral = changeType === 'neutral';

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 transition-smooth hover:shadow-elevation-3">
      <div className="flex items-start justify-between mb-3 md:mb-4">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-1 md:mb-2">{title}</p>
          <h3 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-foreground data-text">
            {value}
          </h3>
        </div>
        <div
          className="w-10 h-10 md:w-12 md:h-12 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${iconColor}15` }}
        >
          <Icon name={icon} size={20} color={iconColor} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!isNeutral && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${
            isPositive ? 'bg-success/10' : 'bg-error/10'
          }`}>
            <Icon
              name={isPositive ? 'TrendingUp' : 'TrendingDown'}
              size={14}
              color={isPositive ? 'var(--color-success)' : 'var(--color-error)'}
            />
            <span className={`text-xs font-medium ${
              isPositive ? 'text-success' : 'text-error'
            }`}>
              {change}
            </span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">vs last period</span>
      </div>
    </div>
  );
};

export default KPICard;