import React, { useState, useMemo, useEffect } from 'react';
import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import useTransactions from '../../hooks/useTransactions';
import useBudgets from '../../hooks/useBudgets';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

// --- 1. MASTER CATEGORY MENU ---
// Real categories (produced by merchant_rules.json / scanReceipt) are listed
// first in each bucket; the trailing names are aspirational placeholders the
// app doesn't generate yet but are kept selectable in the Add Category menu.
const MASTER_CATEGORIES = {
  NEEDS: [
    'Groceries', 'Household/Utilities', 'Insurance', 'Transportation',
    'Medical/Health', 'Education', 'Loan Payment'
  ],
  WANTS: [
    'Dining Out', 'Shopping', 'Subscriptions', 'Sports',
    'Office/Social Events', 'Work Expenses',
    'Travel', 'Entertainment', 'Personal Care', 'Gifts'
  ],
  SAVINGS: [
    'Savings',
    'Investments', 'Emergency Fund', 'Retirement'
  ]
};

// Loan Payment transactions carry the DEBT_FUNDING budgetBucket; treat it as a
// NEEDS for budgeting so its spend is counted instead of falling through.
const BUCKET_ALIASES = { DEBT_FUNDING: 'NEEDS' };

// --- INITIAL DEFAULTS (aligned to real transaction categories) ---
const INITIAL_BUDGETS = {
  'Groceries': { limit: 600, active: true },
  'Household/Utilities': { limit: 1700, active: true }, // was Housing 1500 + Utilities 200
  'Transportation': { limit: 100, active: true },
  'Insurance': { limit: 30, active: true },
  'Medical/Health': { limit: 150, active: true },
  'Loan Payment': { limit: 500, active: true },
  'Dining Out': { limit: 300, active: true },
  'Shopping': { limit: 200, active: true },
  'Savings': { limit: 500, active: true },
};

