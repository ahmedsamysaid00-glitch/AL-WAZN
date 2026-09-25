import { useEffect } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ toast, onDismiss, duration = 4000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss, duration]);

  if (!toast) return null;

  const config: Record<ToastType, { icon: typeof CheckCircle2; bg: string; text: string; border: string }> = {
    success: {
      icon: CheckCircle2,
      bg: 'bg-success-50 dark:bg-success-900/20',
      text: 'text-success-700 dark:text-success-400',
      border: 'border-success-200 dark:border-success-800',
    },
    error: {
      icon: XCircle,
      bg: 'bg-error-50 dark:bg-error-900/20',
      text: 'text-error-700 dark:text-error-400',
      border: 'border-error-200 dark:border-error-800',
    },
    info: {
      icon: Info,
      bg: 'bg-primary-50 dark:bg-primary-900/20',
      text: 'text-primary-700 dark:text-primary-400',
      border: 'border-primary-200 dark:border-primary-800',
    },
  };

  const { icon: Icon, bg, text, border } = config[toast.type];

  return (
    <div className="fixed bottom-6 ltr:right-6 rtl:left-6 z-[60] animate-fade-in">
      <div className={`flex items-center gap-3 rounded-xl border ${border} ${bg} px-4 py-3 shadow-lg max-w-sm`}>
        <Icon className={`h-5 w-5 shrink-0 ${text}`} />
        <p className={`text-sm font-medium ${text}`}>{toast.message}</p>
        <button
          onClick={onDismiss}
          className={`shrink-0 rounded-lg p-1 ${text} hover:bg-black/5 dark:hover:bg-white/10 transition-colors`}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
