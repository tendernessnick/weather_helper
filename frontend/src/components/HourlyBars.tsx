import type { HourlyItem } from '../types';

function popColor(pop: number): string {
  if (pop >= 70) return 'bg-sky-600';
  if (pop >= 50) return 'bg-sky-500';
  if (pop >= 30) return 'bg-sky-400';
  if (pop >= 15) return 'bg-sky-300';
  return 'bg-sky-200';
}

export default function HourlyBars({ hourly }: { hourly: HourlyItem[] }) {
  const items = hourly.slice(0, 48);
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
              return (
                <div
                  key={item.hour}
                  className="flex w-[26px] flex-col items-center"
                  title={`${d.getMonth() + 1}/${d.getDate()} ${label}:00 · 概率 ${item.pop}% · ${item.mm.toFixed(1)}mm · 风 ${item.wind_kmh.toFixed(0)}km/h`}
                >
                  <span className="text-[9px] text-slate-500">{item.pop}%</span>
                  <div
                    className={`w-full rounded-t ${popColor(item.pop)} ${isNow ? 'ring-2 ring-emerald-500' : ''}`}
                    style={{ height: Math.max(4, item.pop * 0.62) }}
                  />
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
        绿框为当前小时。概率来自约 27 公里分辨率集合预报，对香港局部骤雨偏保守——请结合上方临近预报与本球场可信度一起判断。
      </p>
    </section>
  );
}
