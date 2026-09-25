import { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtime';
import { useReferral } from '@/hooks/useReferral';
import type { Profile, UserRole } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, account_status, verification_status, identity_verified, preferred_currency, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch profile:', error.message);
      return null;
    }
    return data as Profile | null;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      const p = await fetchProfile(user.id);
      setProfile(p);
    }
  }, [user, fetchProfile]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);

      if (s?.user) {
        fetchProfile(s.user.id).then((p) => {
          if (mounted) {
            setProfile(p);
            setLoading(false);
          }
        });
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);

      if (s?.user) {
        (async () => {
          const p = await fetchProfile(s.user.id);
          if (mounted) setProfile(p);
        })();
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  useRealtimeTable<Profile>({
    table: 'profiles',
    filter: user?.id ? `id=eq.${user.id}` : undefined,
    event: 'UPDATE',
    enabled: !!user?.id,
    onUpdate: () => {
      if (user?.id) {
        fetchProfile(user.id).then((p) => {
          if (mountedRef.current) setProfile(p);
        });
      }
    },
    onResync: () => {
      if (user?.id) {
        fetchProfile(user.id).then((p) => {
          if (mountedRef.current) setProfile(p);
        });
      }
    },
  });

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          return { error: 'auth.invalidCredentials' };
        }
        return { error: 'auth.loginFailed' };
      }
      return { error: null };
    },
    [],
  );

  const signUp = useCallback(
    async (email: string, password: string, fullName: string, role: UserRole) => {
      if (role === 'admin') {
        return { error: 'auth.registerFailed' };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role,
          },
        },
      });

      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          return { error: 'auth.emailInUse' };
        }
        return { error: 'auth.registerFailed' };
      }

      if (data.user) {
        const p = await fetchProfile(data.user.id);
        setProfile(p);
      }

      return { error: null };
    },
    [fetchProfile],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    session,
    user,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      <ReferralClaimor />
      {children}
    </AuthContext.Provider>
  );
}

function ReferralClaimor() {
  useReferral();
  return null;
}

