// Paste this in the FILE, not the Database
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = {
  'NEEDS': '#10B981',
  'WANTS': '#F59E0B',
  'SAVINGS': '#3B82F6',
  'Unsorted': '#9CA3AF'
};

const SpendingBreakdownChart = ({ data }) => {
  const expenses = data?.filter(t => t.amount < 0) || [];

  const groupedData = expenses.reduce((acc, t) => {
    const bucket = t.budgetBucket || 'Unsorted';
    acc[bucket] = (acc[bucket] || 0) + Math.abs(t.amount);
    return acc;
  }, {});

  const chartData = Object.keys(groupedData)
    .map(name => ({ name, value: groupedData[name] }))
    .sort((a, b) => b.value - a.value);

  if (chartData.length === 0) return (
    <div className="bg-card p-6 rounded-xl shadow-sm border border-border h-96 flex items-center justify-center text-muted-foreground">
      No spending data available
    </div>
  );

  return (
    <div className="bg-card p-6 rounded-xl shadow-sm border border-border h-96">
      <h3 className="text-lg font-bold text-foreground mb-4">Needs vs. Wants</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={5}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[entry.name] || '#9CA3AF'} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              contentStyle={{ backgroundColor: 'var(--color-popover)', color: 'var(--color-popover-foreground)', borderRadius: '8px', border: '1px solid var(--color-border)' }}
            />
            <Legend verticalAlign="bottom" height={36}/>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SpendingBreakdownChart;