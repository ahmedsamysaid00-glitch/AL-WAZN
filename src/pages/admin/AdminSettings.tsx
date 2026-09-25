import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { AdminLayout } from './AdminLayout';
import { LoadingState, EmptyState } from '@/components/ui/States';
import { ShieldCheck, ShieldAlert, Clock, CreditCard, Save, Loader2, CheckCircle2, AlertCircle, Megaphone } from 'lucide-react';
import { DEFAULT_PAYMENT_RECEIVING_NUMBER } from '@/lib/platformConfig';
import type { TranslationKey } from '@/i18n/translations';
import type { MarketingSettings } from '@/types/database';
import { MaintenanceSection } from './MaintenanceSection';

interface ModerationEvent {
  id: string;
  user_id: string;
  conversation_id: string;
  category: string;
  reason: string;
  created_at: string;
}

const MODERATION_CATEGORY_KEYS: { key: string; labelKey: TranslationKey }[] = [
  { key: 'phone', labelKey: 'admin.moderationCategory.phone' },
  { key: 'email', labelKey: 'admin.moderationCategory.email' },
  { key: 'url', labelKey: 'admin.moderationCategory.url' },
  { key: 'whatsapp', labelKey: 'admin.moderationCategory.whatsapp' },
  { key: 'telegram', labelKey: 'admin.moderationCategory.telegram' },
  { key: 'social_media', labelKey: 'admin.moderationCategory.social_media' },
  { key: 'contact_request', labelKey: 'admin.moderationCategory.contact_request' },
];

