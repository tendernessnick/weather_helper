import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import Icon from '../components/Icon';
import { courtName, useLang } from '../i18n';
import type { TKey } from '../i18n';
import type { CourtListItem, LatestReport } from '../types';

const INTENSITY_ICON: Record<string, string> = {
  none: 'sun', light: 'drizzle', moderate: 'rain', heavy: 'storm',
};
const INTENSITY_KEY: Record<string, TKey> = {
  none: 'intensity.none', light: 'intensity.light',
  moderate: 'intensity.moderate', heavy: 'intensity.heavy',
};

const STEPS: { icon: string; tile: string; title: TKey; body: TKey }[] = [
  { icon: 'chart', tile: 'bg-[#007AFF]', title: 'home.step1Title', body: 'home.step1Body' },
  { icon: 'people', tile: 'bg-[#34C759]', title: 'home.step2Title', body: 'home.step2Body' },
  { icon: 'gauge', tile: 'bg-[#FF9500]', title: 'home.step3Title', body: 'home.step3Body' },
];

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[14px] bg-[#161616]/[0.045] p-3 ring-1 ring-white/40">
      <div className="text-[22px] font-bold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 text-[10px] leading-snug text-slate-500">{label}</div>
    </div>
  );
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

export default function Home() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [stats, setStats] = useState<{
    courts: string; reports: string; checkins: string; median: string;
  } | null>(null);
  const [pulse, setPulse] = useState<LatestReport[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateHint, setLocateHint] = useState<string | null>(null);

  useEffect(() => {
    api.health()
      .then((h) => {
        const db = h.db ?? {};
        setStats((s) => ({
          ...(s ?? { median: '—' }),
          courts: String(db.courts ?? '—'),
          reports: String(db.user_reports_total ?? '—'),
          checkins: String(db.checkins ?? '—'),
        }));
      })
      .catch(() => setStats((s) => s ?? { courts: '—', reports: '—', checkins: '—', median: '—' }));
    api.best()
      .then((b) => setStats((s) => ({
        ...(s ?? { courts: '—', reports: '—', checkins: '—' }),
        median: b.city_median_pop != null ? `${b.city_median_pop}%` : '—',
      })))
      .catch(() => { /* keep placeholder */ });
    api.latestReports(5)
      .then((r) => setPulse(r.reports))
      .catch(() => setPulse([]));
  }, []);

  /** "I'm at a court now": locate → nearest court → its detail page, where the
   *  report card sits right under the nowcast. Falls back to the list. */
  const goToNearest = () => {
    if (locating) return;
    if (!navigator.geolocation) {
      navigate('/courts');
      return;
    }
    setLocating(true);
    setLocateHint(null);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const { courts } = await api.courts('', '');
        const nearest = (courts as CourtListItem[]).reduce((best, c) =>
          haversineMeters(lat, lon, c.lat, c.lon)
          < haversineMeters(lat, lon, best.lat, best.lon) ? c : best);
        navigate(`/courts/${nearest.id}`);
      } catch {
        setLocating(false);
        setLocateHint(t('home.geoFail'));
      }
    }, () => {
      setLocating(false);
      setLocateHint(t('home.geoFail'));
      setTimeout(() => setLocateHint(null), 4000);
      navigate('/courts');
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  };

  const timeAgo = (iso: string): string => {
    const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return min < 60
      ? t('recent.ago', { m: min })
      : t('recent.agoH', { h: Math.floor(min / 60) });
  };

  return (
    <div className="pb-4">
      {/* hero */}
      <div className="px-6 pb-2 pt-12 text-center">
        <span className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <span aria-hidden className="absolute -inset-7 rounded-full bg-[#34C759]/30 blur-2xl" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-[24px] bg-gradient-to-b from-[#3DD968] to-[#1FA84C] text-white shadow-[0_14px_30px_-8px_rgba(52,199,89,0.6)] ring-1 ring-white/40">
            <Icon name="ball" className="h-12 w-12" strokeWidth={1.6} />
          </span>
        </span>
        <h1 className="mt-5 text-[28px] font-bold leading-tight tracking-tight">
          {t('home.heroTitle')}
        </h1>
        <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-[#5B5B60]">
          {t('home.heroSub')}
        </p>
        <div className="mx-auto mt-6 max-w-[340px] space-y-3">
          <a
            href="/courts"
            className="block rounded-full bg-gradient-to-b from-[#3DD968] to-[#26B455] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(52,199,89,0.65)] ring-1 ring-white/30 transition active:from-[#1FA84C] active:to-[#178F41]"
          >
            {t('home.ctaCourts')} →
          </a>
          <button
            onClick={goToNearest}
            disabled={locating}
            className="block w-full rounded-full border border-white/80 bg-white/50 px-5 py-3.5 text-[15px] font-semibold text-[#177A3E] shadow-[0_6px_18px_-8px_rgba(17,17,20,0.18)] backdrop-blur-xl transition active:bg-white/75 disabled:opacity-60"
          >
            {locating ? t('home.locating') : t('home.ctaReport')}
          </button>
        </div>
        {locateHint && (
          <p className="mt-2 text-center text-[11px] text-[#8A6100]">{locateHint}</p>
        )}
      </div>

      {/* live stats */}
      {stats && (
        <section className="ios-card mx-4 mt-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat value={stats.courts} label={t('home.statCourts')} />
            <Stat value={stats.median} label={t('home.statMedian')} />
            <Stat value={stats.reports} label={t('home.statReports')} />
            <Stat value={stats.checkins} label={t('home.statCheckins')} />
          </div>
        </section>
      )}

      {/* what is this */}
      <section className="ios-card mx-4 mt-4 p-4">
        <h2 className="text-[15px] font-bold tracking-tight">{t('home.whatTitle')}</h2>
        <div className="mt-3 space-y-3.5">
          {STEPS.map((s) => (
            <div key={s.title} className="flex gap-3">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white ${s.tile}`}>
                <Icon name={s.icon} className="h-5 w-5" strokeWidth={1.6} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold">{t(s.title)}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[#6D6D72]">{t(s.body)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* community pulse */}
      <section className="ios-card mx-4 mt-4 p-4">
        <h2 className="text-[15px] font-bold tracking-tight">{t('home.pulseTitle')}</h2>
        {pulse === null ? (
          <p className="mt-3 text-center text-[11px] text-slate-400">{t('common.loading')}</p>
        ) : pulse.length === 0 ? (
          <p className="mt-2 text-[11px] leading-relaxed text-[#8E8E93]">
            <Icon name="people" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            {t('home.pulseEmpty')}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-black/5">
            {pulse.map((r) => (
              <li key={`${r.court_id}-${r.created_at}`}>
                <a href={`/courts/${r.court_id}`} className="flex items-center gap-2 py-2.5">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    r.was_raining ? 'bg-[#E5F1FB] text-[#0071E3]' : 'bg-[#E8F8ED] text-[#1B7A3D]'
                  }`}>
                    <Icon name={INTENSITY_ICON[r.intensity] ?? 'sun'} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {courtName(
                        { name_sc: r.court_name_sc, name_tc: r.court_name_tc, name_en: r.court_name_en },
                        lang,
                      )}
                    </div>
                    <div className="text-[11px] tabular-nums text-slate-500">{timeAgo(r.created_at)}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    r.was_raining ? 'bg-[#E5F1FB] text-[#0071E3]' : 'bg-[#E8F8ED] text-[#1B7A3D]'
                  }`}>
                    {t(INTENSITY_KEY[r.intensity] ?? 'intensity.none')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* call to participate */}
      <section className="mx-4 mt-4 overflow-hidden rounded-[20px] border border-[#34C759]/25 bg-gradient-to-br from-[#34C759]/15 to-[#8EC5FF]/15 p-4 shadow-[0_12px_32px_-14px_rgba(52,199,89,0.35)] backdrop-blur-xl">
        <h2 className="text-[15px] font-bold tracking-tight text-[#14602F]">{t('home.callTitle')}</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-[#14602F]/85">{t('home.callBody')}</p>
        <a
          href="/courts"
          className="mt-3 block rounded-full bg-gradient-to-b from-[#3DD968] to-[#26B455] px-5 py-2.5 text-center text-[14px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(52,199,89,0.65)] ring-1 ring-white/30 active:from-[#1FA84C] active:to-[#178F41]"
        >
          {t('home.callCta')} →
        </a>
      </section>
    </div>
  );
}
