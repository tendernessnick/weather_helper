import { useEffect, useState } from 'react';
import { api } from '../api';
import type {
  CourtRankRow, HourProfileRow, LeadBucket, StatsOverview,
} from '../types';

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

function BigStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-bold text-slate-800">{value}</div>
      {note && <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{note}</div>}
    </div>
  );
}

function SourceCard({ title, src, windowDays }: { title: string; src: StatsOverview['open_meteo']; windowDays: number }) {
  const dec = src.decomposition ?? null;
  const bss = src.bss ?? null;  // deterministic sources omit bss entirely
  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="text-[10px] text-slate-400">近 {windowDays} 天 · n={src.n}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <BigStat
          label="技巧评分 BSS（比气候基准强多少）"
          value={bss === null ? '—' : bss.toFixed(2)}
          note={bss === null ? '确定性预报不适用概率评分'
            : bss > 0 ? `预报比"只看历史平均"好 ${Math.round(bss * 100)}%`
            : '暂不比历史平均强，别单独依赖'}
        />
        <BigStat
          label="准确率（二分类，95% 置信区间）"
          value={pct(src.accuracy)}
          note={src.accuracy === null ? '' : `n=${src.n} 小时样本`}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded-full bg-slate-100 px-2 py-0.5">
          漏报率 {pct(src.pod === null ? null : 1 - src.pod)}
          {src.pod_ci && ` (${Math.round((1 - src.pod_ci[1]) * 100)}~${Math.round((1 - src.pod_ci[0]) * 100)}%)`}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">
          误报率 {pct(src.far)}
          {src.far_ci && ` (${Math.round(src.far_ci[0] * 100)}~${Math.round(src.far_ci[1] * 100)}%)`}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">Heidke {src.heidke ?? '—'}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">Peirce {src.peirce ?? '—'}</span>
        {src.brier !== null && src.brier !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5">Brier {src.brier.toFixed(3)}</span>
        )}
        {src.onset_capture_rate !== undefined && src.onset_capture_rate !== null && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
            突发雨捕获 {pct(src.onset_capture_rate)}（{src.onsets} 次）
          </span>
        )}
      </div>

      {dec && (
        <div className="mt-3">
          <div className="text-[10px] text-slate-500">
            Brier 分解：可靠性（虚高程度）{dec.reliability.toFixed(3)} · 分辨力 {dec.resolution.toFixed(3)} ·
            基准不确定度 {dec.uncertainty.toFixed(3)}（本底下雨率 {pct(dec.base_rate)}）
          </div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full">
            <div className="bg-rose-400" style={{ width: `${dec.reliability / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
            <div className="bg-sky-400" style={{ width: `${dec.resolution / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
            <div className="bg-slate-300" style={{ width: `${dec.uncertainty / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
          </div>
          <div className="mt-0.5 text-[9px] text-slate-400">
            红=可靠性损失（数字虚高） 蓝=分辨力（能区分下不下） 灰=本底不确定
          </div>
        </div>
      )}
    </section>
  );
}

function ReliabilityChart({ rows }: { rows: NonNullable<StatsOverview['open_meteo']['reliability']> }) {
  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold">可靠性曲线（校准）</h2>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        横轴=预报概率，纵轴=实际下雨频率。贴对角线=预报数字可信；
        在对角线下方=预报虚高（说的%比实际下的多）。气泡大小=样本量。
      </p>
      <div className="relative mt-2 h-44 rounded-lg bg-slate-50">
        <div className="absolute inset-0">
          <div className="absolute left-0 right-0 top-0 border-t border-dashed border-slate-300" />
          <div className="absolute bottom-0 left-0 h-full w-px bg-slate-300" />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
            <line x1="0" y1="100" x2="100" y2="0" stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="3 3" />
            {rows.map((r) => r.n >= 5 && (
              <circle key={r.lo} cx={r.mean_forecast * 100}
                      cy={100 - r.observed_freq * 100}
                      r={Math.max(1.6, Math.min(4, r.n / 40))} fill="#0284c7" fillOpacity="0.75" />
            ))}
          </svg>
        </div>
        <span className="absolute bottom-0.5 right-1 text-[9px] text-slate-400">预报% →</span>
        <span className="absolute left-1 top-0.5 text-[9px] text-slate-400">↑ 实际%</span>
      </div>
    </section>
  );
}

const BUCKET_LABEL: Record<string, string> = {
  l3: '≤3小时', l12: '3-12h', l24: '12-30h', l48: '30-50h',
};

function LeadDecay({ data }: { data: Record<string, LeadBucket> }) {
  const keys = ['l3', 'l12', 'l24', 'l48'];
  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold">提前多久看预报才可信（时效衰减）</h2>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        同一个预报在不同提前量下的技巧评分 BSS。多桶数据从功能上线起积累，需要数周填满。
      </p>
      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        {keys.map((k) => {
          const b = data[k];
          return (
            <div key={k} className="rounded-lg bg-slate-50 p-2">
              <div className="text-[10px] font-medium text-slate-600">{BUCKET_LABEL[k]}</div>
              <div className={`mt-0.5 text-xl font-bold ${
                b?.accumulating ? 'text-slate-300' : (b?.bss ?? 0) > 0.05 ? 'text-emerald-600' : 'text-amber-600'
              }`}>
                {b ? (b.accumulating ? '积累中' : (b.bss ?? 0).toFixed(2)) : '—'}
              </div>
              <div className="text-[9px] text-slate-400">
                {b ? `n=${b.n}${b.accumulating ? '' : ` · 漏${pct(b.pod === null ? null : 1 - b.pod)} 误${pct(b.far)}`}` : ''}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                <div className={(b?.bss ?? 0) > 0 ? 'bg-emerald-500' : 'bg-amber-400'}
                     style={{ width: `${Math.min(100, Math.max(0, ((b?.bss ?? 0) / 0.5) * 100))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HourProfile({ profile }: { profile: HourProfileRow[] }) {
  const max = Math.max(0.5, ...profile.map((p) => p.miss_rate ?? 0));
  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold">几点钟的预报最容易漏报</h2>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        各小时「实际下雨但预报没报」的比例（漏报率）。香港夏季午后对流雨是预报盲区，
        该时段的预报建议主动打折。
      </p>
      <div className="mt-2 flex items-end gap-[2px]" style={{ height: 72 }}>
        {profile.map((p) => (
          <div key={p.hour} className="flex-1"
               title={`${p.hour}:00 · 漏报率 ${pct(p.miss_rate)}（${p.miss_ci ? `${Math.round(p.miss_ci[0] * 100)}~${Math.round(p.miss_ci[1] * 100)}%` : '无雨事件'}）· 雨事件 ${p.rain_events}`}>
            <div className={`w-full rounded-t ${
              (p.miss_rate ?? 0) > 0.4 ? 'bg-rose-500' :
              (p.miss_rate ?? 0) > 0.25 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
                 style={{ height: `${((p.miss_rate ?? 0) / max) * 60}px`, minHeight: p.miss_rate === null ? 0 : 2 }} />
            <div className="mt-0.5 text-center text-[8px] text-slate-400">
              {p.hour % 3 === 0 ? p.hour : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Ranking({ data }: { data: { group_rate: number | null; courts: CourtRankRow[] } }) {
  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold">球场排行（收缩估计 · 带 95% 置信区间）</h2>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        单球场样本噪声大，估计已向全港均值收缩（经验贝叶斯）。区间重叠=差异不显著，
        请看区间而非名次。全域基准 {pct(data.group_rate)}。
      </p>
      <ul className="mt-2 space-y-1">
        {data.courts.slice(0, 12).map((c, i) => (
          <li key={c.court_id} className="flex items-center gap-2 text-[11px]">
            <span className="w-4 text-right text-slate-400">{i + 1}</span>
            <a href={`/courts/${c.court_id}`} className="w-24 truncate font-medium text-slate-700">
              {c.name_sc}{c.microclimate && <span title="微气候球场">🌦️</span>}
            </a>
            <div className="relative h-3.5 flex-1 rounded bg-slate-100">
              {c.ci && (
                <div className="absolute top-0.5 h-2.5 rounded bg-sky-300"
                     style={{ left: `${c.ci[0] * 100}%`, width: `${(c.ci[1] - c.ci[0]) * 100}%` }} />
              )}
              <div className="absolute top-0 h-3.5 w-0.5 bg-slate-700"
                   style={{ left: `${c.shrunk_accuracy * 100}%` }}
                   title={`收缩估计 ${pct(c.shrunk_accuracy)}（原始 ${pct(c.raw_accuracy)}，n=${c.n}）`} />
            </div>
            <span className="w-9 text-right font-semibold">{pct(c.shrunk_accuracy)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Insights() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [decay, setDecay] = useState<Record<string, LeadBucket> | null>(null);
  const [profile, setProfile] = useState<HourProfileRow[] | null>(null);
  const [ranking, setRanking] = useState<{ group_rate: number | null; courts: CourtRankRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.statsOverview(), api.leadDecay(), api.hourlyProfile(), api.courtsRanking(),
    ])
      .then(([ov, dc, hp, rk]) => {
        setOverview(ov);
        setDecay(dc);
        setProfile(hp.profile);
        setRanking(rk);
      })
      .catch((err) => setError(String(err.message ?? err)));
  }, []);

  if (error) return <div className="p-8 text-center text-sm text-rose-600">{error}</div>;
  if (!overview || !decay || !profile || !ranking) {
    return <div className="p-8 text-center text-sm text-slate-400">统计加载中…</div>;
  }

  return (
    <div className="pb-4">
      <p className="mx-4 mt-4 rounded-xl bg-slate-800 p-3 text-[11px] leading-relaxed text-slate-200">
        所有数字来自本站滚动 30 天的「预报快照 vs 实测」自动核对，样本量与置信区间全程标注；
        历史基准来自十年 ERA5 档案（区域网格级 ~11km）。
      </p>
      <SourceCard title="Open-Meteo 逐小时概率预报" src={overview.open_meteo} windowDays={overview.window_days} />
      {overview.open_meteo.reliability && overview.open_meteo.reliability.length > 0 && (
        <ReliabilityChart rows={overview.open_meteo.reliability} />
      )}
      <SourceCard title="天文台临近预报（0-2 小时，确定性）" src={overview.hko_f3} windowDays={overview.window_days} />
      <LeadDecay data={decay} />
      <HourProfile profile={profile} />
      <Ranking data={ranking} />
    </div>
  );
}
