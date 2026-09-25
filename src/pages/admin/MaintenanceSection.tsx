import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { Wrench, Plane, Package, Megaphone, Headphones, Loader2 } from 'lucide-react';
import type { MaintenanceStatus } from '@/hooks/useMaintenance';

interface MaintenanceRow {
  platform: string;
  enabled: boolean;
}

const PLATFORMS = [
  { key: 'traveler', labelKey: 'admin.maintenanceTraveler', icon: Plane },
  { key: 'sender', labelKey: 'admin.maintenanceSender', icon: Package },
  { key: 'marketing', labelKey: 'admin.maintenanceMarketer', icon: Megaphone },
  { key: 'support', labelKey: 'admin.maintenanceSupport', icon: Headphones },
] as const;

export function MaintenanceSection() {
  const { t, dir } = useLanguage();
  const { toast, showToast, dismissToast } = useToast();
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [confirmPlatform, setConfirmPlatform] = useState<string | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('maintenance_settings')
      .select('platform, enabled');

    if (error || !data) {
      setStatus(null);
      setLoading(false);
      return;
    }

    const rows = data as MaintenanceRow[];
    const next: MaintenanceStatus = {
      traveler: false,
      sender: false,
      marketing: false,
      support: false,
    };
    for (const row of rows) {
      if (row.platform in next) {
        const key = row.platform as keyof MaintenanceStatus;
        next[key] = row.enabled;
      }
    }
    setStatus(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleToggle = async (platform: string, enable: boolean) => {
    setToggling(true);
    const { error } = await supabase.rpc('set_maintenance_enabled', {
      p_platform: platform,
      p_enabled: enable,
    });
    setToggling(false);
    setConfirmPlatform(null);

    if (error) {
      showToast('error', t('admin.maintenanceFailed'));
      return;
    }

    setStatus((prev) => {
      if (!prev) return prev;
      const key = platform as keyof MaintenanceStatus;
      return { ...prev, [key]: enable };
    });

    showToast(
      'success',
      enable ? t('admin.maintenanceEnableSuccess') : t('admin.maintenanceDisableSuccess'),
    );
  };

  const openConfirm = (platform: string, enable: boolean) => {
    setConfirmPlatform(platform);
    setConfirmEnable(enable);
  };

  const confirmLabelKey = confirmPlatform
    ? PLATFORMS.find((p) => p.key === confirmPlatform)?.labelKey
    : undefined;

  return (
    <div className="card">
      <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400">
          <Wrench className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('admin.maintenanceTitle')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('admin.maintenanceSubtitle')}
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('admin.maintenanceLoading')}
          </div>
        ) : (
          PLATFORMS.map((platform) => {
            const Icon = platform.icon;
            const isEnabled = status?.[platform.key] ?? false;
            return (
              <div key={platform.key} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      isEnabled
                        ? 'bg-warning-50 dark:bg-warning-900/20 text-warning-600 dark:text-warning-400'
                        : 'bg-success-50 dark:bg-success-900/20 text-success-600 dark:text-success-400'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t(platform.labelKey)}
                    </span>
                    <span
                      className={`ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        isEnabled
                          ? 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400'
                          : 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isEnabled ? 'bg-warning-500' : 'bg-success-500'
                        }`}
                      />
                      {isEnabled
                        ? t('admin.maintenanceUnderMaintenance')
                        : t('admin.maintenanceActive')}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => openConfirm(platform.key, !isEnabled)}
                  disabled={toggling}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                    isEnabled ? 'bg-warning-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                  aria-label={isEnabled ? t('admin.maintenanceDisable') : t('admin.maintenanceEnable')}
                  dir={dir}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isEnabled ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={confirmPlatform !== null}
        title={confirmEnable ? t('admin.maintenanceEnable') : t('admin.maintenanceDisable')}
        message={
          confirmEnable
            ? t('admin.maintenanceEnableConfirm')
            : t('admin.maintenanceDisableConfirm')
        }
        entityLabel={confirmLabelKey ? t(confirmLabelKey) : undefined}
        confirmLabel={confirmEnable ? t('admin.maintenanceEnable') : t('admin.maintenanceDisable')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (confirmPlatform) {
            handleToggle(confirmPlatform, confirmEnable);
          }
        }}
        onCancel={() => setConfirmPlatform(null)}
        loading={toggling}
        destructive={confirmEnable}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
