import React from 'react';
import Icon from './AppIcon';
import { useTheme } from '../contexts/ThemeContext';

// Sun/moon button that flips light <-> dark. Small and self-contained so it can
// sit in the top nav next to the notification bell.
export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${className}`}
    >
      <Icon name={isDark ? 'Sun' : 'Moon'} size={20} />
    </button>
  );
}
