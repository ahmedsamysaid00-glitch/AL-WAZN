import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { LoadingState } from '@/components/ui/States';
import { useLanguage } from '@/i18n/useLanguage';
import { useMaintenanceStatus, isRoleInMaintenance } from '@/hooks/useMaintenance';
import { MaintenancePage } from '@/pages/public/MaintenancePage';
import type { UserRole } from '@/types/database';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireRole?: UserRole | UserRole[];
}

export function ProtectedRoute({ children, requireAdmin = false, requireRole }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const { t } = useLanguage();
  const { status: maintenanceStatus, loading: maintenanceLoading } = useMaintenanceStatus();

  if (loading || maintenanceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <LoadingState label={t('common.loading')} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireAdmin && profile?.role !== 'admin') {
    return <Navigate to="/access-denied" replace />;
  }

  if (requireRole) {
    const allowedRoles = Array.isArray(requireRole) ? requireRole : [requireRole];
    if (!profile?.role || !allowedRoles.includes(profile.role)) {
      return <Navigate to="/access-denied" replace />;
    }
  }

  // Check maintenance mode — admin is never affected
  if (isRoleInMaintenance(profile?.role, maintenanceStatus)) {
    return <MaintenancePage />;
  }

  return <>{children}</>;
}