const Budget = () => {
  const [viewDate, setViewDate] = useState(new Date());

  // Budgets now persist to Supabase (see useBudgets). Legacy localStorage
  // budgets are migrated into the database once by the hook on first load.
  const { budgets: savedBudgets, loading: budgetsLoading, saveBudgets: persistBudgets } = useBudgets();

  // Displayed budgets. Falls back to INITIAL_BUDGETS for a brand-new user with
  // nothing saved yet -- those defaults stay in memory until they hit Save.
  const [budgets, setBudgets] = useState(INITIAL_BUDGETS);

  useEffect(() => {
    if (budgetsLoading) return;
    setBudgets(Object.keys(savedBudgets).length > 0 ? savedBudgets : INITIAL_BUDGETS);
  }, [budgetsLoading, savedBudgets]);

  const [isEditing, setIsEditing] = useState(false);
  const [tempBudgets, setTempBudgets] = useState(budgets);

  // Add Category Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatBucket, setNewCatBucket] = useState('NEEDS');
  const [newCatLimit, setNewCatLimit] = useState(0);

  // --- HELPER FUNCTIONS ---
  const changeMonth = (increment) => {
    const newDate = new Date(viewDate);
    newDate.setMonth(newDate.getMonth() + increment);
    setViewDate(newDate);
  };

  const setSpecificDate = (monthIndex, year) => {
    const newDate = new Date(viewDate);
    if (monthIndex !== null) newDate.setMonth(monthIndex);
    if (year !== null) newDate.setFullYear(year);
    setViewDate(newDate);
  };

  // --- EDIT MODE HANDLERS ---
  const startEditing = () => {
    setTempBudgets(JSON.parse(JSON.stringify(budgets))); // Deep copy
    setIsEditing(true);
  };

  const saveBudgets = async () => {
    try {
      await persistBudgets(tempBudgets); // DB-first: only close edit mode on success
      setBudgets(tempBudgets);
      setIsEditing(false);
    } catch (e) {
      // The hook already surfaced the error; stay in edit mode so nothing is lost.
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setShowAddModal(false);
  };

  const handleBudgetChange = (category, field, value) => {
    setTempBudgets(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: value
      }
    }));
  };

  const deleteCategory = (category) => {
    if (window.confirm(`Are you sure you want to delete ${category}?`)) {
      setTempBudgets(prev => {
        const next = { ...prev };
        delete next[category];
        return next;
      });
    }
  };

  const addNewCategory = () => {
    if (newCatName) {
      setTempBudgets(prev => ({
        ...prev,
        [newCatName]: { limit: parseFloat(newCatLimit) || 0, active: true }
      }));
      setNewCatName('');
      setNewCatLimit(0);
      setShowAddModal(false);
    }
  };

  // --- DATE LOGIC ---
  const { startDate, endDate, label, monthName } = useMemo(() => {
     const y = viewDate.getFullYear();
     const m = viewDate.getMonth();
     const start = new Date(y, m, 1).toISOString().split('T')[0];
     const end = new Date(y, m + 1, 0).toISOString().split('T')[0];
     const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
     return { startDate: start, endDate: end, label: `${monthNames[m]} ${y}`, monthName: monthNames[m] };
  }, [viewDate]);

  // --- FETCH DATA ---
  const filters = useMemo(() => ({ dateRange: 'custom', startDate, endDate }), [startDate, endDate]);
  const { transactions, loading } = useTransactions(null, { filters });

  // --- CALCULATE STATS ---
  const budgetStats = useMemo(() => {
    const activeData = isEditing ? tempBudgets : budgets;

    if (!transactions) return { needs: {}, wants: {}, savings: {}, total: {} };

    const buckets = {
      NEEDS: { limit: 0, spent: 0, color: '#10B981' },
      WANTS: { limit: 0, spent: 0, color: '#F59E0B' },
      SAVINGS: { limit: 0, spent: 0, color: '#3B82F6' }
    };

    const categories = {};

    // 1. Initialize Categories
    Object.keys(activeData).forEach(cat => {
        const settings = activeData[cat];
        const effectiveLimit = settings.active ? settings.limit : 0;

        categories[cat] = {
            limit: effectiveLimit,
            originalLimit: settings.limit,
            active: settings.active,
            spent: 0,
            bucket: 'Unsorted',
            transactions: []
        };
    });

    // 2. Process Transactions
    transactions.forEach(t => {
       const amt = Math.abs(t.amount);
       const cat = t.category || 'Uncategorized';
       let bucket = t.budgetBucket || 'Unsorted';

       if (bucket === 'INCOME' || bucket === 'TRANSFERS') return;

       // Fold DEBT_FUNDING (Loan Payment) into NEEDS so it lands in a column
       bucket = BUCKET_ALIASES[bucket] || bucket;

       if (!categories[cat]) {
           categories[cat] = { limit: 0, originalLimit: 0, active: true, spent: 0, bucket: bucket, transactions: [] };
       }

       categories[cat].spent += amt;
       if(categories[cat].bucket === 'Unsorted') categories[cat].bucket = bucket;
       categories[cat].transactions.push(t);

       if (buckets[bucket]) {
           buckets[bucket].spent += amt;
       }
    });

    // 3. Sum Limits & Auto-Assign
    Object.keys(categories).forEach(cat => {
        const item = categories[cat];

        // Auto-assign bucket if missing (MASTER_CATEGORIES now uses the real
        // category names, so the old hardcoded fallback lists are gone)
        if (item.bucket === 'Unsorted') {
             if (MASTER_CATEGORIES.NEEDS.includes(cat)) item.bucket = 'NEEDS';
             else if (MASTER_CATEGORIES.WANTS.includes(cat)) item.bucket = 'WANTS';
             else if (MASTER_CATEGORIES.SAVINGS.includes(cat)) item.bucket = 'SAVINGS';
        }

        if (buckets[item.bucket]) {
            buckets[item.bucket].limit += item.limit;
        }
    });

    const totalLimit = buckets.NEEDS.limit + buckets.WANTS.limit + buckets.SAVINGS.limit;
    const totalSpent = buckets.NEEDS.spent + buckets.WANTS.spent + buckets.SAVINGS.spent;

    return { buckets, categories, total: { limit: totalLimit, spent: totalSpent } };
  }, [transactions, budgets, isEditing, tempBudgets]);

  if (loading || budgetsLoading) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mb-4"></div>
      <p className="text-muted-foreground font-bold">Loading Budget Data...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <PrimaryNavBar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28 md:pb-8">

        {/* HEADER */}
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-8 gap-4 bg-card p-4 rounded-xl shadow-elevation-1 border border-border">
          <div className="flex items-center gap-3">
             <div className="bg-primary/10 p-2 rounded-lg text-primary">
                <Icon name="Calendar" size={24} />
             </div>
             <div>
                <h1 className="text-xl font-bold text-foreground leading-tight">Monthly Budget</h1>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Viewing: <span className="text-primary font-bold">{label}</span>
                </p>
             </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <div className="mr-4 border-r border-border pr-4 flex items-center">
                {!isEditing ? (
                    <Button variant="secondary" onClick={startEditing} iconName="Edit2">
                        Edit Budget
                    </Button>
                ) : (
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => setShowAddModal(true)} iconName="Plus">
                            Add Category
                        </Button>
                        <Button variant="destructive" onClick={cancelEditing} iconName="X">
                            Cancel
                        </Button>
                        <Button variant="default" onClick={saveBudgets} iconName="Save">
                            Save Changes
                        </Button>
                    </div>
                )}
            </div>

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
          </div>
        </div>

        {/* ADD MODAL */}
        {showAddModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in">
                <div className="bg-card rounded-xl shadow-xl p-6 w-full max-w-md border border-border">
                    <h3 className="text-lg font-bold text-foreground mb-4">Add New Budget Category</h3>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Bucket</label>
                        <div className="flex gap-2 p-1 bg-muted rounded-lg">
                            {['NEEDS', 'WANTS', 'SAVINGS'].map(b => (
                                <button
                                    key={b}
                                    onClick={() => setNewCatBucket(b)}
                                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${newCatBucket === b ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    {b}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Category Name</label>
                        <select
                            value={newCatName}
                            onChange={(e) => setNewCatName(e.target.value)}
                            className="block w-full border border-input rounded-md shadow-sm p-2 mb-2 text-sm bg-background focus:ring-2 focus:ring-ring outline-none"
                        >
                            <option value="">-- Select from Menu --</option>
                            {MASTER_CATEGORIES[newCatBucket].map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                        </select>
                        <Input
                            type="text"
                            placeholder="Or type custom name..."
                            value={newCatName}
                            onChange={(e) => setNewCatName(e.target.value)}
                        />
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Monthly Limit ($)</label>
                        <Input
                            type="number"
                            value={newCatLimit}
                            onChange={(e) => setNewCatLimit(e.target.value)}
                            className="text-lg font-bold"
                        />
                    </div>

                    <div className="flex justify-end gap-3">
                        <Button variant="ghost" onClick={() => setShowAddModal(false)}>Cancel</Button>
                        <Button variant="default" onClick={addNewCategory}>Add Category</Button>
                    </div>
                </div>
            </div>
        )}

        {/* SUMMARY CARD */}
        <div className={`bg-card rounded-xl shadow-sm border ${isEditing ? 'border-primary/50 ring-2 ring-primary/10' : 'border-border'} p-6 mb-8 transition-all`}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="flex-1 w-full">
                    <h2 className="text-lg font-bold text-muted-foreground mb-2 flex items-center gap-2">
                        <Icon name="DollarSign" size={20} className="text-muted-foreground"/>
                        Total Budget ({monthName}) {isEditing && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Editing Mode</span>}
                    </h2>
                    <div className="flex items-end gap-2 mb-2">
                        <span className="text-4xl font-extrabold text-foreground">${budgetStats.total.spent.toLocaleString()}</span>
                        <span className={`text-lg font-medium mb-1 ${isEditing ? 'text-primary' : 'text-muted-foreground'}`}>/ ${budgetStats.total.limit.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-4 mb-2 overflow-hidden">
                        <div
                            className={`h-4 rounded-full transition-all duration-500 ${budgetStats.total.spent > budgetStats.total.limit ? 'bg-destructive' : 'bg-primary'}`}
                            style={{ width: `${Math.min((budgetStats.total.spent / (budgetStats.total.limit || 1)) * 100, 100)}%` }}
                        ></div>
                    </div>
                </div>
                <div className="flex gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
                    {['NEEDS', 'WANTS', 'SAVINGS'].map(key => {
                        const b = budgetStats.buckets[key];
                        if(!b) return null;
                        const pct = b.limit > 0 ? (b.spent / b.limit) * 100 : 0;
                        return (
                            <div key={key} className={`bg-background rounded-lg p-4 min-w-[140px] border ${isEditing ? 'border-primary/20 bg-primary/5' : 'border-border'}`}>
                                <span className={`text-xs font-bold uppercase tracking-wider block mb-1`} style={{color: b.color}}>{key}</span>
                                <div className="text-xl font-bold text-foreground">${b.spent.toLocaleString()}</div>
                                <div className="text-xs text-muted-foreground mb-2">Target: ${b.limit.toLocaleString()}</div>
                                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: b.color }}></div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>

        {/* COLUMNS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <BudgetColumn title="NEEDS" bucket="NEEDS" data={budgetStats} iconName="CheckCircle" iconColor="text-emerald-500" headerColor="bg-emerald-50/50 text-emerald-800 border-emerald-100" isEditing={isEditing} onUpdate={handleBudgetChange} onDelete={deleteCategory} />
            <BudgetColumn title="WANTS" bucket="WANTS" data={budgetStats} iconName="TrendingUp" iconColor="text-amber-500" headerColor="bg-amber-50/50 text-amber-800 border-amber-100" isEditing={isEditing} onUpdate={handleBudgetChange} onDelete={deleteCategory} />
            <BudgetColumn title="SAVINGS" bucket="SAVINGS" data={budgetStats} iconName="DollarSign" iconColor="text-blue-500" headerColor="bg-blue-50/50 text-blue-800 border-blue-100" isEditing={isEditing} onUpdate={handleBudgetChange} onDelete={deleteCategory} />
        </div>
      </div>
    </div>
  );
};

const BudgetColumn = ({ title, bucket, data, iconName, iconColor, headerColor, isEditing, onUpdate, onDelete }) => {
    const [expandedCat, setExpandedCat] = useState(null);
    const toggleExpand = (cat) => setExpandedCat(expandedCat === cat ? null : cat);

    const relevantCategories = Object.keys(data.categories)
        .filter(cat => data.categories[cat].bucket === bucket)
        .sort((a, b) => {
            if (data.categories[a].active !== data.categories[b].active) return data.categories[b].active - data.categories[a].active;
            return isEditing ? 0 : data.categories[b].spent - data.categories[a].spent;
        });

    const totalSpent = relevantCategories.reduce((sum, cat) => sum + data.categories[cat].spent, 0);
    const totalLimit = relevantCategories.reduce((sum, cat) => sum + (data.categories[cat].limit || 0), 0);

    return (
        <div className={`bg-card rounded-xl shadow-sm border overflow-hidden flex flex-col transition-colors ${isEditing ? 'border-primary/40' : 'border-border'}`}>
            <div className={`p-4 border-b flex justify-between items-center ${headerColor}`}>
                <div className="flex items-center gap-2 font-bold">
                    <Icon name={iconName} size={18} className={iconColor}/>
                    {title}
                </div>
                <div className="text-sm font-bold">${totalSpent.toLocaleString()} {!isEditing && <span className="opacity-60 text-xs font-normal">/ ${totalLimit.toLocaleString()}</span>}</div>
            </div>

            <div className="p-0 flex-1">
                {relevantCategories.length > 0 ? (
                    relevantCategories.map(cat => {
                        const item = data.categories[cat];
                        const isActive = item.active;
                        const pct = item.limit > 0 ? (item.spent / item.limit) * 100 : 0;
                        const isOver = item.spent > item.limit && item.limit > 0;
                        const isExpanded = expandedCat === cat;

                        return (
                            <div key={cat} className={`border-b border-border last:border-0 ${!isActive ? 'opacity-50 bg-muted/50' : ''}`}>
                                <div onClick={() => !isEditing && toggleExpand(cat)} className={`p-4 hover:bg-muted/30 transition-colors cursor-pointer ${isExpanded ? 'bg-muted/30' : ''}`}>

                                    <div className="flex justify-between items-center mb-1">
                                        <div className="flex items-center gap-2">
                                            {isEditing ? (
                                                <div
                                                    onClick={(e) => { e.stopPropagation(); onUpdate(cat, 'active', !isActive); }}
                                                    className={`cursor-pointer p-1 rounded-md transition-colors ${isActive ? 'bg-green-100 text-green-600' : 'bg-muted text-muted-foreground'}`}
                                                    title={isActive ? "Disable Category" : "Enable Category"}
                                                >
                                                    <Icon name="Power" size={14} strokeWidth={3} />
                                                </div>
                                            ) : (
                                                item.transactions.length > 0 && (
                                                    <Icon name={isExpanded ? "ChevronUp" : "ChevronDown"} size={14} className="text-muted-foreground"/>
                                                )
                                            )}

                                            <span className={`text-sm font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground line-through'}`}>{cat}</span>
                                        </div>

                                        {isEditing ? (
                                             <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); onDelete(cat); }} className="text-destructive hover:bg-destructive/10 h-6 w-6 p-0">
                                                <Icon name="Trash2" size={14}/>
                                             </Button>
                                        ) : (
                                            <span className={`text-sm font-bold ${isOver && isActive ? 'text-destructive' : 'text-foreground'}`}>${item.spent.toLocaleString()}</span>
                                        )}
                                    </div>

                                    <div className="flex justify-between items-center mb-1.5 min-h-[24px]">
                                            {isEditing ? (
                                                isActive && (
                                                    <div className="flex items-center gap-2 w-full animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                                        <span className="text-xs text-muted-foreground font-bold">Limit: $</span>
                                                        <input
                                                            type="number"
                                                            value={item.originalLimit}
                                                            onChange={(e) => onUpdate(cat, 'limit', parseFloat(e.target.value) || 0)}
                                                            className="w-full text-xs p-1 border border-primary/30 rounded focus:ring-2 focus:ring-primary focus:outline-none bg-primary/5"
                                                        />
                                                    </div>
                                                )
                                            ) : (
                                                isActive && (
                                                    <>
                                                        <span className="text-xs text-muted-foreground">Budget: ${item.limit.toLocaleString()}</span>
                                                        <span className={`text-xs ${isOver ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>{isOver ? `+$${(item.spent - item.limit).toLocaleString()}` : `${Math.abs(item.limit - item.spent).toLocaleString()} left`}</span>
                                                    </>
                                                )
                                            )}
                                    </div>

                                    {!isEditing && isActive && (
                                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                                            <div className={`h-1.5 rounded-full ${isOver ? 'bg-destructive' : 'bg-muted-foreground/50'}`} style={{ width: `${Math.min(pct, 100)}%` }}></div>
                                        </div>
                                    )}
                                </div>

                                {isExpanded && !isEditing && item.transactions.length > 0 && (
                                    <div className="bg-muted/30 px-4 pb-4 border-t border-border shadow-inner">
                                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 mt-2">Transactions</div>
                                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 scrollbar-thin">
                                                {item.transactions.map(t => (
                                                    <div key={t.id} className="flex justify-between text-xs border-b border-border/50 pb-1 last:border-0">
                                                        <div className="flex flex-col"><span className="text-foreground font-medium truncate max-w-[160px]">{t.merchant || t.description}</span><span className="text-muted-foreground">{t.dateString}</span></div>
                                                        <span className="text-foreground font-bold">${Math.abs(t.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                                                    </div>
                                                ))}
                                            </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                ) : <div className="p-8 text-center text-muted-foreground text-sm italic">No active categories.</div>}
            </div>
        </div>
    );
};

export default Budget;