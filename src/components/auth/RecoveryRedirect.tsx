import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Supabase password recovery links contain a `#type=recovery` hash fragment
 * with the access token needed to establish the recovery session.
 *
 * Depending on the Supabase project's Site URL and URI Allow List configuration,
 * the recovery link may redirect to the app root rather than /reset-password.
 *
 * This component detects the recovery hash on any route and redirects to
 * /reset-password while preserving the hash fragment so that Supabase's
 * detectSessionInUrl can establish the recovery session.
 */
export function RecoveryRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('type=recovery') && location.pathname !== '/reset-password') {
      navigate(`/reset-password${hash}`, { replace: true });
    }
  }, [navigate, location.pathname]);

  return null;
}
