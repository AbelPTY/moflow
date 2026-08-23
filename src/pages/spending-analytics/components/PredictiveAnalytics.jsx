import React from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import Icon from '../../../components/AppIcon';

const PredictiveAnalytics = ({ historicalData, projectedData }) => {
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload?.length) {
      return (
        <div className="bg-card border border-border rounded-lg p-4 shadow-elevation-3">
          <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
          {payload?.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-4 mb-1">
              <span className="text-xs text-muted-foreground">{entry?.name}:</span>
              <span className="text-sm font-medium data-text" style={{ color: entry?.color }}>
                ${entry?.value?.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const combinedData = [...historicalData, ...projectedData];

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-1">Predictive Spending Analytics</h2>
          <p className="text-sm text-muted-foreground">AI-powered spending projections based on current velocity and historical patterns</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
          <Icon name="Sparkles" size={16} className="text-primary" />
          <span className="text-sm font-medium text-foreground">AI Forecast</span>
        </div>
      </div>

      <div className="w-full h-64 md:h-80 lg:h-96" aria-label="Predictive spending analytics chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={combinedData}>
            <defs>
              <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="projectedGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="month"
              stroke="var(--color-text-secondary)"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="var(--color-text-secondary)"
              style={{ fontSize: '12px' }}
              tickFormatter={(value) => `$${value / 1000}k`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '14px' }}
              iconType="circle"
            />
            <Area
              type="monotone"
              dataKey="actual"
              stroke="var(--color-primary)"
              strokeWidth={2}
              fill="url(#actualGradient)"
              name="Actual Spending"
            />
            <Area
              type="monotone"
              dataKey="projected"
              stroke="var(--color-accent)"
              strokeWidth={2}
              strokeDasharray="5 5"
              fill="url(#projectedGradient)"
              name="Projected Spending"
            />
            <Line
              type="monotone"
              dataKey="budget"
              stroke="var(--color-secondary)"
              strokeWidth={2}
              strokeDasharray="3 3"
              name="Budget Limit"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="TrendingUp" size={16} className="text-primary" />
            <span className="text-xs text-muted-foreground">Current Month Projection</span>
          </div>
          <p className="text-xl md:text-2xl font-semibold text-foreground data-text">$3,847</p>
          <p className="text-xs text-success mt-1">↓ 8% vs last month</p>
        </div>
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="Calendar" size={16} className="text-warning" />
            <span className="text-xs text-muted-foreground">Days Until Budget Limit</span>
          </div>
          <p className="text-xl md:text-2xl font-semibold text-foreground data-text">18</p>
          <p className="text-xs text-muted-foreground mt-1">At current spending rate</p>
        </div>
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="Target" size={16} className="text-success" />
            <span className="text-xs text-muted-foreground">Savings Potential</span>
          </div>
          <p className="text-xl md:text-2xl font-semibold text-foreground data-text">$423</p>
          <p className="text-xs text-muted-foreground mt-1">If trends continue</p>
        </div>
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="AlertCircle" size={16} className="text-error" />
            <span className="text-xs text-muted-foreground">Budget Risk Level</span>
          </div>
          <p className="text-xl md:text-2xl font-semibold text-foreground">Low</p>
          <p className="text-xs text-success mt-1">Within safe limits</p>
        </div>
      </div>

      <div className="mt-6 p-4 bg-muted rounded-lg">
        <div className="flex items-start gap-3">
          <Icon name="Lightbulb" size={20} className="text-warning flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">AI Recommendations</h4>
            <ul className="space-y-2">
              <li className="text-sm text-muted-foreground">
                • Your dining expenses are trending 15% higher than usual. Consider meal planning to reduce costs.
              </li>
              <li className="text-sm text-muted-foreground">
                • Entertainment spending is on track. You're likely to stay within budget this month.
              </li>
              <li className="text-sm text-muted-foreground">
                • Transportation costs decreased by 22% compared to last month. Great job!
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PredictiveAnalytics;