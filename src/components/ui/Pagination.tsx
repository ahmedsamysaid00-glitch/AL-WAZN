import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  t: (k: TranslationKey) => string;
  rtl?: boolean;
}

export function Pagination({ page, totalPages, onPageChange, t, rtl }: PaginationProps) {
  if (totalPages <= 1) return null;
  const chevron = rtl ? 'rotate-180' : '';

  return (
    <div className="flex items-center justify-center gap-4 pt-2">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        className="btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={t('common.previous')}
      >
        <ChevronLeft className={`h-4 w-4 ${chevron}`} />
        <span className="hidden sm:inline">{t('common.previous')}</span>
      </button>
      <span className="text-sm text-slate-600 dark:text-slate-400">
        {t('common.page')} {page + 1} {t('common.of')} {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages - 1}
        className="btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={t('common.next')}
      >
        <span className="hidden sm:inline">{t('common.next')}</span>
        <ChevronRight className={`h-4 w-4 ${chevron}`} />
      </button>
    </div>
  );
}
