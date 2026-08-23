import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const CreateGoalModal = ({ onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: '',
    category: 'savings',
    targetAmount: '',
    currentAmount: '',
    targetDate: '',
    description: ''
  });

  const categoryOptions = [
    { value: 'savings', label: 'Savings Goal' },
    { value: 'debt', label: 'Debt Payoff' },
    { value: 'investment', label: 'Investment Target' }
  ];

  const templates = [
    { name: 'Emergency Fund', category: 'savings', amount: 10000 },
    { name: 'Vacation Fund', category: 'savings', amount: 5000 },
    { name: 'Credit Card Payoff', category: 'debt', amount: 3000 },
    { name: 'Retirement Savings', category: 'investment', amount: 50000 }
  ];

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleTemplateSelect = (template) => {
    setFormData(prev => ({
      ...prev,
      name: template?.name,
      category: template?.category,
      targetAmount: template?.amount?.toString()
    }));
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!formData?.name || !formData?.targetAmount || !formData?.targetDate) return;

    onSubmit({
      ...formData,
      targetAmount: parseFloat(formData?.targetAmount),
      currentAmount: parseFloat(formData?.currentAmount) || 0,
      id: Date.now()?.toString(),
      startDate: new Date()?.toISOString(),
      progress: 0
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
      <div className="bg-card rounded-xl shadow-elevation-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border p-4 md:p-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg md:text-xl font-semibold text-foreground">Create New Goal</h2>
            <p className="text-sm text-muted-foreground mt-1">Set up your financial goal</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
            aria-label="Close modal"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 md:p-6">
          <div className="mb-6">
            <label className="text-sm font-medium text-foreground mb-3 block">
              Quick Templates
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates?.map((template, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleTemplateSelect(template)}
                  className="p-3 text-left bg-background hover:bg-muted border border-border rounded-lg transition-smooth"
                >
                  <div className="text-sm font-medium text-foreground">{template?.name}</div>
                  <div className="text-xs text-muted-foreground mt-1 capitalize">
                    {template?.category} • ${template?.amount?.toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Goal Name"
              type="text"
              placeholder="e.g., Emergency Fund"
              value={formData?.name}
              onChange={(e) => handleChange('name', e?.target?.value)}
              required
            />

            <Select
              label="Category"
              options={categoryOptions}
              value={formData?.category}
              onChange={(value) => handleChange('category', value)}
              required
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Target Amount"
                type="number"
                placeholder="10000"
                value={formData?.targetAmount}
                onChange={(e) => handleChange('targetAmount', e?.target?.value)}
                required
                min="1"
                step="0.01"
              />

              <Input
                label="Current Amount"
                type="number"
                placeholder="0"
                value={formData?.currentAmount}
                onChange={(e) => handleChange('currentAmount', e?.target?.value)}
                min="0"
                step="0.01"
              />
            </div>

            <Input
              label="Target Date"
              type="date"
              value={formData?.targetDate}
              onChange={(e) => handleChange('targetDate', e?.target?.value)}
              required
              min={new Date()?.toISOString()?.split('T')?.[0]}
            />

            <Input
              label="Description (Optional)"
              type="text"
              placeholder="Add details about your goal"
              value={formData?.description}
              onChange={(e) => handleChange('description', e?.target?.value)}
            />

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                fullWidth
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                fullWidth
                iconName="Plus"
                iconPosition="left"
              >
                Create Goal
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateGoalModal;