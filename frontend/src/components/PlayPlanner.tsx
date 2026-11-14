import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { WeatherResponse } from '../types';
import { useLang } from '../i18n';
import { detailCopy } from '../detail-copy';
import { HOUR_MS, hkDateKey, hkFormat, hkTimestamp } from '../utils/hkTime';
import { evaluatePlayWindow, resolvePlayStart, sourceIsFresh } from '../utils/playWindow';
import type { FreshnessInfo } from '../utils/playWindow';
import Icon from './Icon';

type WeatherWithStatus = WeatherResponse & {
  data_status?: {
    generated_at: string;
    hourly: FreshnessInfo;
    nowcast: FreshnessInfo;
  };
};

const STYLES = {
  go: { panel: 'bg-emerald-50 text-emerald-950', tile: 'bg-emerald-700', icon: 'ball', key: 'low' },
  edge: { panel: 'bg-amber-50 text-amber-950', tile: 'bg-amber-700', icon: 'drizzle', key: 'edge' },
  no: { panel: 'bg-rose-50 text-rose-950', tile: 'bg-rose-700', icon: 'rain', key: 'high' },
  unknown: { panel: 'bg-slate-100 text-slate-800', tile: 'bg-slate-600', icon: 'clock', key: 'unknown' },
  warning: { panel: 'bg-amber-50 text-amber-950', tile: 'bg-amber-700', icon: 'warn', key: 'warning' },
} as const;

