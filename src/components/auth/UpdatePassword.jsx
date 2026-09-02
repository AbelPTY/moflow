import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../AppIcon';
import AuthShell from './AuthShell';
import { useI18n } from '../../i18n';

const inputCls =
  'w-full px-3 py-2.5 border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow';

// Shown when the user arrives via a password-reset email link (recovery mode).
export default function UpdatePassword() {
  const { updatePassword, signOut } = useAuth();
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (password.length < 6) { setError(t('auth.passwordTooShort')); return; }
    if (password !== confirm) { setError(t('auth.passwordsDoNotMatch')); return; }
    setLoading(true);
    try {
      const { error: err } = await updatePassword(password);
      if (err) setError(err.message);
      else setInfo(t('auth.passwordUpdated'));
    } catch {
      setError(t('auth.resetLinkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="bg-card rounded-2xl shadow-xl border border-border p-7">
        <h2 className="text-lg font-bold text-foreground mb-1">{t('auth.setNewPassword')}</h2>
        <p className="text-sm text-muted-foreground mb-5">{t('auth.setNewPasswordSub')}</p>

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 bg-red-500/10 text-red-600 dark:text-red-400 text-sm px-3 py-2.5 rounded-lg border border-red-500/20">
            <Icon name="AlertCircle" size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {info && (
          <div role="status" className="mb-4 flex items-start gap-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-sm px-3 py-2.5 rounded-lg border border-emerald-500/20">
            <Icon name="CheckCircle2" size={16} className="mt-0.5 shrink-0" />
            <span>{info}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="new-password" className="block text-xs font-semibold text-muted-foreground mb-1">{t('auth.newPassword')}</label>
            <div className="relative">
              <input id="new-password" type={showPassword ? 'text' : 'password'} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.passwordHint')} className={`${inputCls} pr-11`} />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center justify-center w-11 min-h-[44px] text-muted-foreground hover:text-foreground rounded-r-lg"
              >
                <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={18} />
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-xs font-semibold text-muted-foreground mb-1">{t('auth.confirmPassword')}</label>
            <input id="confirm-password" type={showPassword ? 'text' : 'password'} required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t('auth.confirmPasswordPlaceholder')} className={inputCls} />
          </div>
          <button type="submit" disabled={loading} className="w-full py-3 min-h-[48px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-lg shadow-primary/20">
            {loading && <Icon name="Loader2" size={16} className="inline-block mr-2 animate-spin align-[-2px]" />}
            {loading ? t('auth.updatingPassword') : t('auth.updatePassword')}
          </button>
        </form>

        <div className="mt-5 text-center text-sm">
          <button onClick={signOut} className="font-semibold text-muted-foreground hover:text-foreground">{t('auth.cancelSignInInstead')}</button>
        </div>
      </div>
    </AuthShell>
  );
}
