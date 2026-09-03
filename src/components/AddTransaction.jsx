import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { authHeader } from '../lib/apiClient';
import AccountSelect from './AccountSelect';
import { classifyTransaction, buildAutoWriteMetadata } from '../lib/transactionIntelligence';
import { useI18n } from '../i18n';

// Controlled component: the parent (QuickActionsFab) owns open/close state so
// this action can share a single "+" speed-dial with Bulk Upload.
export default function AddTransaction({ onTransactionAdded, open = false, onClose }) {
  const { t } = useI18n();
  const close = () => { if (onClose) onClose(); };
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Manual entry uses the shared AccountSelect (first-class accounts + legacy
  // names + Cash/Manual + inline "+ Add new account"); no personal hardcoded list.
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    merchant: '',
    amount: '',
    category: 'Uncategorized',
    account_name: 'Cash/Manual'
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
          alert(t('addTransaction.aiScanFailed'));
          setScanning(false);
        }
      };
    } catch (error) {
      console.error(error);
      alert(t('addTransaction.errorReadingFile'));
      setScanning(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const amount = -parseFloat(formData.amount);
    const account = formData.account_name || 'Cash/Manual';
    // If the user explicitly chose a category, that is a human classification.
    // If left at the default 'Uncategorized', let the engine try to classify.
    const userChoseCategory = !!formData.category && formData.category.trim() && formData.category !== 'Uncategorized';
    let classificationMeta = {};
    try {
      if (userChoseCategory) {
        // User explicitly set a category — mark human classification (no bucket
        // field exists on this form, so bucket is left to the app default).
        classificationMeta = { classification_source: 'user', classification_confidence: 1, user_categorized: true, needs_review: false };
      } else {
        const cls = classifyTransaction({ description: formData.merchant, merchant: formData.merchant, amount });
        classificationMeta = buildAutoWriteMetadata(cls);
      }
    } catch { classificationMeta = {}; }

    const { error } = await supabase
      .from('transactions')
      .insert([
        {
          date: formData.date,
          merchant: formData.merchant,
          amount,
          category: formData.category,
          account_name: account,
          source_account: account,
          is_transfer: false,
          ...classificationMeta,
        }
      ]);

    setLoading(false);
    if (error) {
      alert(t('addTransaction.errorPrefix', { msg: error.message }));
    } else {
      close();
      setFormData({ date: new Date().toISOString().split('T')[0], merchant: '', amount: '', category: 'Uncategorized', account_name: formData.account_name || 'Cash/Manual' });
      if (onTransactionAdded) onTransactionAdded();
      alert(t('addTransaction.added'));
    }
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
    }}>
      <div style={{backgroundColor: 'var(--color-card)', color: 'var(--color-card-foreground)', padding: '20px', borderRadius: '15px', width: '90%', maxWidth: '400px'}}>
        <h2>{t('addTransaction.title')}</h2>

        <label style={{display: 'block', marginBottom: '15px', padding: '10px', background: 'var(--color-muted)', textAlign: 'center', borderRadius: '8px', cursor: 'pointer'}}>
           {scanning ? t('addTransaction.aiScanning') : t('addTransaction.scanReceipt')}
           <input type="file" accept="image/*" onChange={handleScan} style={{display: 'none'}} disabled={scanning || loading} />
        </label>

        <form onSubmit={handleSubmit}>
          <input type="date" name="date" value={formData.date} onChange={handleChange} style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <input type="text" name="merchant" placeholder={t('addTransaction.merchant')} value={formData.merchant} onChange={handleChange} required style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <input type="number" name="amount" placeholder={t('addTransaction.amount')} value={formData.amount} onChange={handleChange} step="0.01" required style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <input type="text" name="category" placeholder={t('addTransaction.category')} value={formData.category} onChange={handleChange} required style={{width: '100%', padding: '10px', marginBottom: '10px'}} />
          <div style={{ marginBottom: '10px' }}>
            <AccountSelect value={formData.account_name} onChange={(name) => setFormData((f) => ({ ...f, account_name: name }))} />
          </div>
          <div style={{display: 'flex', gap: '10px'}}>
            <button type="button" onClick={close} style={{flex: 1, padding: '10px', background: 'var(--color-muted)', border: 'none', borderRadius: '5px'}}>{t('common.cancel')}</button>
            <button type="submit" disabled={loading} style={{flex: 1, padding: '10px', background: '#007AFF', color: 'white', border: 'none', borderRadius: '5px'}}>{loading ? t('addTransaction.saving') : t('addTransaction.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
