import { useState, type FormEvent, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/useAuth';
import { useLanguage } from '@/i18n/useLanguage';
import { UserLayout } from './UserLayout';
import { Spinner, EmptyState } from '@/components/ui/States';
import { ShieldAlert, ArrowRight, Lock } from 'lucide-react';

import type { TranslationKey } from '@/i18n/translations';
import type { TripStatus, Trip } from '@/types/database';

interface FormState {
  origin: string;
  destination: string;
  departure_date: string;
  arrival_date: string;
  available_weight_kg: string;
  price_per_kg: string;
  notes: string;
}

const empty: FormState = { origin: '', destination: '', departure_date: '', arrival_date: '', available_weight_kg: '', price_per_kg: '', notes: '' };

export function TripFormPage() {
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
  const [notOwner, setNotOwner] = useState(false);
  const [notEditable, setNotEditable] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const { data, error: err } = await supabase.from('trips').select('*').eq('id', id).maybeSingle();
      if (err || !data) { navigate('/dashboard/trips'); return; }
      const trip = data as Trip;
      if (trip.traveler_id !== profile?.id) { setNotOwner(true); setLoading(false); return; }
      if (trip.status === 'completed' || trip.status === 'cancelled' || trip.status === 'in_progress') { setNotEditable(true); setLoading(false); return; }
      setForm({
        origin: trip.origin, destination: trip.destination,
        departure_date: trip.departure_date, arrival_date: trip.arrival_date,
        available_weight_kg: String(trip.available_weight_kg), price_per_kg: String(trip.price_per_kg),
        notes: trip.notes ?? '',
      });
      setLoading(false);
    })();
  }, [id, isEdit, navigate, profile?.id]);

  const isVerified = profile?.verification_status === 'approved' && profile?.identity_verified === true && profile?.account_status === 'active';
  const isTraveler = profile?.role === 'traveler';

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.origin.trim()) e.origin = 'trips.form.required';
    if (!form.destination.trim()) e.destination = 'trips.form.required';
    if (!form.departure_date) e.departure_date = 'trips.form.required';
    if (!form.arrival_date) e.arrival_date = 'trips.form.required';
    if (form.departure_date && form.arrival_date && form.departure_date > form.arrival_date) e.arrival_date = 'trips.form.departureBeforeArrival';
    const w = parseFloat(form.available_weight_kg);
    if (!form.available_weight_kg || isNaN(w) || w <= 0) e.available_weight_kg = 'trips.form.weightPositive';
    const p = parseFloat(form.price_per_kg);
    if (isNaN(p) || p < 0) e.price_per_kg = 'trips.form.priceNonNegative';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: FormEvent, publish: boolean) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    if (publish && !isVerified) {
      setError('trips.publishFailed');
      return;
    }

    setSubmitting(true);
    const payload = {
      traveler_id: profile!.id,
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      departure_date: form.departure_date,
      arrival_date: form.arrival_date,
      available_weight_kg: parseFloat(form.available_weight_kg),
      price_per_kg: parseFloat(form.price_per_kg),
      notes: form.notes.trim() || null,
      status: (publish ? 'published' : 'draft') as TripStatus,
    };

    if (isEdit) {
      const { error: err } = await supabase.from('trips').update({
        origin: payload.origin, destination: payload.destination,
        departure_date: payload.departure_date, arrival_date: payload.arrival_date,
        available_weight_kg: payload.available_weight_kg, price_per_kg: payload.price_per_kg,
        notes: payload.notes,
        ...(publish ? { status: 'published' as TripStatus } : {}),
      }).eq('id', id);
      if (err) { setError('trips.updateFailed'); setSubmitting(false); return; }
    } else {
      const { error: err } = await supabase.from('trips').insert(payload);
      if (err) { setError('trips.createFailed'); setSubmitting(false); return; }
    }

    setSubmitting(false);
    navigate('/dashboard/trips');
  };

  if (loading) return (
    <UserLayout><div className="max-w-2xl"><h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{isEdit ? t('trips.editTitle') : t('trips.newTitle')}</h1><div className="flex justify-center py-12"><Spinner size="lg" /></div></div></UserLayout>
  );

  if (!isTraveler) return (
    <UserLayout>
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('trips.newTitle')}</h1>
        <div className="alert-warning">
          <p className="font-semibold">{t('trips.gateSenderTitle')}</p>
          <p className="mt-1 text-sm">{t('trips.gateSenderDesc')}</p>
        </div>
      </div>
    </UserLayout>
  );

  if (notOwner) return (
    <UserLayout>
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('trips.editTitle')}</h1>
        <div className="card p-8">
          <EmptyState icon={<Lock className="h-8 w-8" />} title={t('trips.notOwner')} />
          <Link to="/dashboard/trips" className="btn-secondary btn-sm mt-4">{t('trips.title')}</Link>
        </div>
      </div>
    </UserLayout>
  );

  if (notEditable) return (
    <UserLayout>
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">{t('trips.editTitle')}</h1>
        <div className="card p-8">
          <EmptyState icon={<Lock className="h-8 w-8" />} title={t('trips.notEditableTitle')} description={t('trips.notEditable')} />
          <Link to="/dashboard/trips" className="btn-secondary btn-sm mt-4">{t('trips.title')}</Link>
        </div>
      </div>
    </UserLayout>
  );

  return (
    <UserLayout>
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{isEdit ? t('trips.editTitle') : t('trips.newTitle')}</h1>

        {error && <div className="alert-error">{t(error as TranslationKey)}</div>}

        {!isVerified && (
          <div className="card border-2 border-warning-200 bg-warning-50 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 shrink-0 text-warning-600" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{t('trips.verificationGateTitle')}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('trips.verificationGateDesc')}</p>
                <Link to="/dashboard/verification" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
                  {t('nav.verification')} <ArrowRight className={`h-4 w-4 ${arrow}`} />
                </Link>
              </div>
            </div>
          </div>
        )}

        <form className="card p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('trips.origin')} value={form.origin} onChange={(v) => setForm({ ...form, origin: v })} error={errors.origin} t={t} />
            <Field label={t('trips.destination')} value={form.destination} onChange={(v) => setForm({ ...form, destination: v })} error={errors.destination} t={t} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField label={t('trips.departureDate')} value={form.departure_date} onChange={(v) => setForm({ ...form, departure_date: v })} error={errors.departure_date} t={t} />
            <DateField label={t('trips.arrivalDate')} value={form.arrival_date} onChange={(v) => setForm({ ...form, arrival_date: v })} error={errors.arrival_date} t={t} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label={t('trips.availableWeight')} value={form.available_weight_kg} onChange={(v) => setForm({ ...form, available_weight_kg: v })} error={errors.available_weight_kg} t={t} step="0.1" />
            <NumberField label={t('trips.pricePerKg')} value={form.price_per_kg} onChange={(v) => setForm({ ...form, price_per_kg: v })} error={errors.price_per_kg} t={t} step="0.01" />
          </div>
          <div>
            <label className="label">{t('trips.notes')}</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input min-h-[80px] resize-y" placeholder={t('trips.notesPlaceholder')} disabled={submitting} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={(e) => submit(e, false)} className="btn-secondary" disabled={submitting}>
              {submitting ? <Spinner size="sm" /> : t('trips.saveDraft')}
            </button>
            <button type="button" onClick={(e) => submit(e, true)} className="btn-primary" disabled={submitting || !isVerified}>
              {submitting ? <Spinner size="sm" /> : t('trips.publish')}
            </button>
          </div>
        </form>
      </div>
    </UserLayout>
  );
}

function Field({ label, value, onChange, error, t }: { label: string; value: string; onChange: (v: string) => void; error?: string; t: (k: TranslationKey) => string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={`input ${error ? 'input-error' : ''}`} disabled={false} />
      {error && <p className="mt-1 text-xs text-error-600">{t(error as TranslationKey)}</p>}
    </div>
  );
}
function DateField({ label, value, onChange, error, t }: { label: string; value: string; onChange: (v: string) => void; error?: string; t: (k: TranslationKey) => string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`input ${error ? 'input-error' : ''}`} />
      {error && <p className="mt-1 text-xs text-error-600">{t(error as TranslationKey)}</p>}
    </div>
  );
}
function NumberField({ label, value, onChange, error, t, step }: { label: string; value: string; onChange: (v: string) => void; error?: string; t: (k: TranslationKey) => string; step?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" step={step ?? '1'} value={value} onChange={(e) => onChange(e.target.value)} className={`input ${error ? 'input-error' : ''}`} />
      {error && <p className="mt-1 text-xs text-error-600">{t(error as TranslationKey)}</p>}
    </div>
  );
}
