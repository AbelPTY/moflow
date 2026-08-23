import React from 'react';
import Icon from '../../../components/AppIcon';

const AchievementBadges = ({ achievements }) => {
  const getBadgeColor = (type) => {
    switch (type) {
      case 'gold': return 'from-yellow-500 to-yellow-600';
      case 'silver': return 'from-gray-400 to-gray-500';
      case 'bronze': return 'from-orange-600 to-orange-700';
      default: return 'from-primary to-secondary';
    }
  };

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base md:text-lg font-semibold text-foreground">Achievements</h3>
        <div className="flex items-center gap-1 px-3 py-1 bg-accent/10 rounded-full">
          <Icon name="Award" size={14} className="text-accent" />
          <span className="text-xs font-medium text-accent">{achievements?.length}</span>
        </div>
      </div>
      <div className="space-y-3">
        {achievements?.map((achievement) => (
          <div
            key={achievement?.id}
            className="flex items-start gap-3 p-3 bg-background rounded-lg hover:bg-muted/50 transition-smooth"
          >
            <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${getBadgeColor(achievement?.type)} flex items-center justify-center flex-shrink-0 shadow-elevation-2`}>
              <Icon name={achievement?.icon} size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-foreground mb-1">{achievement?.title}</h4>
              <p className="text-xs text-muted-foreground line-clamp-2">{achievement?.description}</p>
              <div className="flex items-center gap-2 mt-2">
                <Icon name="Calendar" size={12} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {new Date(achievement.earnedDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {achievements?.length === 0 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
            <Icon name="Trophy" size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No achievements yet</p>
          <p className="text-xs text-muted-foreground mt-1">Keep working toward your goals!</p>
        </div>
      )}
    </div>
  );
};

export default AchievementBadges;