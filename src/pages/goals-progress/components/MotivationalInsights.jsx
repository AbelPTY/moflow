import React from 'react';
import Icon from '../../../components/AppIcon';

const MotivationalInsights = ({ insights }) => {
  const getInsightIcon = (type) => {
    switch (type) {
      case 'success': return 'TrendingUp';
      case 'warning': return 'AlertCircle';
      case 'tip': return 'Lightbulb';
      case 'celebration': return 'PartyPopper';
      default: return 'Info';
    }
  };

  const getInsightColor = (type) => {
    switch (type) {
      case 'success': return 'bg-success/10 text-success border-success/20';
      case 'warning': return 'bg-warning/10 text-warning border-warning/20';
      case 'tip': return 'bg-primary/10 text-primary border-primary/20';
      case 'celebration': return 'bg-accent/10 text-accent border-accent/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base md:text-lg font-semibold text-foreground">Insights & Tips</h3>
        <Icon name="Sparkles" size={18} className="text-primary" />
      </div>
      <div className="space-y-3">
        {insights?.map((insight, index) => (
          <div
            key={index}
            className={`p-3 rounded-lg border ${getInsightColor(insight?.type)} transition-smooth`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <Icon name={getInsightIcon(insight?.type)} size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold mb-1">{insight?.title}</h4>
                <p className="text-xs opacity-90 line-clamp-3">{insight?.message}</p>
                {insight?.action && (
                  <button className="text-xs font-medium mt-2 hover:underline">
                    {insight?.action}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {insights?.length === 0 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
            <Icon name="Lightbulb" size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No insights available</p>
          <p className="text-xs text-muted-foreground mt-1">Check back later for tips</p>
        </div>
      )}
    </div>
  );
};

export default MotivationalInsights;