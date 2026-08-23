import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const AlertsPanel = ({ alerts }) => {
  const [filter, setFilter] = useState('all');

  const getAlertIcon = (type) => {
    switch (type) {
      case 'overbudget':
        return { name: 'AlertTriangle', color: 'text-error' };
      case 'unusual':
        return { name: 'AlertCircle', color: 'text-warning' };
      case 'milestone':
        return { name: 'Trophy', color: 'text-success' };
      case 'recommendation':
        return { name: 'Lightbulb', color: 'text-primary' };
      default:
        return { name: 'Info', color: 'text-muted-foreground' };
    }
  };

  const getAlertBgColor = (type) => {
    switch (type) {
      case 'overbudget':
        return 'bg-error/10 border-error/20';
      case 'unusual':
        return 'bg-warning/10 border-warning/20';
      case 'milestone':
        return 'bg-success/10 border-success/20';
      case 'recommendation':
        return 'bg-primary/10 border-primary/20';
      default:
        return 'bg-muted border-border';
    }
  };

  const filteredAlerts = filter === 'all'
    ? alerts
    : alerts?.filter(alert => alert?.type === filter);

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-1">Alerts & Insights</h2>
          <p className="text-sm text-muted-foreground">Budget overruns, unusual patterns, and optimization recommendations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-smooth ${
              filter === 'all' ?'bg-primary text-primary-foreground' :'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('overbudget')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-smooth ${
              filter === 'overbudget' ?'bg-error text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <Icon name="AlertTriangle" size={14} className="inline mr-1" />
            Critical
          </button>
          <button
            onClick={() => setFilter('recommendation')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-smooth ${
              filter === 'recommendation' ?'bg-primary text-primary-foreground' :'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <Icon name="Lightbulb" size={14} className="inline mr-1" />
            Tips
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {filteredAlerts?.length === 0 ? (
          <div className="text-center py-12">
            <Icon name="CheckCircle" size={48} className="text-success mx-auto mb-4" />
            <p className="text-lg font-medium text-foreground mb-2">All Clear!</p>
            <p className="text-sm text-muted-foreground">No alerts or recommendations at this time</p>
          </div>
        ) : (
          filteredAlerts?.map((alert) => {
            const iconConfig = getAlertIcon(alert?.type);
            return (
              <div
                key={alert?.id}
                className={`border rounded-lg p-4 transition-smooth hover:shadow-elevation-2 ${getAlertBgColor(alert?.type)}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 ${iconConfig?.color}`}>
                    <Icon name={iconConfig?.name} size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="text-sm font-semibold text-foreground">{alert?.title}</h4>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{alert?.time}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">{alert?.description}</p>
                    {alert?.action && (
                      <button className="flex items-center gap-2 px-3 py-1.5 bg-card hover:bg-muted rounded-md text-xs font-medium text-foreground transition-smooth border border-border">
                        <Icon name={alert?.action?.icon} size={14} />
                        {alert?.action?.label}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {filteredAlerts?.length > 0 && (
        <div className="mt-6 flex items-center justify-between pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Showing {filteredAlerts?.length} {filter === 'all' ? 'total' : filter} alert{filteredAlerts?.length !== 1 ? 's' : ''}
          </p>
          <button className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg text-sm font-medium text-foreground transition-smooth">
            <Icon name="Settings" size={16} />
            Alert Settings
          </button>
        </div>
      )}
    </div>
  );
};

export default AlertsPanel;