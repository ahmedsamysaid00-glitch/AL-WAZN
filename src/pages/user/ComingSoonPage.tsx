import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from './UserLayout';
import { EmptyState } from '@/components/ui/States';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';

interface ComingSoonPageProps {
  icon: LucideIcon;
  titleKey: TranslationKey;
  emptyKey: TranslationKey;
}

export function ComingSoonPage({ icon: Icon, titleKey, emptyKey }: ComingSoonPageProps) {
  const { t } = useLanguage();

  return (
    <UserLayout>
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
    </UserLayout>
  );
}
