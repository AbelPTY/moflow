import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { authHeader } from '../lib/apiClient';

// Controlled component: the parent (QuickActionsFab) owns open/close state so
// this action can share a single "+" speed-dial with Bulk Upload.
export default function AddTransaction({ onTransactionAdded, open = false, onClose }) {
  const close = () => { if (onClose) onClose(); };
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    merchant: '',
    amount: '',
    category: 'Uncategorized'
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setScanning(true);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);

      reader.onloadend = async () => {
        try {
          const img = new Image();
          img.src = reader.result;

          img.onload = async () => {
            // Compress the image to avoid Vercel's 4.5MB payload limit
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1000;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Convert to JPEG with 0.7 quality
            const base64Image = canvas.toDataURL('image/jpeg', 0.7);

            // Call the Vercel AI function
            const response = await fetch('/api/scanReceipt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
              body: JSON.stringify({ image: base64Image })
            });

            if (!response.ok) throw new Error("Failed to scan: " + response.statusText);

            const aiData = await response.json();

            // Auto-fill the form with the AI's answers
            setFormData({
              ...formData,
              date: aiData.date || formData.date,
              merchant: aiData.merchant || '',
              amount: aiData.amount || '',
              category: aiData.category || 'Uncategorized',
            });

            setScanning(false);
          };
        } catch (fetchErr) {
          console.error(fetchErr);
          alert("AI Scanning failed. Please enter manually.");
          setScanning(false);
        }
      };
    } catch (error) {
      console.error(error);
      alert("Error reading file.");
      setScanning(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase
      .from('transactions')
      .insert([
        {
          date: formData.date,
          merchant: formData.merchant,
          amount: -parseFloat(formData.amount),
          category: formData.category,
          account_name: 'Cash/Manual',
          is_transfer: false
        }
      ]);

    setLoading(false);
    if (error) {
      alert('Error: ' + error.message);
    } else {
      close();
      setFormData({ date: new Date().toISOString().split('T')[0], merchant: '', amount: '', category: 'Uncategorized' });
      if (onTransactionAdded) onTransactionAdded();
      alert('Transaction Added!');
    }
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
    }}>
      <div style={{backgroundColor: 'var(--color-card)', color: 'var(--color-card-foreground)', padding: '20px', borderRadius: '15px', width: '90%', maxWidth: '400px'}}>
        <h2>Add Transaction</h2>

        <label style={{display: 'block', marginBottom: '15px', padding: '10px', background: 'var(--color-muted)', textAlign: 'center', borderRadius: '8px', cursor: 'pointer'}}>
           {scanning ? '🧠 AI is Scanning...' : '📷 Scan Receipt'}
           <input type="file" accept="image/*" onChange={handleScan} style={{display: 'none'}} disabled={scanning || loading} />
        </label>

        <form onSubmit={handleSubmit}>
          <input type="date" name="date" value={formData.date} onChange={handleChange} style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <input type="text" name="merchant" placeholder="Merchant" value={formData.merchant} onChange={handleChange} required style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <input type="number" name="amount" placeholder="Amount" value={formData.amount} onChange={handleChange} step="0.01" required style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <input type="text" name="category" placeholder="Category" value={formData.category} onChange={handleChange} required style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <div style={{display: 'flex', gap: '10px'}}>
            <button type="button" onClick={close} style={{flex: 1, padding: '10px', background: 'var(--color-muted)', border: 'none', borderRadius: '5px'}}>Cancel</button>
            <button type="submit" disabled={loading} style={{flex: 1, padding: '10px', background: '#007AFF', color: 'white', border: 'none', borderRadius: '5px'}}>{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
