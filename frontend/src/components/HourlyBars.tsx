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
  hourly, calibrationN,
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
                        style={{ bottom: Math.max(2, corrected * 0.62) - 3 }}
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
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        绿框为当前小时。蓝条=官方概率；黑点=校正后概率（用近 30 天该预报的实测表现换算
        {hasStats ? `，基于 ${calibrationN ?? 0} 小时样本` : '，样本积累中暂时等于官方值'}）；
        灰色虚线=十年同期历史下雨频率。背景色块为建议分区（绿≤30% 放心 / 黄 30-60% 边缘 / 红&gt;60% 别赌）。
        底部时段的虚线若高于蓝条，说明该时段历史上比现在预报的更常下雨。
      </p>
    </section>
  );
}
