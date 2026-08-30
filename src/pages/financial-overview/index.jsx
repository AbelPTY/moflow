import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

import PrimaryNavBar from '../../components/navigation/PrimaryNavBar';
import useTransactions from '../../hooks/useTransactions';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import RecentActivityScanner from '../../components/RecentActivityScanner';

import { supabase } from '../../lib/supabase'; // <-- Important: Verify this path matches your setup!
import rulesData from '../../rules/merchant_rules.json';
import { classifyTransaction } from '../../lib/engine/ruleMatcher';
import useUserMerchantRules from '../../hooks/useUserMerchantRules';
import useOnboarding from '../../hooks/useOnboarding';

const COLORS = {
  'NEEDS': '#10B981',   // Emerald
  'WANTS': '#F59E0B',   // Amber
  'SAVINGS': '#3B82F6', // Blue
  'DEBT_FUNDING': '#EF4444', // Red
  'INCOME': '#8B5CF6',   // Violet
  'TRANSFERS': '#64748B', // Slate
  'Unsorted': '#9CA3AF'  // Gray
};

const ITEMS_PER_PAGE = 50;

// ==========================================
// 1. LOCAL UI COMPONENTS
// ==========================================

const AccountFilterDropdown = ({ accounts, selected, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleAccount = (account) => {
    if (selected.includes(account)) onChange(selected.filter(a => a !== account));
    else onChange([...selected, account]);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <Button variant="outline" onClick={() => setIsOpen(!isOpen)} className="min-w-[200px] justify-between bg-card text-foreground border-input" iconName="Wallet" iconPosition="left">
        <span className="truncate">{selected.length === 0 ? "All Accounts" : `${selected.length} Selected`}</span>
        <Icon name={isOpen ? "ChevronUp" : "ChevronDown"} size={14} className="ml-2 opacity-50" />
      </Button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="p-2 border-b border-border bg-muted/30">
            <div onClick={() => onChange([])} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted transition-colors">
              <Input type="checkbox" checked={selected.length === 0} readOnly className="pointer-events-none" />
              <span className="text-sm font-medium">All Accounts</span>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            {accounts.map(account => (
              <div key={account} onClick={() => toggleAccount(account)} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted transition-colors">
                <Input type="checkbox" checked={selected.includes(account)} readOnly className="pointer-events-none"/>
                <span className="text-sm text-foreground truncate">{account}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const KPICard = ({ title, value, change, changeType, iconName, iconColor }) => (
  <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2 border border-border flex items-start justify-between bg-card">
    <div>
      <p className="text-muted-foreground text-sm font-medium mb-1">{title}</p>
      <h3 className="text-2xl font-bold text-foreground">{value}</h3>
      <div className={`flex items-center gap-1 mt-2 text-xs font-bold ${changeType === 'positive' ? 'text-green-600' : changeType === 'negative' ? 'text-red-600' : 'text-muted-foreground'}`}>
        <span>{change}</span>
      </div>
    </div>
    <div className="p-3 rounded-lg bg-opacity-10" style={{ backgroundColor: `${iconColor}20` }}><Icon name={iconName} size={24} color={iconColor} /></div>
  </div>
);

const NetWorthChart = ({ data }) => {
  const chartData = useMemo(() => {
    if (!data) return [];
    const sorted = [...data].sort((a,b) => new Date(a.dateString) - new Date(b.dateString));
    const grouped = {};
    let runningBalance = 0;
    sorted.forEach(t => {
      // Match the headline Net Worth definition: income inflow minus
      // needs/wants spending. Excludes transfers, CC payments, cash
      // withdrawals, savings and debt movements so internal shuffles don't
      // distort the trend (and the line ends at the headline Net Worth value).
      const isIncome = t.amount > 0 && t.budgetBucket === 'INCOME';
      const isSpend = t.amount < 0 && (t.budgetBucket === 'NEEDS' || t.budgetBucket === 'WANTS');
      if (!isIncome && !isSpend) return;
      runningBalance += t.amount;
      grouped[t.dateString.substring(0, 7)] = runningBalance;
    });
    return Object.entries(grouped).map(([date, amount]) => ({ date, amount })).slice(-12);
  }, [data]);

  return (
    <div className="bg-card p-6 rounded-xl shadow-elevation-2 border border-border h-96 bg-card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-foreground">Net Worth Trend</h3>
        <span className="text-xs font-medium px-2 py-1 rounded-full bg-blue-50 text-blue-700">Selected Accounts</span>
      </div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs><linearGradient id="colorB" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <RechartsTooltip formatter={(val) => [`$${val.toLocaleString()}`, 'Net Worth']} />
            <Area type="monotone" dataKey="amount" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorB)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SpendingBreakdownChart = ({ data }) => {
  const chartData = useMemo(() => {
    if(!data) return [];
    const expenses = data.filter(t => t.amount < 0 && (t.budgetBucket === 'NEEDS' || t.budgetBucket === 'WANTS'));
    const grouped = expenses.reduce((acc, t) => {
      const bucket = t.budgetBucket;
      acc[bucket] = (acc[bucket] || 0) + Math.abs(t.amount);
      return acc;
    }, {});
    return Object.keys(grouped).map(name => ({ name, value: grouped[name] })).sort((a, b) => b.value - a.value);
  }, [data]);

  return (
    <div className="bg-card p-6 rounded-xl shadow-elevation-2 border border-border h-96 bg-card">
      <h3 className="text-lg font-bold text-foreground mb-4">Spending by Bucket</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
              {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[entry.name] || '#9CA3AF'} />)}
            </Pie>
            <RechartsTooltip formatter={(val) => `$${val.toLocaleString()}`} />
            <Legend verticalAlign="bottom" height={36}/>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ==========================================
// 2. MAIN PAGE COMPONENT
// ==========================================

const FinancialOverview = () => {
  const [timeRange, setTimeRange] = useState('all');
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [bucketFilter, setBucketFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkBucket, setBulkBucket] = useState('');
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  const filters = useMemo(() => ({ dateRange: 'all' }), []);
  const transactionOptions = useMemo(() => ({ filters }), [filters]);

  const { transactions, loading, refetch, updateTransaction, deleteTransaction } = useTransactions(null, transactionOptions);
  const { userRules } = useUserMerchantRules(); // active user rules (empty today)

  // Recent-activity screenshot import lives here (Activity is its home).
  const [showActivityScanner, setShowActivityScanner] = useState(false);
  const { updateOnboarding } = useOnboarding();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from the Flow next-step prompt: /financial-overview?scan=activity
  // reveals the scanner (but never auto-triggers the file picker). Strip the
  // param afterward so a refresh doesn't keep reopening it.
  useEffect(() => {
    if (searchParams.get('scan') === 'activity') {
      setShowActivityScanner(true);
      const next = new URLSearchParams(searchParams);
      next.delete('scan');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uniqueAccounts = useMemo(() => transactions ? [...new Set(transactions.map(t => t.account).filter(Boolean))].sort() : [], [transactions]);
  const uniqueCategories = useMemo(() => transactions ? [...new Set(transactions.map(t => t.category).filter(Boolean))].sort() : [], [transactions]);
  const uniqueBuckets = useMemo(() => transactions ? [...new Set(transactions.map(t => t.budgetBucket).filter(Boolean))].sort() : [], [transactions]);

  const uniqueYears = useMemo(() => {
    if (!transactions) return [];
    const validTransactions = transactions.filter(t => t.dateString && typeof t.dateString === 'string');
    const years = new Set(validTransactions.map(t => t.dateString.substring(0, 4)));
    return [...years].sort().reverse();
  }, [transactions]);

  const processedData = useMemo(() => {
    if (!transactions) return [];
    let data = transactions;
    if (selectedAccounts.length > 0) data = data.filter(t => selectedAccounts.includes(t.account));
    if (timeRange !== 'all') data = data.filter(t => t.dateString && t.dateString.startsWith(timeRange));
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      data = data.filter(t => (t.merchant || '').toLowerCase().includes(lower) || (t.amount || 0).toString().includes(lower));
    }
    if (minAmount !== '') data = data.filter(t => Math.abs(t.amount) >= parseFloat(minAmount));
    if (maxAmount !== '') data = data.filter(t => Math.abs(t.amount) <= parseFloat(maxAmount));
    if (categoryFilter !== 'All') data = data.filter(t => t.category === categoryFilter);
    if (bucketFilter !== 'All') data = data.filter(t => t.budgetBucket === bucketFilter);
    if (typeFilter === 'Income') data = data.filter(t => t.amount > 0);
    else if (typeFilter === 'Expense') data = data.filter(t => t.amount < 0);

    data.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];
      if (sortConfig.key === 'amount') { aVal = parseFloat(a.amount); bVal = parseFloat(b.amount); }
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [transactions, selectedAccounts, timeRange, searchTerm, minAmount, maxAmount, categoryFilter, bucketFilter, typeFilter, sortConfig]);

  const financialStats = useMemo(() => {
    if (!processedData.length) return null;
    const inflow = processedData.filter(t => t.amount > 0 && t.budgetBucket === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
    const outflow = processedData.filter(t => t.amount < 0 && (t.budgetBucket === 'NEEDS' || t.budgetBucket === 'WANTS')).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { netWorth: inflow - outflow, inflow, outflow, count: processedData.length };
  }, [processedData]);

  const filteredStats = useMemo(() => {
    const total = processedData.reduce((sum, t) => sum + t.amount, 0);
    return { count: processedData.length, amount: total };
  }, [processedData]);

  const totalPages = Math.ceil(processedData.length / ITEMS_PER_PAGE);
  const currentData = processedData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleSort = (key) => setSortConfig(c => ({ key, direction: c.key === key && c.direction === 'desc' ? 'asc' : 'desc' }));
  const toggleSelectOne = (id) => { const s = new Set(selectedIds); if(s.has(id)) s.delete(id); else s.add(id); setSelectedIds(s); };
  const toggleSelectAll = () => { if(selectedIds.size === currentData.length) setSelectedIds(new Set()); else setSelectedIds(new Set(currentData.map(t => t.id))); };

  const clearFilters = () => {
    setSearchTerm(''); setMinAmount(''); setMaxAmount('');
    setCategoryFilter('All'); setBucketFilter('All'); setTypeFilter('All');
    setSelectedAccounts([]); setTimeRange('all'); setCurrentPage(1);
  };

 const startEditing = (t) => { setEditingId(t.id); setEditForm({ ...t }); };
const cancelEditing = () => { setEditingId(null); setEditForm({}); };
const handleEditChange = (field, value) => { setEditForm(prev => ({ ...prev, [field]: value })); };

const handleDeleteTransaction = async (t) => {
  const label = t.merchant || t.description || 'this transaction';
  const confirmed = window.confirm(
    `Delete "${label}" (${t.dateString}, $${Math.abs(t.amount).toFixed(2)})? This can't be undone.`
  );
  if (!confirmed) return;

  try {
    await deleteTransaction(t.id);
  } catch (err) {
    console.error('Delete transaction error:', err);
    alert('Failed to delete transaction: ' + (err?.message || 'Unknown error'));
  }
};

  const saveEditing = async () => {
    if (updateTransaction) {
        const updates = { ...editForm };
        if (['TRANSFERS', 'CC_PAYMENT', 'ADJUSTMENT'].includes(updates.budgetBucket)) {
            updates.is_transfer = true;
        } else if (['INCOME', 'NEEDS', 'WANTS', 'SAVINGS'].includes(updates.budgetBucket)) {
            updates.is_transfer = false;
        }
        await updateTransaction(editingId, updates);
    }
    setEditingId(null); setEditForm({});
  };

  const handleBulkUpdate = async () => {
    if (!updateTransaction || selectedIds.size === 0) return;
    if (!bulkCategory && !bulkBucket) return;

    setIsBulkUpdating(true);
    const updates = {};
    if (bulkCategory) updates.category = bulkCategory;
    if (bulkBucket) {
        updates.budget_bucket = bulkBucket;
        if (['TRANSFERS', 'CC_PAYMENT', 'ADJUSTMENT'].includes(bulkBucket)) {
            updates.is_transfer = true;
        } else if (['INCOME', 'NEEDS', 'WANTS', 'SAVINGS'].includes(bulkBucket)) {
            updates.is_transfer = false;
        }
    }

    const promises = Array.from(selectedIds).map(id => updateTransaction(id, updates));
    await Promise.all(promises);

    setIsBulkUpdating(false);
    setSelectedIds(new Set());
    setBulkCategory(''); setBulkBucket('');
  };

  const handleBulkDelete = async () => {
    if (!deleteTransaction || selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmed = window.confirm(
      `Delete ${count} selected transaction${count === 1 ? '' : 's'}? This can't be undone.`
    );
    if (!confirmed) return;

    setIsBulkUpdating(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      const results = await Promise.allSettled(idsToDelete.map(id => deleteTransaction(id)));
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed > 0) {
        alert(`Deleted ${count - failed} of ${count} transactions. ${failed} failed -- check console for details.`);
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
      alert('Failed to delete selected transactions: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsBulkUpdating(false);
      setSelectedIds(new Set());
    }
  };

  // --- THE MEGA-DICTIONARY MAGIC SWEEP ---
  const handleMagicSweep = async () => {
    if(!window.confirm("This will scan the database and automatically bucket your Unsorted transactions. Ready?")) return;
    setIsBulkUpdating(true);

    // The massive dictionary containing all your custom categories
    const autoBucketMap = {
      // Income
      'Income': 'INCOME',
      'Interest Income': 'INCOME',
      'Salary': 'INCOME',
      'Reimbursements': 'INCOME',

      // Needs
      'Health': 'NEEDS',
      'Maintenance': 'NEEDS',
      'Groceries': 'NEEDS',
      'Transportation': 'NEEDS',
      'Transport': 'NEEDS',
      'Utilities': 'NEEDS',
      'Financial': 'NEEDS',
      'Financial Fees': 'NEEDS',
      'Supermercados': 'NEEDS',
      'Health Insurance': 'NEEDS',
      'Insurance': 'NEEDS',
      'Life Insurance': 'NEEDS',
      'Medical/Health': 'NEEDS',
      'Household Help': 'NEEDS',
      'Education': 'NEEDS',

      // Wants
      'Miscellaneous': 'WANTS',
      'Dining Out': 'WANTS',
      'Food': 'WANTS',
      'Shopping': 'WANTS',
      'Tiendas y almacenes': 'WANTS',
      'Comida y Bebida': 'WANTS',
      'Sports': 'WANTS',
      'Subscriptions': 'WANTS',
      'Membership Fees': 'WANTS', // legacy alias for Subscriptions
      'Office/Social Events': 'WANTS',
      'Work Expenses': 'WANTS',

      // Debt
      'Debt Payment': 'DEBT_FUNDING',
      'Debt Repayment': 'DEBT_FUNDING',

      // Transfers / Savings
      'Transfer': 'TRANSFERS',
      'Payment': 'TRANSFERS',
      'Cash': 'TRANSFERS',
      'Cash Swap': 'TRANSFERS',
      'Credit Card Payment': 'TRANSFERS',
      'Savings Contribution': 'TRANSFERS',
      'Savings/Investment': 'SAVINGS'
    };

    try {
      // Send bulk updates directly to Supabase
      for (const [cat, bucket] of Object.entries(autoBucketMap)) {
         await supabase
           .from('transactions')
           .update({ budget_bucket: bucket })
           .eq('category', cat)
           .in('budget_bucket', ['Unsorted', 'Uncategorized', '', null]);
      }
     alert(`Magic Sweep Complete! Automatically assigned buckets for known categories.`);
      window.location.reload(); // Hard refresh to pull pristine data
    } catch (err) {
      console.error(err);
      alert("Error running Magic Sweep. Check console.");
    }
    setIsBulkUpdating(false);
  };

  // Applies your actual merchant_rules.json to every transaction that's still
  // Uncategorized in the DATABASE (even if it currently *displays* correctly
  // thanks to the same rules being re-applied live on this page -- that live
  // repaint never gets saved, so this is what actually fixes the underlying
  // data). Also feeds the bulk-upload "learn from history" feature, since it
  // only learns from what's really stored, not what's just displayed.
  const handleRuleBasedCategorize = async () => {
    if (!window.confirm("This will scan ALL your Uncategorized transactions and apply your saved rules to permanently assign real categories and buckets. This may take a moment for ~2,000+ transactions. Ready?")) return;
    setIsBulkUpdating(true);

    try {
      const { data: uncategorized, error } = await supabase
        .from('transactions')
        .select('id, description, description_raw, merchant')
        .or('category.is.null,category.eq.Uncategorized');

      if (error) throw error;

      if (!uncategorized || uncategorized.length === 0) {
        alert('No uncategorized transactions found -- nothing to do.');
        setIsBulkUpdating(false);
        return;
      }

      // Group matched transaction IDs by their target (category, bucket) pair,
      // so we can update many rows in one request per group instead of one
      // request per row (much faster for thousands of transactions).
      const updateGroups = new Map();
      let matchedCount = 0;

      for (const row of uncategorized) {
        const description = String(row.description_raw || row.description || row.merchant || '').toUpperCase();
        // MANUAL -> LEGACY(STATIC + MIGRATED). Empty userRules today -> pure static.
        const match = classifyTransaction({ merchant: row.merchant, description }, rulesData?.rules, userRules);
        if (match) {
          const assign = match.rule.assign;
          const key = `${assign.category}|||${assign.budgetBucket}|||${assign.is_transfer}`;
          if (!updateGroups.has(key)) updateGroups.set(key, []);
          updateGroups.get(key).push(row.id);
          matchedCount++;
        }
      }

      for (const [key, ids] of updateGroups.entries()) {
        const [category, budget_bucket, is_transfer_str] = key.split('|||');
        const is_transfer = is_transfer_str === 'true';

        // Supabase .in() can choke on very large ID lists -- chunk into batches of 200
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const { error: updateError } = await supabase
            .from('transactions')
            .update({ category, budget_bucket, is_transfer })
            .in('id', chunk);
          if (updateError) throw updateError;
        }
      }

      const unmatchedCount = uncategorized.length - matchedCount;
      alert(`Done! Categorized ${matchedCount} of ${uncategorized.length} previously uncategorized transactions using your rules.\n\n${unmatchedCount} still have no matching rule and remain Uncategorized -- these are genuinely new merchants worth reviewing manually or adding a rule for.`);
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert('Error running rule-based categorization: ' + (err?.message || 'Unknown error'));
      setIsBulkUpdating(false);
    }
  };

  const handleExportCSV = () => {
    if (!processedData.length) return;
    const headers = ['Date', 'Merchant', 'Amount', 'Category', 'Bucket', 'Account'];
    const rows = processedData.map(t => [ t.dateString, `"${t.merchant.replace(/"/g, '""')}"`, t.amount, t.category, t.budgetBucket, t.account ]);
    const csvContent = [ headers.join(','), ...rows.map(row => row.join(',')) ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `transactions_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <PrimaryNavBar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Financial Overview</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-muted-foreground font-medium">
                {timeRange === 'all' ? 'All Time History' : `${timeRange} Fiscal Year`}
              </p>
              {loading && <span className="text-xs text-primary animate-pulse ml-2 font-bold">Syncing...</span>}
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
             <Button variant="default" className="bg-blue-600 hover:bg-blue-700 text-white h-10" iconName="ScanLine" iconPosition="left" onClick={() => setShowActivityScanner((s) => !s)}>
               Scan recent activity
             </Button>
             <AccountFilterDropdown accounts={uniqueAccounts} selected={selectedAccounts} onChange={setSelectedAccounts}/>
             <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="bg-card border border-input rounded-lg p-2 text-sm font-medium shadow-sm h-10">
               <option value="all">All Time</option>
               {uniqueYears.map(year => <option key={year} value={year}>{year}</option>)}
             </select>
          </div>
        </div>

        {showActivityScanner && (
          <div className="mb-8">
            <RecentActivityScanner
              accounts={uniqueAccounts}
              onImported={() => {
                updateOnboarding({ activityImportCompleted: true });
                if (refetch) refetch();
              }}
              onClose={() => setShowActivityScanner(false)}
            />
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <KPICard title="Net Position" value={`$${financialStats?.netWorth.toLocaleString() || '0.00'}`} change="Real Income - Expense" changeType={financialStats?.netWorth >= 0 ? 'positive' : 'negative'} iconName="TrendingUp" iconColor="#10B981" />
          <KPICard title="Real Income" value={`$${financialStats?.inflow.toLocaleString() || '0.00'}`} change="Salary & Interest Only" changeType="positive" iconName="DollarSign" iconColor="#3B82F6" />
          <KPICard title="Real Spending" value={`$${financialStats?.outflow.toLocaleString() || '0.00'}`} change="Needs & Wants Only" changeType="neutral" iconName="CreditCard" iconColor="#F59E0B" />
          <KPICard title="Activity" value={financialStats?.count || 0} change="Total Rows" changeType="neutral" iconName="List" iconColor="#6366F1" />
        </div>

        {/* CHARTS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
           <NetWorthChart data={processedData} />
           <SpendingBreakdownChart data={processedData} />
        </div>

        {/* TRANSACTION MANAGER */}
        <div className="bg-card rounded-xl shadow-elevation-2 border border-border overflow-hidden bg-card relative">

          {/* BULK EDIT BAR */}
          {selectedIds.size > 0 && (
            <div className="absolute top-0 left-0 right-0 bg-primary text-primary-foreground p-3 z-20 flex items-center justify-between animate-in slide-in-from-top-2">
               <div className="flex items-center gap-4">
                  <span className="font-bold text-sm px-3 py-1 bg-white/20 rounded-full">{selectedIds.size} Selected</span>
                  <div className="flex items-center gap-2">
                     <span className="text-xs opacity-80">Category:</span>
                     <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className="h-8 rounded bg-card text-foreground text-xs border-0 px-2 focus:ring-2 focus:ring-white">
                       <option value="">-- No Change --</option>
                       <option value="Lunch Reimbursement">Lunch Reimbursement</option>
                       <option value="Transfer In">Transfer In</option>
                       <option value="Transfer">Transfer</option>
                       {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                     </select>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-xs opacity-80">Bucket:</span>
                     <select value={bulkBucket} onChange={(e) => setBulkBucket(e.target.value)} className="h-8 rounded bg-card text-foreground text-xs border-0 px-2 focus:ring-2 focus:ring-white">
                       <option value="">-- No Change --</option>
                       <option value="TRANSFERS">TRANSFERS</option>
                       <option value="INCOME">INCOME</option>
                       <option value="NEEDS">NEEDS</option>
                       <option value="WANTS">WANTS</option>
                       <option value="SAVINGS">SAVINGS</option>
                     </select>
                  </div>
               </div>
              <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="bg-transparent border-white/50 text-white hover:bg-white/20" onClick={() => setSelectedIds(new Set())}>Cancel</Button>
                  <Button variant="default" size="sm" className="bg-card text-primary hover:bg-white/90 font-bold shadow-lg" onClick={handleBulkUpdate} disabled={isBulkUpdating || (!bulkCategory && !bulkBucket)}>{isBulkUpdating ? 'Updating...' : 'Update'}</Button>
                  <Button variant="destructive" size="sm" className="font-bold shadow-lg" iconName="Trash2" onClick={handleBulkDelete} disabled={isBulkUpdating}>{isBulkUpdating ? 'Deleting...' : `Delete ${selectedIds.size}`}</Button>
               </div>
            </div>
          )}

          {/* TOOLBAR */}
          <div className="p-4 border-b border-border flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center bg-muted/20 pt-16 xl:pt-4">
             <div className="flex flex-col md:flex-row gap-2 w-full xl:w-auto flex-1">
                <div className="relative flex-grow">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"><Icon name="Search" size={16} /></div>
                    <input type="text" placeholder="Search merchant..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div className="w-24"><input type="number" placeholder="Min $" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
                <div className="w-24"><input type="number" placeholder="Max $" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
             </div>
             <div className="flex flex-col md:flex-row gap-4 items-center w-full xl:w-auto mt-4 xl:mt-0">
               <div className="flex items-center gap-3 px-3 py-1 bg-card border border-border rounded-lg shadow-sm w-full md:w-auto justify-between md:justify-start">
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Filtered Sum</p>
                    <p className={`text-sm font-mono font-bold ${filteredStats.amount > 0 ? 'text-green-600' : 'text-foreground'}`}>{filteredStats.amount > 0 ? '+' : ''}${filteredStats.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="h-8 w-px bg-border mx-1"></div>
                  <div><p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Count</p><p className="text-sm font-mono font-bold text-foreground">{filteredStats.count}</p></div>
               </div>
               <div className="flex gap-2 w-full md:w-auto flex-wrap md:flex-nowrap items-center">
                 <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer"><option value="All">All Types</option><option value="Income">Income (+)</option><option value="Expense">Expense (-)</option></select>
                 <select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer"><option value="All">All Buckets</option>{uniqueBuckets.map(b => <option key={b} value={b}>{b}</option>)}</select>
                 <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer max-w-[150px]"><option value="All">All Categories</option>{uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}</select>

                 {/* THE NEW BUTTONS */}
                 <Button variant="ghost" size="icon" iconName="X" onClick={clearFilters} title="Clear All Filters" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"/>
                 <Button variant="outline" size="icon" iconName="Download" onClick={handleExportCSV} title="Export to CSV" />
                 <Button variant="default" className="bg-indigo-600 hover:bg-indigo-700 text-white ml-2 text-xs h-10 px-3 shadow-md" iconName="Wand" onClick={handleMagicSweep} disabled={isBulkUpdating}>
                    {isBulkUpdating ? 'Fixing...' : 'Magic Sweep'}
                 </Button>
                 <Button variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-10 px-3 shadow-md" iconName="Sparkles" onClick={handleRuleBasedCategorize} disabled={isBulkUpdating}>
                    {isBulkUpdating ? 'Working...' : 'Categorize from Rules'}
                 </Button>
               </div>
             </div>
          </div>

          {/* TABLE */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase text-muted-foreground font-semibold tracking-wider">
                <tr>
                  <th className="p-4 w-10"><button onClick={toggleSelectAll} className="hover:text-foreground">{selectedIds.size > 0 && selectedIds.size === currentData.length ? <Icon name="CheckSquare" size={18} className="text-primary"/> : <Icon name="Square" size={18} className="text-muted-foreground"/>}</button></th>
                  <th className="p-4 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('date')}>Date</th>
                  <th className="p-4 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('merchant')}>Merchant</th>
                  <th className="p-4 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('category')}>Category</th>
                  <th className="p-4 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('budgetBucket')}>Bucket</th>
                  <th className="p-4 text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('amount')}>Amount</th>
                  <th className="p-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm">
                {currentData.length === 0 ? (
                  <tr><td colSpan="7" className="p-12 text-center text-muted-foreground italic">No transactions found matching your filters.</td></tr>
                ) : currentData.map(t => {
                  const isEditing = editingId === t.id;
                  return (
                  <tr key={t.id} className={`hover:bg-muted/30 transition-colors ${selectedIds.has(t.id) ? 'bg-primary/5' : ''}`}>
                    <td className="p-4"><Input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelectOne(t.id)} className="cursor-pointer" disabled={isEditing} /></td>
                    <td className="p-4 text-muted-foreground whitespace-nowrap">{t.dateString}</td>
                    <td className="p-4">{isEditing ? (<div className="flex flex-col gap-1"><input type="text" value={editForm.merchant} onChange={(e) => handleEditChange('merchant', e.target.value)} className="border border-primary rounded p-1 text-sm w-full bg-card" autoFocus /><input type="text" value={editForm.description || ''} onChange={(e) => handleEditChange('description', e.target.value)} className="border border-border rounded p-1 text-xs w-full bg-muted/20" placeholder="Original Description" /></div>) : (<><div className="font-bold text-foreground">{t.merchant}</div><div className="text-xs text-muted-foreground truncate max-w-[200px]">{t.description}</div></>)}</td>
                    <td className="p-4">{isEditing ? (<select value={editForm.category} onChange={(e) => handleEditChange('category', e.target.value)} className="border border-primary rounded p-1 text-xs w-full bg-card">{uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}</select>) : (<span className="bg-muted text-foreground px-2 py-1 rounded-md text-xs font-medium border border-border">{t.category}</span>)}</td>
                    <td className="p-4">{isEditing ? (<select value={editForm.budgetBucket} onChange={(e) => handleEditChange('budgetBucket', e.target.value)} className="border border-primary rounded p-1 text-xs w-full bg-card">{['NEEDS', 'WANTS', 'SAVINGS', 'INCOME', 'TRANSFERS', 'DEBT_FUNDING'].map(b => <option key={b} value={b}>{b}</option>)}</select>) : (<span className={`px-2 py-1 rounded text-xs font-bold border ${t.budgetBucket === 'NEEDS' ? 'bg-green-100 text-green-800 border-green-200' : t.budgetBucket === 'WANTS' ? 'bg-orange-100 text-orange-800 border-orange-200' : 'bg-muted text-muted-foreground border-border'}`}>{t.budgetBucket}</span>)}</td>
                    <td className={`p-4 text-right font-mono font-medium ${t.amount > 0 ? 'text-green-600' : 'text-foreground'}`}>{t.amount > 0 ? '+' : ''}${Math.abs(t.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className="p-4 text-center">{isEditing ? (<div className="flex justify-center gap-1"><Button variant="success" size="icon" iconName="Check" className="h-8 w-8" onClick={saveEditing} /><Button variant="outline" size="icon" iconName="X" className="h-8 w-8 text-muted-foreground" onClick={cancelEditing} title="Cancel edit" /></div>) : (<div className="flex justify-center gap-1"><Button variant="ghost" size="icon" iconName="Edit2" onClick={() => startEditing(t)} className="hover:bg-primary/10 text-muted-foreground hover:text-primary" title="Edit" /><Button variant="ghost" size="icon" iconName="Trash2" onClick={() => handleDeleteTransaction(t)} className="hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete" /></div>)}</td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border bg-muted/20 flex justify-between items-center">
             <span className="text-xs text-muted-foreground font-medium">Page {currentPage} of {totalPages}</span>
             <div className="flex gap-1">
               <Button variant="outline" size="icon" iconName="ChevronLeft" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage===1} />
               <Button variant="outline" size="icon" iconName="ChevronRight" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage===totalPages} />
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinancialOverview;
