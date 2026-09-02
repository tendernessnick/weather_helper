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

export default function HourlyBars({
  hourly,
}: { hourly: HourlyItem[]; calibrationN?: number }) {
  const items = hourly.slice(0, 48);
  const hasStats = items.some((i) => i.corrected_pop !== undefined);

  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">逐小时降水概率（未来 48 小时）</h2>
        <span className="text-[10px] text-slate-400">Open-Meteo 集合预报</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">暂无逐小时预报数据，请稍后刷新</p>
      ) : (
        <div className="mt-3 overflow-x-auto pb-1 pr-1">
          <div className="flex min-w-max items-end gap-[3px] pr-2" style={{ height: 120 }}>
            {items.map((item) => {
              const d = new Date(item.hour);
              const label = `${d.getHours().toString().padStart(2, '0')}`;
              const isNow = new Date().getHours() === d.getHours()
                && new Date().getDate() === d.getDate();
              const corrected = item.corrected_pop;
              const clim = item.climatology_pop;
              const tip = [
                `${d.getMonth() + 1}/${d.getDate()} ${label}:00`,
                `官方概率 ${item.pop}%`,
                corrected !== undefined ? `校正后 ${corrected}%（按本站实测口径）` : null,
                clim !== null && clim !== undefined ? `十年同期 ${clim}%` : null,
                `雨量 ${item.mm.toFixed(1)}mm · 风 ${item.wind_kmh.toFixed(0)}km/h`,
                item.zone ? `建议：${ZONE_LABEL[item.zone]}` : null,
              ].filter(Boolean).join('\n');
              return (
                <div
                  key={item.hour}
                  className={`flex w-[26px] flex-col items-center rounded-lg ${ZONE_BG[item.zone ?? ''] ?? ''}`}
                  title={tip}
                >
                  <span className="text-[9px] text-slate-500">{item.pop}%</span>
                  <div className="relative w-full" style={{ height: 62 }}>
                    {/* climatology tick: ten-year same-month same-hour rate */}
                    {clim !== null && clim !== undefined && (
                      <div
                        className="absolute left-0 right-0 border-t border-dashed border-slate-400/70"
                        style={{ bottom: Math.max(3, clim * 0.62) }}
                      />
                    )}
                    <div
                      className={`w-full rounded-t ${popColor(item.pop)} ${isNow ? 'ring-2 ring-emerald-500' : ''}`}
                      style={{ height: Math.max(4, item.pop * 0.62) }}
                    />
                    {/* corrected-probability dot */}
                    {corrected !== undefined && (
                      <div
                        className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-slate-700"
                        style={{ bottom: Math.max(0, corrected * 0.62 - 3) }}
                      />
                    )}
                  </div>
                  <span className={`mt-1 text-[9px] ${isNow ? 'font-bold text-emerald-600' : 'text-slate-400'}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />官方预报</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-700" />按实测校正后</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0 w-3 border-t border-dashed border-slate-400" />十年同期</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" />放心</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-50 ring-1 ring-amber-200" />边缘</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-50 ring-1 ring-rose-200" />别赌</span>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
        口诀：三个数都低 → 走；虚线比柱子高 → 这个时段历史上更爱下雨，别只信预报{hasStats ? '' : '（校正数据积累中，黑点暂等于官方值）'}。点柱子可看详情。
      </p>
    </section>
  );
}
