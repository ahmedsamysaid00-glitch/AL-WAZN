import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { useRealtimeRefresh } from '@/hooks/useRealtime';
import { MarketingLayout } from './MarketingLayout';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import type { MarketingSocialLink } from '@/types/database';
import type { TranslationKey } from '@/i18n/translations';
import {
  Link2,
  Copy,
  Check,
  Share2,
  QrCode,
  Download,
  Plus,
  Pencil,
  Trash2,
  X,
  ExternalLink,
  Megaphone,
  Info,
  AlertCircle,
  Facebook,
  MessageCircle,
  Send,
  Mail,
  Globe,
} from 'lucide-react';

const SUPPORTED_PLATFORMS = [
  { value: 'facebook', labelKey: 'marketing.toolsPlatformFacebook' as TranslationKey, icon: <Facebook className="h-4 w-4" /> },
  { value: 'instagram', labelKey: 'marketing.toolsPlatformInstagram' as TranslationKey, icon: <Globe className="h-4 w-4" /> },
  { value: 'tiktok', labelKey: 'marketing.toolsPlatformTiktok' as TranslationKey, icon: <Globe className="h-4 w-4" /> },
  { value: 'youtube', labelKey: 'marketing.toolsPlatformYoutube' as TranslationKey, icon: <Globe className="h-4 w-4" /> },
  { value: 'x', labelKey: 'marketing.toolsPlatformX' as TranslationKey, icon: <Globe className="h-4 w-4" /> },
  { value: 'telegram', labelKey: 'marketing.toolsPlatformTelegram' as TranslationKey, icon: <Send className="h-4 w-4" /> },
  { value: 'linkedin', labelKey: 'marketing.toolsPlatformLinkedin' as TranslationKey, icon: <Globe className="h-4 w-4" /> },
  { value: 'website', labelKey: 'marketing.toolsPlatformWebsite' as TranslationKey, icon: <Globe className="h-4 w-4" /> },
];

