import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../AppIcon';

// Beta sign-up is server-enforced: the browser only submits the invite code to
// POST /api/signup, which validates it (never the browser). VITE_SIGNUP_ENABLED
// is a NON-SECRET UI feature flag that only controls whether the sign-up link is
// shown; it is not an authorization control. Defaults to enabled when unset.
const SIGNUP_ENABLED = (import.meta.env?.VITE_SIGNUP_ENABLED ?? 'true') !== 'false';

const inputCls =
  'w-full px-3 py-2.5 border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

const LoginScreen = () => {
  const { signIn, resetPassword } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        else setInfo(`If an account exists for ${email}, a reset link is on its way. Check your inbox.`);
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
          setError('Something went wrong — check your connection and try again.');
          return;
        }

        if (res.ok) {
          // Email confirmation is on: prompt the user to confirm, then sign in.
          setInfo(`Account created. Check ${email} to confirm your address, then sign in.`);
          setMode('signin');
          setPassword('');
          setInvite(''); // never persisted; cleared from state after submit
        } else if (res.status === 403) {
          setError('That invite code is not valid.');
        } else if (res.status === 429) {
          setError('Too many attempts. Please try again later.');
        } else if (res.status === 400) {
          setError('Please enter a valid email and password.');
        } else {
          setError('Sign-up is temporarily unavailable. Please try again later.');
        }
      }
    } catch {
      setError('Something went wrong — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Welcome back';
  const cta = loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in';
  const sub = mode === 'forgot'
    ? "We'll email you a secure link to set a new password."
    : mode === 'signup'
      ? 'Beta access — enter your invite code to join.'
      : 'Sign in to continue.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-blue-600/20 mb-4">
            <Icon name="DollarSign" size={28} />
          </div>
          <h1 className="text-2xl font-extrabold text-foreground">
            Con<span className="text-blue-600">Plata</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Own your money — bills, cards, cash flow, goals.</p>
        </div>

        <div className="bg-card rounded-2xl shadow-xl border border-border p-7">
          <h2 className="text-lg font-bold text-foreground mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground mb-5">{sub}</p>

          {error && <div className="mb-4 bg-red-50 text-red-600 text-sm px-3 py-2.5 rounded-lg border border-red-100">{error}</div>}
          {info && <div className="mb-4 bg-emerald-50 text-emerald-700 text-sm px-3 py-2.5 rounded-lg border border-emerald-100">{info}</div>}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Email</label>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={inputCls} />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-muted-foreground">Password</label>
                  {mode === 'signin' && (
                    <button type="button" onClick={() => switchMode('forgot')} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Forgot?</button>
                  )}
                </div>
                <input type="password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Invite code</label>
                <input type="text" required value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Your beta invite code" className={inputCls} />
              </div>
            )}

            <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {cta}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            {mode === 'signin' && SIGNUP_ENABLED && (
              <button onClick={() => switchMode('signup')} className="font-semibold text-blue-600 hover:text-blue-700">Have an invite? Create an account</button>
            )}
            {mode === 'signup' && (
              <button onClick={() => switchMode('signin')} className="font-semibold text-blue-600 hover:text-blue-700">Already have an account? Sign in</button>
            )}
            {mode === 'forgot' && (
              <button onClick={() => switchMode('signin')} className="font-semibold text-blue-600 hover:text-blue-700">← Back to sign in</button>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-5">Private beta · Your data is encrypted and only visible to you.</p>
      </div>
    </div>
  );
};

export default LoginScreen;
