import { useLanguage } from '@/i18n/useLanguage';
import { AdminLayout } from './AdminLayout';
import { EmptyState } from '@/components/ui/States';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

interface AdminComingSoonProps {
  icon: LucideIcon;
  titleKey: TranslationKey;
  emptyKey: TranslationKey;
}

export function AdminComingSoon({ icon: Icon, titleKey, emptyKey }: AdminComingSoonProps) {
  const { t } = useLanguage();

  return (
    <AdminLayout>
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t(titleKey)}</h1>
        <div className="card">
          <EmptyState
            icon={<Icon className="h-8 w-8" />}
            title={t(emptyKey)}
            description={t('empty.comingSoonDesc')}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
