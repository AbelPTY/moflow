import React, { useState, useMemo } from 'react';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import useTransactions from '../../hooks/useTransactions';
import useGoal from '../../hooks/useGoal';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Target, TrendingUp, Calendar, Plane, DollarSign, Pencil } from 'lucide-react';

const GoalsProgress = () => {
  const { transactions, loading } = useTransactions(null, { filters: { dateRange: 'all' } });
  const { goal, loading: goalLoading, saveGoal } = useGoal();

  // Goal editor state
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalForm, setGoalForm] = useState(null);

  const openGoalEditor = () => { setGoalForm({ ...goal }); setIsEditingGoal(true); };
  const handleGoalFieldChange = (field, value) => setGoalForm(prev => ({ ...prev, [field]: value }));
  const handleGoalSave = async () => {
    try {
      await saveGoal(goalForm);
      setIsEditingGoal(false);
    } catch (e) {
      // The hook already surfaced the error; keep the editor open so nothing is lost.
    }
  };

  // 2. CALCULATE SAVINGS PERFORMANCE
  const goalsStats = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;

    // A. Identify Savings (Money tagged as 'SAVINGS' bucket). CC payments and
    // internal transfers already carry is_transfer = true, so !is_transfer
    // excludes them.
    const savingsTx = transactions.filter(t =>
      t.budgetBucket === 'SAVINGS' &&
      !t.is_transfer
    );

    // B. Identify Income (for Savings Rate calc)
    const incomeTx = transactions.filter(t =>
      t.amount > 0 &&
      !t.is_transfer &&
      (t.category === 'Income' || t.category === 'Loan Payment') // Include the loan as "Cash In" for liquidity view
    );

    const totalSaved = savingsTx.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const totalIncome = incomeTx.reduce((sum, t) => sum + t.amount, 0);

    // C. Build the Growth Chart Data (Running Total of Savings)
    const sortedSavings = [...savingsTx].sort((a, b) => new Date(a.dateString) - new Date(b.dateString));

    let runningBalance = 0;
    const chartData = sortedSavings.reduce((acc, t) => {
      runningBalance += Math.abs(t.amount);
      const month = t.dateString.substring(0, 7); // "2025-01"

      // Keep last entry per month
      acc[month] = { date: month, saved: runningBalance };
      return acc;
    }, {});

    return {
      totalSaved,
      savingsRate: totalIncome > 0 ? (totalSaved / totalIncome) * 100 : 0,
      chartData: Object.values(chartData),
      recentSavings: savingsTx.sort((a, b) => new Date(b.dateString) - new Date(a.dateString)).slice(0, 5)
    };
  }, [transactions]);

  if (loading || goalLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mb-4"></div>
      <p className="ml-4 text-xl font-bold text-muted-foreground">Calculating Savings Velocity...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PrimaryNavBar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* HEADER */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Goals & Savings</h1>
            <p className="text-sm text-muted-foreground font-medium mt-1">
               Tracking accumulation in your "SAVINGS" bucket.
            </p>
          </div>
          <button
            onClick={openGoalEditor}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm font-semibold text-foreground hover:bg-background shadow-sm whitespace-nowrap"
          >
            <Pencil size={16} /> Edit Goal
          </button>
        </div>

        {/* GOAL EDITOR MODAL */}
        {isEditingGoal && goalForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-xl shadow-xl p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Edit Goal</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Goal Name</label>
                  <input
                    type="text"
                    value={goalForm.name}
                    onChange={(e) => handleGoalFieldChange('name', e.target.value)}
                    className="w-full border border-border rounded-md p-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Target Amount ($)</label>
                  <input
                    type="number"
                    value={goalForm.targetAmount}
                    onChange={(e) => handleGoalFieldChange('targetAmount', e.target.value)}
                    className="w-full border border-border rounded-md p-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Milestone</label>
                  <input
                    type="text"
                    value={goalForm.milestoneLabel}
                    onChange={(e) => handleGoalFieldChange('milestoneLabel', e.target.value)}
                    className="w-full border border-border rounded-md p-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Milestone Detail</label>
                  <input
                    type="text"
                    value={goalForm.milestoneSublabel}
                    onChange={(e) => handleGoalFieldChange('milestoneSublabel', e.target.value)}
                    className="w-full border border-border rounded-md p-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setIsEditingGoal(false)}
                  className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-md font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGoalSave}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 font-semibold"
                >
                  Save Goal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 1. HERO CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* TOTAL SAVED */}
          <div className="bg-card p-6 rounded-xl shadow-sm border border-border flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Total Accumulated</p>
              <h3 className="text-3xl font-bold text-emerald-600">
                ${goalsStats?.totalSaved.toLocaleString()}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Real cash tagged as Savings</p>
            </div>
            <div className="h-12 w-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
              <Target size={24} />
            </div>
          </div>

          {/* SAVINGS RATE */}
          <div className="bg-card p-6 rounded-xl shadow-sm border border-border flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Savings Rate</p>
              <h3 className="text-3xl font-bold text-blue-600">
                {goalsStats?.savingsRate.toFixed(1)}%
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Of Total Income</p>
            </div>
            <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
              <TrendingUp size={24} />
            </div>
          </div>

          {/* TRIP COUNTDOWN (Feb 2026) */}
          <div className="bg-card p-6 rounded-xl shadow-sm border border-border flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">Next Milestone</p>
              <h3 className="text-xl font-bold text-foreground">{goal.milestoneLabel}</h3>
              <p className="text-xs text-muted-foreground mt-1">{goal.milestoneSublabel}</p>
            </div>
            <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center text-purple-600">
              <Plane size={24} />
            </div>
          </div>
        </div>

        {/* 2. THE GOAL PROGRESS BAR */}
        <div className="bg-card p-6 rounded-xl shadow-sm border border-border mb-8">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h3 className="text-lg font-bold">{goal.name}</h3>
              <p className="text-sm text-muted-foreground">Progress toward ${goal.targetAmount.toLocaleString()} target</p>
            </div>
            <span className="text-2xl font-bold text-emerald-600">
              {(((goalsStats?.totalSaved || 0) / (goal.targetAmount || 1)) * 100).toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min(((goalsStats?.totalSaved || 0) / (goal.targetAmount || 1)) * 100, 100)}%` }}
            ></div>
          </div>
        </div>

        {/* 3. CHART & LIST */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* GROWTH CHART */}
          <div className="bg-card p-6 rounded-xl shadow-sm border border-border h-96">
            <h3 className="text-lg font-bold mb-6">Savings Growth</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={goalsStats?.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSaved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 12, fill: '#9CA3AF'}}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 12, fill: '#9CA3AF'}}
                    tickFormatter={(val) => `$${val/1000}k`}
                  />
                  <Tooltip
                     formatter={(value) => [`$${value.toLocaleString()}`, 'Total Saved']}
                     contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                  />
                  <Area type="monotone" dataKey="saved" stroke="#10B981" fillOpacity={1} fill="url(#colorSaved)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RECENT WINS */}
          <div className="bg-card p-6 rounded-xl shadow-sm border border-border">
            <h3 className="text-lg font-bold mb-6">Recent Savings Contributions</h3>
            <div className="space-y-4">
              {goalsStats?.recentSavings.map((t, i) => (
                <div key={i} className="flex justify-between items-center p-3 hover:bg-background rounded-lg transition-colors border border-border">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                      <DollarSign size={18} />
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{t.merchant || 'Savings Transfer'}</p>
                      <div className="flex items-center text-xs text-muted-foreground gap-1">
                        <Calendar size={12} />
                        {t.dateString}
                      </div>
                    </div>
                  </div>
                  <span className="font-bold text-emerald-600">
                    +${Math.abs(t.amount).toLocaleString()}
                  </span>
                </div>
              ))}
              {goalsStats?.recentSavings.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No savings transactions found yet.</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default GoalsProgress;