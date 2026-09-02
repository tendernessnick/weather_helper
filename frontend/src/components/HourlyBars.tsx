import { useEffect, useMemo, useState } from 'react';
import type { HourlyItem } from '../types';
import { comfortNote, useLang, WEEKDAYS } from '../i18n';
import type { TKey } from '../i18n';

function popColor(pop: number): string {
  if (pop >= 70) return 'bg-sky-600';
  if (pop >= 50) return 'bg-sky-500';
  if (pop >= 30) return 'bg-sky-400';
  if (pop >= 15) return 'bg-sky-300';
  return 'bg-sky-200';
}

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
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0');
}

const COMFORT_CHIP: Record<string, string> = {
  good: 'bg-[#E8F8ED] text-[#1B7A3D]',
  fair: 'bg-[#FFF4E5] text-[#8A6100]',
  poor: 'bg-[#FFE9DC] text-[#B3541E]',
  severe: 'bg-[#FFE5E5] text-[#C0392B]',
};

/** Plain-language conclusion from the three numbers of one hour. */
function verdictFor(t: ReturnType<typeof useLang>['t'], item: HourlyItem): string {
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
  if (corrected >= 60) {
    return t('hourly.vWet', { c: corrected });
  }
  if (corrected >= 30) {
    return t('hourly.vEdge', { c: corrected });
  }
  return t('hourly.vLow', { o: official, c: corrected });
}

export default function HourlyBars({ hourly }: { hourly: HourlyItem[] }) {
  const { t, lang } = useLang();
  const items = useMemo(() => hourly.slice(0, 48), [hourly]);
  const hasStats = items.some((i) => i.corrected_pop !== undefined);

  // default selection: current hour, unless a worse zone shows up within 6h -
  // steer attention to the risk point.
  const defaultKey = useMemo(() => {
    const nowHour = new Date().getHours();
    const pick = items.find((it) => {
      const d = new Date(it.hour);
      const within6 = d.getTime() - Date.now() <= 6 * 3600 * 1000;
      return within6 && (it.zone === 'edge' || it.zone === 'no');
    });
    const fallback = items.find((it) => new Date(it.hour).getHours() === nowHour);
    return (pick ?? fallback ?? items[0])?.hour ?? null;
  }, [items]);

  const [selected, setSelected] = useState<string | null>(defaultKey);
  useEffect(() => {
    // keep selection valid when the hourly data refreshes
    if (selected && !items.some((it) => it.hour === selected)) {
      setSelected(defaultKey);
    }
  }, [items, selected, defaultKey]);

  const sel = items.find((it) => it.hour === selected) ?? null;
  const selDate = sel ? new Date(sel.hour) : null;
  const weekday = selDate ? WEEKDAYS[lang][selDate.getDay()] : '';
  const selLabel = selDate
    ? `${weekday} ${selDate.getHours().toString().padStart(2, '0')}:00–${(selDate.getHours() + 1).toString().padStart(2, '0')}:00`
    : '';

  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">{t('hourly.title')}</h2>
        <span className="text-[10px] text-slate-400">{t('hourly.source')}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{t('hourly.empty')}</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto pb-1 pr-1">
            <div className="flex min-w-max items-end gap-[3px] pr-2" style={{ height: 120 }}>
              {items.map((item) => {
                const d = new Date(item.hour);
                const label = hourLabel(item.hour);
                const isNow = new Date().getHours() === d.getHours()
                  && new Date().getDate() === d.getDate();
                const isSel = item.hour === selected;
                return (
                  <button
                    key={item.hour}
                    onClick={() => setSelected(item.hour)}
                    className={`flex w-[30px] flex-col items-center rounded-lg px-0.5 pt-0.5 ${ZONE_BG[item.zone ?? ''] ?? ''} ${isSel ? 'ring-2 ring-slate-700' : ''}`}
                    title={[
                      `${d.getMonth() + 1}/${d.getDate()} ${label}:00`,
                      t('hourly.tipOfficial', { p: item.pop }),
                      item.corrected_pop !== undefined ? t('hourly.tipCorrected', { p: item.corrected_pop }) : null,
                      item.climatology_pop !== null && item.climatology_pop !== undefined
                        ? t('hourly.tipClim', { p: item.climatology_pop }) : null,
                      item.zone ? t('hourly.tipZone', { z: t(ZONE_KEY[item.zone]) }) : null,
                    ].filter(Boolean).join('\n')}
                  >
                    <span className="text-[9px] text-slate-500">{item.pop}%</span>
                    <div className="relative w-full" style={{ height: 62 }}>
                      <div
                        className={`absolute bottom-0 left-0 right-0 rounded-t ${popColor(item.pop)} ${isNow ? 'ring-2 ring-emerald-500' : ''}`}
                        style={{ height: Math.max(4, item.pop * 0.62) }}
                      />
                      {item.corrected_pop !== undefined && (
                        <div
                          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-slate-700"
                          style={{ bottom: Math.max(0, item.corrected_pop * 0.62 - 3) }}
                        />
                      )}
                    </div>
                    <span className={`text-[9px] ${isNow ? 'font-bold text-emerald-600' : 'text-slate-400'}`}>
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
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ZONE_CHIP[sel.zone ?? 'go']}`}>
                  {t('hourly.suggest', { z: t(ZONE_KEY[sel.zone ?? 'go']) })}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[9px] text-slate-400">{t('hourly.official')}</div>
                  <div className="text-base font-bold text-sky-700">{sel.pop}%</div>
                </div>
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[9px] text-slate-400">{t('hourly.corrected')}</div>
                  <div className="text-base font-bold text-slate-700">
                    {(sel.corrected_pop ?? sel.pop)}%
                  </div>
                </div>
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[9px] text-slate-400">{t('hourly.clim')}</div>
                  <div className="text-base font-bold text-slate-500">
                    {sel.climatology_pop ?? '—'}%
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
                💡 {verdictFor(t, sel)}
              </p>
              {sel.comfort && sel.comfort.level && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${COMFORT_CHIP[sel.comfort.level]}`}>
                    {t('hourly.comfort')}
                  </span>
                  <span className="text-slate-600">{comfortNote(t, sel.comfort.level, sel.apparent_temp, sel.wind_kmh)}</span>
                </p>
              )}
              <p className="mt-1 text-[9px] text-slate-400">
                {t('hourly.footer', { mm: sel.mm.toFixed(1), w: sel.wind_kmh.toFixed(0) })}
                {sel.apparent_temp != null && t('hourly.atemp', { t: sel.apparent_temp.toFixed(0) })}
                {sel.humidity != null && t('hourly.hum', { h: sel.humidity.toFixed(0) })}
                {hasStats ? '' : t('hourly.noStats')}
              </p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />{t('hourly.official')}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-700" />{t('hourly.corrected')}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" />{t('hourly.legendGo')}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-50 ring-1 ring-amber-200" />{t('hourly.legendEdge')}</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-50 ring-1 ring-rose-200" />{t('hourly.legendNo')}</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            {t('hourly.tip')}
          </p>
        </>
      )}
    </section>
  );
}
