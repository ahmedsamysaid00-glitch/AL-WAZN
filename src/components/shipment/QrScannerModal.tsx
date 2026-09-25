import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { QrCode, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import QrScanner from 'qr-scanner';

interface QrScannerModalProps {
  orderId: string;
  onVerified: () => void;
  onClose: () => void;
}

export function QrScannerModal({ onVerified, onClose }: QrScannerModalProps) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);

  const extractToken = useCallback((scannedText: string): string | null => {
    try {
      const url = new URL(scannedText);
      const parts = url.pathname.split('/');
      const token = parts[parts.length - 1];
      return token || null;
    } catch {
      if (/^[a-f0-9]{64}$/i.test(scannedText.trim())) {
        return scannedText.trim();
      }
      return null;
    }
  }, []);

  const handleScan = useCallback(async (scannedText: string) => {
    if (verifying || success) return;
    const token = extractToken(scannedText);
    if (!token) {
      setError(t('shipment.invalidQr'));
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('verify_delivery_qr', { p_token: token });
      if (rpcError) {
        setError(rpcError.message || t('shipment.qrVerificationFailed'));
        setVerifying(false);
        return;
      }
      if (!data?.success) {
        setError(t('shipment.qrVerificationFailed'));
        setVerifying(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        onVerified();
      }, 1500);
    } catch {
      setError(t('shipment.qrVerificationFailed'));
      setVerifying(false);
    }
  }, [verifying, success, extractToken, t, onVerified]);

  useEffect(() => {
    if (!videoRef.current) return;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => handleScan(typeof result === 'string' ? result : (result.data ?? '')),
      {
        preferredCamera: 'environment',
        highlightScanRegion: true,
        highlightCodeOutline: true,
      },
    );
    scannerRef.current = scanner;
    scanner.start().catch(() => {
      setError(t('shipment.cameraDenied'));
    });

    return () => {
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [handleScan, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade-in">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <QrCode className="h-5 w-5" /> {t('shipment.scanRecipientQr')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="h-14 w-14 text-success-500" />
            <p className="text-sm font-semibold text-success-600 dark:text-success-400">{t('shipment.deliveryConfirmed')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('shipment.scanInstructions')}</p>
            <div className="relative overflow-hidden rounded-lg bg-black aspect-square">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline />
            </div>
            {verifying && (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('shipment.verifyingQr')}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-error-200 bg-error-50 dark:bg-error-900/20 p-3">
                <AlertCircle className="h-4 w-4 text-error-500 flex-shrink-0" />
                <p className="text-sm text-error-600 dark:text-error-400">{error}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
