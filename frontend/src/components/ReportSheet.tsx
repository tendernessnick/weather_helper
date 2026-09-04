import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import Icon from './Icon';
import RecentReports from './RecentReports';
import { serverMsg, useLang } from '../i18n';
import type { TKey } from '../i18n';
import type { Court } from '../types';

const INTENSITIES = [
  { key: 'none', labelKey: 'intensity.none', icon: 'sun' },
  { key: 'light', labelKey: 'intensity.light', icon: 'drizzle' },
  { key: 'moderate', labelKey: 'intensity.moderate', icon: 'rain' },
  { key: 'heavy', labelKey: 'intensity.heavy', icon: 'storm' },
] as const;

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('NO_GEO'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    });
  });
}

export default function ReportSheet({ court }: { court: Court }) {
  const { t } = useLang();
  const [status, setStatus] = useState<{ cooldown_remaining_sec: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'err'>('ok');

  const countdown = (sec: number): string => {
    if (sec <= 0) return '';
    const m = Math.ceil(sec / 60);
    return m >= 60
      ? t('report.hours', { h: Math.floor(m / 60), m: m % 60 })
      : t('report.minutes', { m });
  };

  const refreshStatus = () => {
    api.reportStatus(court.id)
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [court.id]);

  const cooldown = status?.cooldown_remaining_sec ?? 0;

  const submit = async (intensity: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const pos = await getPosition();
      const result = await api.submitReport({
        court_id: court.id,
        intensity,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
      });
      setMessage(t('report.ok', { t: countdown(result.cooldown_remaining_sec) }));
      setMessageTone('ok');
      setOpen(false);
      refreshStatus();
    } catch (err) {
      if (err instanceof ApiError) {
        setMessage(serverMsg(err.message, t));
      } else if (err instanceof GeolocationPositionError) {
        // Denied (code 1) or a missing API is typical of in-app webviews; a
        // plain timeout/GPS miss is not — keep the softer hint for that.
        setMessage(err.code === 1 ? t('report.geoDenied') : t('report.geoFail'));
      } else if (err instanceof Error && err.message === 'NO_GEO') {
        setMessage(t('report.geoDenied'));
      } else {
        setMessage(String((err as Error).message ?? err));
      }
      setMessageTone('err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('report.title')}</h2>
      <p className="mt-0.5 text-[12px] leading-relaxed text-emerald-700">
        {t('report.note')}
        {cooldown > 0 && (
          <span className="ml-1 font-medium">
            {t('report.cooldownLeft', { t: countdown(cooldown) })}
          </span>
        )}
      </p>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={cooldown > 0}
        className="mt-3 w-full rounded-full bg-[#34C759] px-4 py-3 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(52,199,89,0.35)] active:bg-[#1B7A3D] disabled:bg-black/20 disabled:shadow-none"
      >
        {cooldown > 0 ? t('report.cooling') : t('report.cta')}
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {INTENSITIES.map((item) => (
            <button
              key={item.key}
              onClick={() => submit(item.key)}
              disabled={busy}
              className="flex flex-col items-center rounded-[12px] bg-[#F2F2F7] px-1 py-2.5 text-[11px] active:bg-[#E5F1FB] disabled:opacity-50"
            >
              <Icon name={item.icon} className="h-5 w-5" strokeWidth={1.6} />
              {t(item.labelKey as TKey)}
            </button>
          ))}
        </div>
      )}

      <RecentReports courtId={court.id} />

      {message && (
        <p className={`mt-2 text-xs ${messageTone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
          {message}
        </p>
      )}
    </section>
  );
}
