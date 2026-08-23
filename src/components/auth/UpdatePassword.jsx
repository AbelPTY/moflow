import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../AppIcon';

const inputCls =
  'w-full px-3 py-2.5 border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

// Shown when the user arrives via a password-reset email link (recovery mode).
export default function UpdatePassword() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { error: err } = await updatePassword(password);
      if (err) setError(err.message);
      else setInfo('Password updated — taking you in…');
    } catch {
      setError('Something went wrong. Please try the reset link again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/20 mb-4">
            <Icon name="KeyRound" size={26} />
          </div>
          <h1 className="text-2xl font-extrabold text-foreground">Set a new password</h1>
          <p className="text-sm text-muted-foreground mt-1">Choose a new password for your account.</p>
        </div>

        <div className="bg-card rounded-2xl shadow-xl border border-border p-7">
          {error && <div className="mb-4 bg-red-50 text-red-600 text-sm px-3 py-2.5 rounded-lg border border-red-100">{error}</div>}
          {info && <div className="mb-4 bg-emerald-50 text-emerald-700 text-sm px-3 py-2.5 rounded-lg border border-emerald-100">{info}</div>}

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">New password</label>
              <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Confirm password</label>
              <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" className={inputCls} />
            </div>
            <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <button onClick={signOut} className="font-semibold text-muted-foreground hover:text-foreground">Cancel and sign in instead</button>
          </div>
        </div>
      </div>
    </div>
  );
}
