import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/i18n/useLanguage';
import { Camera, RefreshCw, CheckCircle2, Upload, AlertCircle } from 'lucide-react';

interface ShipmentReceiptPhotoCaptureProps {
  orderId: string;
  onPhotoRecorded: () => void;
}

export function ShipmentReceiptPhotoCapture({ orderId, onPhotoRecorded }: ShipmentReceiptPhotoCaptureProps) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mode, setMode] = useState<'idle' | 'camera' | 'preview' | 'uploading' | 'done'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setMode('camera');
    } catch {
      setError(t('shipment.cameraDenied'));
    }
  }, [t]);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) {
        setError(t('shipment.captureFailed'));
        return;
      }
      const file = new File([blob], `shipment-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCapturedFile(file);
      setPreviewUrl(URL.createObjectURL(blob));
      stopCamera();
      setMode('preview');
    }, 'image/jpeg', 0.85);
  }, [stopCamera, t]);

  const retakePhoto = useCallback(() => {
    setPreviewUrl(null);
    setCapturedFile(null);
    startCamera();
  }, [startCamera]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t('shipment.invalidFileType'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t('shipment.fileTooLarge'));
      return;
    }
    setError(null);
    setCapturedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setMode('preview');
  }, [t]);

  const confirmAndUpload = useCallback(async () => {
    if (!capturedFile) return;
    setMode('uploading');
    setError(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        setError(t('shipment.authRequired'));
        setMode('preview');
        return;
      }

      const fileExt = capturedFile.name.split('.').pop() || 'jpg';
      const fileName = `${userId}/${orderId}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('shipment-photos')
        .upload(fileName, capturedFile, { contentType: capturedFile.type });

      if (uploadError) {
        setError(uploadError.message || t('shipment.uploadFailed'));
        setMode('preview');
        return;
      }

      const { error: rpcError } = await supabase.rpc('record_shipment_receipt', {
        p_order_id: orderId,
        p_storage_path: fileName,
      });

      if (rpcError) {
        await supabase.storage.from('shipment-photos').remove([fileName]);
        setError(rpcError.message || t('shipment.uploadFailed'));
        setMode('preview');
        return;
      }

      setMode('done');
      onPhotoRecorded();
    } catch {
      setError(t('shipment.uploadFailed'));
      setMode('preview');
    }
  }, [capturedFile, orderId, onPhotoRecorded, t]);

  if (mode === 'done') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-success-200 bg-success-50 dark:bg-success-900/20 p-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-success-600" />
        <p className="text-sm font-semibold text-success-700 dark:text-success-400">{t('shipment.receivedConfirmed')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />
      <canvas ref={canvasRef} className="hidden" />

      {mode === 'camera' && (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full"
              onLoadedMetadata={() => videoRef.current?.play()}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="border-2 border-white/70 rounded-lg w-48 h-48" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={capturePhoto} className="btn-primary btn-sm flex-1">
              <Camera className="h-4 w-4" /> {t('shipment.takePhoto')}
            </button>
            <button onClick={() => { stopCamera(); setMode('idle'); }} className="btn-secondary btn-sm">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {mode === 'preview' && previewUrl && (
        <div className="space-y-3">
          <img src={previewUrl} alt="Shipment preview" className="w-full rounded-lg border border-slate-200 dark:border-slate-700" />
          <div className="flex gap-2">
            <button onClick={retakePhoto} className="btn-secondary btn-sm flex-1">
              <RefreshCw className="h-4 w-4" /> {t('shipment.retakePhoto')}
            </button>
            <button onClick={confirmAndUpload} className="btn-primary btn-sm flex-1">
              <CheckCircle2 className="h-4 w-4" />
              {t('shipment.confirmReceived')}
            </button>
          </div>
        </div>
      )}

      {mode === 'idle' && (
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
            <Camera className="h-10 w-10 text-slate-400" />
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('shipment.photoInstructions')}</p>
            <div className="flex gap-2">
              <button onClick={startCamera} className="btn-primary btn-sm">
                <Camera className="h-4 w-4" /> {t('shipment.takePhoto')}
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="btn-secondary btn-sm">
                <Upload className="h-4 w-4" /> {t('shipment.uploadFile')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-error-200 bg-error-50 dark:bg-error-900/20 p-3">
          <AlertCircle className="h-4 w-4 text-error-500 flex-shrink-0" />
          <p className="text-sm text-error-600 dark:text-error-400">{error}</p>
        </div>
      )}
    </div>
  );
}
