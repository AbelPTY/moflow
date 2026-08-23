import React from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';

const GoalTimelineChart = ({ goals, selectedGoalId }) => {
  const selectedGoal = goals?.find(g => g?.id === selectedGoalId) || goals?.[0];

  const generateTimelineData = (goal) => {
    const data = [];
    const startDate = new Date(goal.startDate);
    const endDate = new Date(goal.targetDate);
    const today = new Date();
    const monthsDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 30));

    for (let i = 0; i <= monthsDiff; i++) {
      const currentDate = new Date(startDate);
      currentDate?.setMonth(startDate?.getMonth() + i);

      const monthLabel = currentDate?.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const projectedAmount = (goal?.targetAmount / monthsDiff) * i;

      let actualAmount = null;
      if (currentDate <= today) {
        const progressRatio = i / monthsDiff;
        const variance = (Math.random() - 0.5) * 0.1;
        actualAmount = (goal?.currentAmount / (today - startDate)) * (currentDate - startDate) * (1 + variance);
        actualAmount = Math.min(actualAmount, goal?.currentAmount);
      }

      data?.push({
        month: monthLabel,
        projected: Math.round(projectedAmount),
        actual: actualAmount ? Math.round(actualAmount) : null,
        target: goal?.targetAmount
      });
    }

    return data;
  };

  const timelineData = generateTimelineData(selectedGoal);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload?.length) {
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-elevation-3">
          <p className="text-sm font-medium text-foreground mb-2">{label}</p>
          {payload?.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-4 text-xs">
              <span className="text-muted-foreground capitalize">{entry?.name}:</span>
              <span className="font-semibold data-text" style={{ color: entry?.color }}>
                ${entry?.value?.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 border border-border">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h3 className="text-lg md:text-xl font-semibold text-foreground">Goal Progress Timeline</h3>
          <p className="text-sm text-muted-foreground mt-1">Actual vs Projected Progress</p>
        </div>
      </div>
      <div className="w-full h-64 md:h-80 lg:h-96" aria-label="Goal progress timeline chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="projectedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-secondary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-secondary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="month"
              stroke="var(--color-muted-foreground)"
              style={{ fontSize: '12px' }}
              tick={{ fill: 'var(--color-muted-foreground)' }}
            />
            <YAxis
              stroke="var(--color-muted-foreground)"
              style={{ fontSize: '12px' }}
              tick={{ fill: 'var(--color-muted-foreground)' }}
              tickFormatter={(value) => `$${(value / 1000)?.toFixed(0)}K`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '14px', paddingTop: '20px' }}
              iconType="line"
            />
            <Area
              type="monotone"
              dataKey="projected"
              stroke="var(--color-secondary)"
              strokeWidth={2}
              fill="url(#projectedGradient)"
              name="Projected"
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="var(--color-primary)"
              strokeWidth={3}
              fill="url(#actualGradient)"
              name="Actual"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="target"
              stroke="var(--color-success)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="Target"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-4 md:mt-6">
        <div className="bg-background rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-xs text-muted-foreground">Actual Progress</span>
          </div>
          <p className="text-lg md:text-xl font-semibold text-foreground data-text">
            ${selectedGoal?.currentAmount?.toLocaleString()}
          </p>
        </div>
        <div className="bg-background rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-secondary" />
            <span className="text-xs text-muted-foreground">Projected Now</span>
          </div>
          <p className="text-lg md:text-xl font-semibold text-foreground data-text">
            ${Math.round(selectedGoal?.targetAmount * 0.6)?.toLocaleString()}
          </p>
        </div>
        <div className="bg-background rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-success" />
            <span className="text-xs text-muted-foreground">Final Target</span>
          </div>
          <p className="text-lg md:text-xl font-semibold text-foreground data-text">
            ${selectedGoal?.targetAmount?.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default GoalTimelineChart;