import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const AccountContextSelector = ({ selectedAccountIds, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const dropdownRef = useRef(null);

  // Fetch Accounts on Mount
  useEffect(() => {
    const fetchAccounts = async () => {
      const { data } = await supabase.from('accounts').select('id, name, type');
      if (data) setAccounts(data);
    };
    fetchAccounts();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleAccount = (id) => {
    let newSelection;
    if (selectedAccountIds.includes(id)) {
      // Remove it
      newSelection = selectedAccountIds.filter(accId => accId !== id);
    } else {
      // Add it
      newSelection = [...selectedAccountIds, id];
    }
    onChange(newSelection);
  };

  const selectAll = () => onChange([]); // Empty array = "All Accounts"

  // Label Logic
  const getLabel = () => {
    if (selectedAccountIds.length === 0) return 'All Accounts';
    if (selectedAccountIds.length === 1) {
      const acc = accounts.find(a => a.id === selectedAccountIds[0]);
      return acc ? acc.name : '1 Account';
    }
    return `${selectedAccountIds.length} Accounts Selected`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* TRIGGER BUTTON */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg shadow-sm hover:bg-background transition-colors min-w-[200px] justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 text-blue-600 rounded-md">
            <Wallet size={16} />
          </div>
          <span className="text-sm font-bold text-foreground truncate max-w-[120px]">
            {getLabel()}
          </span>
        </div>
        <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* DROPDOWN MENU */}
      {isOpen && (
        <div className="absolute top-full mt-2 left-0 w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 space-y-1 max-h-80 overflow-y-auto">

            {/* ALL ACCOUNTS OPTION */}
            <button
              onClick={selectAll}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedAccountIds.length === 0 ? 'bg-blue-50 text-blue-700' : 'hover:bg-background text-foreground'
              }`}
            >
              <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                selectedAccountIds.length === 0 ? 'bg-blue-600 border-blue-600' : 'border-border'
              }`}>
                {selectedAccountIds.length === 0 && <Check size={12} className="text-white" />}
              </div>
              All Accounts
            </button>

            <div className="h-px bg-muted my-1" />

            {/* INDIVIDUAL ACCOUNTS */}
            {accounts.map((acc) => {
              const isSelected = selectedAccountIds.includes(acc.id);
              return (
                <button
                  key={acc.id}
                  onClick={() => toggleAccount(acc.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isSelected ? 'bg-blue-50/50' : 'hover:bg-background'
                  }`}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                    isSelected ? 'bg-blue-600 border-blue-600' : 'border-border'
                  }`}>
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                  <div className="text-left">
                    <span className={`block font-medium ${isSelected ? 'text-blue-900' : 'text-foreground'}`}>
                      {acc.name}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">{acc.type}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountContextSelector;