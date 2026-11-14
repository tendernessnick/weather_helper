import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type {
  CalibrationInfo, Court, CourtScores, LightningInfo,
  WeatherResponse,
} from '../types';
import NowcastStrip from '../components/NowcastStrip';
import HourlyBars from '../components/HourlyBars';
import ScoreCard from '../components/ScoreCard';
import ReportSheet from '../components/ReportSheet';
import SubscribeBox from '../components/SubscribeBox';
import PersistenceCard from '../components/PersistenceCard';
import CheckInCard from '../components/CheckInCard';
import FeedbackSheet from '../components/FeedbackSheet';
import FavoriteButton from '../components/FavoriteButton';
import PlayPlanner from '../components/PlayPlanner';
import Icon from '../components/Icon';
import { comfortNote, courtName, districtName, hintLines, useLang } from '../i18n';
import type { TKey } from '../i18n';
import { detailCopy } from '../detail-copy';
import { hkFormat } from '../utils/hkTime';

/** Heat advisory when any of the next 6 hours is poor/severe comfort. */
function ComfortBanner({ weather }: { weather: WeatherResponse }) {
  const { t } = useLang();
  const hours = weather.hourly.slice(0, 6);
  const worst = hours.find((h) => h.comfort?.level === 'severe')
    ?? hours.find((h) => h.comfort?.level === 'poor');
  if (!worst?.comfort) return null;
  const hh = hkFormat(worst.hour, { hour: '2-digit', hourCycle: 'h23' });
  const severe = worst.comfort.level === 'severe';
  return (
    <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white ${severe ? 'bg-[#FF3B30]' : 'bg-[#FF6B00]'}`}>
        <Icon name="sun" className="h-5 w-5" />
      </span>
      <div>
        <p className={`text-[12px] font-bold ${severe ? 'text-[#B3261E]' : 'text-[#8A4B00]'}`}>
          {severe ? t('comfort.heatSevere') : t('comfort.heatPoor')} {t('comfort.heatPeak', { hh })}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#8A6100]/90">
          {comfortNote(t, worst.comfort.level, worst.apparent_temp, worst.wind_kmh)}。{t('comfort.heatAdvice')}
        </p>
      </div>
    </div>
  );
}

/** Lightning warning when the past hour saw cloud-to-ground flashes in the
 *  court's region. Safety-first: red, before any rain advice. */
function LightningBanner({ lightning }: { lightning: LightningInfo }) {
  const { t } = useLang();
  if (lightning.cg_count <= 0) return null;
  return (
    <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#FF3B30] text-white">
        <Icon name="bolt" className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[12px] font-bold text-[#B3261E]">{t('lightning.title')}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#B3261E]/90">
          {t('lightning.body', {
            region: t(`lightning.r.${lightning.region}` as TKey),
            n: lightning.cg_count,
          })}
        </p>
      </div>
    </div>
  );
}

export default function CourtDetail() {
  const { t, lang } = useLang();
  const { id } = useParams<{ id: string }>();
  const [court, setCourt] = useState<Court | null>(null);
  const [scores, setScores] = useState<CourtScores | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [calibration, setCalibration] = useState<CalibrationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setReload((value) => value + 1); };
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    setError(null);
    setNotFound(false);
    setRefreshing(true);
    Promise.all([
      fetch(`/api/courts/${encodeURIComponent(id)}`, { signal: controller.signal }).then((r) => {
        if (r.status === 404) throw new Error('NOT_FOUND');
        if (!r.ok) throw new Error(`request failed (${r.status})`);
        return r.json();
      }),
      api.courtWeather(id),
      api.courtCalibration(id).catch(() => null),
    ])
      .then(([courtData, weatherData, calib]) => {
        if (cancelled) return;
        setCourt(courtData);
        setScores(courtData.scores);
        setWeather(weatherData);
        setCalibration(calib);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === 'NOT_FOUND') setNotFound(true);
        else setError(String(err.message ?? err));
      })
      .finally(() => { clearTimeout(timeout); if (!cancelled) setRefreshing(false); });
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [id, reload]);

  if (notFound) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        {t('detail.notFound')}<a href="/courts" className="text-[#007AFF] underline">{t('detail.backList')}</a>
      </div>
    );
  }
  if (error && (!court || court.id !== id || !weather)) {
    return <div role="alert" className="mx-4 mt-4 rounded-2xl bg-white p-6 text-center">
      <h1 className="text-lg font-bold text-slate-900">{detailCopy(lang, 'detailFailed')}</h1>
      <p className="mt-2 break-words text-[13px] text-slate-600">{error}</p>
      <button type="button" onClick={() => setReload((value) => value + 1)} className="mt-4 min-h-11 rounded-xl bg-[#007AFF] px-5 text-sm font-semibold text-white">{detailCopy(lang, 'retry')}</button>
    </div>;
  }
  if (!court || court.id !== id || !weather) {
    return <div className="p-8 text-center text-sm text-[#8E8E93]">{t('common.loading')}</div>;
  }

  const temp = weather.current?.temperature?.data
    ?.find((tm) => tm.place === 'Hong Kong Observatory')?.value;
  const humidity = weather.current?.humidity?.data?.[0]?.value;
  const uv = weather.current?.uvindex?.data?.[0]?.value;
  const microclimate = calibration?.divergence?.microclimate;

  return (
    <div>
      <section className="ios-card mx-4 mt-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="min-w-0 text-[21px] font-bold tracking-tight">{courtName(court, lang)}</h1>
          <FavoriteButton courtId={court.id} />
        </div>
        <p className="mt-0.5 text-[12px] text-[#8E8E93]">
          {lang === 'en' ? `${court.name_tc} · ${court.name_sc}` : `${court.name_tc} · ${court.name_en}`}
        </p>
        <div className="mt-3 space-y-1.5 text-[12px] text-[#3C3C43]/90">
          <p className="flex items-start gap-1.5">
            <Icon name="pin" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
            <span>
              {districtName(court.district_tc, court.district_en, lang)} · {lang === 'en' ? (court.address_en || court.address_tc) : (court.address_tc || court.address_en)}
            </span>
          </p>
          <p className="flex items-start gap-1.5">
            <Icon name="ball" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
            <span>{court.court_no || '—'}</span>
          </p>
          <p className="flex items-start gap-1.5">
            <Icon name="clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
            <span>{court.opening_hours || '—'}</span>
          </p>
          {court.phone && (
            <p className="flex items-center gap-1.5">
              <Icon name="phone" className="h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
              <span>{court.phone}</span>
            </p>
          )}
        </div>
        {(temp !== undefined || humidity !== undefined) && (
          <p className="mt-3 border-t border-black/5 pt-2.5 text-[12px] text-[#6D6D72]">
            {t('detail.now', { t: temp ?? '—', h: humidity ?? '—' })}
            {uv != null && ` · UV ${uv}`}
          </p>
        )}
        <button
          onClick={() => setFbOpen(true)}
          className="mt-2.5 border-t border-black/5 pt-2 text-left text-[12px] font-medium text-[#007AFF] active:opacity-60"
        >
          {t('fb.entryCourt')}
        </button>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3">
          <a href="/courts" className="text-[12px] font-medium text-[#007AFF]">← {t('detail.backList')}</a>
          <button type="button" disabled={refreshing} onClick={() => setReload((value) => value + 1)} className="min-h-11 rounded-xl bg-slate-100 px-3 text-[12px] font-semibold text-slate-700 disabled:opacity-60">
            {detailCopy(lang, refreshing ? 'refreshing' : 'refresh')}
          </button>
        </div>
      </section>
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">{detailCopy(lang, 'refreshFailed')}</p>}

      {weather.warnings.length > 0 && (
        <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#FF9500] text-white">
            <Icon name="warn" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[12px] font-bold text-[#8A6100]">{t('detail.warnings')}</p>
            <ul className="mt-0.5 list-inside list-disc text-[11px] leading-relaxed text-[#8A6100]/90">
              {weather.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      {weather.lightning && <LightningBanner lightning={weather.lightning} />}

      <PlayPlanner key={court.id} weather={weather} />
      <ComfortBanner weather={weather} />

      {microclimate && (
        <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#AF52DE] text-white">
            <Icon name="people" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[12px] font-bold text-[#6929A8]">{t('detail.microTitle')}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#6929A8]/90">
              {t('detail.microBody')}
            </p>
          </div>
        </div>
      )}

      <NowcastStrip steps={weather.nowcast.steps} fetchedAt={weather.nowcast.fetched_at} freshness={weather.data_status?.nowcast} />
      {/* Reporting is the "I'm here right now" action: keep it right after the
          nowcast, before the long analytical charts, so participation is
          visible without scrolling. */}
      <ReportSheet court={court} />
      <HourlyBars hourly={weather.hourly} freshness={weather.data_status?.hourly} radarFreshness={weather.data_status?.nowcast} />
      {calibration && calibration.basis && (() => {
        const deltas = calibration.mapping
          .map((m) => (m.official_pct - m.corrected * 100) / 100)
          .filter((d) => Number.isFinite(d));
        const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
        const interpretation = Math.abs(avgDelta) < 0.05
          ? t('detail.calibOk')
          : avgDelta > 0
            ? t('detail.calibHigh', { p: Math.round(avgDelta * 100), hi: Math.round(avgDelta * 100) + 40 })
            : t('detail.calibLow', { p: Math.round(-avgDelta * 100) });
        return (
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">{t('detail.calibTitle')}</h2>
            <p className="mt-1.5 rounded-[10px] bg-[#F2F2F7] p-2.5 text-[12px] font-medium leading-relaxed text-[#3C3C43]">
              💡 {interpretation}
            </p>
            <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-slate-600">
              {hintLines(t('detail.calibBasis', {
                basis: calibration.basis === 'court' ? t('detail.basisCourt') : t('detail.basisPooled'),
                n: calibration.n,
              }))}
            </p>
            <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[12.5px] font-semibold">
              {calibration.mapping.map((m) => (
                <div key={m.official_pct} className="rounded-[8px] bg-[#161616]/[0.045] py-1.5">
                  <div className="text-slate-500">{t('detail.saidPct', { p: m.official_pct })}</div>
                  <div className="font-bold text-slate-900">
                    {t('detail.actualPct', { p: Math.round(m.corrected * 100) })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
      {weather.persistence && <PersistenceCard data={weather.persistence} />}
      {scores && <ScoreCard scores={scores} />}
      <CheckInCard court={court} />
      <SubscribeBox court={court} />
      {fbOpen && (
        <FeedbackSheet court={court} presetCategory="data" onClose={() => setFbOpen(false)} />
      )}
    </div>
  );
}
