import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';

// Mobile-only bottom tab bar (hidden on md+). Five primary tabs matching the
// desktop primary navigation. "More" now navigates to a real /more page
// instead of opening a bottom sheet.
const PRIMARY = [
  { label: 'Cards', path: '/cards', icon: 'CreditCard' },
  { label: 'Flow', path: '/cash-flow', icon: 'CalendarClock' },
  { label: 'Bills', path: '/bills', icon: 'Receipt' },
  { label: 'Activity', path: '/financial-overview', icon: 'LayoutDashboard' },
  { label: 'More', path: '/more', icon: 'Menu' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const go = (path) => { navigate(path); };
  // Cards is the home route, so treat "/" as Cards for active highlighting.
  const isActive = (path) =>
    location.pathname === path || (path === '/cards' && location.pathname === '/');

  const tabCls = (active) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${active ? 'text-primary' : 'text-muted-foreground'}`;

  return (
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
    </nav>
  );
}
