import React, { useState, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

// --- IMPORTS ---
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import useTransactions from '../../hooks/useTransactions';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';

// --- THEME COLORS ---
const COLORS = {
  'NEEDS': '#10B981',   // Emerald
  'WANTS': '#F59E0B',   // Amber
  'SAVINGS': '#3B82F6', // Blue
  'Unsorted': '#94A3B8' // Slate
};

const Spending = () => {
  // 1. STATE MANAGEMENT
  const [viewDate, setViewDate] = useState(new Date());
  const [expandedCategory, setExpandedCategory] = useState(null);

  // Helper: Date Navigation
  const changeMonth = (increment) => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() + increment);
    setViewDate(newDate);
    setExpandedCategory(null);
  };

  const setSpecificDate = (monthIndex, year) => {
    const newDate = new Date(viewDate);
    if (monthIndex !== null) newDate.setMonth(monthIndex);
    if (year !== null) newDate.setFullYear(year);
    setViewDate(newDate);
    setExpandedCategory(null);
  };

  const toggleCategory = (catName) => {
    if (expandedCategory === catName) setExpandedCategory(null);
    else setExpandedCategory(catName);
  };

  // 2. DATE LOGIC
  const { startDate, endDate, label, monthName, daysArray, effectiveDays } = useMemo(() => {
     const y = viewDate.getFullYear();
     const m = viewDate.getMonth();
     const start = new Date(y, m, 1).toISOString().split('T')[0];
     const end = new Date(y, m + 1, 0).toISOString().split('T')[0];
     const days = new Date(y, m + 1, 0).getDate();
     const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

     // Generate array of days for chart/heatmap
     const dArray = Array.from({length: days}, (_, i) => i + 1);

     // For the current (partial) month, average over days elapsed so far, not
     // the full month length -- otherwise the daily average is understated.
     const now = new Date();
     const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m;
     const effDays = isCurrentMonth ? now.getDate() : days;

     return { startDate: start, endDate: end, label: `${monthNames[m]} ${y}`, monthName: monthNames[m], daysInMonth: days, daysArray: dArray, effectiveDays: effDays };
  }, [viewDate]);

  // 3. FETCH TRANSACTIONS
  const filters = useMemo(() => ({ dateRange: 'custom', startDate, endDate }), [startDate, endDate]);
  const { transactions, loading } = useTransactions(null, { filters });

  // 4. CALCULATE SPENDING STATS
  const stats = useMemo(() => {
    if (!transactions) return { total: 0, byBucket: [], topCategories: [], largest: null, dailyData: [] };

    let total = 0;
    const bucketMap = { 'NEEDS': 0, 'WANTS': 0, 'SAVINGS': 0, 'Unsorted': 0 };
    const categoryMap = {};
    const dailyMap = {};
    let largest = { amount: 0, merchant: 'N/A' };

    // Initialize daily map
    daysArray.forEach(d => dailyMap[d] = 0);

    transactions.forEach(t => {
        let bucket = t.budgetBucket || 'Unsorted';
        // Skip non-spending
        if (bucket === 'INCOME' || bucket === 'TRANSFERS') return;

        // Fold DEBT_FUNDING (Loan Payment) into NEEDS so it matches the budget
        // page instead of landing in the Unsorted pie slice.
        if (bucket === 'DEBT_FUNDING') bucket = 'NEEDS';

        const amt = Math.abs(t.amount);
        total += amt;

        // Bucket Stats
        if (bucketMap.hasOwnProperty(bucket)) bucketMap[bucket] += amt;
        else bucketMap['Unsorted'] += amt;

        // Category & Merchant Stats
        const cat = t.category || 'Uncategorized';
        const merchant = t.merchant || t.description || 'Unknown';

        if (!categoryMap[cat]) {
            categoryMap[cat] = { total: 0, merchants: {} };
        }
        categoryMap[cat].total += amt;

        if (!categoryMap[cat].merchants[merchant]) {
            categoryMap[cat].merchants[merchant] = 0;
        }
        categoryMap[cat].merchants[merchant] += amt;

        // Largest Expense
        if (amt > largest.amount) {
            largest = { amount: amt, merchant: merchant, date: t.dateString };
        }

        // Daily Stats
        const day = new Date(t.dateString).getDate(); // Ensure T.dateString is local or handle timezone
        // Simple fallback if dateString is YYYY-MM-DD
        const dayPart = parseInt(t.dateString.split('-')[2]);
        if (dailyMap[dayPart] !== undefined) dailyMap[dayPart] += amt;
    });

    // Format Buckets for Pie Chart
    const byBucket = [
        { name: 'Needs', value: bucketMap.NEEDS, color: '#10B981' },
        { name: 'Wants', value: bucketMap.WANTS, color: '#F59E0B' },
        { name: 'Savings', value: bucketMap.SAVINGS, color: '#3B82F6' },
        { name: 'Unsorted', value: bucketMap.Unsorted, color: '#94A3B8' }
    ].filter(i => i.value > 0);

    // Format Daily Data for Bar Chart
    const dailyData = Object.keys(dailyMap).map(day => ({
        day: day,
        amount: dailyMap[day]
    }));

    // Format Top 15 Categories & Top 20 Merchants per Category
    const topCategories = Object.entries(categoryMap)
        .map(([name, data]) => {
            const sortedMerchants = Object.entries(data.merchants)
                .map(([mName, mAmt]) => ({ name: mName, value: mAmt }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 20);

            return {
                name,
                value: data.total,
                merchants: sortedMerchants
            };
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 15);

    return { total, byBucket, topCategories, largest, dailyData };
  }, [transactions, daysArray]);

  if (loading) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mb-4"></div>
      <p className="text-muted-foreground font-bold">Loading Analysis...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground pb-12">
      <PrimaryNavBar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* --- HEADER --- */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-8 gap-4 bg-card p-4 rounded-xl shadow-elevation-1 border border-border">
          <div className="flex items-center gap-3">
             <div className="bg-purple-100 p-2 rounded-lg text-purple-600">
                <Icon name="CreditCard" size={24} />
             </div>
             <div>
                <h1 className="text-xl font-bold text-foreground leading-tight">Spending Analysis</h1>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Viewing: <span className="text-purple-600 font-bold">{label}</span>
                </p>
             </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <Button variant="ghost" size="icon" onClick={() => changeMonth(-1)} iconName="ChevronLeft" />

            <select
                value={viewDate.getMonth()}
                onChange={(e) => setSpecificDate(parseInt(e.target.value), null)}
                className="bg-card border border-input text-foreground text-sm rounded-md p-2 font-semibold focus:ring-2 focus:ring-ring outline-none"
            >
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => (<option key={m} value={i}>{m}</option>))}
            </select>

            <select
                value={viewDate.getFullYear()}
                onChange={(e) => setSpecificDate(null, parseInt(e.target.value))}
                className="bg-card border border-input text-foreground text-sm rounded-md p-2 font-semibold focus:ring-2 focus:ring-ring outline-none"
            >
                {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            <Button variant="ghost" size="icon" onClick={() => changeMonth(1)} iconName="ChevronRight" />

            <Button
                variant="outline"
                size="sm"
                onClick={() => setViewDate(new Date())}
                className="ml-2 border-purple-200 text-purple-600 hover:bg-purple-50"
            >
                Jump to Today
            </Button>
          </div>
        </div>

        {/* --- KPI CARDS --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-card p-6 rounded-xl shadow-elevation-2 border border-border flex flex-col justify-between">
                <div>
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Total Spent</div>
                    <div className="text-3xl font-extrabold text-foreground">
                        ${stats.total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon name="TrendingUp" size={16} className="text-muted-foreground"/>
                    <span>Across all categories</span>
                </div>
            </div>
            <div className="bg-card p-6 rounded-xl shadow-elevation-2 border border-border flex flex-col justify-between">
                <div>
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Daily Average</div>
                    <div className="text-3xl font-extrabold text-blue-600">
                        ${(stats.total / effectiveDays).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon name="Calendar" size={16} className="text-muted-foreground"/>
                    <span>Per day in {monthName}</span>
                </div>
            </div>
            <div className="bg-card p-6 rounded-xl shadow-elevation-2 border border-border flex flex-col justify-between">
                <div>
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Largest Expense</div>
                    <div className="text-xl font-bold text-foreground truncate" title={stats.largest?.merchant}>
                        {stats.largest?.merchant || "No expenses"}
                    </div>
                    <div className="text-2xl font-bold text-destructive mt-1">
                        ${stats.largest?.amount.toLocaleString('en-US', {minimumFractionDigits: 2}) || "0.00"}
                    </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                    {stats.largest?.date || ""}
                </div>
            </div>
        </div>

        {/* --- CHARTS ROW (New Bar Chart added) --- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
            {/* SPENDING COMPOSITION */}
            <div className="lg:col-span-1 bg-card p-6 rounded-xl shadow-elevation-2 border border-border">
                <h3 className="text-lg font-bold text-foreground mb-6">Spending Breakdown</h3>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={stats.byBucket}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {stats.byBucket.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <RechartsTooltip formatter={(value) => `$${value.toLocaleString()}`} />
                            <Legend verticalAlign="bottom" height={36}/>
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* DAILY SPENDING TREND (New) */}
            <div className="lg:col-span-2 bg-card p-6 rounded-xl shadow-elevation-2 border border-border">
                 <h3 className="text-lg font-bold text-foreground mb-6">Daily Spending Trend</h3>
                 <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.dailyData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                            <XAxis dataKey="day" tick={{fontSize: 12}} />
                            <YAxis tick={{fontSize: 12}} />
                            <RechartsTooltip
                                formatter={(value) => [`$${value.toLocaleString()}`, 'Spent']}
                                labelFormatter={(label) => `${monthName} ${label}`}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                            />
                            <Bar dataKey="amount" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                 </div>
            </div>
        </div>

        {/* --- TOP CATEGORIES & MERCHANTS --- */}
        <div className="space-y-4">
            <h3 className="text-lg font-bold text-foreground mb-2">Top 15 Categories & Merchants</h3>

            {stats.topCategories.length > 0 ? (
                stats.topCategories.map((cat, index) => {
                    const isExpanded = expandedCategory === cat.name;
                    const pct = (cat.value / stats.total) * 100;

                    return (
                        <div key={cat.name} className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">

                            {/* CATEGORY HEADER */}
                            <div
                                onClick={() => toggleCategory(cat.name)}
                                className={`p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors ${isExpanded ? 'bg-muted/30 border-b border-border' : ''}`}
                            >
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-muted text-muted-foreground font-bold rounded-full text-xs">
                                        #{index + 1}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-foreground">{cat.name}</span>
                                            <span className="font-bold text-foreground">${cat.value.toLocaleString()}</span>
                                        </div>
                                        <div className="w-full bg-muted rounded-full h-1.5">
                                            <div
                                                className="bg-purple-600 h-1.5 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.min(pct * 2, 100)}%` }} // Visual scaling
                                            ></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="ml-4 text-muted-foreground">
                                    <Icon name={isExpanded ? "ChevronUp" : "ChevronDown"} size={20} />
                                </div>
                            </div>

                            {/* MERCHANT DRILL-DOWN */}
                            {isExpanded && (
                                <div className="bg-muted/10 p-4 border-t border-border animate-in slide-in-from-top-2 fade-in duration-200">
                                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <Icon name="Store" size={14}/> Top 20 Merchants in {cat.name}
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                                        {cat.merchants.map((merchant, i) => (
                                            <div key={i} className="flex justify-between items-center text-sm border-b border-border/50 pb-1 last:border-0 md:border-none">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <span className="text-muted-foreground text-xs w-4">{(i + 1)}.</span>
                                                    <span className="text-foreground font-medium truncate max-w-[140px]" title={merchant.name}>
                                                        {merchant.name}
                                                    </span>
                                                </div>
                                                <span className="font-semibold text-foreground">
                                                    ${merchant.value.toLocaleString()}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })
            ) : (
                <div className="bg-card p-8 rounded-xl shadow-sm border border-border text-center text-muted-foreground italic">
                    No spending data found for {label}.
                </div>
            )}
        </div>

      </div>
    </div>
  );
};

export default Spending;