export function MarketingToolsPage() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const marketerId = profile?.id ?? '';

  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  const [socialLinks, setSocialLinks] = useState<MarketingSocialLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [linkError, setLinkError] = useState(false);

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [editingLink, setEditingLink] = useState<MarketingSocialLink | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [linkForm, setLinkForm] = useState({
    platform: '',
    profile_url: '',
    display_name: '',
    follower_count: '',
  });
  const [linkFormError, setLinkFormError] = useState('');

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const referralLink = referralCode ? `${window.location.origin}/?ref=${referralCode}` : '';

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from('marketing_settings')
      .select('referral_code')
      .limit(1)
      .maybeSingle();
    setReferralCode(data?.referral_code ?? null);
    setLoadingSettings(false);
  }, []);

  const fetchSocialLinks = useCallback(async () => {
    setLinkError(false);
    const { data, error } = await supabase
      .from('marketing_social_links')
      .select('*')
      .eq('marketer_id', marketerId)
      .order('created_at', { ascending: true });
    if (error) {
      setLinkError(true);
    } else {
      setSocialLinks((data ?? []) as MarketingSocialLink[]);
    }
    setLoadingLinks(false);
  }, [marketerId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (marketerId) fetchSocialLinks();
  }, [marketerId, fetchSocialLinks]);

  useRealtimeRefresh(
    [{ table: 'marketing_social_links', filter: `marketer_id=eq.${marketerId}` }],
    () => fetchSocialLinks(),
    !!marketerId,
  );

  useEffect(() => {
    if (!referralLink) {
      setQrDataUrl(null);
      return;
    }
    setQrLoading(true);
    QRCode.toDataURL(referralLink, {
      width: 256,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        setQrDataUrl(url);
        setQrLoading(false);
      })
      .catch(() => {
        setQrLoading(false);
      });
  }, [referralLink]);

  const handleCopyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  const handleCopyCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  const handleShare = async () => {
    if (!referralLink) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: t('marketing.toolsShareTitle'), url: referralLink });
      } catch { /* user cancelled */ }
    } else {
      handleCopyLink();
    }
  };

  const handleDownloadQR = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `referral-qr-${referralCode ?? 'code'}.png`;
    a.click();
  };

  const shareUrl = (platform: string) => {
    if (!referralLink) return;
    const encoded = encodeURIComponent(referralLink);
    const text = encodeURIComponent(t('marketing.toolsShareText'));
    const map: Record<string, string> = {
      whatsapp: `https://wa.me/?text=${text}%20${encoded}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
      telegram: `https://t.me/share/url?url=${encoded}&text=${text}`,
      x: `https://twitter.com/intent/tweet?url=${encoded}&text=${text}`,
      email: `mailto:?subject=${text}&body=${encoded}`,
    };
    const url = map[platform];
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openAddLinkModal = () => {
    setEditingLink(null);
    setLinkForm({ platform: '', profile_url: '', display_name: '', follower_count: '' });
    setLinkFormError('');
    setShowLinkModal(true);
  };

  const openEditLinkModal = (link: MarketingSocialLink) => {
    setEditingLink(link);
    setLinkForm({
      platform: link.platform,
      profile_url: link.profile_url,
      display_name: link.display_name ?? '',
      follower_count: link.follower_count?.toString() ?? '',
    });
    setLinkFormError('');
    setShowLinkModal(true);
  };

  const handleSaveLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkForm.platform || !linkForm.profile_url) {
      setLinkFormError(t('marketing.toolsSocialValidationRequired'));
      return;
    }
    if (!/^https?:\/\/.+/.test(linkForm.profile_url)) {
      setLinkFormError(t('marketing.toolsSocialValidationUrl'));
      return;
    }
    const existingActive = socialLinks.find(
      (l) => l.platform === linkForm.platform && l.is_active && l.id !== editingLink?.id,
    );
    if (existingActive) {
      setLinkFormError(t('marketing.toolsSocialValidationDuplicate'));
      return;
    }

    setSavingLink(true);
    setLinkFormError('');

    const payload = {
      marketer_id: marketerId,
      platform: linkForm.platform,
      profile_url: linkForm.profile_url,
      display_name: linkForm.display_name || null,
      follower_count: linkForm.follower_count ? parseInt(linkForm.follower_count, 10) : null,
      is_active: true,
    };

    if (editingLink) {
      const { error } = await supabase
        .from('marketing_social_links')
        .update({
          platform: payload.platform,
          profile_url: payload.profile_url,
          display_name: payload.display_name,
          follower_count: payload.follower_count,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingLink.id);
      if (error) {
        setLinkFormError(t('marketing.toolsSocialSaveFailed'));
      } else {
        setShowLinkModal(false);
        fetchSocialLinks();
      }
    } else {
      const { error } = await supabase
        .from('marketing_social_links')
        .insert(payload);
      if (error) {
        setLinkFormError(
          error.code === '23505'
            ? t('marketing.toolsSocialValidationDuplicate')
            : t('marketing.toolsSocialSaveFailed'),
        );
      } else {
        setShowLinkModal(false);
        fetchSocialLinks();
      }
    }
    setSavingLink(false);
  };

  const handleDeleteLink = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase
      .from('marketing_social_links')
      .delete()
      .eq('id', deleteId);
    setDeleting(false);
    if (!error) {
      setDeleteId(null);
      fetchSocialLinks();
    }
  };

  const platformLabel = (platform: string): string => {
    const p = SUPPORTED_PLATFORMS.find((s) => s.value === platform);
    return p ? t(p.labelKey) : platform;
  };

  if (loadingSettings) {
    return (
      <MarketingLayout>
        <LoadingState label={t('marketing.toolsLoading')} />
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('marketing.toolsTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('marketing.toolsSubtitle')}</p>
        </div>

        {/* Referral Link Card */}
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t('marketing.toolsReferralLinkTitle')}</h2>
          </div>
          {referralCode ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">{t('marketing.toolsYourLink')}</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-slate-100 dark:bg-slate-700 px-3 py-2 text-sm text-slate-700 dark:text-slate-300">
                    {referralLink}
                  </code>
                  <button
                    onClick={handleCopyLink}
                    className="shrink-0 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                    aria-label={t('marketing.copyLink')}
                  >
                    {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{t('marketing.toolsReferralLinkHint')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleCopyLink} className="btn-secondary btn-sm flex items-center gap-1.5">
                  {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {linkCopied ? t('marketing.copied') : t('marketing.copyLink')}
                </button>
                <button onClick={handleShare} className="btn-secondary btn-sm flex items-center gap-1.5">
                  <Share2 className="h-4 w-4" />
                  {t('marketing.toolsShare')}
                </button>
                {referralLink && (
                  <a href={referralLink} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm flex items-center gap-1.5">
                    <ExternalLink className="h-4 w-4" />
                    {t('marketing.toolsPreview')}
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('marketing.toolsNoCode')}</p>
          )}
        </div>

        {/* Referral Code Card */}
        {referralCode && (
          <div className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t('marketing.toolsReferralCodeTitle')}</h2>
            </div>
            <div className="flex items-center gap-3">
              <code className="rounded-lg bg-slate-100 dark:bg-slate-700 px-4 py-3 text-lg font-bold tracking-wider text-slate-800 dark:text-slate-200">
                {referralCode}
              </code>
              <button
                onClick={handleCopyCode}
                className="btn-secondary btn-sm flex items-center gap-1.5"
              >
                {codeCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {codeCopied ? t('marketing.copied') : t('marketing.copyCode')}
              </button>
            </div>
          </div>
        )}

        {/* QR Code Card */}
        {referralCode && (
          <div className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t('marketing.toolsQrTitle')}</h2>
            </div>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
              <div className="rounded-xl bg-white p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                {qrLoading ? (
                  <div className="h-48 w-48 flex items-center justify-center">
                    <LoadingState />
                  </div>
                ) : qrDataUrl ? (
                  <img src={qrDataUrl} alt={t('marketing.toolsQrAlt')} className="h-48 w-48" />
                ) : (
                  <div className="h-48 w-48 flex items-center justify-center text-sm text-slate-400">
                    {t('marketing.toolsQrFailed')}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xs">{t('marketing.toolsQrHint')}</p>
                {qrDataUrl && (
                  <button onClick={handleDownloadQR} className="btn-secondary btn-sm flex items-center gap-1.5 self-start">
                    <Download className="h-4 w-4" />
                    {t('marketing.toolsQrDownload')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Share Tools Card */}
        {referralCode && (
          <div className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Share2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t('marketing.toolsShareTitle')}</h2>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <ShareButton onClick={() => shareUrl('whatsapp')} icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp" />
              <ShareButton onClick={() => shareUrl('facebook')} icon={<Facebook className="h-5 w-5" />} label="Facebook" />
              <ShareButton onClick={() => shareUrl('telegram')} icon={<Send className="h-5 w-5" />} label="Telegram" />
              <ShareButton onClick={() => shareUrl('x')} icon={<Globe className="h-5 w-5" />} label="X" />
              <ShareButton onClick={() => shareUrl('email')} icon={<Mail className="h-5 w-5" />} label={t('marketing.toolsEmail')} />
              <ShareButton onClick={handleShare} icon={<Share2 className="h-5 w-5" />} label={t('marketing.toolsMore')} />
            </div>
          </div>
        )}

        {/* Social Links Card */}
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t('marketing.toolsSocialTitle')}</h2>
            </div>
            <button onClick={openAddLinkModal} className="btn-primary btn-sm flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              {t('marketing.toolsSocialAdd')}
            </button>
          </div>
          {loadingLinks ? (
            <LoadingState />
          ) : linkError ? (
            <ErrorState message={t('marketing.toolsSocialLoadFailed')} onRetry={fetchSocialLinks} retryLabel={t('common.retry')} />
          ) : socialLinks.length === 0 ? (
            <EmptyState icon={<Globe className="h-8 w-8" />} title={t('marketing.toolsSocialEmpty')} description={t('marketing.toolsSocialEmptyDesc')} />
          ) : (
            <div className="space-y-2">
              {socialLinks.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                      <Globe className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{platformLabel(link.platform)}</p>
                      <a href={link.profile_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-primary-600 dark:text-primary-400 hover:underline">
                        {link.profile_url}
                      </a>
                      {link.follower_count != null && (
                        <p className="text-xs text-slate-400 dark:text-slate-500">{t('marketing.toolsFollowers')}: {link.follower_count.toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEditLinkModal(link)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label={t('marketing.toolsEdit')}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setDeleteId(link.id)} className="rounded-lg p-2 text-error-500 hover:bg-error-50 dark:hover:bg-error-900/30" aria-label={t('marketing.toolsDelete')}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Campaign Links — Not Available */}
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t('marketing.toolsCampaignTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('marketing.toolsCampaignUnavailable')}</p>
            </div>
          </div>
        </div>

        {/* UTM Parameters — Not Available */}
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">{t('marketing.toolsUtmTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('marketing.toolsUtmUnavailable')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Social Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLinkModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {editingLink ? t('marketing.toolsSocialEdit') : t('marketing.toolsSocialAdd')}
              </h3>
              <button onClick={() => setShowLinkModal(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveLink} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('marketing.toolsSocialPlatform')}</label>
                <select
                  value={linkForm.platform}
                  onChange={(e) => setLinkForm({ ...linkForm, platform: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:outline-none"
                >
                  <option value="">{t('marketing.toolsSocialPlatformPlaceholder')}</option>
                  {SUPPORTED_PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>{t(p.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('marketing.toolsSocialUrl')}</label>
                <input
                  type="url"
                  value={linkForm.profile_url}
                  onChange={(e) => setLinkForm({ ...linkForm, profile_url: e.target.value })}
                  placeholder="https://"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('marketing.toolsSocialDisplayName')}</label>
                <input
                  type="text"
                  value={linkForm.display_name}
                  onChange={(e) => setLinkForm({ ...linkForm, display_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('marketing.toolsSocialFollowers')}</label>
                <input
                  type="number"
                  value={linkForm.follower_count}
                  onChange={(e) => setLinkForm({ ...linkForm, follower_count: e.target.value })}
                  min="0"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:border-primary-500 focus:outline-none"
                />
              </div>
              {linkFormError && (
                <p className="text-sm text-error-500">{linkFormError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowLinkModal(false)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
                <button type="submit" disabled={savingLink} className="btn-primary btn-sm">
                  {savingLink ? t('common.loading') : editingLink ? t('common.save') : t('marketing.toolsSocialAdd')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error-50 dark:bg-error-900/40">
                <Trash2 className="h-5 w-5 text-error-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('marketing.toolsSocialDeleteTitle')}</h3>
            </div>
            <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">{t('marketing.toolsSocialDeleteConfirm')}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="btn-secondary btn-sm">{t('common.cancel')}</button>
              <button onClick={handleDeleteLink} disabled={deleting} className="btn-sm rounded-lg bg-error-600 px-4 py-2 text-sm font-medium text-white hover:bg-error-700">
                {deleting ? t('common.loading') : t('marketing.toolsDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </MarketingLayout>
  );
}

function ShareButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
