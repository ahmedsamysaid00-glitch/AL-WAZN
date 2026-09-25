import { useState, type FormEvent, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from './UserLayout';
import { Spinner } from '@/components/ui/States';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import type { TranslationKey } from '@/i18n/translations';
import type { ListingStatus, SenderListing } from '@/types/database';

interface FormState {
  product_name: string;
  description: string;
  quantity: string;
  weight_kg: string;
  origin: string;
  destination: string;
  preferred_date: string;
  budget: string;
  notes: string;
}

const empty: FormState = { product_name: '', description: '', quantity: '', weight_kg: '', origin: '', destination: '', preferred_date: '', budget: '', notes: '' };

export function ListingFormPage() {
  const { t, dir } = useLanguage();
  const arrow = dir === 'rtl' ? 'rotate-180' : '';
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [form, setForm] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data, error: err } = await supabase.from('sender_listings').select('*').eq('id', id).maybeSingle();
      if (err || !data) { navigate('/dashboard/shipments'); return; }
      const l = data as SenderListing;
      setForm({
        product_name: l.product_name, description: l.description, quantity: String(l.quantity),
        weight_kg: String(l.weight_kg), origin: l.origin, destination: l.destination,
        preferred_date: l.preferred_date ?? '', budget: l.budget != null ? String(l.budget) : '', notes: l.notes ?? '',
      });
      setLoading(false);
    })();
  }, [id, isEdit, navigate]);

  const isVerified = profile?.verification_status === 'approved' && profile?.identity_verified === true && profile?.account_status === 'active';
  const isSender = profile?.role === 'sender';

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.product_name.trim()) e.product_name = 'shipments.form.required';
    if (!form.description.trim()) e.description = 'shipments.form.required';
    const q = parseInt(form.quantity);
    if (!form.quantity || isNaN(q) || q <= 0) e.quantity = 'shipments.form.quantityPositive';
    const w = parseFloat(form.weight_kg);
    if (!form.weight_kg || isNaN(w) || w <= 0) e.weight_kg = 'shipments.form.weightPositive';
    if (!form.origin.trim()) e.origin = 'shipments.form.required';
    if (!form.destination.trim()) e.destination = 'shipments.form.required';
    if (form.budget) { const b = parseFloat(form.budget); if (isNaN(b) || b < 0) e.budget = 'shipments.form.budgetNonNegative'; }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: FormEvent, publish: boolean) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    if (publish && !isVerified) { setError('shipments.publishFailed'); return; }

    setSubmitting(true);
    const payload = {
      sender_id: profile!.id,
      product_name: form.product_name.trim(),
      description: form.description.trim(),
      quantity: parseInt(form.quantity),
      weight_kg: parseFloat(form.weight_kg),
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      preferred_date: form.preferred_date || null,
      budget: form.budget ? parseFloat(form.budget) : null,
      notes: form.notes.trim() || null,
      status: (publish ? 'published' : 'draft') as ListingStatus,
    };

    if (isEdit) {
      const { error: err } = await supabase.from('sender_listings').update({
        product_name: payload.product_name, description: payload.description, quantity: payload.quantity,
        weight_kg: payload.weight_kg, origin: payload.origin, destination: payload.destination,
        preferred_date: payload.preferred_date, budget: payload.budget, notes: payload.notes,
        ...(publish ? { status: 'published' as ListingStatus } : {}),
      }).eq('id', id);
      if (err) { setError(err.message.includes('Verification') ? 'shipments.publishFailed' : 'shipments.updateFailed'); setSubmitting(false); return; }
    } else {
      const { error: err } = await supabase.from('sender_listings').insert(payload);
      if (err) { setError(err.message.includes('Verification') ? 'shipments.publishFailed' : 'shipments.createFailed'); setSubmitting(false); return; }
    }

    setSubmitting(false);
    navigate('/dashboard/shipments');
  };

  if (loading) return (
    <UserLayout><div className="max-w-2xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{isEdit ? t('shipments.editTitle') : t('shipments.newTitle')}</h1><div className="flex justify-center py-12"><Spinner size="lg" /></div></div></UserLayout>
  );

  if (!isSender) return (
    <UserLayout>
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('shipments.newTitle')}</h1>
        <div className="alert-warning">
          <p className="font-semibold">{t('shipments.gateTravelerTitle')}</p>
          <p className="mt-1 text-sm">{t('shipments.gateTravelerDesc')}</p>
        </div>
      </div>
    </UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{isEdit ? t('shipments.editTitle') : t('shipments.newTitle')}</h1>

        {error && <div className="alert-error">{t(error as TranslationKey)}</div>}

        {!isVerified && (
          <div className="card border-2 border-warning-200 bg-warning-50 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 shrink-0 text-warning-600" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{t('shipments.verificationGateTitle')}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('shipments.verificationGateDesc')}</p>
                <Link to="/dashboard/verification" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                  {t('nav.verification')} <ArrowRight className={`h-4 w-4 ${arrow}`} />
                </Link>
              </div>
            </div>
          </div>
        )}

        <form className="card p-6 space-y-4">
          <Field label={t('shipments.productName')} value={form.product_name} onChange={(v) => setForm({ ...form, product_name: v })} error={errors.product_name} t={t} />
          <div>
            <label className="label">{t('shipments.description')}</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`input min-h-[80px] resize-y ${errors.description ? 'input-error' : ''}`} placeholder={t('shipments.descriptionPlaceholder')} />
            {errors.description && <p className="mt-1 text-xs text-error-600">{t(errors.description as TranslationKey)}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label={t('shipments.quantity')} value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} error={errors.quantity} t={t} />
            <NumberField label={t('shipments.weight')} value={form.weight_kg} onChange={(v) => setForm({ ...form, weight_kg: v })} error={errors.weight_kg} t={t} step="0.1" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('shipments.origin')} value={form.origin} onChange={(v) => setForm({ ...form, origin: v })} error={errors.origin} t={t} />
            <Field label={t('shipments.destination')} value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} error={errors.destination} t={t} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField label={t('shipments.preferredDate')} value={form.preferred_date} onChange={(v) => setForm({ ...form, preferred_date: v })} t={t} />
            <NumberField label={t('shipments.budget')} value={form.budget} onChange={(v) => setForm({ ...form, budget: v })} error={errors.budget} t={t} step="0.01" placeholder={t('shipments.budgetPlaceholder')} />
          </div>
          <div>
            <label className="label">{t('shipments.notes')}</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input min-h-[60px] resize-y" placeholder={t('shipments.notesPlaceholder')} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={(e) => submit(e, false)} className="btn-secondary" disabled={submitting}>
              {submitting ? <Spinner size="sm" /> : t('shipments.saveDraft')}
            </button>
            <button type="button" onClick={(e) => submit(e, true)} className="btn-primary" disabled={submitting || !isVerified}>
              {submitting ? <Spinner size="sm" /> : t('shipments.publish')}
            </button>
          </div>
        </form>
      </div>
    </UserLayout>
  );
}

function Field({ label, value, onChange, error, t, placeholder }: { label: string; value: string; onChange: (v: string) => void; error?: string; t: (k: TranslationKey) => string; placeholder?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={`input ${error ? 'input-error' : ''}`} placeholder={placeholder} />
      {error && <p className="mt-1 text-xs text-error-600">{t(error as TranslationKey)}</p>}
    </div>
  );
}
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; t: (k: TranslationKey) => string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="input" />
    </div>
  );
}
function NumberField({ label, value, onChange, error, t, step, placeholder }: { label: string; value: string; onChange: (v: string) => void; error?: string; t: (k: TranslationKey) => string; step?: string; placeholder?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" step={step ?? '1'} value={value} onChange={(e) => onChange(e.target.value)} className={`input ${error ? 'input-error' : ''}`} placeholder={placeholder} />
      {error && <p className="mt-1 text-xs text-error-600">{t(error as TranslationKey)}</p>}
    </div>
  );
}
