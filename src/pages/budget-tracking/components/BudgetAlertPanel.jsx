import React from 'react';
import Icon from '../../../components/AppIcon';

const BudgetAlertPanel = ({ alerts }) => {
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'border-error bg-error/5';
      case 'warning':
        return 'border-warning bg-warning/5';
      case 'info':
        return 'border-primary bg-primary/5';
      default:
        return 'border-border bg-card';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
        return 'XCircle';
      case 'warning':
        return 'AlertTriangle';
      case 'info':
        return 'Info';
      default:
        return 'Bell';
    }
  };

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h3 className="text-base md:text-lg font-semibold text-foreground">Budget Alerts</h3>
        <Icon name="Bell" size={20} className="text-muted-foreground" />
      </div>
      <div className="space-y-3 md:space-y-4">
        {alerts?.map((alert) => (
          <div
            key={alert?.id}
            className={`border-l-4 rounded-lg p-3 md:p-4 transition-smooth hover:shadow-elevation-1 ${getSeverityColor(alert?.severity)}`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg flex-shrink-0 ${alert?.severity === 'critical' ? 'bg-error/10' : alert?.severity === 'warning' ? 'bg-warning/10' : 'bg-primary/10'}`}>
                <Icon
                  name={getSeverityIcon(alert?.severity)}
                  size={16}
                  className={alert?.severity === 'critical' ? 'text-error' : alert?.severity === 'warning' ? 'text-warning' : 'text-primary'}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm md:text-base font-semibold text-foreground">
                  {alert?.title}
                </h4>
                <p className="text-xs md:text-sm text-muted-foreground mt-1 line-clamp-2">
                  {alert?.message}
                </p>
                {alert?.recommendation && (
                  <div className="mt-2 md:mt-3 p-2 md:p-3 bg-muted rounded-lg">
                    <p className="text-xs md:text-sm text-foreground">
                      <span className="font-medium">Recommendation:</span> {alert?.recommendation}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2 md:mt-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(alert.timestamp)?.toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </span>
                  {alert?.category && (
                    <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                      {alert?.category}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button className="w-full mt-4 md:mt-6 py-2 md:py-3 text-sm font-medium text-primary hover:bg-primary/5 rounded-lg transition-smooth">
        View All Alerts
      </button>
    </div>
  );
};

export default BudgetAlertPanel;