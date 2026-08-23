import React from 'react';
import Icon from '../../../components/AppIcon';

// Added onResetMonth to the props
const UpcomingBillsTimeline = ({ bills, onMarkAsPaid, onResetMonth }) => {

  // ... (keep your existing helper functions like getDaysUntil, getCardStyle, renderStatusDot)

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-2">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h3 className="text-base md:text-lg font-semibold text-foreground">Upcoming Bills</h3>

        {/* NEW: The Header Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={onResetMonth}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-md transition-smooth"
            title="Roll over paid recurring bills to next month"
          >
            <Icon name="RotateCcw" size={14} />
            <span className="hidden sm:inline">Reset Month</span>
          </button>
          <Icon name="Calendar" size={20} className="text-muted-foreground" />
        </div>
      </div>

      {/* ... (keep your existing mapping of bills here) */}
