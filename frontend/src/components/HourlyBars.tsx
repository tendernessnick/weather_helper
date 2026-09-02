import { useEffect, useMemo, useState } from 'react';
import type { HourlyItem } from '../types';

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
const ZONE_LABEL: Record<string, string> = {
  go: '放心',
  edge: '边缘',
  no: '别赌',
};
const ZONE_CHIP: Record<string, string> = {
  go: 'bg-emerald-100 text-emerald-800',
  edge: 'bg-amber-100 text-amber-800',
  no: 'bg-rose-100 text-rose-800',
};
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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
function verdictFor(item: HourlyItem): string {
  const official = item.pop;
  const corrected = item.corrected_pop ?? item.pop;
  const clim = item.climatology_pop;

  if ((item.zone ?? 'go') === 'go' && corrected < 30) {
    const tail = clim !== null && clim !== undefined && clim > corrected + 15
      ? `，不过历史上这个时间有 ${clim}% 在下雨，别完全按惯例排除`
      : '';
    return `三个数都低：这一小时可以放心${tail}`;
  }
  if (clim !== null && clim !== undefined && clim > corrected + 20
      && official >= 50 && corrected >= 50) {
    return `预报和校正后都偏高（${official}%→${corrected}%），但历史上这个时间只有 ${clim}% 在下雨——更像短期天气过程，过去就过去了`;
  }
  if (corrected >= 60) {
    return `校正后 ${corrected}%，下雨是大概率事件，这个时段不建议硬打`;
  }
  if (corrected >= 30) {
    return `校正后 ${corrected}%，属于五五开的边缘时段：能改就改，要打就盯紧临近预报`;
  }
  return `官方 ${official}%、校正后 ${corrected}%，风险不高`;
}

export default function HourlyBars({ hourly }: { hourly: HourlyItem[] }) {
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
  const weekday = selDate ? WEEKDAYS[selDate.getDay()] : '';
  const selLabel = selDate
    ? `${weekday} ${selDate.getHours().toString().padStart(2, '0')}:00–${(selDate.getHours() + 1).toString().padStart(2, '0')}:00`
    : '';

  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">逐小时降水概率（未来 48 小时）</h2>
        <span className="text-[10px] text-slate-400">Open-Meteo 集合预报</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">暂无逐小时预报数据，请稍后刷新</p>
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
                      `官方概率 ${item.pop}%`,
                      item.corrected_pop !== undefined ? `校正后 ${item.corrected_pop}%` : null,
                      item.climatology_pop !== null && item.climatology_pop !== undefined
                        ? `十年同期 ${item.climatology_pop}%` : null,
                      item.zone ? `建议：${ZONE_LABEL[item.zone]}` : null,
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
                  建议：{ZONE_LABEL[sel.zone ?? 'go']}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[9px] text-slate-400">官方预报</div>
                  <div className="text-base font-bold text-sky-700">{sel.pop}%</div>
                </div>
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[9px] text-slate-400">按实测校正后</div>
                  <div className="text-base font-bold text-slate-700">
                    {(sel.corrected_pop ?? sel.pop)}%
                  </div>
                </div>
                <div className="rounded-lg bg-white p-1.5">
                  <div className="text-[9px] text-slate-400">十年同期</div>
                  <div className="text-base font-bold text-slate-500">
                    {sel.climatology_pop ?? '—'}%
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
                💡 {verdictFor(sel)}
              </p>
              {sel.comfort && sel.comfort.level && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${COMFORT_CHIP[sel.comfort.level]}`}>
                    打球舒适度
                  </span>
                  <span className="text-slate-600">{sel.comfort.note}</span>
                </p>
              )}
              <p className="mt-1 text-[9px] text-slate-400">
                雨量 {sel.mm.toFixed(1)}mm · 风 {sel.wind_kmh.toFixed(0)}km/h
                {sel.apparent_temp != null && <> · 体感 {sel.apparent_temp.toFixed(0)}°C</>}
                {sel.humidity != null && <> · 湿度 {sel.humidity.toFixed(0)}%</>}
                {hasStats ? '' : ' · 校正数据积累中，黑点暂等于官方值'}
              </p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />官方预报</span>
            <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-700" />按实测校正后</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" />放心</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-50 ring-1 ring-amber-200" />边缘</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-50 ring-1 ring-rose-200" />别赌</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            看颜色拿结论，点柱子看三个数和细节。黑点比蓝条低 = 预报历史上偏乐观，按黑点算。
          </p>
        </>
      )}
    </section>
  );
}
