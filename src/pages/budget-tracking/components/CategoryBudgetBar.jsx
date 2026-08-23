import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const CategoryBudgetBar = ({ category, budgeted, actual, onEdit }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(budgeted);

  const percentage = (actual / budgeted) * 100;
  const variance = actual - budgeted;
  const variancePercentage = ((variance / budgeted) * 100)?.toFixed(1);

  const getStatusColor = () => {
    if (percentage <= 75) return 'bg-success';
    if (percentage <= 90) return 'bg-warning';
    return 'bg-error';
  };

  const getVarianceColor = () => {
    if (variance <= 0) return 'text-success';
    if (percentage <= 90) return 'text-warning';
    return 'text-error';
  };

  const handleSave = () => {
    onEdit(category?.id, parseFloat(editValue));
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(budgeted);
    setIsEditing(false);
  };

  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-1 hover:shadow-elevation-2 transition-smooth">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 mb-3 md:mb-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="p-2 md:p-3 rounded-lg bg-primary/10 flex-shrink-0">
            <Icon name={category?.icon} size={20} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm md:text-base font-semibold text-foreground truncate">
              {category?.name}
            </h4>
            <p className="text-xs md:text-sm text-muted-foreground">
              {category?.transactionCount} transactions
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 md:gap-6 flex-wrap lg:flex-nowrap">
          <div className="flex-1 lg:flex-initial">
            <p className="text-xs text-muted-foreground mb-1">Budgeted</p>
            {isEditing ? (
              <input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e?.target?.value)}
                className="w-full px-2 py-1 text-sm font-semibold bg-muted rounded border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
            ) : (
              <p className="text-sm md:text-base font-semibold text-foreground data-text">
                ${budgeted?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>

          <div className="flex-1 lg:flex-initial">
            <p className="text-xs text-muted-foreground mb-1">Actual</p>
            <p className="text-sm md:text-base font-semibold text-foreground data-text">
              ${actual?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>

          <div className="flex-1 lg:flex-initial">
            <p className="text-xs text-muted-foreground mb-1">Variance</p>
            <p className={`text-sm md:text-base font-semibold data-text ${getVarianceColor()}`}>
              {variance > 0 ? '+' : ''}${Math.abs(variance)?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs ml-1">({variancePercentage > 0 ? '+' : ''}{variancePercentage}%)</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  className="p-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-smooth"
                  aria-label="Save budget"
                >
                  <Icon name="Check" size={16} />
                </button>
                <button
                  onClick={handleCancel}
                  className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-smooth"
                  aria-label="Cancel edit"
                >
                  <Icon name="X" size={16} />
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-smooth"
                aria-label="Edit budget"
              >
                <Icon name="Edit2" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs md:text-sm">
          <span className="text-muted-foreground">Budget Utilization</span>
          <span className={`font-medium ${percentage > 100 ? 'text-error' : percentage > 90 ? 'text-warning' : 'text-success'}`}>
            {percentage?.toFixed(1)}%
          </span>
        </div>
        <div className="relative w-full bg-muted rounded-full h-3 md:h-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${getStatusColor()}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
          {percentage > 100 && (
            <div
              className="absolute top-0 left-0 h-full bg-error/30 rounded-full"
              style={{ width: `${Math.min(percentage - 100, 100)}%`, marginLeft: '100%' }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryBudgetBar;