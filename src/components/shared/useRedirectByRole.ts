import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';

export function useRedirectByRole() {
  const { profile } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from;

  if (from) return from;
  if (profile?.role === 'admin') return '/admin';
  if (profile?.role === 'marketing') return '/marketing';
  if (profile?.role === 'support') return '/support';
  return '/dashboard';
}
