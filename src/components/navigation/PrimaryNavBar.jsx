import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from "../../contexts/AuthContext";
import NotificationBell from '../NotificationBell';
import ThemeToggle from '../ThemeToggle';

const PrimaryNavBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { signOut, user } = useAuth();

  const navigationItems = [
    { label: 'Cards', path: '/cards', icon: 'CreditCard' },
    { label: 'Flow', path: '/cash-flow', icon: 'CalendarClock' },
    { label: 'Bills', path: '/bills', icon: 'Receipt' },
    { label: 'Activity', path: '/financial-overview', icon: 'LayoutDashboard' },
    { label: 'More', path: '/more', icon: 'Menu' }
  ];

  const handleNavigation = (path) => {
    navigate(path);
    setIsMobileMenuOpen(false);
  };

  // Cards is the home route, so treat "/" as Cards for active highlighting.
  const isItemActive = (path) =>
    location.pathname === path ||
    (path === '/cards' && location.pathname === '/');

  return (
    <nav className="bg-card border-b border-border sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">

          {/* LEFT: LOGO & BRAND */}
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center gap-2 cursor-pointer" onClick={() => navigate('/cards')}>
              <div className="bg-primary/10 p-2 rounded-lg">
                <Icon name="DollarSign" size={24} className="text-primary" />
              </div>
              <span className="font-bold text-xl text-foreground hidden md:block">
                Mo<span className="text-primary">Flow</span>
              </span>
            </div>

            {/* DESKTOP NAV LINKS */}
            <div className="hidden md:ml-8 md:flex md:space-x-4">
              {navigationItems.map((item) => {
                const isActive = isItemActive(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavigation(item.path)}
                    className={`inline-flex items-center px-3 py-2 border-b-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                    }`}
                  >
                    <Icon name={item.icon} size={16} className="mr-2" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT: GLOBAL BALANCE & USER */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* THEME + NOTIFICATIONS */}
            <ThemeToggle />
            <NotificationBell />

            {/* MOBILE MENU TOGGLE */}
            <div className="flex items-center md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
              >
                <Icon name={isMobileMenuOpen ? "X" : "Menu"} size={24} />
              </button>
            </div>

            {/* USER PROFILE & LOGOUT */}
            <div className="flex items-center gap-3">
              <div
                className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs cursor-pointer hover:bg-primary/30 transition-colors"
                title={user?.email || 'User'}
              >
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
              <button
                onClick={signOut}
                className="hidden md:flex items-center justify-center p-2 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-500 transition-colors"
                title="Sign Out"
              >
                <Icon name="LogOut" size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE MENU */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-card">
          <div className="pt-2 pb-3 space-y-1">
            {navigationItems.map((item) => {
               const isActive = isItemActive(item.path);
               return (
                <button
                  key={item.path}
                  onClick={() => handleNavigation(item.path)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium w-full text-left ${
                    isActive
                      ? 'bg-primary/5 border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:border-border hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center">
                    <Icon name={item.icon} size={20} className="mr-3" />
                    {item.label}
                  </div>
                </button>
               );
            })}
          </div>
          <div className="pt-4 pb-4 border-t border-border">
             <div className="px-4">
               <button
                 onClick={signOut}
                 className="flex items-center w-full px-3 py-2 rounded-md text-red-600 hover:bg-red-50 focus:outline-none transition-colors"
               >
                 <Icon name="LogOut" size={20} className="mr-3" />
                 Sign Out ({user?.email})
               </button>
             </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default PrimaryNavBar;