export default function PlayPlanner({ weather }: { weather: WeatherWithStatus }) {
  const { lang } = useLang();
  const c = (key: Parameters<typeof detailCopy>[1], values?: Record<string, string | number>) => detailCopy(lang, key, values);
  const [params, setParams] = useSearchParams();
  const [duration, setDuration] = useState(2);
  const [now, setNow] = useState(Date.now);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const updateConnection = () => { setOnline(navigator.onLine); tick(); };
    const timer = window.setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  const starts = useMemo(() => [...new Set(weather.hourly
    .map((item) => hkTimestamp(item.hour))
    .filter((time) => Number.isFinite(time) && time >= now && time < now + 48 * HOUR_MS))]
    .sort((a, b) => a - b), [weather.hourly, now]);
  const start = resolvePlayStart(starts, params.get('start'));
  const options = start !== undefined && !starts.includes(start) ? [...starts, start].sort((a, b) => a - b) : starts;
  const result = evaluatePlayWindow(weather.hourly, start ?? Number.NaN, duration, now, weather.data_status?.hourly, weather.data_status?.nowcast, online);
  const warningPresent = weather.warnings.length > 0 || (weather.lightning?.cg_count ?? 0) > 0;
  const state = result.reason ? 'unknown' : warningPresent ? 'warning' : result.zone ?? 'unknown';
  const style = STYLES[state];
  const body = result.reason ? c(result.reason) : c(state === 'warning' ? 'warningBody' : state === 'go' ? 'lowBody' : state === 'no' ? 'highBody' : 'edgeBody');
  const dateLabel = (time: number) => {
    const day = hkDateKey(time);
    const prefix = day === hkDateKey(now) ? c('today') : day === hkDateKey(now + 24 * HOUR_MS) ? c('tomorrow')
      : hkFormat(time, { month: '2-digit', day: '2-digit' });
    return `${prefix} ${hkFormat(time)}`;
  };
  const issued = result.slots.filter((slot) => slot.item?.fetched_at)
    .map((slot) => hkTimestamp(slot.item!.fetched_at!)).filter(Number.isFinite);
  const oldestIssue = issued.length ? Math.min(...issued) : weather.data_status?.hourly.fetched_at;
  const radarState = sourceIsFresh(weather.data_status?.nowcast, now) ? 'fresh' : weather.data_status?.nowcast.fetched_at ? 'stale' : 'missing';

  return (
    <section aria-labelledby="play-plan-title" className="ios-card mx-4 mt-4 overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#173B2B] text-white"><Icon name="ball" className="h-5 w-5" /></span>
        <div>
          <h2 id="play-plan-title" className="text-[17px] font-bold tracking-tight">{c('planTitle')}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{c('planHint')}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0 text-[12px] font-semibold text-slate-600">
          {c('start')}
          <select
            aria-label={c('start')}
            value={start ?? ''}
            disabled={options.length === 0}
            onChange={(event) => { const next = new URLSearchParams(params); next.set('start', new Date(Number(event.target.value)).toISOString()); setParams(next, { replace: true, preventScrollReset: true }); }}
            className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-semibold text-slate-900 disabled:text-slate-500"
          >
            {options.length === 0 && <option value="">{c('noSlots')}</option>}
            {options.map((time) => <option key={time} value={time}>{dateLabel(time)}{!starts.includes(time) ? ` · ${time < now ? c('pastLabel') : c('missingLabel')}` : ''}</option>)}
          </select>
        </label>
        <fieldset className="min-w-0">
          <legend className="text-[12px] font-semibold text-slate-600">{c('duration')}</legend>
          <div className="mt-1 flex gap-1 rounded-xl bg-slate-100 p-1">
            {[1, 2, 3].map((hours) => <button key={hours} type="button" aria-pressed={duration === hours} onClick={() => setDuration(hours)}
              className={`min-h-9 min-w-0 flex-1 rounded-lg px-1 text-[12px] font-semibold transition-colors ${duration === hours ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{c('hours', { n: hours })}</button>)}
          </div>
        </fieldset>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className={`mt-3 rounded-2xl p-3.5 ${style.panel}`}>
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${style.tile}`}><Icon name={style.icon} className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-[15px] font-bold">{c(style.key)}</p>
            {start !== undefined && <p className="mt-0.5 text-[12px]">{dateLabel(start)}–{hkDateKey(start) === hkDateKey(result.end) ? hkFormat(result.end) : dateLabel(result.end)}</p>}
          </div>
          {result.peak !== null && !result.reason && <span className="shrink-0 text-[12px] font-bold">{c('peak', { n: result.peak })}</span>}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed">{body}</p>
        <p className="mt-2 text-[11px] leading-relaxed opacity-85">{c('coverage', { n: result.covered, total: result.slots.length || duration })} · {c('peakHint')}</p>
      </div>

      {result.slots.length > 0 && <ol aria-label={c('duration')} className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${result.slots.length}, minmax(0, 1fr))` }}>
        {result.slots.map((slot) => <li key={slot.hour} className="rounded-xl border border-black/5 bg-white/75 px-2 py-2.5 text-center">
          <div className="text-[12px] font-semibold text-slate-700">{hkFormat(slot.hour)}</div>
          <div className={`mt-1 text-[16px] font-bold ${!online || slot.stale || slot.risk === null ? 'text-slate-500' : slot.risk > 60 ? 'text-rose-700' : slot.risk > 30 ? 'text-amber-800' : 'text-emerald-800'}`}>{slot.risk === null ? '—' : `${slot.risk}/100`}</div>
          <div className="mt-0.5 text-[11px] text-slate-600">{!slot.item || slot.risk === null ? c('missingLabel') : slot.stale ? c('staleLabel') : slot.item.fused_pop !== undefined ? c('fusedLabel') : lang === 'en' ? 'Calibrated' : lang === 'hant' ? '校正預報' : '校正预报'}</div>
        </li>)}
      </ol>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span>{oldestIssue ? c('sourceTime', { time: hkFormat(oldestIssue, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }) : c('timeUnknown')}</span>
        <span className={radarState === 'fresh' ? 'text-slate-600' : 'font-semibold text-amber-800'}>{c(radarState === 'fresh' ? 'radarFresh' : radarState === 'stale' ? 'radarStale' : 'radarMissing')}</span>
      </div>
      <details className="mt-3 border-t border-slate-200/70 pt-3 text-[12px] text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">{c('methodTitle')}</summary>
        <p className="mt-2 leading-relaxed">{c('method')}</p>
      </details>
    </section>
  );
}
