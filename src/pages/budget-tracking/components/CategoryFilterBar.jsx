import React from 'react';
import Icon from '../../../components/AppIcon';

const CategoryFilterBar = ({ categories, selectedCategories, onCategoryToggle, onClearAll }) => {
  return (
    <div className="bg-card rounded-lg p-4 md:p-6 shadow-elevation-1">
      <div className="flex items-center justify-between mb-3 md:mb-4">
        <h4 className="text-sm md:text-base font-semibold text-foreground">Filter by Category</h4>
        {selectedCategories?.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs md:text-sm text-primary hover:text-primary/80 font-medium transition-smooth"
          >
            Clear All
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {categories?.map((category) => {
          const isSelected = selectedCategories?.includes(category?.id);
          return (
            <button
              key={category?.id}
              onClick={() => onCategoryToggle(category?.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition-smooth ${
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-elevation-1'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              <Icon name={category?.icon} size={14} />
              <span>{category?.name}</span>
              {isSelected && <Icon name="Check" size={14} />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryFilterBar;