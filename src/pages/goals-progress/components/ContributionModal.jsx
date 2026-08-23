import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

const ContributionModal = ({ goal, onClose, onSubmit }) => {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date()?.toISOString()?.split('T')?.[0]);
  const [type, setType] = useState('deposit');
  const [note, setNote] = useState('');

  const typeOptions = [
    { value: 'deposit', label: 'Deposit' },
    { value: 'payment', label: 'Payment' },
    { value: 'transfer', label: 'Transfer' }
  ];

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;

    onSubmit({
      goalId: goal?.id,
      amount: parseFloat(amount),
      date,
      type,
      note
    });
  };

  const quickAmounts = [50, 100, 250, 500];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
      <div className="bg-card rounded-xl shadow-elevation-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border p-4 md:p-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg md:text-xl font-semibold text-foreground">Add Contribution</h2>
            <p className="text-sm text-muted-foreground mt-1">{goal?.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
            aria-label="Close modal"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Quick Amount
            </label>
            <div className="grid grid-cols-4 gap-2">
              {quickAmounts?.map((quickAmount) => (
                <button
                  key={quickAmount}
                  type="button"
                  onClick={() => setAmount(quickAmount?.toString())}
                  className="px-3 py-2 text-sm font-medium bg-background hover:bg-primary hover:text-primary-foreground border border-border rounded-lg transition-smooth"
                >
                  ${quickAmount}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Amount"
            type="number"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e?.target?.value)}
            required
            min="0.01"
            step="0.01"
          />

          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e?.target?.value)}
            required
          />

          <Select
            label="Type"
            options={typeOptions}
            value={type}
            onChange={setType}
            required
          />

          <Input
            label="Note (Optional)"
            type="text"
            placeholder="Add a note"
            value={note}
            onChange={(e) => setNote(e?.target?.value)}
          />

          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Current Progress</span>
              <span className="text-sm font-semibold text-foreground data-text">
                ${goal?.currentAmount?.toLocaleString()}
              </span>
            </div>
            {amount && parseFloat(amount) > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">After Contribution</span>
                <span className="text-sm font-semibold text-success data-text">
                  ${(goal?.currentAmount + parseFloat(amount))?.toLocaleString()}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
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
              iconName="Check"
              iconPosition="left"
            >
              Add Contribution
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ContributionModal;