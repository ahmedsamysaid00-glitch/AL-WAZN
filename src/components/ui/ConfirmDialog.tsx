import { useEffect, useRef } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  destructive?: boolean;
  entityLabel?: string;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  loading = false,
  destructive = false,
  entityLabel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', handleEsc);
    confirmRef.current?.focus();
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => { if (!loading) onCancel(); }}
      />
      <div
        className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              destructive
                ? 'bg-error-50 dark:bg-error-900/30 text-error-600 dark:text-error-400'
                : 'bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400'
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 id="confirm-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={() => { if (!loading) onCancel(); }}
            className="ltr:ml-auto rtl:mr-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label={cancelLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
          {entityLabel && (
            <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white break-all">
              {entityLabel}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={loading}
            className={
              destructive
                ? 'btn-primary bg-error-600 hover:bg-error-700'
                : 'btn-primary'
            }
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PromptDialogProps {
  open: boolean;
  title: string;
  message: string;
  label: string;
  placeholder?: string;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  loading?: boolean;
  initialValue?: string;
  required?: boolean;
  multiline?: boolean;
}

export function PromptDialog({
  open,
  title,
  message,
  label,
  placeholder,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
  loading = false,
  initialValue = '',
  required = true,
  multiline = false,
}: PromptDialogProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const valueRef = useRef(initialValue);

  useEffect(() => {
    if (!open) return;
    valueRef.current = initialValue;
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        if (inputRef.current instanceof HTMLInputElement) {
          inputRef.current.select();
        }
      }
    }, 50);
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
      clearTimeout(timer);
    };
  }, [open, initialValue, loading, onCancel]);

  if (!open) return null;

  const handleSubmit = () => {
    const v = valueRef.current.trim();
    if (required && !v) return;
    onSubmit(v);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={() => { if (!loading) onCancel(); }}
      />
      <div
        className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <h2 id="prompt-dialog-title" className="text-lg font-bold text-slate-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={() => { if (!loading) onCancel(); }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label={cancelLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              {label}
            </label>
            {multiline ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                defaultValue={initialValue}
                onChange={(e) => { valueRef.current = e.target.value; }}
                placeholder={placeholder}
                disabled={loading}
                rows={3}
                className="input resize-none"
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type="text"
                defaultValue={initialValue}
                onChange={(e) => { valueRef.current = e.target.value; }}
                placeholder={placeholder}
                disabled={loading}
                className="input"
                onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleSubmit(); }}
              />
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700 px-6 py-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (required && !valueRef.current.trim())}
            className="btn-primary"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
