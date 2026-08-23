import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';

// Mobile-only bottom tab bar (hidden on md+). Four primary tabs plus a "More"
// sheet for the rest, so the phone feels like a native app instead of a
// hamburger list.
const PRIMARY = [
  { label: 'Overview', path: '/financial-overview', icon: 'LayoutDashboard' },
  { label: 'Cash Flow', path: '/cash-flow', icon: 'CalendarClock' },
  { label: 'Cards', path: '/cards', icon: 'CreditCard' },
  { label: 'Budget', path: '/budget-tracking', icon: 'Wallet' },
];
const MORE = [
  { label: 'Action Plan', path: '/action-plan', icon: 'ListChecks' },
  { label: 'Spending', path: '/spending-analytics', icon: 'TrendingUp' },
  { label: 'Goals', path: '/goals-progress', icon: 'Target' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const go = (path) => { navigate(path); setMoreOpen(false); };
  const isActive = (path) =>
    location.pathname === path || (path === '/financial-overview' && location.pathname === '/');
  const moreActive = MORE.some((m) => location.pathname === m.path);

  const tabCls = (active) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${active ? 'text-primary' : 'text-muted-foreground'}`;

  return (
    <>
      {moreOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-[70]" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute bottom-16 left-0 right-0 bg-card rounded-t-2xl p-2 shadow-2xl"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto w-10 h-1 rounded-full bg-muted mb-2" />
            {MORE.map((m) => (
              <button
                key={m.path}
                onClick={() => go(m.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl ${location.pathname === m.path ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-background'}`}
              >
                <Icon name={m.icon} size={20} />
                <span className="text-sm font-semibold">{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-card border-t border-border flex z-40 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {PRIMARY.map((item) => (
          <button key={item.path} onClick={() => go(item.path)} className={tabCls(isActive(item.path))}>
            <Icon name={item.icon} size={20} />
            <span className="text-[10px] font-semibold">{item.label}</span>
          </button>
        ))}
        <button onClick={() => setMoreOpen((o) => !o)} className={tabCls(moreActive || moreOpen)}>
          <Icon name="Menu" size={20} />
          <span className="text-[10px] font-semibold">More</span>
        </button>
      </nav>
    </>
  );
}
