import { useEffect, useMemo, useState } from 'react';
import type { HourlyItem } from '../types';
import Icon from './Icon';
import { comfortNote, useLang } from '../i18n';
import type { TKey } from '../i18n';
import { hkDateKey, hkFloorHour, hkFormat, hkTimestamp, HOUR_MS } from '../utils/hkTime';
import { hourIsStale, hourRisk, riskZone } from '../utils/playWindow';
import type { FreshnessInfo } from '../utils/playWindow';
import { useWeatherClock } from '../hooks/useWeatherClock';
import { detailCopy } from '../detail-copy';

type Metric = 'pop' | 'temp' | 'wind';

function popColor(pop: number): string {
  if (pop >= 70) return 'bg-sky-600';
  if (pop >= 50) return 'bg-sky-500';
  if (pop >= 30) return 'bg-sky-400';
  if (pop >= 15) return 'bg-sky-300';
  return 'bg-sky-200';
}

/** Heat colouring matches the comfort thresholds (28/32/35°C). */
function tempColor(temp: number): string {
  if (temp >= 35) return 'bg-[#FF3B30]/80';
  if (temp >= 32) return 'bg-[#FF9500]/80';
  if (temp >= 28) return 'bg-[#FFC53D]/80';
  return 'bg-[#34C759]/70';
}

/** Wind bands: ≥25 km/h disturbs the serve (same rule as the comfort note). */
function windColor(wind: number): string {
  if (wind >= 25) return 'bg-slate-600';
  if (wind >= 15) return 'bg-slate-400';
  return 'bg-slate-300';
}

const THUNDER_CODES = [95, 96, 99];

const ZONE_BG: Record<string, string> = {
  go: 'bg-emerald-50',
  edge: 'bg-amber-50',
  no: 'bg-rose-50',
};
const ZONE_KEY: Record<string, TKey> = { go: 'hourly.legendGo', edge: 'hourly.legendEdge', no: 'hourly.legendNo' };
const ZONE_CHIP: Record<string, string> = {
  go: 'bg-emerald-100 text-emerald-800',
  edge: 'bg-amber-100 text-amber-800',
  no: 'bg-rose-100 text-rose-800',
};

function hourLabel(iso: string): string {
  return hkFormat(iso, { hour: '2-digit', hourCycle: 'h23' });
}

const COMFORT_CHIP: Record<string, string> = {
  good: 'bg-[#E8F8ED] text-[#1B7A3D]',
  fair: 'bg-[#FFF4E5] text-[#8A6100]',
  poor: 'bg-[#FFE9DC] text-[#B3541E]',
  severe: 'bg-[#FFE5E5] text-[#C0392B]',
};

/** Plain-language conclusion from the three numbers of one hour. */
function verdictFor(t: ReturnType<typeof useLang>['t'], item: HourlyItem): string {
  // When a fused 0-6h value exists it is our best single number, so the
  // verdict leans on it instead of the corrected probability.
  const fused = item.fused_pop;
  if (fused !== undefined) return '';

  const official = item.pop;
  const corrected = item.corrected_pop ?? item.pop;
  const clim = item.climatology_pop;

  if ((item.zone ?? 'go') === 'go' && corrected < 30) {
    const tail = clim !== null && clim !== undefined && clim > corrected + 15
      ? t('hourly.vGoTail', { c: clim })
      : '';
    return t('hourly.vGo') + tail;
  }
  if (clim !== null && clim !== undefined && clim > corrected + 20
      && official >= 50 && corrected >= 50) {
    return t('hourly.vClimWin', { o: official, c: corrected, cl: clim });
  }
  if (corrected > 60) {
    return t('hourly.vWet', { c: corrected });
  }
  if (corrected > 30) {
    return t('hourly.vEdge', { c: corrected });
  }
  return t('hourly.vLow', { o: official, c: corrected });
}

