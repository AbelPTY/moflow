import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../AppIcon';
import AuthShell from './AuthShell';
import { useI18n } from '../../i18n';

// Beta sign-up is server-enforced: the browser only submits the invite code to
// POST /api/signup, which validates it (never the browser). VITE_SIGNUP_ENABLED
// is a NON-SECRET UI feature flag that only controls whether the sign-up link is
// shown; it is not an authorization control. Defaults to enabled when unset.
const SIGNUP_ENABLED = (import.meta.env?.VITE_SIGNUP_ENABLED ?? 'true') !== 'false';

const inputCls =
  'w-full px-3 py-2.5 border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-shadow';

const LoginScreen = () => {
  const { signIn, resetPassword } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (m) => { setMode(m); setError(''); setInfo(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await signIn(email, password);
        if (err) setError(err.message);
      } else if (mode === 'forgot') {
        const { error: err } = await resetPassword(email);
        if (err) setError(err.message);
        else setInfo(t('auth.resetSent', { email }));
      } else if (mode === 'signup') {
        // The browser never decides whether the invite is valid; it only submits
        // it to the server, which enforces the invite and rate limits by IP.
        let res;
        try {
          res = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, invite_code: invite }),
          });
        } catch {
          setError(t('auth.connectionError'));
          return;
        }

        if (res.ok) {
          // Email confirmation is on: prompt the user to confirm, then sign in.
          setInfo(t('auth.accountCreated', { email }));
          setMode('signin');
          setPassword('');
          setInvite(''); // never persisted; cleared from state after submit
        } else if (res.status === 403) {
          setError(t('auth.inviteInvalid'));
        } else if (res.status === 429) {
          setError(t('auth.tooManyAttempts'));
        } else if (res.status === 400) {
          setError(t('auth.invalidEmailPassword'));
        } else {
          setError(t('auth.signupUnavailable'));
        }
      }
    } catch {
      setError(t('auth.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'signup' ? t('auth.createAccount') : mode === 'forgot' ? t('auth.resetPassword') : t('auth.welcomeBack');
  const cta = loading ? t('auth.pleaseWait') : mode === 'signup' ? t('auth.createAccountCta') : mode === 'forgot' ? t('auth.sendResetLink') : t('auth.signIn');
  const sub = mode === 'forgot'
    ? t('auth.forgotSub')
    : mode === 'signup'
      ? t('auth.signupSub')
      : t('auth.signInToContinue');

  return (
    <AuthShell footer={t('auth.footerPrivacy')}>
      <div className="bg-card rounded-2xl shadow-xl border border-border p-7">
        <h2 className="text-lg font-bold text-foreground mb-1">{title}</h2>
        <p className="text-sm text-muted-foreground mb-5">{sub}</p>

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

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="auth-email" className="block text-xs font-semibold text-muted-foreground mb-1">{t('auth.email')}</label>
            <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={inputCls} />
          </div>

          {mode !== 'forgot' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="auth-password" className="block text-xs font-semibold text-muted-foreground">{t('auth.password')}</label>
                {mode === 'signin' && (
                  <button type="button" onClick={() => switchMode('forgot')} className="text-xs font-semibold text-primary hover:opacity-80">{t('auth.forgot')}</button>
                )}
              </div>
              <div className="relative">
                <input id="auth-password" type={showPassword ? 'text' : 'password'} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={`${inputCls} pr-11`} />
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
          )}

          {mode === 'signup' && (
            <div>
              <label htmlFor="auth-invite" className="block text-xs font-semibold text-muted-foreground mb-1">{t('auth.inviteCode')}</label>
              <input id="auth-invite" type="text" required value={invite} onChange={(e) => setInvite(e.target.value)} placeholder={t('auth.invitePlaceholder')} className={inputCls} />
            </div>
          )}

          <button type="submit" disabled={loading} className="w-full py-3 min-h-[48px] rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-lg shadow-primary/20">
            {loading && <Icon name="Loader2" size={16} className="inline-block mr-2 animate-spin align-[-2px]" />}
            {cta}
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-muted-foreground">
          {mode === 'signin' && SIGNUP_ENABLED && (
            <button onClick={() => switchMode('signup')} className="font-semibold text-primary hover:opacity-80">{t('auth.haveInvite')}</button>
          )}
          {mode === 'signup' && (
            <button onClick={() => switchMode('signin')} className="font-semibold text-primary hover:opacity-80">{t('auth.alreadyHaveAccount')}</button>
          )}
          {mode === 'forgot' && (
            <button onClick={() => switchMode('signin')} className="font-semibold text-primary hover:opacity-80">{t('auth.backToSignIn')}</button>
          )}
        </div>
      </div>
    </AuthShell>
  );
};

export default LoginScreen;
