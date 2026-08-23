import React, { useState, useRef, useEffect } from 'react';
import Icon from './AppIcon';
import useNotifications from '../hooks/useNotifications';

const SEV = {
  overdue: { dot: 'bg-red-500', label: 'Overdue', text: 'text-red-600' },
  today: { dot: 'bg-amber-500', label: 'Today', text: 'text-amber-600' },
  soon: { dot: 'bg-blue-500', label: 'Soon', text: 'text-blue-600' },
};

export default function NotificationBell() {
  const { items, count } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Icon name="Bell" size={20} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[85vw] bg-card border border-border rounded-xl shadow-xl z-[80] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="font-bold text-sm text-foreground">Notifications</span>
            {count > 0 && <span className="text-xs text-muted-foreground">{count} need attention</span>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground italic">You're all caught up 🎉</div>
            ) : (
              items.map((it) => {
                const s = SEV[it.severity] || SEV.soon;
                return (
                  <div key={it.id} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{it.title}</p>
                      <p className="text-xs text-muted-foreground">{it.subtitle}{it.date ? ` · ${it.date}` : ''}</p>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${s.text}`}>{s.label}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
