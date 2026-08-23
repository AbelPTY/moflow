import React from 'react';
import Icon from '../../../components/AppIcon';

import Button from '../../../components/ui/Button';

const GoalCard = ({ goal, onContribute, onEdit, onShare }) => {
  const progressPercentage = (goal?.currentAmount / goal?.targetAmount) * 100;
  const remainingAmount = goal?.targetAmount - goal?.currentAmount;
  const daysRemaining = Math.ceil((new Date(goal.targetDate) - new Date()) / (1000 * 60 * 60 * 24));

  const getStatusColor = () => {
    if (progressPercentage >= 100) return 'text-success';
    if (progressPercentage >= 75) return 'text-primary';
    if (progressPercentage >= 50) return 'text-secondary';
    return 'text-warning';
  };

  const getCategoryIcon = () => {
    switch (goal?.category) {
      case 'savings': return 'PiggyBank';
      case 'debt': return 'CreditCard';
      case 'investment': return 'TrendingUp';
      default: return 'Target';
    }
  };

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 hover:shadow-elevation-3 transition-smooth border border-border">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 md:w-14 md:h-14 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon name={getCategoryIcon()} size={24} className="text-primary" />
          </div>
          <div>
            <h3 className="text-base md:text-lg font-semibold text-foreground">{goal?.name}</h3>
            <p className="text-xs md:text-sm text-muted-foreground capitalize">{goal?.category} Goal</p>
          </div>
        </div>
        <button
          onClick={() => onEdit(goal)}
          className="p-2 hover:bg-muted rounded-lg transition-smooth"
          aria-label="Edit goal"
        >
          <Icon name="Settings" size={18} className="text-muted-foreground" />
        </button>
      </div>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Progress</span>
          <span className={`text-lg md:text-xl font-semibold data-text ${getStatusColor()}`}>
            {progressPercentage?.toFixed(1)}%
          </span>
        </div>
        <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500"
            style={{ width: `${Math.min(progressPercentage, 100)}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4">
        <div className="bg-background rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-1">Current</p>
          <p className="text-base md:text-lg font-semibold text-foreground data-text">
            ${goal?.currentAmount?.toLocaleString()}
          </p>
        </div>
        <div className="bg-background rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-1">Target</p>
          <p className="text-base md:text-lg font-semibold text-foreground data-text">
            ${goal?.targetAmount?.toLocaleString()}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between mb-4 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Icon name="Calendar" size={16} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {daysRemaining > 0 ? `${daysRemaining} days left` : 'Goal reached!'}
          </span>
        </div>
        <span className="text-sm font-medium text-foreground">
          {new Date(goal.targetDate)?.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
        </span>
      </div>
      {goal?.milestones && goal?.milestones?.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2">Milestones</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-2">
            {goal?.milestones?.map((milestone, index) => (
              <div
                key={index}
                className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium ${
                  goal?.currentAmount >= milestone?.amount
                    ? 'bg-success/10 text-success' :'bg-muted text-muted-foreground'
                }`}
              >
                {milestone?.amount >= 1000 ? `$${(milestone?.amount / 1000)?.toFixed(0)}K` : `$${milestone?.amount}`}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          fullWidth
          iconName="Plus"
          iconPosition="left"
          onClick={() => onContribute(goal)}
        >
          Add Contribution
        </Button>
        <Button
          variant="outline"
          size="sm"
          iconName="Share2"
          onClick={() => onShare(goal)}
          className="flex-shrink-0"
        />
      </div>
      {goal?.streak && goal?.streak > 0 && (
        <div className="mt-3 flex items-center justify-center gap-2 p-2 bg-accent/10 rounded-lg">
          <Icon name="Flame" size={16} className="text-accent" />
          <span className="text-sm font-medium text-accent">{goal?.streak} day streak!</span>
        </div>
      )}
    </div>
  );
};

export default GoalCard;