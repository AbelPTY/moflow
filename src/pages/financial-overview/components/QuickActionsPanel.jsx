import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
// NOTE: ReceiptUploadModal was removed — it used an insecure client-side
// OpenAI key AND inserted into transaction columns that don't exist in
// the real schema (transaction_date, tax_amount, etc). The working,
// secure version of this feature already lives in AddTransaction.jsx
// (rendered globally in App.jsx) which calls /api/scanReceipt safely.

const QuickActionsPanel = () => {
  const handleActionClick = (actionType) => {
    if (actionType === 'upload-receipt') {
      // Scanning now happens via the global "Add Transaction" button
      // (see AddTransaction.jsx, rendered in App.jsx) which has a
      // built-in camera/scan option that safely calls /api/scanReceipt.
      alert('Use the "+" Add Transaction button to scan a receipt.');
      return;
    }
    // Handle other actions as needed
  };

  const actions = [
    {
      id: 1,
      title: "Upload Receipt",
      description: "Scan receipt to add expense",
      icon: "Camera",
      color: "var(--color-primary)",
      action: "upload-receipt"
    },
    {
      id: 2,
      title: "Add Transaction",
      description: "Record a new expense or income",
      icon: "Plus",
      color: "var(--color-primary)",
      action: "add-transaction"
    },
    {
      id: 3,
      title: "Set Budget",
      description: "Create or modify spending limits",
      icon: "Target",
      color: "var(--color-secondary)",
      action: "set-budget"
    },
    {
      id: 4,
      title: "Export Report",
      description: "Download financial statements",
      icon: "Download",
      color: "var(--color-accent)",
      action: "export-report"
    },
    {
      id: 5,
      title: "View Insights",
      description: "AI-powered financial analysis",
      icon: "Sparkles",
      color: "var(--color-success)",
      action: "view-insights"
    }
  ];

  return (
    <>
      <div className="bg-card rounded-xl p-4 md:p-6 shadow-elevation-2">
      <h2 className="text-lg md:text-xl font-semibold text-foreground mb-4 md:mb-6">Quick Actions</h2>
      <div className="grid grid-cols-1 gap-3">
        {actions?.map((action) => (
          <button
            key={action?.id}
            onClick={() => handleActionClick(action?.action)}
            className="flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth text-left w-full"
          >
            <div
              className="w-10 h-10 md:w-12 md:h-12 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${action?.color}15` }}
            >
              <Icon name={action?.icon} size={20} color={action?.color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm md:text-base font-medium text-foreground mb-0.5">
                {action?.title}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {action?.description}
              </p>
            </div>
            <Icon name="ChevronRight" size={16} className="text-muted-foreground flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
    </>
  );
};

export default QuickActionsPanel;
