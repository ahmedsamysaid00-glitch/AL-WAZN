import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Wallet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { WalletAccount, FinancialLedgerEntry } from '@/types/database';

export function UserWalletPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [entries, setEntries] = useState<FinancialLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!profile?.id) return;
    setError(false);

    const [walletRes, ledgerRes] = await Promise.all([
      supabase.from('wallet_accounts').select('*').eq('user_id', profile.id).maybeSingle(),
      supabase.from('financial_ledger_entries').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
    ]);
    setWallet(walletRes.data as WalletAccount | null);
    if (ledgerRes.error) { setError(true); return; }
    setEntries((ledgerRes.data as FinancialLedgerEntry[]) ?? []);
  }, [profile?.id]);

  const fetchDataInitial = useCallback(async () => {
    setLoading(true);
    await fetchData();
    setLoading(false);
  }, [fetchData]);

  useEffect(() => { fetchDataInitial(); }, [fetchDataInitial]);

  useRealtimeRefresh(
    [
      { table: 'wallet_accounts', filter: `user_id=eq.${profile?.id ?? ''}` },
      { table: 'financial_ledger_entries', filter: `user_id=eq.${profile?.id ?? ''}` },
    ],
    () => fetchData(),
    !!profile?.id,
  );

  if (loading) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('wallet.title')}</h1>
        <div className="card"><LoadingState /></div>
      </div>
    </UserLayout>
  );

  if (error) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('wallet.title')}</h1>
        <div className="card"><ErrorState message={t('wallet.failed')} onRetry={fetchData} retryLabel={t('common.retry')} /></div>
      </div>
    </UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('wallet.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('wallet.subtitle')}</p>
        </div>

        {/* Balance cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 text-success-600">
                <Wallet className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('wallet.availableBalance')}</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {wallet?.available_balance?.toFixed(2) ?? '0.00'} <span className="text-lg text-slate-400 dark:text-slate-500">{wallet?.currency ?? 'USD'}</span>
            </p>
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
                <Wallet className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('wallet.pendingBalance')}</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {wallet?.pending_balance?.toFixed(2) ?? '0.00'} <span className="text-lg text-slate-400 dark:text-slate-500">{wallet?.currency ?? 'USD'}</span>
            </p>
          </div>
        </div>

        {/* Info note */}
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
          <div className="flex items-start gap-3">
            <Wallet className="h-5 w-5 text-primary-600 shrink-0" />
            <p className="text-sm text-primary-800">{t('wallet.balanceNote')}</p>
          </div>
        </div>

        {/* Ledger entries */}
        <div className="card p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('wallet.recentEntries')}</h2>
          {entries.length === 0 ? (
            <EmptyState icon={<Wallet className="h-8 w-8" />} title={t('wallet.noEntries')} />
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-lg border border-slate-100 dark:border-slate-700 p-3">
                  <div className="flex items-center gap-3">
                    {entry.direction === 'credit' ? (
                      <ArrowDownCircle className="h-5 w-5 text-success-500" />
                    ) : (
                      <ArrowUpCircle className="h-5 w-5 text-error-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {t(`wallet.entryType.${entry.entry_type}` as TranslationKey)}
                      </p>
                      {entry.description && <p className="text-xs text-slate-500 dark:text-slate-400">{entry.description}</p>}
                      <p className="text-xs text-slate-400 dark:text-slate-500">{new Date(entry.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-semibold ${entry.direction === 'credit' ? 'text-success-600' : 'text-error-600'}`}>
                    {entry.direction === 'credit' ? '+' : '-'}{entry.amount} {entry.currency}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </UserLayout>
  );
}
