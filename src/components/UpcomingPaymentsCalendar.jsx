import React, { useState, useMemo } from 'react';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  addDays,
} from 'date-fns';
import Icon from './AppIcon';
import Button from './ui/Button';
import useScheduledPayments from '../hooks/useScheduledPayments';

const UpcomingPaymentsCalendar = ({ extraEvents = [] }) => {
  const { payments, loading, addPayment, deletePayment, updatePayment } = useScheduledPayments();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // States for Adding and Editing
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ entity: '', amount: '', payment_date: '' });

  const [newEntity, setNewEntity] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newIsRecurring, setNewIsRecurring] = useState(false); // Added for subscriptions

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  // --- THE BULLETPROOF CLICK HANDLER ---
  const handleDateClick = (clickedDay) => {
    setSelectedDate(clickedDay);
    setEditingId(null);
    // We intentionally removed setIsAdding(false) here!
    // Now you can click different days while the form is open to change the target date.
  };

  // Merge real scheduled payments with read-only "extra" events (credit-card
  // statement due dates passed in from the Cards data) so the calendar shows a
  // complete picture. Extra events are display-only -- not editable/deletable.
  const allPayments = useMemo(
    () => [...(payments || []), ...(extraEvents || [])],
    [payments, extraEvents]
  );

  const paymentsByDate = useMemo(() => {
    const grouped = {};
    allPayments.forEach(payment => {
      const dStr = payment.payment_date;
      if (!dStr) return;
      if (!grouped[dStr]) grouped[dStr] = [];
      grouped[dStr].push(payment);
    });
    return grouped;
  }, [allPayments]);

  const selectedDateString = format(selectedDate, 'yyyy-MM-dd');
  const selectedPayments = paymentsByDate[selectedDateString] || [];

  // --- REMINDER SUMMARY: overdue (past due, still pending) and upcoming
  // (due within the next 7 days) -- surfaced as a banner so this doesn't
  // require remembering to open the calendar and click through months.
  const todayString = format(new Date(), 'yyyy-MM-dd');
  const reminderSummary = useMemo(() => {
    const overdue = [];
    const upcoming = [];
    const weekAhead = format(addDays(new Date(), 7), 'yyyy-MM-dd');

    (allPayments || []).forEach((p) => {
      if (p.status === 'paid') return;
      if (p.payment_date < todayString) overdue.push(p);
      else if (p.payment_date <= weekAhead) upcoming.push(p);
    });

    return {
      overdue,
      upcoming,
      overdueTotal: overdue.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      upcomingTotal: upcoming.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    };
  }, [allPayments, todayString]);

  // --- ACTIONS ---
  const togglePaymentStatus = async (payment) => {
    const newStatus = payment.status === 'paid' ? 'pending' : 'paid';
    await updatePayment(payment.id, { status: newStatus });

    // --- THE AUTO-ROLLOVER MAGIC ---
    // If we just marked it as paid, and it is a recurring payment...
    if (newStatus === 'paid' && payment.is_recurring) {
      // Safely calculate exactly 1 month ahead
      const [year, month, day] = payment.payment_date.split('-');
      const currentDateObj = new Date(year, month - 1, day);
      const nextMonthDate = addMonths(currentDateObj, 1);
      const nextMonthDateStr = format(nextMonthDate, 'yyyy-MM-dd');

      // Guard against creating a duplicate: if toggling paid/unpaid/paid
      // happens more than once, don't create a second "phantom" entry for
      // the same entity + next month's date.
      const alreadyExists = (payments || []).some(
        (p) => p.entity === payment.entity && p.payment_date === nextMonthDateStr
      );

      if (!alreadyExists) {
        await addPayment({
          entity: payment.entity,
          amount: payment.amount,
          payment_date: nextMonthDateStr,
          status: 'pending',
          is_recurring: true
        });
      }
    }
  };

  const startEditing = (payment) => {
    setEditingId(payment.id);
    setEditForm({
      entity: payment.entity,
      amount: payment.amount,
      payment_date: payment.payment_date
    });
  };

  const handleEditSave = async (id) => {
    await updatePayment(id, {
      entity: editForm.entity,
      amount: parseFloat(editForm.amount),
      payment_date: editForm.payment_date
    });
    setEditingId(null);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!newEntity || !newAmount) return;
    const payload = {
      entity: newEntity,
      amount: parseFloat(newAmount),
      payment_date: format(selectedDate, 'yyyy-MM-dd'),
      status: 'pending',
      is_recurring: newIsRecurring // Added to save the recurring status
    };
    await addPayment(payload);
    setIsAdding(false);
    setNewEntity('');
    setNewAmount('');
    setNewIsRecurring(false); // Reset the checkbox
  };

  // --- RENDERING HELPERS ---
  const renderHeader = () => (
    <div className="flex justify-between items-center mb-4">
      <h3 className="text-lg font-bold text-foreground">Upcoming Payments</h3>
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" iconName="ChevronLeft" onClick={prevMonth} />
        <span className="font-bold text-sm min-w-[100px] text-center">{format(currentDate, 'MMMM yyyy')}</span>
        <Button variant="ghost" size="icon" iconName="ChevronRight" onClick={nextMonth} />
      </div>
    </div>
  );

  const renderCells = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    const rows = [];
    let days = [];
    let day = startDate;

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        // THE FIX: Create a pristine, isolated copy of the date for this specific cell
        const currentDay = new Date(day.getTime());
        const dateStr = format(currentDay, 'yyyy-MM-dd');
        const hasPayments = !!paymentsByDate[dateStr];
        const isSelected = isSameDay(currentDay, selectedDate);
        const isCurrentMonth = isSameMonth(currentDay, monthStart);
        const isToday = isSameDay(currentDay, new Date());

        days.push(
          <div
            key={dateStr}
            onClick={() => handleDateClick(currentDay)}
            className={`
              relative p-2 h-14 border cursor-pointer transition-all duration-200
              ${!isCurrentMonth ? 'bg-muted border-border text-muted-foreground' : 'bg-card border-border text-foreground hover:bg-muted'}
              ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500 z-10' : ''}
            `}
          >
            <span className={`text-sm font-bold ${isSelected ? 'text-blue-700' : isToday ? 'text-foreground underline' : ''}`}>
              {format(currentDay, 'd')}
            </span>
            {hasPayments && (
              <div className="absolute bottom-1 left-1 right-1 flex gap-1 flex-wrap justify-center">
                {paymentsByDate[dateStr].map((p, idx) => {
                  const isOverdue = p.status !== 'paid' && dateStr < todayString;
                  const dotColor = p.readOnly
                    ? (p.status === 'paid' ? 'bg-green-500' : 'bg-blue-500')
                    : p.status === 'paid'
                      ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]'
                      : isOverdue
                        ? 'bg-red-600 shadow-[0_0_5px_rgba(220,38,38,0.7)] animate-pulse'
                        : 'bg-amber-500';
                  return <div key={idx} className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${dotColor}`}></div>;
                })}
              </div>
            )}
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(<div className="grid grid-cols-7" key={`row-${format(day, 'yyyy-MM-dd')}`}>{days}</div>);
      days = [];
    }
    return <div className="border border-border rounded-lg overflow-hidden bg-card">{rows}</div>;
  };

  const renderSidebar = () => (
    <div className="mt-6 lg:mt-0 lg:ml-6 lg:w-1/3 flex flex-col">
      <h4 className="font-bold text-foreground mb-4 border-b border-border pb-2">
        {isSameDay(selectedDate, new Date()) ? 'Today' : format(selectedDate, 'MMM do, yyyy')}
      </h4>

      {!isAdding ? (
        <div className="space-y-3">
          {selectedPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">No payments scheduled.</p>
          ) : (
            selectedPayments.map((payment) => {
              // Read-only card statement due dates (from the Cards tab): shown
              // for awareness, but managed on the Cards tab, not here.
              if (payment.readOnly) {
                const cardPaid = payment.status === 'paid';
                return (
                  <div key={payment.id} className={`p-3 rounded-lg border flex justify-between items-center ${cardPaid ? 'border-green-200 bg-green-50/50' : 'border-blue-200 bg-blue-50/50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white ${cardPaid ? 'bg-green-500' : 'bg-blue-500'}`}>
                        <Icon name={cardPaid ? 'Check' : 'CreditCard'} size={12} />
                      </div>
                      <div>
                        <p className={`font-bold text-sm ${cardPaid ? 'text-green-800 line-through' : 'text-blue-900'}`}>{payment.entity}</p>
                        <p className={`text-[10px] uppercase font-bold ${cardPaid ? 'text-green-600' : 'text-blue-500'}`}>{cardPaid ? 'Paid · Card' : 'Card · manage on Cards tab'}</p>
                      </div>
                    </div>
                    <p className={`font-mono font-bold ${cardPaid ? 'text-green-700' : 'text-blue-700'}`}>${Number(payment.amount).toFixed(2)}</p>
                  </div>
                );
              }

              const isPaid = payment.status === 'paid';
              const isOverdue = !isPaid && payment.payment_date < todayString;
              const isEditing = editingId === payment.id;

              return (
                <div key={payment.id} className={`p-3 rounded-lg border flex flex-col gap-2 group transition-all duration-300 ${isPaid ? 'bg-green-50/50 border-green-200' : isOverdue ? 'bg-red-50/50 border-red-200' : 'bg-muted/30 border-border'}`}>
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <input type="text" value={editForm.entity} onChange={e => setEditForm({...editForm, entity: e.target.value})} className="text-xs border rounded p-1" />
                      <input type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: e.target.value})} className="text-xs border rounded p-1" />
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => handleEditSave(payment.id)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <button onClick={() => togglePaymentStatus(payment)} className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${isPaid ? 'bg-green-500 border-green-500 text-white' : 'border-muted-foreground/50 hover:border-primary bg-card'}`}>
                          {isPaid && <Icon name="Check" size={12} />}
                        </button>
                        <div>
                          <p className={`font-bold text-sm transition-all ${isPaid ? 'text-green-800 line-through' : 'text-foreground'}`}>
                            {payment.entity}
                            {/* THE AUTOPILOT INDICATOR ICON */}
                            {payment.is_recurring && <span title="Recurring" className="ml-2 text-blue-500 text-xs">🔄</span>}
                          </p>
                          <p className={`text-[10px] uppercase font-bold ${isPaid ? 'text-green-600' : isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}>{isOverdue ? 'Overdue' : payment.status}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className={`font-mono font-bold ${isPaid ? 'text-green-700' : 'text-red-600'}`}>${Number(payment.amount).toFixed(2)}</p>
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEditing(payment)} className="text-muted-foreground hover:text-primary"><Icon name="Edit2" size={12} /></button>
                          <button onClick={() => deletePayment(payment.id)} className="text-muted-foreground hover:text-destructive"><Icon name="Trash2" size={12} /></button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <Button variant="outline" className="w-full border-dashed mt-4 text-xs" iconName="Plus" onClick={() => setIsAdding(true)}>Add Payment</Button>
        </div>
      ) : (
        <form onSubmit={handleAddSubmit} className="bg-muted/20 p-4 rounded-lg border border-border flex flex-col gap-3">
          <p className="text-sm font-bold">New Payment for {format(selectedDate, 'MMM do')}</p>
          <input type="text" placeholder="Entity" value={newEntity} onChange={e => setNewEntity(e.target.value)} className="border rounded p-2 text-sm" autoFocus required />
          <input type="number" placeholder="Amount" value={newAmount} onChange={e => setNewAmount(e.target.value)} className="border rounded p-2 text-sm" step="0.01" required />

          {/* THE NEW CHECKBOX FOR RECURRING PAYMENTS */}
          <div className="flex items-center gap-2 mb-1">
            <input
              type="checkbox"
              id="is_recurring"
              checked={newIsRecurring}
              onChange={(e) => setNewIsRecurring(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-border cursor-pointer"
            />
            <label htmlFor="is_recurring" className="text-xs text-muted-foreground cursor-pointer">
              Recurring monthly
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" onClick={() => setIsAdding(false)}>Cancel</Button>
            <Button type="submit" className="flex-1">Save</Button>
          </div>
        </form>
      )}
    </div>
  );

  const renderReminderBanner = () => {
    const { overdue, upcoming, overdueTotal, upcomingTotal } = reminderSummary;
    if (overdue.length === 0 && upcoming.length === 0) return null;

    return (
      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        {overdue.length > 0 && (
          <div className="flex-1 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            <Icon name="AlertTriangle" size={16} className="text-red-600 shrink-0" />
            <p className="text-sm text-red-800">
              <span className="font-bold">{overdue.length} overdue</span> — ${overdueTotal.toFixed(2)} total
            </p>
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="flex-1 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <Icon name="Clock" size={16} className="text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-bold">{upcoming.length} due this week</span> — ${upcomingTotal.toFixed(2)} total
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-card p-6 rounded-xl shadow-elevation-2 border border-border w-full flex flex-col">
      {renderReminderBanner()}
      <div className="flex flex-col lg:flex-row">
        <div className="flex-1">
          {renderHeader()}
          <div className="grid grid-cols-7 mb-2 border-b border-border">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="text-center text-xs font-bold text-muted-foreground uppercase py-2">{d}</div>)}
          </div>
          {renderCells()}
        </div>
        {renderSidebar()}
      </div>
    </div>
  );
};

export default UpcomingPaymentsCalendar;