export function AdminSettings() {
  const { t } = useLanguage();
  const [events, setEvents] = useState<ModerationEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment receiving number state
  const [receivingNumber, setReceivingNumber] = useState(DEFAULT_PAYMENT_RECEIVING_NUMBER);
  const [receivingNumberLoading, setReceivingNumberLoading] = useState(true);
  const [savingNumber, setSavingNumber] = useState(false);
  const [numberSuccess, setNumberSuccess] = useState(false);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [numberValidationError, setNumberValidationError] = useState<string | null>(null);

  // Marketing settings state
  const [marketingSettings, setMarketingSettings] = useState<MarketingSettings | null>(null);
  const [marketingLoading, setMarketingLoading] = useState(true);
  const [savingMarketing, setSavingMarketing] = useState(false);
  const [marketingSuccess, setMarketingSuccess] = useState(false);
  const [marketingError, setMarketingError] = useState<string | null>(null);
  const [marketingValidationError, setMarketingValidationError] = useState<string | null>(null);
  const [commissionRate, setCommissionRate] = useState('5');
  const [commissionBase, setCommissionBase] = useState<'platform_fee' | 'order_total'>('platform_fee');
  const [attributionEnabled, setAttributionEnabled] = useState(true);
  const [attributionWindow, setAttributionWindow] = useState('30');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('message_moderation_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    setEvents((data as ModerationEvent[]) ?? []);
    setLoading(false);
  }, []);

  const fetchReceivingNumber = useCallback(async () => {
    setReceivingNumberLoading(true);
    const { data, error } = await supabase
      .from('platform_settings')
      .select('payment_receiving_number')
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      setReceivingNumber((data as { payment_receiving_number: string }).payment_receiving_number);
    }
    setReceivingNumberLoading(false);
  }, []);

  const fetchMarketingSettings = useCallback(async () => {
    setMarketingLoading(true);
    const { data, error } = await supabase
      .from('marketing_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      const s = data as MarketingSettings;
      setMarketingSettings(s);
      setCommissionRate(String(s.commission_rate));
      setCommissionBase(s.commission_base);
      setAttributionEnabled(s.attribution_enabled);
      setAttributionWindow(String(s.attribution_window_days));
    }
    setMarketingLoading(false);
  }, []);

  useEffect(() => { fetchEvents(); fetchReceivingNumber(); fetchMarketingSettings(); }, [fetchEvents, fetchReceivingNumber, fetchMarketingSettings]);

  useRealtimeRefresh(
    [{ table: 'message_moderation_events' }, { table: 'platform_settings' }],
    () => { fetchEvents(); fetchReceivingNumber(); fetchMarketingSettings(); },
  );

  const handleSaveNumber = async () => {
    setNumberValidationError(null);
    const trimmed = receivingNumber.trim();
    if (!trimmed) {
      setNumberValidationError(t('admin.receivingNumberInvalid'));
      return;
    }
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (digits.length < 8 || digits.length > 15) {
      setNumberValidationError(t('admin.receivingNumberInvalid'));
      return;
    }

    setSavingNumber(true);
    setNumberSuccess(false);
    setNumberError(null);

    const { data, error } = await supabase.rpc('update_payment_receiving_number', {
      p_number: trimmed,
    });

    setSavingNumber(false);

    if (error) {
      setNumberError(t('admin.receivingNumberSaveFailed'));
      return;
    }
    if (data) {
      setReceivingNumber(data as string);
    }
    setNumberSuccess(true);
    setTimeout(() => setNumberSuccess(false), 4000);
  };

  const handleSaveMarketing = async () => {
    setMarketingValidationError(null);
    const rate = parseFloat(commissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setMarketingValidationError(t('marketing.settingsInvalidRate'));
      return;
    }
    const window = parseInt(attributionWindow);
    if (isNaN(window) || window < 1) {
      setMarketingValidationError(t('marketing.settingsInvalidWindow'));
      return;
    }

    setSavingMarketing(true);
    setMarketingSuccess(false);
    setMarketingError(null);

    const { error: rpcError } = await supabase.rpc('update_marketing_settings', {
      p_commission_rate: rate,
      p_commission_base: commissionBase,
      p_attribution_enabled: attributionEnabled,
      p_attribution_window_days: window,
    });

    setSavingMarketing(false);

    if (rpcError) {
      setMarketingError(t('marketing.settingsSaveFailed'));
      return;
    }
    setMarketingSuccess(true);
    setTimeout(() => setMarketingSuccess(false), 4000);
    fetchMarketingSettings();
  };

  const categoryLabel = (cat: string): string => {
    const found = MODERATION_CATEGORY_KEYS.find((c) => c.key === cat);
    if (!found) return cat;
    return t(found.labelKey);
  };

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('nav.settings')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('admin.platformSettingsSubtitle')}
          </p>
        </div>

        {/* Payment Settings */}
        <div className="card">
          <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <CreditCard className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('admin.paymentSettings')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('admin.paymentSettingsSubtitle')}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {receivingNumberLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common.loading')}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('admin.receivingNumber')}
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {t('admin.receivingNumberHint')}
                  </p>
                  <input
                    type="text"
                    value={receivingNumber}
                    onChange={(e) => {
                      setReceivingNumber(e.target.value);
                      setNumberSuccess(false);
                      setNumberError(null);
                      setNumberValidationError(null);
                    }}
                    placeholder={t('admin.receivingNumberPlaceholder')}
                    className="input"
                    dir="ltr"
                  />
                </div>

                {numberValidationError && (
                  <div className="flex items-center gap-2 rounded-lg bg-error-50 dark:bg-error-900/20 p-3">
                    <AlertCircle className="h-4 w-4 text-error-600 shrink-0" />
                    <p className="text-sm text-error-700 dark:text-error-400">{numberValidationError}</p>
                  </div>
                )}

                {numberSuccess && (
                  <div className="flex items-center gap-2 rounded-lg bg-success-50 dark:bg-success-900/20 p-3">
                    <CheckCircle2 className="h-4 w-4 text-success-600 shrink-0" />
                    <p className="text-sm text-success-700 dark:text-success-400">{t('admin.receivingNumberSaveSuccess')}</p>
                  </div>
                )}

                {numberError && (
                  <div className="flex items-center gap-2 rounded-lg bg-error-50 dark:bg-error-900/20 p-3">
                    <AlertCircle className="h-4 w-4 text-error-600 shrink-0" />
                    <p className="text-sm text-error-700 dark:text-error-400">{numberError}</p>
                  </div>
                )}

                <button
                  onClick={handleSaveNumber}
                  disabled={savingNumber}
                  className="btn-primary btn-sm"
                >
                  {savingNumber ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.receivingNumberSaving')}</>
                  ) : (
                    <><Save className="h-4 w-4" /> {t('admin.receivingNumberSave')}</>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Marketing Settings */}
        <div className="card">
          <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <Megaphone className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('marketing.settingsTitle')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('marketing.settingsSubtitle')}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {marketingLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common.loading')}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('marketing.commissionRate')}
                  </label>
                  <input
                    type="number"
                    value={commissionRate}
                    onChange={(e) => {
                      setCommissionRate(e.target.value);
                      setMarketingSuccess(false);
                      setMarketingValidationError(null);
                    }}
                    min="0"
                    max="100"
                    step="0.1"
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('marketing.commissionBase')}
                  </label>
                  <select
                    value={commissionBase}
                    onChange={(e) => {
                      setCommissionBase(e.target.value as 'platform_fee' | 'order_total');
                      setMarketingSuccess(false);
                    }}
                    className="input"
                  >
                    <option value="platform_fee">{t('marketing.commissionBase.platform_fee')}</option>
                    <option value="order_total">{t('marketing.commissionBase.order_total')}</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('marketing.attributionEnabled')}
                  </label>
                  <button
                    onClick={() => {
                      setAttributionEnabled(!attributionEnabled);
                      setMarketingSuccess(false);
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      attributionEnabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        attributionEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('marketing.attributionWindow')}
                  </label>
                  <input
                    type="number"
                    value={attributionWindow}
                    onChange={(e) => {
                      setAttributionWindow(e.target.value);
                      setMarketingSuccess(false);
                      setMarketingValidationError(null);
                    }}
                    min="1"
                    max="365"
                    className="input"
                  />
                </div>

                {marketingSettings?.referral_code && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t('marketing.referralCode')}
                    </label>
                    <p className="text-sm font-mono font-semibold text-slate-600 dark:text-slate-400" dir="ltr">{marketingSettings.referral_code}</p>
                  </div>
                )}

                {marketingValidationError && (
                  <div className="flex items-center gap-2 rounded-lg bg-error-50 dark:bg-error-900/20 p-3">
                    <AlertCircle className="h-4 w-4 text-error-600 shrink-0" />
                    <p className="text-sm text-error-700 dark:text-error-400">{marketingValidationError}</p>
                  </div>
                )}

                {marketingSuccess && (
                  <div className="flex items-center gap-2 rounded-lg bg-success-50 dark:bg-success-900/20 p-3">
                    <CheckCircle2 className="h-4 w-4 text-success-600 shrink-0" />
                    <p className="text-sm text-success-700 dark:text-success-400">{t('marketing.settingsSaved')}</p>
                  </div>
                )}

                {marketingError && (
                  <div className="flex items-center gap-2 rounded-lg bg-error-50 dark:bg-error-900/20 p-3">
                    <AlertCircle className="h-4 w-4 text-error-600 shrink-0" />
                    <p className="text-sm text-error-700 dark:text-error-400">{marketingError}</p>
                  </div>
                )}

                <button
                  onClick={handleSaveMarketing}
                  disabled={savingMarketing}
                  className="btn-primary btn-sm"
                >
                  {savingMarketing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t('marketing.savingSettings')}</>
                  ) : (
                    <><Save className="h-4 w-4" /> {t('marketing.saveSettings')}</>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Maintenance Mode */}
        <MaintenanceSection />

        {/* Message Moderation Settings */}
        <div className="card">
          <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('admin.moderationTitle')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('admin.moderationSubtitle')}
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {MODERATION_CATEGORY_KEYS.map((cat) => (
              <div key={cat.key} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success-50 dark:bg-success-900/20 text-success-600 dark:text-success-400">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t(cat.labelKey)}
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 dark:bg-success-900/20 px-2.5 py-1 text-xs font-medium text-success-700 dark:text-success-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
                  {t('admin.moderationActive')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Moderation Events */}
        <div className="card">
          <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('admin.recentBlockedTitle')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('admin.recentBlockedSubtitle')}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="p-4"><LoadingState /></div>
          ) : events.length === 0 ? (
            <div className="p-4"><EmptyState icon={<ShieldCheck className="h-8 w-8" />} title={t('admin.noBlockedAttempts')} /></div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {events.map((evt) => (
                <div key={evt.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="rounded-md bg-error-50 dark:bg-error-900/20 px-2 py-1 text-xs font-medium text-error-700 dark:text-error-400">
                      {categoryLabel(evt.category)}
                    </span>
                    <span className="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">{evt.reason}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                    <Clock className="h-3 w-3" />
                    {new Date(evt.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
