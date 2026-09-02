import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { CalibrationInfo, Court, CourtScores, WeatherResponse } from '../types';
import NowcastStrip from '../components/NowcastStrip';
import HourlyBars from '../components/HourlyBars';
import ScoreCard from '../components/ScoreCard';
import ReportSheet from '../components/ReportSheet';
import SubscribeBox from '../components/SubscribeBox';
import PersistenceCard from '../components/PersistenceCard';
import CheckInCard from '../components/CheckInCard';
import Icon from '../components/Icon';
import { comfortNote, courtName, districtName, useLang } from '../i18n';

/** Plain-language verdict for the next few hours, computed from zones. */
function VerdictBanner({ weather }: { weather: WeatherResponse }) {
  const { t } = useLang();
  const hours = weather.hourly.slice(0, 6);
  if (hours.length === 0) return null;

  const worst = hours.reduce<string>((acc, h) => {
    const z = h.zone ?? 'go';
    if (z === 'no' || acc === 'no') return 'no';
    if (z === 'edge' || acc === 'edge') return 'edge';
    return 'go';
  }, 'go');
  const worstHour = hours.find((h) => (h.zone ?? 'go') === worst);
  const hhmm = worstHour ? new Date(worstHour.hour).getHours().toString().padStart(2, '0') + ':00' : '';
  const pop = worstHour ? (worstHour.corrected_pop ?? worstHour.pop) : 0;

  const look = {
    go: { tile: 'bg-[#34C759]', icon: 'ball' as const, text: 'text-[#1B7A3D]' },
    edge: { tile: 'bg-[#FF9500]', icon: 'drizzle' as const, text: 'text-[#8A6100]' },
    no: { tile: 'bg-[#FF3B30]', icon: 'storm' as const, text: 'text-[#B3261E]' },
  }[worst] ?? {
    tile: 'bg-[#34C759]', icon: 'ball' as const, text: 'text-[#1B7A3D]',
  };

  const sentence = worst === 'go'
    ? t('verdict.go', { n: hours.length })
    : worst === 'edge'
      ? t('verdict.edge', { hhmm, pop })
      : t('verdict.no', { hhmm, pop });

  return (
    <div className="mx-4 mt-4 flex items-center gap-3 rounded-[16px] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white ${look.tile}`}>
        <Icon name={look.icon} className="h-5 w-5" />
      </span>
      <p className={`text-[13px] font-semibold leading-relaxed ${look.text}`}>
        {sentence}
      </p>
    </div>
  );
}

/** Heat advisory when any of the next 6 hours is poor/severe comfort. */
function ComfortBanner({ weather }: { weather: WeatherResponse }) {
  const { t } = useLang();
  const hours = weather.hourly.slice(0, 6);
  const worst = hours.find((h) => h.comfort?.level === 'severe')
    ?? hours.find((h) => h.comfort?.level === 'poor');
  if (!worst?.comfort) return null;
  const hh = new Date(worst.hour).getHours().toString().padStart(2, '0');
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

export default function CourtDetail() {
  const { t, lang } = useLang();
  const { id } = useParams<{ id: string }>();
  const [court, setCourt] = useState<Court | null>(null);
  const [scores, setScores] = useState<CourtScores | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [calibration, setCalibration] = useState<CalibrationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError(null);
    setNotFound(false);
    Promise.all([
      fetch(`/api/courts/${id}`).then((r) => {
        if (r.status === 404) throw new Error('NOT_FOUND');
        if (!r.ok) throw new Error(`request failed (${r.status})`);
        return r.json();
      }),
      api.courtWeather(id),
      api.courtCalibration(id).catch(() => null),
    ])
      .then(([courtData, weatherData, calib]) => {
        setCourt(courtData);
        setScores(courtData.scores);
        setWeather(weatherData);
        setCalibration(calib);
      })
      .catch((err) => {
        if (err instanceof Error && err.message === 'NOT_FOUND') setNotFound(true);
        else setError(String(err.message ?? err));
      });
  }, [id]);

  if (notFound) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        {t('detail.notFound')}<a href="/" className="text-[#007AFF] underline">{t('detail.backList')}</a>
      </div>
    );
  }
  if (error) {
    return <div className="p-8 text-center text-sm text-[#FF3B30]">{error}</div>;
  }
  if (!court || !weather) {
    return <div className="p-8 text-center text-sm text-[#8E8E93]">{t('common.loading')}</div>;
  }

  const temp = weather.current?.temperature?.data
    ?.find((tm) => tm.place === 'Hong Kong Observatory')?.value;
  const humidity = weather.current?.humidity?.data?.[0]?.value;
  const microclimate = calibration?.divergence?.microclimate;

  return (
    <div>
      <section className="ios-card mx-4 mt-4 p-4">
        <h1 className="text-[21px] font-bold tracking-tight">{courtName(court, lang)}</h1>
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
          </p>
        )}
      </section>

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

      <VerdictBanner weather={weather} />
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

      <NowcastStrip steps={weather.nowcast.steps} fetchedAt={weather.nowcast.fetched_at} />
      <HourlyBars hourly={weather.hourly} />
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
            <p className="mt-1.5 text-[10px] leading-relaxed text-[#8E8E93]">
              {t('detail.calibBasis', {
                basis: calibration.basis === 'court' ? t('detail.basisCourt') : t('detail.basisPooled'),
                n: calibration.n,
              })}
            </p>
            <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px]">
              {calibration.mapping.map((m) => (
                <div key={m.official_pct} className="rounded-[8px] bg-[#F2F2F7] py-1.5">
                  <div className="text-[#8E8E93]">{t('detail.saidPct', { p: m.official_pct })}</div>
                  <div className="text-sm font-bold text-slate-800">
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
      <ReportSheet court={court} />
      <SubscribeBox court={court} />
    </div>
  );
}
