import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';

const FilterPanel = ({ filters, onFilterChange }) => {
  const [dateRange, setDateRange] = useState(filters?.dateRange || 'all');
  const [startDate, setStartDate] = useState(filters?.startDate || '');
  const [endDate, setEndDate] = useState(filters?.endDate || '');
  const [selectedAccounts, setSelectedAccounts] = useState(['all']);
  const [isExpanded, setIsExpanded] = useState(true);

  const dateRangeOptions = [
    { value: 'all', label: 'All Time (Full 2,162 Rows)' },
    { value: 'last7days', label: 'Last 7 Days' },
    { value: 'last30days', label: 'Last 30 Days' },
    { value: 'thisYear', label: 'This Year (2026)' },
    { value: 'custom', label: 'Custom 2025 Range' }
  ];

  const handleApplyFilters = () => {
    onFilterChange({
      dateRange,
      startDate,
      endDate,
      selectedAccounts
    });
  };

  const handleResetFilters = () => {
    setDateRange('all');
    setStartDate('');
    setEndDate('');
    onFilterChange({ dateRange: 'all', startDate: '', endDate: '' });
  };

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2 mb-6 border border-primary/10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="Filter" size={20} className="text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Sync Panama 2025 Data</h3>
        </div>
        <button onClick={() => setIsExpanded(!isExpanded)} className="p-2 hover:bg-muted rounded-lg">
          <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={20} />
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Select
              label="Date Range"
              options={dateRangeOptions}
              value={dateRange}
              onChange={setDateRange}
            />

            {/* FIXED CALENDAR: Teleports picker to 2025 range */}
            {dateRange === 'custom' && (
              <>
                <Input
                  type="date"
                  label="Start Date"
                  value={startDate}
                  min="2025-01-01"
                  max="2025-12-31"
                  placeholder="2025-01-01"
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <Input
                  type="date"
                  label="End Date"
                  value={endDate}
                  min="2025-01-01"
                  max="2025-12-31"
                  placeholder="2025-12-31"
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </>
            )}

            <div className="flex items-end">
               <button
                onClick={handleApplyFilters}
                className="w-full h-10 flex items-center justify-center gap-2 px-6 bg-primary text-white rounded-lg font-bold hover:bg-primary/90 transition-all"
              >
                <Icon name="Check" size={16} />
                Apply & Refresh
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2 border-t border-border">
            <button onClick={handleResetFilters} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Icon name="RotateCcw" size={14} />
              Reset to All 2,162 Rows
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilterPanel;