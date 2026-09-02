import type { PersistenceCard as PersistenceData } from '../types';

export default function PersistenceCard({ data }: { data: PersistenceData }) {
  const s = data.dry_survival_1_to_4h ?? {};
  const twoHour = s['2'];
  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold">下雨的持续性（{data.month} 月 · 十年统计）</h2>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-sky-50 p-2.5">
          <div className="text-[10px] text-slate-500">现在在下雨</div>
          <div className="mt-0.5 text-lg font-bold text-sky-700">
            {data.p_still_wet_next_hour === null ? '—' : `${Math.round((1 - data.p_still_wet_next_hour) * 100)}%`}
          </div>
          <div className="text-[10px] text-slate-500">下一小时转停的概率</div>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2.5">
          <div className="text-[10px] text-slate-500">现在没下雨</div>
          <div className="mt-0.5 text-lg font-bold text-emerald-700">
            {twoHour !== undefined ? `${Math.round(twoHour * 100)}%` : '—'}
          </div>
          <div className="text-[10px] text-slate-500">未来 2 小时保持无雨的概率</div>
        </div>
      </div>
      <div className="mt-2 flex gap-1.5 text-[10px] text-slate-500">
        <span>转雨概率（现在没雨）：</span>
        <span>{data.p_dry_turns_wet_next_hour === null ? '—' : `${Math.round(data.p_dry_turns_wet_next_hour * 100)}%/小时`}</span>
        <span className="ml-auto">{data.grid_note}</span>
      </div>
    </section>
  );
}
