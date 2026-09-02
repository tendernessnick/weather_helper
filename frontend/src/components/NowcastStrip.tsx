import type { NowcastStep } from '../types';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function NowcastStrip({
  steps, fetchedAt,
}: { steps: NowcastStep[]; fetchedAt: string | null }) {
  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">未来 2 小时降雨（天文台临近预报）</h2>
        <span className="text-[10px] text-slate-400">
          {fetchedAt ? `更新于 ${fmtTime(fetchedAt)}` : ''}
        </span>
      </div>
      {steps.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">暂无临近预报数据，请稍后刷新</p>
      ) : (
        <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {steps.map((step) => {
            const raining = step.mm >= 0.05;
            return (
              <li
                key={step.ending}
                className={`flex min-w-[68px] flex-col items-center rounded-lg px-2 py-2 ${
                  raining ? 'bg-sky-50 text-sky-700' : 'bg-slate-50 text-slate-500'
                }`}
              >
                <span className="text-xs font-medium">{fmtTime(step.ending)}</span>
                <span className="mt-1 text-lg" aria-hidden>{raining ? '💧' : '—'}</span>
                <span className="text-[11px]">{step.mm.toFixed(1)}mm</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        天文台 SWIRLS 雷达外推预报，每 12 分钟更新、半小时一档。0-2 小时内它比任何逐小时模型预报都准。
      </p>
    </section>
  );
}
