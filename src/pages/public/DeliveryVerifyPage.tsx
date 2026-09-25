import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { Spinner } from '@/components/ui/States';
import { QrCode, Package } from 'lucide-react';
import QRCode from 'qrcode';

export function DeliveryVerifyPage() {
  const { token } = useParams<{ token: string }>();
  const { t, dir } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadQr() {
      if (!token) {
        setError(t('shipment.invalidQrLink'));
        setLoading(false);
        return;
      }

      // Look up the token to get the order reference (RLS allows sender/traveler/admin)
      const { data, error: queryError } = await supabase
        .from('delivery_qr_tokens')
        .select('order_id, is_used, orders(order_number)')
        .eq('token', token)
        .maybeSingle();

      if (queryError || !data) {
        setError(t('shipment.invalidQrLink'));
        setLoading(false);
        return;
      }

      const orderData = data as unknown as { order_id: string; is_used: boolean; is_revoked: boolean; orders: { order_number: string } | null };
      if (orderData.is_revoked) {
        setError(t('shipment.qrRevokedMessage'));
        setLoading(false);
        return;
      }
      setOrderRef(orderData.orders?.order_number ?? t('shipment.orderReference'));

      // Generate the verification URL — the QR encodes only the opaque token
      const baseUrl = window.location.origin;
      const verifyUrl = `${baseUrl}/delivery/verify/${token}`;

      if (canvasRef.current) {
        try {
          await QRCode.toCanvas(canvasRef.current, verifyUrl, {
            width: 256,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' },
          });
        } catch {
          setError(t('shipment.qrGenerationFailed'));
        }
      }

      setLoading(false);
    }
    loadQr();
  }, [token, t]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md text-center space-y-3">
          <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-4" dir={dir}>
      <div className="max-w-md w-full space-y-6 rounded-2xl bg-white dark:bg-slate-900 p-8 shadow-xl text-center">
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary-50 dark:bg-primary-900/30">
            <QrCode className="h-7 w-7 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('shipment.deliveryVerification')}</h1>
          <div className="flex items-center justify-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <Package className="h-4 w-4" />
            <span>{t('shipment.orderLabel')}: {orderRef}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white flex items-center justify-center">
          <canvas ref={canvasRef} />
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400">{t('shipment.showQrToTraveler')}</p>
      </div>
    </div>
  );
}
