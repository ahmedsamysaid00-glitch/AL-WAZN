import { useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';

const STORAGE_KEY = 'wzn_referral_code';
const QUERY_PARAM = 'ref';

function getReferralCodeFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get(QUERY_PARAM);
  return code && code.trim() ? code.trim() : null;
}

function storeReferralCode(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // localStorage may be unavailable (private mode) — attribution will be lost
  }
}

function getStoredReferralCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearStoredReferralCode(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useReferral() {
  const { user } = useAuth();

  useEffect(() => {
    const codeFromURL = getReferralCodeFromURL();
    if (codeFromURL) {
      storeReferralCode(codeFromURL);
    }
  }, []);

  const claimReferral = useCallback(async (): Promise<void> => {
    if (!user) return;

    const code = getReferralCodeFromURL() ?? getStoredReferralCode();
    if (!code) return;

    try {
      await supabase.rpc('claim_referral', { p_referral_code: code });
      clearStoredReferralCode();
    } catch {
      // Claim failed — keep the code for retry on next login
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      claimReferral();
    }
  }, [user, claimReferral]);

  return { claimReferral };
}
