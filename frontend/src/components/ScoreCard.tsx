import type { CourtScores, Metrics } from '../types';

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function VerifyLine({ label, m }: { label: string; m: Metrics }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
        {label}
      </span>
      <div className="flex items-baseline gap-2 overflow-hidden">
        <span className={`text-lg font-bold ${
          m.sufficient_samples
            ? (m.accuracy ?? 0) >= 0.75 ? 'text-emerald-600'
              : (m.accuracy ?? 0) >= 0.55 ? 'text-amber-600' : 'text-rose-600'
            : 'text-slate-400'
        }`}>
          {m.sufficient_samples ? pct(m.accuracy) : '—'}
        </span>
        <span className="whitespace-nowrap text-[10px] text-slate-500">
          n={m.n}
          {m.sufficient_samples && m.pod !== null && (
            <> · 漏报{pct(m.pod)} · 误报{pct(m.far)}</>
          )}
          {m.sufficient_samples && m.brier !== null && <> · Brier {m.brier}</>}
        </span>
      </div>
    </div>
  );
}

function SourceCard({
  title, note, station, user,
}: { title: string; note: string; station: Metrics; user: Metrics }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs font-semibold text-slate-700">{title}</div>
      <div className="text-[10px] text-slate-400">{note}</div>
      <VerifyLine label="雨量站实测" m={station} />
      <VerifyLine label="球友上报" m={user} />
    </div>
  );
}

export default function ScoreCard({ scores }: { scores: CourtScores }) {
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">预报可信吗？（近 {scores.window_days} 天）</h2>
      <p className="mt-1 text-[10px] leading-relaxed text-[#8E8E93]">
        「雨量站实测」= 天文台最近测站自动核对；「球友上报」= 到场球友众包核对。
        漏报率高要防突发降雨；误报率高可以放心赌一把。样本不足 {scores.min_samples} 时显示 —。
      </p>
      <div className="mt-2 space-y-2">
        <SourceCard
          title="Open-Meteo 逐小时概率" note="中期预报（2-48小时）· 非官方"
          station={scores.open_meteo.station} user={scores.open_meteo.user}
        />
        <SourceCard
          title="天文台临近预报" note="雷达外推（0-2小时）· 官方"
          station={scores.hko_f3.station} user={scores.hko_f3.user}
        />
      </div>
    </section>
  );
}
