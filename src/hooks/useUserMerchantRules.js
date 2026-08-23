import { useState, useEffect, useCallback } from 'react';
import { fetchActiveUserRules } from '../lib/engine/userRules';

// Loads the authenticated user's ACTIVE merchant rules (engine-shaped, priority
// ordered) for the components that classify at import/bulk time. Ownership is
// enforced by RLS; this hook never sends a browser-supplied user_id and never
// writes. On failure it yields an empty array so classification falls back to
// static behavior. READ-ONLY.
export default function useUserMerchantRules() {
  const [userRules, setUserRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rules = await fetchActiveUserRules(); // already returns [] on failure
      setUserRules(rules);
    } catch (e) {
      setError(e);
      setUserRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { userRules, loading, error, refetch: load };
}
