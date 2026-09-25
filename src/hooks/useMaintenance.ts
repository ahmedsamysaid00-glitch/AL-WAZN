import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/types/database';

export interface MaintenanceStatus {
  traveler: boolean;
  sender: boolean;
  marketing: boolean;
  support: boolean;
}

interface MaintenanceRow {
  platform: string;
  enabled: boolean;
}

/**
 * Fetch maintenance settings from the database.
 * Returns null on error (fail-open: do NOT enable maintenance on error).
 */
export async function fetchMaintenanceSettings(): Promise<MaintenanceStatus | null> {
  const { data, error } = await supabase
    .from('maintenance_settings')
    .select('platform, enabled');

  if (error || !data) return null;

  const rows = data as MaintenanceRow[];
  const status: MaintenanceStatus = {
    traveler: false,
    sender: false,
    marketing: false,
    support: false,
  };

  for (const row of rows) {
    if (row.platform in status) {
      const key = row.platform as keyof MaintenanceStatus;
      status[key] = row.enabled;
    }
  }

  return status;
}

/**
 * Check if a specific role should see the maintenance page.
 * Returns false for admin (never in maintenance) and on error (fail-open).
 */
export function isRoleInMaintenance(
  role: UserRole | undefined,
  status: MaintenanceStatus | null,
): boolean {
  if (!role || !status) return false;
  if (role === 'admin') return false;

  if (role === 'traveler' || role === 'sender') {
    return status[role];
  }
  if (role === 'marketing') return status.marketing;
  if (role === 'support') return status.support;

  return false;
}

/**
 * Hook that fetches maintenance settings once and caches them.
 * Multiple components can call this — only one fetch happens.
 */
let cachedStatus: MaintenanceStatus | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000; // 30 seconds

export function useMaintenanceStatus(): {
  status: MaintenanceStatus | null;
  loading: boolean;
  refresh: () => void;
} {
  const [status, setStatus] = useState<MaintenanceStatus | null>(cachedStatus);
  const [loading, setLoading] = useState(cachedStatus === null);

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (cachedStatus && now - cacheTimestamp < CACHE_TTL) {
      setStatus(cachedStatus);
      setLoading(false);
      return;
    }

    const result = await fetchMaintenanceSettings();
    cachedStatus = result;
    cacheTimestamp = Date.now();
    setStatus(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, loading, refresh: () => { cacheTimestamp = 0; refresh(); } };
}
