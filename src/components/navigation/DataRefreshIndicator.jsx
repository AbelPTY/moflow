import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';

const DataRefreshIndicator = ({ onRefresh }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const handleRefresh = () => {
    setIsRefreshing(true);
    if (onRefresh) {
      onRefresh();
    }
    setTimeout(() => {
      setIsRefreshing(false);
      setLastRefresh(new Date());
    }, 1500);
  };

  const getRelativeTime = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setLastRefresh(new Date(lastRefresh));
    }, 60000);

    return () => clearInterval(interval);
  }, [lastRefresh]);

  return (
    <div
      onClick={handleRefresh}
      className="refresh-indicator"
      role="button"
      tabIndex={0}
      aria-label="Refresh financial data"
      onKeyDown={(e) => {
        if (e?.key === 'Enter' || e?.key === ' ') {
          handleRefresh();
        }
      }}
    >
      <Icon
        name="RefreshCw"
        size={16}
        className={`refresh-icon ${isRefreshing ? 'spinning' : ''}`}
      />
      <span className="refresh-text">{getRelativeTime(lastRefresh)}</span>
    </div>
  );
};

export default DataRefreshIndicator;