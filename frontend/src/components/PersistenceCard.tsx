import type { PersistenceCard as PersistenceData } from '../types';

export default function PersistenceCard({ data }: { data: PersistenceData }) {
  const s = data.dry_survival_1_to_4h ?? {};
  const twoHour = s['2'];
  const stopProb = data.p_still_wet_next_hour === null
    ? null : Math.round((1 - data.p_still_wet_next_hour) * 100);

  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">下雨了等多久？没下能顶多久？</h2>
      <p className="mt-0.5 text-[10px] text-slate-400">
        基于该区十年 {data.month} 月实测（≥0.5mm 口径），回答你打球时最常问的两个问题
      </p>
      <div className="mt-2 space-y-2">
        <div className="rounded-lg bg-emerald-50 p-2.5">
          <p className="text-[11px] leading-relaxed text-emerald-900">
            <span className="font-semibold">现在没下雨就出门打 2 小时：</span>
            {twoHour !== undefined ? (
              <>{twoHour >= 0.85
                ? <><span className="text-base font-bold text-emerald-700">{Math.round(twoHour * 100)}%</span> 全程无雨——这个季节的干爽时段很稳</>
                : twoHour >= 0.7
                  ? <><span className="text-base font-bold text-emerald-700">{Math.round(twoHour * 100)}%</span> 全程无雨，可以安排</>
                  : <><span className="text-base font-bold text-amber-700">{Math.round(twoHour * 100)}%</span> 全程无雨——这个时段雨说来就来，看紧临近预报</>}
              </>
            ) : '数据积累中'}
          </p>
        </div>
        <div className="rounded-lg bg-sky-50 p-2.5">
          <p className="text-[11px] leading-relaxed text-sky-900">
            <span className="font-semibold">正在下雨？</span>
            {stopProb !== null ? (
              <><span className="text-base font-bold text-sky-700">{stopProb}%</span> 的雨在一小时内会停——
                {stopProb >= 60 ? '可以先热身等一等' : stopProb >= 40 ? '五五开，赌前看眼雷达' : '这个季节的雨很能下，考虑改期'}（{data.month} 月历史）</>
            ) : '数据积累中'}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">{data.grid_note}</p>
    </section>
  );
}
