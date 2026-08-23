import React, { useState } from 'react';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from 'recharts';
import Icon from '../../../components/AppIcon';

const SpendingTrendChart = ({ data, onDrillDown }) => {
  const [viewMode, setViewMode] = useState('combined');

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

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-1">Monthly Spending Trends</h2>
          <p className="text-sm text-muted-foreground">Actual spending vs budget allocation with variance analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('combined')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-smooth ${
              viewMode === 'combined' ?'bg-primary text-primary-foreground' :'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <Icon name="BarChart3" size={16} className="inline mr-1" />
            Combined
          </button>
          <button
            onClick={() => setViewMode('bars')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-smooth ${
              viewMode === 'bars' ?'bg-primary text-primary-foreground' :'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <Icon name="BarChart2" size={16} className="inline mr-1" />
            Bars Only
          </button>
        </div>
      </div>

      <div className="w-full h-64 md:h-80 lg:h-96" aria-label="Monthly spending trends chart">
        <ResponsiveContainer width="100%" height="100%">
          {viewMode === 'combined' ? (
            <ComposedChart data={data} onClick={onDrillDown}>
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
              <Bar
                dataKey="actual"
                fill="var(--color-primary)"
                name="Actual Spending"
                radius={[8, 8, 0, 0]}
              />
              <Bar
                dataKey="budget"
                fill="var(--color-secondary)"
                name="Budget"
                radius={[8, 8, 0, 0]}
              />
              <Line
                type="monotone"
                dataKey="variance"
                stroke="var(--color-accent)"
                strokeWidth={2}
                name="Variance"
                dot={{ r: 4 }}
              />
            </ComposedChart>
          ) : (
            <BarChart data={data} onClick={onDrillDown}>
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
              <Bar
                dataKey="actual"
                fill="var(--color-primary)"
                name="Actual Spending"
                radius={[8, 8, 0, 0]}
              />
              <Bar
                dataKey="budget"
                fill="var(--color-secondary)"
                name="Budget"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="TrendingUp" size={16} className="text-success" />
            <span className="text-xs text-muted-foreground">Avg Monthly Spending</span>
          </div>
          <p className="text-xl md:text-2xl font-semibold text-foreground data-text">$3,245</p>
        </div>
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="Target" size={16} className="text-primary" />
            <span className="text-xs text-muted-foreground">Budget Utilization</span>
          </div>
          <p className="text-xl md:text-2xl font-semibold text-foreground data-text">87.3%</p>
        </div>
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="AlertCircle" size={16} className="text-warning" />
            <span className="text-xs text-muted-foreground">Over Budget Months</span>
          </div>
          <p className="text-xl md:text-2xl font-semibold text-foreground data-text">2/6</p>
        </div>
      </div>
    </div>
  );
};

export default SpendingTrendChart;