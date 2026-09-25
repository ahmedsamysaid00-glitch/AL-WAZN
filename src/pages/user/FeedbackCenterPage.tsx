import { useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from '@/pages/user/UserLayout';
import { Toast } from '@/components/ui/Toast'
import { useToast } from '@/components/ui/useToast';
import { Spinner } from '@/components/ui/States';
import { supabase } from '@/lib/supabase';
import type { TranslationKey } from '@/i18n/translations';
import type {
  FeedbackType,
  FeedbackCategory,
} from '@/types/database';
import {
  Star,
  Lightbulb,
  Bug,
  ShieldAlert,
  ClipboardList,
  ArrowLeft,
  ArrowRight,
  Upload,
  X,
  CheckCircle2,
  Heart,
  MessageSquare,
} from 'lucide-react';

type Flow = 'home' | 'rating' | 'suggestion' | 'bug' | 'security' | 'success';

interface FeedbackSubmission {
  feedbackId: string;
  type: FeedbackType;
}

export function FeedbackCenterPage() {
  const { profile } = useAuth();
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast, showToast, dismissToast } = useToast();
  const [flow, setFlow] = useState<Flow>('home');
  const [submission, setSubmission] = useState<FeedbackSubmission | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isTraveler = profile?.role === 'traveler';
  const isSender = profile?.role === 'sender';

  const handleSuccess = useCallback((feedbackId: string, type: FeedbackType) => {
    setSubmission({ feedbackId, type });
    setFlow('success');
  }, []);

  const handleSubmitError = useCallback((errorKey: TranslationKey) => {
    showToast('error', t(errorKey));
  }, [showToast, t]);

  const backIcon = dir === 'rtl' ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />;
  const forwardIcon = dir === 'rtl' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />;

  return (
    <UserLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        {flow !== 'success' && (
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 dark:bg-primary-900/20 px-4 py-1.5">
              <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                {t('feedback.badge')}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {t('feedback.title')}
            </h1>
            <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
              {t('feedback.description')}
            </p>
          </div>
        )}

        {flow === 'home' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FeedbackCard
              icon={<Star className="h-6 w-6" />}
              gradient="from-amber-400 to-orange-500"
              title={t('feedback.card.rating.title')}
              description={t('feedback.card.rating.description')}
              onClick={() => setFlow('rating')}
            />
            <FeedbackCard
              icon={<Lightbulb className="h-6 w-6" />}
              gradient="from-primary-500 to-primary-600"
              title={t('feedback.card.suggestion.title')}
              description={t('feedback.card.suggestion.description')}
              onClick={() => setFlow('suggestion')}
            />
            <FeedbackCard
              icon={<Bug className="h-6 w-6" />}
              gradient="from-rose-500 to-red-500"
              title={t('feedback.card.bug.title')}
              description={t('feedback.card.bug.description')}
              onClick={() => setFlow('bug')}
            />
            <FeedbackCard
              icon={<ShieldAlert className="h-6 w-6" />}
              gradient="from-slate-600 to-slate-800"
              title={t('feedback.card.security.title')}
              description={t('feedback.card.security.description')}
              onClick={() => setFlow('security')}
            />
            <FeedbackCard
              icon={<ClipboardList className="h-6 w-6" />}
              gradient="from-slate-400 to-slate-500"
              title={t('feedback.card.myFeedback.title')}
              description={t('feedback.card.myFeedback.description')}
              onClick={() => navigate('/dashboard/feedback/my')}
              comingSoon
              comingSoonLabel={t('feedback.comingSoon')}
            />
          </div>
        )}

        {flow === 'home' && (
          <button
            onClick={() => navigate('/dashboard/feedback/ideas')}
            className="group flex w-full items-center gap-3 rounded-2xl border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 p-4 text-start transition-all hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-md">
              <Lightbulb className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-primary-700 dark:text-primary-300">{t('feedback.ideas.linkTitle')}</h3>
              <p className="text-xs text-primary-600/80 dark:text-primary-400/80">{t('feedback.ideas.linkDescription')}</p>
            </div>
            {forwardIcon}
          </button>
        )}

        {flow === 'rating' && (
          <RatingFlow
            isTraveler={isTraveler}
            isSender={isSender}
            submitting={submitting}
            setSubmitting={setSubmitting}
            onSuccess={handleSuccess}
            onError={handleSubmitError}
            onBack={() => setFlow('home')}
            backIcon={backIcon}
            pageUrl={location.pathname}
          />
        )}

        {flow === 'suggestion' && (
          <SuggestionFlow
            submitting={submitting}
            setSubmitting={setSubmitting}
            onSuccess={handleSuccess}
            onError={handleSubmitError}
            onBack={() => setFlow('home')}
            backIcon={backIcon}
            pageUrl={location.pathname}
          />
        )}

        {flow === 'bug' && (
          <BugFlow
            submitting={submitting}
            setSubmitting={setSubmitting}
            onSuccess={handleSuccess}
            onError={handleSubmitError}
            onBack={() => setFlow('home')}
            backIcon={backIcon}
            pageUrl={location.pathname}
          />
        )}

        {flow === 'security' && (
          <SecurityFlow
            submitting={submitting}
            setSubmitting={setSubmitting}
            onSuccess={handleSuccess}
            onError={handleSubmitError}
            onBack={() => setFlow('home')}
            backIcon={backIcon}
            pageUrl={location.pathname}
          />
        )}

        {flow === 'success' && submission && (
          <SuccessView
            onSendAnother={() => setFlow('home')}
            onViewMyFeedback={() => navigate('/dashboard/feedback/my')}
            forwardIcon={forwardIcon}
          />
        )}
      </div>
      <Toast toast={toast} onDismiss={dismissToast} />
    </UserLayout>
  );
}

