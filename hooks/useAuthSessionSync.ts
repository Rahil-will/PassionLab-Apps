import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { clearAuthenticatedSession } from '../lib/authSession';

/** Keep navigation auth state in sync when Supabase session ends outside explicit logout. */
export function useAuthSessionSync(): void {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        clearAuthenticatedSession();
      }
    });
    return () => subscription.unsubscribe();
  }, []);
}
