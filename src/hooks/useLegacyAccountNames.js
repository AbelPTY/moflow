import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Distinct account names already present in the user's transactions (the legacy
// backward-compatibility source for account selectors). Bounded, RLS-scoped
// read; fails soft to [] so selectors still work if it errors. Used to keep
// historical account names selectable alongside first-class accounts.
export default function useLegacyAccountNames() {
  const [names, setNames] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('transactions')
          .select('account_name, source_account')
          .limit(5000);
        if (cancelled || !data) return;
        const set = new Set();
        data.forEach((r) => {
          if (r.account_name) set.add(r.account_name);
          if (r.source_account) set.add(r.source_account);
        });
        setNames([...set]);
      } catch {
        // Non-fatal: selectors fall back to first-class accounts only.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return names;
}
