import React, { useState } from 'react';
import Icon from './AppIcon';
import AddTransaction from './AddTransaction';
import BulkUpload from './BulkUpload';

// A single "+" speed-dial that merges the two "add data" actions —
// Add Transaction and Bulk Upload — into one floating button. Tapping "+"
// fans out both options; each opens its (now controlled) modal. Keeping them
// under one FAB declutters the corner and leaves the mic button on its own.
export default function QuickActionsFab({ onDataChanged }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const openAdd = () => { setMenuOpen(false); setShowAdd(true); };
  const openUpload = () => { setMenuOpen(false); setShowUpload(true); };

  return (
    <>
      {/* Backdrop to dismiss the fanned-out menu on outside tap */}
      {menuOpen && (
        <div className="fixed inset-0 z-[59]" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}

      <div className="fixed right-5 bottom-20 md:bottom-6 md:right-6 z-[60] flex flex-col items-end gap-3">
        {/* Fanned-out action items */}
        {menuOpen && (
          <div className="flex flex-col items-end gap-3 mb-1">
            <button
              onClick={openUpload}
              className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-card shadow-lg border border-border group"
            >
              <span className="text-sm font-semibold text-foreground whitespace-nowrap">Upload statement</span>
              <span className="w-11 h-11 rounded-full bg-[#34C759] text-white flex items-center justify-center shrink-0">
                <Icon name="FileUp" size={20} />
              </span>
            </button>

            <button
              onClick={openAdd}
              className="flex items-center gap-2 pl-3 pr-1 py-1 rounded-full bg-card shadow-lg border border-border group"
            >
              <span className="text-sm font-semibold text-foreground whitespace-nowrap">Add transaction</span>
              <span className="w-11 h-11 rounded-full bg-[#007AFF] text-white flex items-center justify-center shrink-0">
                <Icon name="Plus" size={22} />
              </span>
            </button>
          </div>
        )}

        {/* Main + / x trigger */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? 'Close quick actions' : 'Quick actions'}
          aria-expanded={menuOpen}
          className="w-[60px] h-[60px] rounded-full bg-[#007AFF] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.3)] hover:bg-[#0069DB] transition-transform"
        >
          <Icon name="Plus" size={30} className={`transition-transform duration-200 ${menuOpen ? 'rotate-45' : ''}`} />
        </button>
      </div>

      {/* Controlled modals */}
      <AddTransaction open={showAdd} onClose={() => setShowAdd(false)} onTransactionAdded={onDataChanged} />
      <BulkUpload open={showUpload} onClose={() => setShowUpload(false)} onTransactionsAdded={onDataChanged} />
    </>
  );
}
