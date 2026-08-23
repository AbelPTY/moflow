import React from 'react';
import Icon from '../../../components/AppIcon';

const BudgetMetricCard = ({ title, value, subtitle, percentage, status, icon }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return 'text-success';
      case 'warning':
        return 'text-warning';
      case 'error':
        return 'text-error';
      default:
        return 'text-foreground';
    }
  };

  const getProgressColor = () => {
    switch (status) {
      case 'success':
        return 'bg-success';
      case 'warning':
        return 'bg-warning';
      case 'error':
        return 'bg-error';
      default:
        return 'bg-primary';
    }
  };

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2 transition-smooth hover:shadow-elevation-3">
      <div className="flex items-start justify-between mb-3 md:mb-4">
        <div className="flex-1">
          <p className="text-xs md:text-sm text-muted-foreground mb-1 md:mb-2">{title}</p>
          <h3 className={`text-xl md:text-2xl lg:text-3xl font-semibold ${getStatusColor()}`}>
            {value}
          </h3>
          {subtitle && (
            <p className="text-xs md:text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={`p-2 md:p-3 rounded-lg ${status === 'success' ? 'bg-success/10' : status === 'warning' ? 'bg-warning/10' : status === 'error' ? 'bg-error/10' : 'bg-primary/10'}`}>
            <Icon name={icon} size={20} className={getStatusColor()} />
          </div>
        )}
      </div>
      {percentage !== undefined && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs md:text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className={`font-medium ${getStatusColor()}`}>{percentage}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${getProgressColor()}`}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetMetricCard;