import React from 'react';
import Icon from '../../../components/AppIcon';

const UpcomingMilestones = ({ milestones }) => {
  const getProgressColor = (progress) => {
    if (progress >= 90) return 'text-success';
    if (progress >= 70) return 'text-primary';
    if (progress >= 50) return 'text-secondary';
    return 'text-warning';
  };

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base md:text-lg font-semibold text-foreground">Upcoming Milestones</h3>
        <Icon name="Flag" size={18} className="text-primary" />
      </div>
      <div className="space-y-3">
        {milestones?.map((milestone, index) => (
          <div
            key={index}
            className="p-3 bg-background rounded-lg border border-border hover:border-primary/50 transition-smooth"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-foreground mb-1">{milestone?.goalName}</h4>
                <p className="text-xs text-muted-foreground">{milestone?.description}</p>
              </div>
              <div className={`text-lg font-semibold data-text ${getProgressColor(milestone?.progress)}`}>
                {milestone?.progress}%
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Icon name="Target" size={12} />
                <span className="data-text">${milestone?.amount?.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Icon name="Calendar" size={12} />
                <span>{milestone?.daysLeft} days left</span>
              </div>
            </div>

            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
                style={{ width: `${milestone?.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {milestones?.length === 0 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
            <Icon name="Flag" size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No upcoming milestones</p>
          <p className="text-xs text-muted-foreground mt-1">Set goals to track milestones</p>
        </div>
      )}
    </div>
  );
};

export default UpcomingMilestones;