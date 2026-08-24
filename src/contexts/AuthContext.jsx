import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase'; // Ensure this file exists in src/lib/

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True while the user arrived via a password-reset email link and needs to
  // set a new password (Supabase fires a PASSWORD_RECOVERY event for this).
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Auth methods ---
  const signIn = async (email, password) => {
    return await supabase.auth.signInWithPassword({ email, password });
  };

  // Registration is server-enforced via POST /api/signup (invite validated
  // server-side, IP rate-limited, and gated by the Supabase Before-User-Created
  // Auth Hook). The client intentionally exposes NO direct supabase.auth.signUp
  // path, so registration cannot bypass the server invite check.

  // Sends a reset link to the email; the link returns to the app and triggers
  // recovery mode, where updatePassword sets the new password.
  const resetPassword = async (email) => {
    return await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
  };

  const updatePassword = async (newPassword) => {
    const result = await supabase.auth.updateUser({ password: newPassword });
    if (!result.error) setRecovery(false);
    return result;
  };

  const signOut = async () => {
    setRecovery(false);
    return await supabase.auth.signOut();
  };

  const value = {
    user,
    loading,
    recovery,
    signIn,
    resetPassword,
    updatePassword,
    signOut,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
