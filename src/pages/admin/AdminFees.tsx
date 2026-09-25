import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { Percent, Check, Plus, History } from 'lucide-react';
import type { PlatformFeeSetting } from '@/types/database';

export function AdminFees() {
  const { t } = useLanguage();
  const [configs, setConfigs] = useState<PlatformFeeSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ percentage: '0', fixed_amount: '0', currency: 'USD' });
  const [saving, setSaving] = useState(false);
  const [activateTarget, setActivateTarget] = useState<PlatformFeeSetting | null>(null);
  const [activating, setActivating] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: err } = await supabase
      .from('platform_fee_settings')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) { setError(true); setLoading(false); return; }
    setConfigs((data as PlatformFeeSetting[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  useRealtimeRefresh(
    [{ table: 'platform_fee_settings' }],
    () => fetchConfigs(),
  );

  const handleSave = async () => {
    setSaving(true);
    const percentage = parseFloat(formData.percentage) || 0;
    const fixed_amount = parseFloat(formData.fixed_amount) || 0;
    if (percentage < 0 || percentage > 100) { showToast('error', t('fees.percentageInvalid')); setSaving(false); return; }

    const { error: err } = await supabase.rpc('save_fee_config', {
      p_percentage: percentage,
      p_fixed_amount: fixed_amount,
      p_currency: formData.currency,
    });
    setSaving(false);
    if (err) { showToast('error', t('fees.saveFailed')); return; }

    setShowForm(false);
    setFormData({ percentage: '0', fixed_amount: '0', currency: 'USD' });
    showToast('success', t('fees.saveSuccess'));
    fetchConfigs();
  };

  const handleActivate = async () => {
    if (!activateTarget) return;
    setActivating(true);
    const { error: err } = await supabase.rpc('activate_fee_config', { p_config_id: activateTarget.id });
    setActivating(false);
    if (err) { showToast('error', t('fees.activateFailed')); return; }
    showToast('success', t('fees.activateSuccess'));
    setActivateTarget(null);
    fetchConfigs();
  };

  if (loading) return (
    <AdminLayout>
      <div className="card"><LoadingState /></div>
    </AdminLayout>
  );
  if (error) return (
    <AdminLayout>
      <div className="card"><ErrorState message={t('admin.failedFees')} onRetry={fetchConfigs} retryLabel={t('common.retry')} /></div>
    </AdminLayout>
  );

  const activeConfig = configs.find((c) => c.is_active);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('fees.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('fees.subtitle')}</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary btn-sm">
            <Plus className="h-4 w-4" /> {t('fees.create')}
          </button>
        </div>

        {/* Active config */}
        <div className="card p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('fees.activeConfig')}</h2>
          {activeConfig ? (
            <div className="flex items-center gap-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                <Percent className="h-8 w-8" />
              </div>
              <div className="flex-1 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('fees.percentageLabel')}</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeConfig.percentage}%</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('fees.fixedLabel')}</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeConfig.fixed_amount} {activeConfig.currency}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('fees.currency')}</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeConfig.currency}</p>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState icon={<Percent className="h-8 w-8" />} title={t('fees.noActiveConfig')} />
          )}
        </div>

        {/* Create form */}
        {showForm && (
          <div className="card p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('fees.create')}</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('fees.percentage')} ({t('fees.percentageHint')})</label>
                <input type="number" step="0.01" min="0" max="100" value={formData.percentage} onChange={(e) => setFormData({ ...formData, percentage: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('fees.fixedAmount')}</label>
                <input type="number" step="0.01" min="0" value={formData.fixed_amount} onChange={(e) => setFormData({ ...formData, fixed_amount: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{t('fees.currency')}</label>
                <input type="text" value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} className="input" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary btn-sm">{t('fees.save')}</button>
              <button onClick={() => setShowForm(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
            </div>
          </div>
        )}

        {/* History */}
        <div className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <History className="h-5 w-5 text-slate-400 dark:text-slate-500" /> {t('fees.history')}
          </h2>
          {configs.length === 0 ? (
            <EmptyState icon={<History className="h-8 w-8" />} title={t('fees.noHistory')} />
          ) : (
            <div className="space-y-2">
              {configs.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-700 p-3">
                  <div className="flex items-center gap-3">
                    {c.is_active ? (
                      <span className="badge-success">{t('fees.active')}</span>
                    ) : (
                      <span className="badge-neutral">{t('fees.inactive')}</span>
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{c.percentage}% + {c.fixed_amount} {c.currency}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(c.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {!c.is_active && (
                    <button onClick={() => setActivateTarget(c)} className="btn-secondary btn-sm">
                      <Check className="h-4 w-4" /> {t('fees.activate')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!activateTarget}
        title={t('fees.activateConfirm')}
        message={t('fees.activateConfirm')}
        confirmLabel={t('admin.confirmAction')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleActivate}
        onCancel={() => setActivateTarget(null)}
        loading={activating}
        entityLabel={activateTarget ? `${activateTarget.percentage}% + ${activateTarget.fixed_amount} ${activateTarget.currency}` : undefined}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </AdminLayout>
  );
}
