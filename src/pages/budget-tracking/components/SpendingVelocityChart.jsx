import React from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, ComposedChart } from 'recharts';

const SpendingVelocityChart = ({ data }) => {
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload?.length) {
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-elevation-3">
          <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
          {payload?.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-4 text-xs">
              <span className="text-muted-foreground">{entry?.name}:</span>
              <span className="font-semibold data-text" style={{ color: entry?.color }}>
                ${entry?.value?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4 md:mb-6">
        <div>
          <h3 className="text-base md:text-lg font-semibold text-foreground">Spending Velocity</h3>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Daily spending rate vs budget burn rate
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-xs md:text-sm text-muted-foreground">Actual Spending</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-warning" />
            <span className="text-xs md:text-sm text-muted-foreground">Budget Burn Rate</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-success/30" />
            <span className="text-xs md:text-sm text-muted-foreground">Confidence Interval</span>
          </div>
        </div>
      </div>
      <div className="w-full h-64 md:h-80 lg:h-96" aria-label="Spending velocity line chart showing daily spending rate against budget burn rate">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="day"
              stroke="var(--color-muted-foreground)"
              style={{ fontSize: '12px' }}
              tick={{ fill: 'var(--color-muted-foreground)' }}
            />
            <YAxis
              stroke="var(--color-muted-foreground)"
              style={{ fontSize: '12px' }}
              tick={{ fill: 'var(--color-muted-foreground)' }}
              tickFormatter={(value) => `$${value}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
              iconType="circle"
            />
            <Area
              type="monotone"
              dataKey="confidenceUpper"
              stroke="none"
              fill="var(--color-success)"
              fillOpacity={0.1}
              name="Upper Confidence"
            />
            <Area
              type="monotone"
              dataKey="confidenceLower"
              stroke="none"
              fill="var(--color-success)"
              fillOpacity={0.1}
              name="Lower Confidence"
            />
            <Line
              type="monotone"
              dataKey="actualSpending"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={{ fill: 'var(--color-primary)', r: 4 }}
              activeDot={{ r: 6 }}
              name="Actual Spending"
            />
            <Line
              type="monotone"
              dataKey="budgetBurnRate"
              stroke="var(--color-warning)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ fill: 'var(--color-warning)', r: 4 }}
              activeDot={{ r: 6 }}
              name="Budget Burn Rate"
            />
            <Line
              type="monotone"
              dataKey="projected"
              stroke="var(--color-error)"
              strokeWidth={2}
              strokeDasharray="3 3"
              dot={false}
              name="Projected"
            />
            <ReferenceLine
              y={data?.[0]?.monthlyBudget || 0}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="3 3"
              label={{ value: 'Monthly Budget', position: 'right', fill: 'var(--color-muted-foreground)', fontSize: 12 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-4 md:mt-6">
        <div className="bg-muted rounded-lg p-3 md:p-4">
          <p className="text-xs text-muted-foreground mb-1">Current Daily Rate</p>
          <p className="text-base md:text-lg font-semibold text-foreground data-text">
            ${data?.[data?.length - 1]?.actualSpending?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-muted rounded-lg p-3 md:p-4">
          <p className="text-xs text-muted-foreground mb-1">Target Daily Rate</p>
          <p className="text-base md:text-lg font-semibold text-foreground data-text">
            ${data?.[data?.length - 1]?.budgetBurnRate?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-muted rounded-lg p-3 md:p-4">
          <p className="text-xs text-muted-foreground mb-1">Month-End Projection</p>
          <p className={`text-base md:text-lg font-semibold data-text ${data?.[data?.length - 1]?.projected > data?.[0]?.monthlyBudget ? 'text-error' : 'text-success'}`}>
            ${data?.[data?.length - 1]?.projected?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SpendingVelocityChart;