export default function HourlyBars({ hourly, freshness, radarFreshness }: { hourly: HourlyItem[]; freshness?: FreshnessInfo; radarFreshness?: FreshnessInfo }) {
  const { t, lang } = useLang();
  const now = useWeatherClock();
  const [metric, setMetric] = useState<Metric>('pop');
  const items = useMemo(() => hourly.slice(0, 48), [hourly]);
  const hasStats = items.some((i) => i.corrected_pop !== undefined);

  // default selection: current hour, unless a worse zone shows up within 6h -
  // steer attention to the risk point.
  const defaultKey = useMemo(() => {
    const pick = items.find((it) => {
      const difference = hkTimestamp(it.hour) - now;
      const risk = hourRisk(it);
      const within6 = difference >= -HOUR_MS && difference <= 6 * HOUR_MS;
      return within6 && !hourIsStale(it, now, freshness, radarFreshness) && risk !== null && risk > 30;
    });
    // hour-of-day match must be same-day: once today's slot is no longer
    // served (fresh hour, next OM ingest), tomorrow's would grab the default.
    const fallback = items.find((it) => {
      return hkTimestamp(it.hour) === hkFloorHour(now);
    });
    return (pick ?? fallback ?? items[0])?.hour ?? null;
  }, [items, now, freshness, radarFreshness]);

  const [selected, setSelected] = useState<string | null>(defaultKey);
  useEffect(() => {
    // keep selection valid when the hourly data refreshes
    if (!selected || !items.some((it) => it.hour === selected)) {
      setSelected(defaultKey);
    }
  }, [items, selected, defaultKey]);

  const sel = items.find((it) => it.hour === selected) ?? null;
  const selDate = sel ? hkTimestamp(sel.hour) : null;
  const selLabel = selDate !== null
    ? `${hkFormat(selDate, { month: '2-digit', day: '2-digit' })} ${hkFormat(selDate)}–${hkFormat(selDate + HOUR_MS)} HKT`
    : '';
  const selStale = sel ? hourIsStale(sel, now, freshness, radarFreshness) : false;
  const selRisk = sel ? hourRisk(sel) : null;
  const selZone = selRisk === null || selStale ? null : riskZone(selRisk);

  const METRIC_KEY: Record<Metric, TKey> = {
    pop: 'hourly.metricPop', temp: 'hourly.metricTemp', wind: 'hourly.metricWind',
  };

  /** (bar value, height px, tailwind colour, label) for the active metric. */
  const barOf = (item: HourlyItem): { h: number; color: string; label: string } | null => {
    if (metric === 'pop') {
      return { h: Math.max(4, item.pop * 0.62), color: popColor(item.pop), label: `${item.pop}%` };
    }
    if (metric === 'temp') {
      if (item.apparent_temp == null) return null;
      const v = item.apparent_temp;
      const frac = Math.min(1, Math.max(0, (v - 10) / 28));
      return { h: 4 + frac * 58, color: tempColor(v), label: `${Math.round(v)}°` };
    }
    const w = item.wind_kmh ?? 0;
    const frac = Math.min(1, Math.max(0, w / 40));
    return { h: 4 + frac * 58, color: windColor(w), label: `${Math.round(w)}` };
  };

  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">{t('hourly.title')}</h2>
        <span className="text-[11px] text-slate-400">{t('hourly.source')}</span>
      </div>
      <div className="mt-2 flex w-max rounded-[8px] bg-[#E9E9EB] p-[2px] text-[11px] font-semibold">
        {(['pop', 'temp', 'wind'] as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`rounded-[6px] px-2.5 py-1 transition-colors ${
              metric === m ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#6D6D72]'
            }`}
          >
            {t(METRIC_KEY[m])}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{t('hourly.empty')}</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto pb-1 pr-1">
            <div className="flex min-w-max items-end gap-[3px] pr-2" style={{ height: 120 }}>
              {items.map((item) => {
                const label = hourLabel(item.hour);
                const isNow = hkTimestamp(item.hour) === hkFloorHour(now);
                const isSel = item.hour === selected;
                const bar = barOf(item);
                const stale = hourIsStale(item, now, freshness, radarFreshness);
                const risk = hourRisk(item);
                const zone = risk !== null && !stale ? riskZone(risk) : null;
                const thunder = THUNDER_CODES.includes(item.weather_code);
                return (
                  <button
                    key={item.hour}
                    onClick={() => setSelected(item.hour)}
                    aria-pressed={isSel}
                    aria-label={`${hkDateKey(item.hour)} ${label}:00 HKT, ${t('hourly.tipOfficial', { p: item.pop })}${stale ? `, ${detailCopy(lang, 'staleLabel')}` : ''}`}
                    className={`relative flex w-[34px] flex-col items-center rounded-lg px-0.5 pt-0.5 ${zone ? ZONE_BG[zone] : 'bg-slate-100'} ${isSel ? 'ring-2 ring-slate-700' : ''}`}
                    title={[
                      `${hkDateKey(item.hour)} ${label}:00 HKT`,
                      t('hourly.tipOfficial', { p: item.pop }),
                      item.corrected_pop !== undefined ? t('hourly.tipCorrected', { p: item.corrected_pop }) : null,
                      item.fused_pop !== undefined ? `${detailCopy(lang, 'fusedLabel')}: ${item.fused_pop}/100` : null,
                      item.climatology_pop !== null && item.climatology_pop !== undefined
                        ? t('hourly.tipClim', { p: item.climatology_pop }) : null,
                      stale ? detailCopy(lang, 'staleLabel') : zone ? t('hourly.tipZone', { z: t(ZONE_KEY[zone]) }) : null,
                    ].filter(Boolean).join('\n')}
                  >
                    <span className="text-[10.5px] text-slate-500">{bar ? bar.label : '—'}</span>
                    <div className="relative w-full" style={{ height: 62 }}>
                      {bar && (
                        <div
                          className={`absolute bottom-0 left-0 right-0 rounded-t ${bar.color} ${isNow ? 'ring-2 ring-emerald-500' : ''}`}
                          style={{ height: bar.h }}
                        />
                      )}
                      {metric === 'pop' && item.corrected_pop !== undefined && (
                        <div
                          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-slate-700"
                          style={{ bottom: Math.max(0, item.corrected_pop * 0.62 - 3) }}
                        />
                      )}
                      {metric === 'pop' && item.fused_pop !== undefined && (
                        <div
                          className="absolute left-1/2 ml-[3px] h-1.5 w-1.5 rounded-full bg-amber-500"
                          style={{ bottom: Math.max(0, item.fused_pop * 0.62 - 3) }}
                        />
                      )}
                      {thunder && (
                        <span className="absolute -top-0.5 right-0 text-amber-500">
                          <Icon name="bolt" className="h-3 w-3" strokeWidth={2.2} />
                        </span>
                      )}
                    </div>
                    <span className={`text-[10.5px] ${isNow ? 'font-bold text-emerald-600' : 'text-slate-400'}`}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* tap detail: the three numbers + a plain-language verdict */}
          {sel && (
            <div className="mt-2 rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">{selLabel}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${selZone ? ZONE_CHIP[selZone] : 'bg-slate-200 text-slate-700'}`}>
                  {selZone ? t('hourly.suggest', { z: t(ZONE_KEY[selZone]) }) : detailCopy(lang, 'staleLabel')}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[11px] text-slate-400">{t('hourly.official')}</div>
                  <div className="text-base font-bold text-sky-700">{sel.pop}%</div>
                </div>
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[11px] text-slate-400">{t('hourly.corrected')}</div>
                  <div className="text-base font-bold text-slate-700">
                    {(sel.corrected_pop ?? sel.pop)}%
                  </div>
                </div>
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[11px] text-slate-400">{t('hourly.clim')}</div>
                  <div className="text-base font-bold text-slate-500">
                    {sel.climatology_pop ?? '—'}%
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-600">
                {selStale ? detailCopy(lang, 'staleHourly') : sel.fused_pop !== undefined
                  ? detailCopy(lang, selZone === 'no' ? 'highBody' : selZone === 'edge' ? 'edgeBody' : 'lowBody')
                  : verdictFor(t, sel)}
              </p>
              {sel.fused_pop !== undefined && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {detailCopy(lang, 'fusedLabel')}: {sel.fused_pop}/100
                </p>
              )}
              {sel.comfort && sel.comfort.level && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${COMFORT_CHIP[sel.comfort.level]}`}>
                    {t('hourly.comfort')}
                  </span>
                  <span className="text-slate-600">{comfortNote(t, sel.comfort.level, sel.apparent_temp, sel.wind_kmh)}</span>
                </p>
              )}
              <p className="mt-1 text-[11px] text-slate-400">
                {t('hourly.footer', { mm: sel.mm.toFixed(1), w: sel.wind_kmh.toFixed(0) })}
                {sel.apparent_temp != null && t('hourly.atemp', { t: sel.apparent_temp.toFixed(0) })}
                {sel.humidity != null && t('hourly.hum', { h: sel.humidity.toFixed(0) })}
                {hasStats ? '' : t('hourly.noStats')}
              </p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
            {metric === 'pop' && (
              <>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />{t('hourly.official')}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-700" />{t('hourly.corrected')}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />{detailCopy(lang, 'fusedLabel')}</span>
              </>
            )}
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" />{t('hourly.legendGo')}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-50 ring-1 ring-amber-200" />{t('hourly.legendEdge')}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-50 ring-1 ring-rose-200" />{t('hourly.legendNo')}</span>
          </div>
          <p className="mt-1 text-[12px] text-slate-500">
            {detailCopy(lang, 'chartNote')}
          </p>
        </>
      )}
    </section>
  );
}
