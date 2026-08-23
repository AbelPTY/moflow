import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';


const GoalPredictionCard = ({ goal }) => {
  const [monthlyContribution, setMonthlyContribution] = useState(500);

  const calculateCompletion = (contribution) => {
    const remaining = goal?.targetAmount - goal?.currentAmount;
    const months = Math.ceil(remaining / contribution);
    const completionDate = new Date();
    completionDate?.setMonth(completionDate?.getMonth() + months);
    return { months, completionDate };
  };

  const scenarios = [
    { label: 'Conservative', amount: monthlyContribution * 0.5 },
    { label: 'Current Pace', amount: monthlyContribution },
    { label: 'Aggressive', amount: monthlyContribution * 1.5 }
  ];

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 border border-border">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h3 className="text-lg md:text-xl font-semibold text-foreground">Goal Prediction</h3>
          <p className="text-sm text-muted-foreground mt-1">{goal?.name}</p>
        </div>
        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon name="TrendingUp" size={24} className="text-primary" />
        </div>
      </div>
      <div className="mb-6">
        <label className="text-sm font-medium text-foreground mb-2 block">
          Monthly Contribution
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="100"
            max="2000"
            step="50"
            value={monthlyContribution}
            onChange={(e) => setMonthlyContribution(Number(e?.target?.value))}
            className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${((monthlyContribution - 100) / 1900) * 100}%, var(--color-muted) ${((monthlyContribution - 100) / 1900) * 100}%, var(--color-muted) 100%)`
            }}
          />
          <span className="text-lg font-semibold text-foreground data-text min-w-[80px] text-right">
            ${monthlyContribution}
          </span>
        </div>
      </div>
      <div className="space-y-3 mb-6">
        {scenarios?.map((scenario, index) => {
          const prediction = calculateCompletion(scenario?.amount);
          return (
            <div
              key={index}
              className="p-4 bg-background rounded-lg border border-border hover:border-primary/50 transition-smooth"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">{scenario?.label}</span>
                <span className="text-sm font-semibold text-primary data-text">
                  ${scenario?.amount?.toFixed(0)}/mo
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Icon name="Calendar" size={12} />
                  <span>{prediction?.months} months</span>
                </div>
                <span>
                  {prediction?.completionDate?.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
        <div className="flex items-start gap-3">
          <Icon name="Lightbulb" size={18} className="text-primary flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">Recommendation</h4>
            <p className="text-xs text-muted-foreground">
              Based on your current progress, increasing your monthly contribution to ${(monthlyContribution * 1.2)?.toFixed(0)} would help you reach your goal {Math.ceil((calculateCompletion(monthlyContribution)?.months - calculateCompletion(monthlyContribution * 1.2)?.months))} months earlier.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoalPredictionCard;