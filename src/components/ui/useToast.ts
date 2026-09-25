import { useState, useCallback } from 'react';
import type { ToastType, ToastMessage } from './Toast';

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((type: ToastType, message: string) => {
    setToast({ id: Date.now().toString(), type, message });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, dismissToast };
}