// ============================================
// Feedback Card
// ============================================

function FeedbackCard({
  icon,
  gradient,
  title,
  description,
  onClick,
  comingSoon,
  comingSoonLabel,
}: {
  icon: React.ReactNode;
  gradient: string;
  title: string;
  description: string;
  onClick: () => void;
  comingSoon?: boolean;
  comingSoonLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-start transition-all hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-lg dark:hover:shadow-slate-900/30"
    >
      <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md`}>
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      {comingSoon && comingSoonLabel && (
        <span className="mt-3 inline-block rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          {comingSoonLabel}
        </span>
      )}
    </button>
  );
}

// ============================================
// Shared Flow Header
// ============================================

function FlowHeader({
  title,
  onBack,
  backIcon,
}: {
  title: string;
  onBack: () => void;
  backIcon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onBack} className="btn-ghost btn-sm">
        {backIcon}
        <span className="sr-only">Back</span>
      </button>
      <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
    </div>
  );
}

// ============================================
// Star Rating Input
// ============================================

function StarRating({
  value,
  onChange,
  size = 'lg',
}: {
  value: number;
  onChange: (v: number) => void;
  size?: 'lg' | 'sm';
}) {
  const [hover, setHover] = useState(0);
  const starSize = size === 'lg' ? 'h-10 w-10 sm:h-12 sm:w-12' : 'h-7 w-7';

  return (
    <div className="flex gap-1.5 sm:gap-2">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          className={`${starSize} transition-transform hover:scale-110 focus:outline-none`}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          <Star
            className={`h-full w-full ${
              (hover || value) >= star
                ? 'fill-amber-400 text-amber-400'
                : 'fill-slate-200 text-slate-300 dark:fill-slate-700 dark:text-slate-600'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ============================================
// Optional Label
// ============================================

function OptionalLabel() {
  const { t } = useLanguage();
  return (
    <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
      ({t('feedback.optional')})
    </span>
  );
}

// ============================================
// Rating Flow
// ============================================

function RatingFlow({
  isTraveler,
  isSender,
  submitting,
  setSubmitting,
  onSuccess,
  onError,
  onBack,
  backIcon,
  pageUrl,
}: {
  isTraveler: boolean;
  isSender: boolean;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  onSuccess: (id: string, type: FeedbackType) => void;
  onError: (key: TranslationKey) => void;
  onBack: () => void;
  backIcon: React.ReactNode;
  pageUrl: string;
}) {
  const { t } = useLanguage();
  const [rating, setRating] = useState(0);
  const [secondaryRatings, setSecondaryRatings] = useState<Record<string, number>>({});
  const [improvement, setImprovement] = useState('');

  const secondaryQuestions: { key: string; labelKey: TranslationKey }[] = isTraveler
    ? [
        { key: 'ease_listing', labelKey: 'feedback.rating.traveler.easeListing' },
        { key: 'ease_sender', labelKey: 'feedback.rating.traveler.easeSender' },
        { key: 'clarity', labelKey: 'feedback.rating.traveler.clarity' },
        { key: 'safety', labelKey: 'feedback.rating.traveler.safety' },
      ]
    : isSender
      ? [
          { key: 'ease_find', labelKey: 'feedback.rating.sender.easeFind' },
          { key: 'clarity_info', labelKey: 'feedback.rating.sender.clarityInfo' },
          { key: 'ease_contact', labelKey: 'feedback.rating.sender.easeContact' },
          { key: 'safety', labelKey: 'feedback.rating.sender.safety' },
        ]
      : [];

  const handleSubmit = async () => {
    if (rating === 0) {
      onError('feedback.error.ratingRequired');
      return;
    }
    setSubmitting(true);

    const messageParts: string[] = [];
    for (const q of secondaryQuestions) {
      const val = secondaryRatings[q.key];
      if (val) {
        messageParts.push(`${t(q.labelKey)}: ${val}/5`);
      }
    }
    if (improvement.trim()) {
      messageParts.push(`${t('feedback.rating.improvement')}: ${improvement.trim()}`);
    }

    const { data, error } = await supabase.rpc('create_feedback', {
      p_type: 'general_feedback',
      p_category: isTraveler ? 'traveler_experience' : 'sender_experience',
      p_title: t('feedback.rating.title'),
      p_message: messageParts.join('\n') || t('feedback.rating.defaultMessage'),
      p_rating: rating,
      p_is_public: false,
      p_source: 'rating_flow',
      p_page_url: pageUrl,
    });

    setSubmitting(false);

    if (error) {
      if (error.code === '42901' || error.message.includes('rate')) {
        onError('feedback.error.rateLimit');
      } else {
        onError('feedback.error.generic');
      }
      return;
    }

    if (data) {
      onSuccess(data as string, 'general_feedback');
    }
  };

  return (
    <div className="space-y-6">
      <FlowHeader title={t('feedback.rating.flowTitle')} onBack={onBack} backIcon={backIcon} />

      <div className="card p-6 space-y-6">
        <div className="text-center space-y-4">
          <p className="text-lg font-medium text-slate-900 dark:text-white">
            {t('feedback.rating.mainQuestion')}
          </p>
          <div className="flex justify-center">
            <StarRating value={rating} onChange={setRating} />
          </div>
        </div>

        {rating > 0 && secondaryQuestions.length > 0 && (
          <div className="space-y-5 border-t border-slate-100 dark:border-slate-700 pt-6">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('feedback.rating.secondaryTitle')} <OptionalLabel />
            </p>
            {secondaryQuestions.map((q) => (
              <div key={q.key} className="space-y-2">
                <label className="text-sm text-slate-600 dark:text-slate-400">{t(q.labelKey)}</label>
                <StarRating
                  value={secondaryRatings[q.key] ?? 0}
                  onChange={(v) => setSecondaryRatings({ ...secondaryRatings, [q.key]: v })}
                  size="sm"
                />
              </div>
            ))}
          </div>
        )}

        {rating > 0 && (
          <div className="space-y-2 border-t border-slate-100 dark:border-slate-700 pt-6">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('feedback.rating.improvement')} <OptionalLabel />
            </label>
            <textarea
              value={improvement}
              onChange={(e) => setImprovement(e.target.value)}
              className="input"
              rows={3}
              placeholder={t('feedback.rating.improvementPlaceholder')}
            />
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || rating === 0}
          className="btn-primary w-full"
        >
          {submitting ? <Spinner size="sm" /> : t('feedback.submit')}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Suggestion Flow
// ============================================

function SuggestionFlow({
  submitting,
  setSubmitting,
  onSuccess,
  onError,
  onBack,
  backIcon,
  pageUrl,
}: {
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  onSuccess: (id: string, type: FeedbackType) => void;
  onError: (key: TranslationKey) => void;
  onBack: () => void;
  backIcon: React.ReactNode;
  pageUrl: string;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('new_feature');
  const [description, setDescription] = useState('');
  const [problem, setProblem] = useState('');
  const [solution, setSolution] = useState('');

  const categories: { value: FeedbackCategory; labelKey: TranslationKey }[] = [
    { value: 'new_feature', labelKey: 'feedback.category.new_feature' },
    { value: 'improve_existing_feature', labelKey: 'feedback.category.improve_existing_feature' },
    { value: 'design', labelKey: 'feedback.category.design' },
    { value: 'traveler_experience', labelKey: 'feedback.category.traveler_experience' },
    { value: 'sender_experience', labelKey: 'feedback.category.sender_experience' },
    { value: 'communication', labelKey: 'feedback.category.communication' },
    { value: 'safety_trust', labelKey: 'feedback.category.safety_trust' },
    { value: 'identity_verification', labelKey: 'feedback.category.identity_verification' },
    { value: 'tracking', labelKey: 'feedback.category.tracking' },
    { value: 'payments', labelKey: 'feedback.category.payments' },
    { value: 'notifications', labelKey: 'feedback.category.notifications' },
    { value: 'other', labelKey: 'feedback.category.other' },
  ];

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      onError('feedback.error.requiredFields');
      return;
    }
    setSubmitting(true);

    const messageParts = [description.trim()];
    if (problem.trim()) messageParts.push(`${t('feedback.suggestion.problem')}: ${problem.trim()}`);
    if (solution.trim()) messageParts.push(`${t('feedback.suggestion.solution')}: ${solution.trim()}`);

    const { data, error } = await supabase.rpc('create_feedback', {
      p_type: 'suggestion',
      p_category: category,
      p_title: title.trim(),
      p_message: messageParts.join('\n\n'),
      p_is_public: false,
      p_source: 'suggestion_flow',
      p_page_url: pageUrl,
      p_proposed_solution: solution.trim() || null,
    });

    setSubmitting(false);

    if (error) {
      if (error.code === '42901' || error.message.includes('rate')) {
        onError('feedback.error.rateLimit');
      } else {
        onError('feedback.error.generic');
      }
      return;
    }

    if (data) {
      onSuccess(data as string, 'suggestion');
    }
  };

  return (
    <div className="space-y-6">
      <FlowHeader title={t('feedback.suggestion.flowTitle')} onBack={onBack} backIcon={backIcon} />

      <div className="card p-6 space-y-5">
        <div className="space-y-2">
          <label className="label">{t('feedback.suggestion.title')} *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            maxLength={200}
            placeholder={t('feedback.suggestion.titlePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="label">{t('feedback.suggestion.category')} *</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            className="input"
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="label">{t('feedback.suggestion.description')} *</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
            rows={4}
            maxLength={2000}
            placeholder={t('feedback.suggestion.descriptionPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('feedback.suggestion.problem')} <OptionalLabel />
          </label>
          <textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            className="input"
            rows={3}
            maxLength={1000}
            placeholder={t('feedback.suggestion.problemPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('feedback.suggestion.solution')} <OptionalLabel />
          </label>
          <textarea
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            className="input"
            rows={3}
            maxLength={1000}
            placeholder={t('feedback.suggestion.solutionPlaceholder')}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !title.trim() || !description.trim()}
          className="btn-primary w-full"
        >
          {submitting ? <Spinner size="sm" /> : t('feedback.submit')}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Bug Report Flow
// ============================================

function detectDeviceType(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
  if (/Tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

function detectOS(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'unknown';
}

function detectBrowser(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Edg/i.test(ua)) return 'Edge';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'unknown';
}

function BugFlow({
  submitting,
  setSubmitting,
  onSuccess,
  onError,
  onBack,
  backIcon,
  pageUrl,
}: {
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  onSuccess: (id: string, type: FeedbackType) => void;
  onError: (key: TranslationKey) => void;
  onBack: () => void;
  backIcon: React.ReactNode;
  pageUrl: string;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('technical_other');
  const [whatHappened, setWhatHappened] = useState('');
  const [expected, setExpected] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categories: { value: FeedbackCategory; labelKey: TranslationKey }[] = [
    { value: 'registration', labelKey: 'feedback.bug.category.registration' },
    { value: 'login', labelKey: 'feedback.bug.category.login' },
    { value: 'account', labelKey: 'feedback.bug.category.account' },
    { value: 'create_listing', labelKey: 'feedback.bug.category.create_listing' },
    { value: 'search', labelKey: 'feedback.bug.category.search' },
    { value: 'orders', labelKey: 'feedback.bug.category.orders' },
    { value: 'messages', labelKey: 'feedback.bug.category.messages' },
    { value: 'notifications', labelKey: 'feedback.bug.category.notifications' },
    { value: 'identity_verification', labelKey: 'feedback.bug.category.identity_verification' },
    { value: 'file_upload', labelKey: 'feedback.bug.category.file_upload' },
    { value: 'technical_other', labelKey: 'feedback.bug.category.technical_other' },
  ];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      onError('feedback.error.invalidFileType');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onError('feedback.error.fileTooLarge');
      return;
    }
    setScreenshot(file);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !whatHappened.trim()) {
      onError('feedback.error.requiredFields');
      return;
    }
    setSubmitting(true);

    const messageParts = [whatHappened.trim()];
    if (expected.trim()) {
      messageParts.push(`${t('feedback.bug.expected')}: ${expected.trim()}`);
    }

    const { data: feedbackId, error } = await supabase.rpc('create_feedback', {
      p_type: 'bug_report',
      p_category: category,
      p_title: title.trim(),
      p_message: messageParts.join('\n\n'),
      p_is_public: false,
      p_source: 'bug_flow',
      p_page_url: pageUrl,
      p_device_type: detectDeviceType(),
      p_operating_system: detectOS(),
      p_browser: detectBrowser(),
      p_expected_behavior: expected.trim() || null,
    });

    if (error) {
      setSubmitting(false);
      if (error.code === '42901' || error.message.includes('rate')) {
        onError('feedback.error.rateLimit');
      } else {
        onError('feedback.error.generic');
      }
      return;
    }

    const fid = feedbackId as string;

    if (screenshot && fid) {
      setUploading(true);
      const ext = screenshot.name.split('.').pop() ?? 'png';
      const filePath = `${fid}/screenshot.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('feedback-attachments')
        .upload(filePath, screenshot, { upsert: false });

      setUploading(false);

      if (uploadError) {
        // Feedback was created; screenshot failed — still succeed but warn
        onError('feedback.error.screenshotFailed');
        onSuccess(fid, 'bug_report');
        return;
      }

      const { error: attachError } = await supabase.from('feedback_attachments').insert({
        feedback_id: fid,
        storage_path: filePath,
        file_type: screenshot.type,
      });

      if (attachError) {
        onError('feedback.error.screenshotFailed');
        onSuccess(fid, 'bug_report');
        return;
      }
    }

    setSubmitting(false);
    onSuccess(fid, 'bug_report');
  };

  return (
    <div className="space-y-6">
      <FlowHeader title={t('feedback.bug.flowTitle')} onBack={onBack} backIcon={backIcon} />

      <div className="card p-6 space-y-5">
        <div className="space-y-2">
          <label className="label">{t('feedback.bug.title')} *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            maxLength={200}
            placeholder={t('feedback.bug.titlePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="label">{t('feedback.bug.category')}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            className="input"
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="label">{t('feedback.bug.whatHappened')} *</label>
          <textarea
            value={whatHappened}
            onChange={(e) => setWhatHappened(e.target.value)}
            className="input"
            rows={4}
            maxLength={2000}
            placeholder={t('feedback.bug.whatHappenedPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('feedback.bug.expected')} <OptionalLabel />
          </label>
          <textarea
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            className="input"
            rows={3}
            maxLength={1000}
            placeholder={t('feedback.bug.expectedPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('feedback.bug.screenshot')} <OptionalLabel />
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />
          {screenshot ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <span className="flex-1 truncate text-sm text-slate-600 dark:text-slate-400">{screenshot.name}</span>
              <button
                onClick={() => setScreenshot(null)}
                className="btn-ghost btn-sm text-error-500"
                aria-label={t('feedback.bug.removeScreenshot')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 px-4 py-6 text-sm text-slate-500 dark:text-slate-400 transition-colors hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400"
            >
              <Upload className="h-5 w-5" />
              {t('feedback.bug.uploadScreenshot')}
            </button>
          )}
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t('feedback.bug.screenshotHint')}
          </p>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || uploading || !title.trim() || !whatHappened.trim()}
          className="btn-primary w-full"
        >
          {submitting || uploading ? <Spinner size="sm" /> : t('feedback.submit')}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Security Report Flow
// ============================================

function SecurityFlow({
  submitting,
  setSubmitting,
  onSuccess,
  onError,
  onBack,
  backIcon,
  pageUrl,
}: {
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  onSuccess: (id: string, type: FeedbackType) => void;
  onError: (key: TranslationKey) => void;
  onBack: () => void;
  backIcon: React.ReactNode;
  pageUrl: string;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('security_other');
  const [whatHappened, setWhatHappened] = useState('');
  const [details, setDetails] = useState('');

  const categories: { value: FeedbackCategory; labelKey: TranslationKey }[] = [
    { value: 'suspicious_account', labelKey: 'feedback.security.category.suspicious_account' },
    { value: 'suspicious_listing', labelKey: 'feedback.security.category.suspicious_listing' },
    { value: 'inappropriate_behavior', labelKey: 'feedback.security.category.inappropriate_behavior' },
    { value: 'off_platform_contact', labelKey: 'feedback.security.category.off_platform_contact' },
    { value: 'identity_verification', labelKey: 'feedback.security.category.identity_verification' },
    { value: 'privacy_issue', labelKey: 'feedback.security.category.privacy_issue' },
    { value: 'security_other', labelKey: 'feedback.security.category.security_other' },
  ];

  const handleSubmit = async () => {
    if (!title.trim() || !whatHappened.trim()) {
      onError('feedback.error.requiredFields');
      return;
    }
    setSubmitting(true);

    const messageParts = [whatHappened.trim()];
    if (details.trim()) {
      messageParts.push(`${t('feedback.security.details')}: ${details.trim()}`);
    }

    const { data, error } = await supabase.rpc('create_feedback', {
      p_type: 'security_report',
      p_category: category,
      p_title: title.trim(),
      p_message: messageParts.join('\n\n'),
      p_is_public: false,
      p_source: 'security_flow',
      p_page_url: pageUrl,
    });

    setSubmitting(false);

    if (error) {
      if (error.code === '42901' || error.message.includes('rate')) {
        onError('feedback.error.rateLimit');
      } else {
        onError('feedback.error.generic');
      }
      return;
    }

    if (data) {
      onSuccess(data as string, 'security_report');
    }
  };

  return (
    <div className="space-y-6">
      <FlowHeader title={t('feedback.security.flowTitle')} onBack={onBack} backIcon={backIcon} />

      <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex gap-3">
          <ShieldAlert className="h-5 w-5 shrink-0 text-slate-600 dark:text-slate-400" />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('feedback.security.privacyNotice')}
          </p>
        </div>
      </div>

      <div className="card p-6 space-y-5">
        <div className="space-y-2">
          <label className="label">{t('feedback.security.title')} *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            maxLength={200}
            placeholder={t('feedback.security.titlePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="label">{t('feedback.security.category')}</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            className="input"
          >
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="label">{t('feedback.security.whatHappened')} *</label>
          <textarea
            value={whatHappened}
            onChange={(e) => setWhatHappened(e.target.value)}
            className="input"
            rows={4}
            maxLength={2000}
            placeholder={t('feedback.security.whatHappenedPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('feedback.security.details')} <OptionalLabel />
          </label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className="input"
            rows={3}
            maxLength={1000}
            placeholder={t('feedback.security.detailsPlaceholder')}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !title.trim() || !whatHappened.trim()}
          className="btn-primary w-full"
        >
          {submitting ? <Spinner size="sm" /> : t('feedback.security.submit')}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Success View
// ============================================

function SuccessView({
  onSendAnother,
  onViewMyFeedback,
  forwardIcon,
}: {
  onSendAnother: () => void;
  onViewMyFeedback: () => void;
  forwardIcon: React.ReactNode;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success-50 dark:bg-success-900/20">
        <CheckCircle2 className="h-10 w-10 text-success-600 dark:text-success-400" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-2">
          {t('feedback.success.title')}
          <Heart className="h-6 w-6 fill-rose-500 text-rose-500" />
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
          {t('feedback.success.message')}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={onViewMyFeedback} className="btn-secondary">
          <ClipboardList className="h-4 w-4" />
          {t('feedback.success.viewMyFeedback')}
          {forwardIcon}
        </button>
        <button onClick={onSendAnother} className="btn-primary">
          <MessageSquare className="h-4 w-4" />
          {t('feedback.success.sendAnother')}
        </button>
      </div>
    </div>
  );
}
