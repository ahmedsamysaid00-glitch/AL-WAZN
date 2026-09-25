import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { UserLayout } from './UserLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Pagination';
import { CreditCard, ArrowRight } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { PaymentWithDetails, PaymentStatus } from '@/types/database';

type TabKey = 'all' | 'pending' | 'held' | 'refunded';
const PAGE_SIZE = 10;

const TAB_STATUSES: Record<Exclude<TabKey, 'all'>, PaymentStatus[]> = {
  pending: ['pending', 'processing'],
  held: ['held'],
  refunded: ['refunded', 'partially_refunded'],
};

export function UserPaymentsPage() {
  const { t, dir } = useLanguage();
  const { profile } = useAuth();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const [payments, setPayments] = useState<PaymentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [tabCounts, setTabCounts] = useState<Record<TabKey, number>>({ all: 0, pending: 0, held: 0, refunded: 0 });
  const fetchingRef = useRef(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const fetchPayments = useCallback(async (pageNum: number, currentTab: TabKey) => {
    if (!profile?.id || fetchingRef.current) return;
    fetchingRef.current = true;
    setError(false);

    const uid = profile.id;
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('payments')
      .select(`
        *,
        orders(order_number, status, total_amount, currency)
      `, { count: 'exact' })
      .or(`payer_id.eq.${uid},payee_id.eq.${uid}`)
      .order('created_at', { ascending: false });

    if (currentTab !== 'all') {
      query = query.in('status', TAB_STATUSES[currentTab]);
    }

    const { data, error: err, count } = await query.range(from, to);

    if (err) { setError(true); setPayments([]); fetchingRef.current = false; return; }
    setPayments((data as PaymentWithDetails[]) ?? []);
    setTotalCount(count ?? 0);

    // Fetch tab counts in parallel (head-only queries)
    const [allRes, pendingRes, heldRes, refundedRes] = await Promise.all([
      supabase.from('payments').select('id', { count: 'exact', head: true })
        .or(`payer_id.eq.${uid},payee_id.eq.${uid}`),
      supabase.from('payments').select('id', { count: 'exact', head: true })
        .or(`payer_id.eq.${uid},payee_id.eq.${uid}`).in('status', TAB_STATUSES.pending),
      supabase.from('payments').select('id', { count: 'exact', head: true })
        .or(`payer_id.eq.${uid},payee_id.eq.${uid}`).eq('status', 'held'),
      supabase.from('payments').select('id', { count: 'exact', head: true })
        .or(`payer_id.eq.${uid},payee_id.eq.${uid}`).in('status', TAB_STATUSES.refunded),
    ]);
    setTabCounts({
      all: allRes.count ?? 0,
      pending: pendingRes.count ?? 0,
      held: heldRes.count ?? 0,
      refunded: refundedRes.count ?? 0,
    });

    fetchingRef.current = false;
  }, [profile?.id]);

  const fetchPaymentsInitial = useCallback(async () => {
    setLoading(true);
    await fetchPayments(0, 'all');
    setLoading(false);
  }, [fetchPayments]);

  useEffect(() => { fetchPaymentsInitial(); }, [fetchPaymentsInitial]);

  useRealtimeRefresh(
    [{ table: 'payments' }, { table: 'refunds' }],
    () => fetchPayments(page, tab),
    !!profile?.id,
  );

  const handleTabChange = (newTab: TabKey) => {
    setTab(newTab);
    setPage(0);
    fetchPayments(0, newTab);
  };

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchPayments(newPage, tab);
  };

  const tabs: { key: TabKey; labelKey: TranslationKey; count: number }[] = [
    { key: 'all', labelKey: 'admin.allPaymentStatuses', count: tabCounts.all },
    { key: 'pending', labelKey: 'payments.status.pending', count: tabCounts.pending },
    { key: 'held', labelKey: 'payments.status.held', count: tabCounts.held },
    { key: 'refunded', labelKey: 'payments.status.refunded', count: tabCounts.refunded },
  ];

  if (loading) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('payments.title')}</h1>
        <div className="card"><LoadingState /></div>
      </div>
    </UserLayout>
  );

  if (error) return (
    <UserLayout>
      <div className="max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('payments.title')}</h1>
        <div className="card"><ErrorState message={t('payments.failed')} onRetry={() => goToPage(page)} retryLabel={t('common.retry')} /></div>
      </div>
    </UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('payments.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('payments.subtitle')}</p>
        </div>

        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
          <div className="flex items-start gap-3">
            <CreditCard className="h-5 w-5 text-primary-600 shrink-0" />
            <p className="text-sm text-primary-800">{t('payments.manualPaymentNote')}</p>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => handleTabChange(tb.key)}
              className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === tb.key ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t(tb.labelKey)}
              {tb.count > 0 && (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {tb.count}
                </span>
              )}
              {tab === tb.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary-600" />}
            </button>
          ))}
        </div>

        {payments.length === 0 ? (
          <div className="card"><EmptyState icon={<CreditCard className="h-8 w-8" />} title={t('payments.empty')} /></div>
        ) : (
          <div className="space-y-3">
            {payments.map((payment) => (
              <PaymentCard key={payment.id} payment={payment} t={t} arrow={arrow} />
            ))}
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} t={t} rtl={dir === 'rtl'} />
      </div>
    </UserLayout>
  );
}

function PaymentCard({ payment, t, arrow }: { payment: PaymentWithDetails; t: (k: TranslationKey) => string; arrow: string }) {
  const order = payment.orders;
  return (
    <Link to={`/dashboard/payments/${payment.id}`} className="card card-hover p-5 animate-fade-in block">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <PaymentStatusBadge status={payment.status} t={t} />
            {order && <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{order.order_number}</span>}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
            <span>{t('payments.amount')}: <span className="font-semibold text-slate-900 dark:text-white">{payment.amount} {payment.currency}</span></span>
            <span>{t('payments.platformFee')}: <span className="font-semibold text-slate-700 dark:text-slate-300">{payment.platform_fee} {payment.currency}</span></span>
            <span>{t('payments.netAmount')}: <span className="font-semibold text-slate-700 dark:text-slate-300">{payment.net_amount} {payment.currency}</span></span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('payments.createdAt')}: {new Date(payment.created_at).toLocaleDateString()}</p>
        </div>
        <ArrowRight className={`h-5 w-5 text-slate-300 dark:text-slate-600 shrink-0 ${arrow}`} />
      </div>
    </Link>
  );
}

function PaymentStatusBadge({ status, t }: { status: PaymentStatus; t: (k: TranslationKey) => string }) {
  const map: Record<PaymentStatus, string> = {
    pending: 'badge-warning',
    processing: 'badge-accent',
    held: 'badge-accent',
    paid: 'badge-success',
    released: 'badge-success',
    failed: 'badge-error',
    cancelled: 'badge-neutral',
    refunded: 'badge-primary',
    partially_refunded: 'badge-primary',
  };
  const labelKey: Record<PaymentStatus, TranslationKey> = {
    pending: 'payments.status.pending',
    processing: 'payments.status.processing',
    held: 'payments.status.held',
    paid: 'payments.status.paid',
    released: 'payments.status.released',
    failed: 'payments.status.failed',
    cancelled: 'payments.status.cancelled',
    refunded: 'payments.status.refunded',
    partially_refunded: 'payments.status.partially_refunded',
  };
  return <span className={map[status]}>{t(labelKey[status])}</span>;
}
