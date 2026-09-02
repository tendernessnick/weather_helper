import { useEffect, useState } from 'react';
import { api } from '../api';
import type {
  CourtRankRow, HourProfileRow, LeadBucket, StatsOverview,
} from '../types';
import MyReportCard from '../components/MyReportCard';

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

/** Plain-language verdict for the Brier Skill Score. */
function bssVerdict(bss: number): { label: string; tone: string } {
  if (bss < 0) return { label: '不如查日历', tone: 'bg-rose-100 text-rose-700' };
  if (bss < 0.1) return { label: '勉强有用', tone: 'bg-[#FFF4E5] text-[#8A6100]' };
  if (bss < 0.25) return { label: '有价值', tone: 'bg-[#E8F8ED] text-[#1B7A3D]' };
  return { label: '很有价值', tone: 'bg-emerald-600 text-white' };
}

/** One-sentence auto-interpretation of the reliability curve. */
function reliabilityVerdict(rows: NonNullable<StatsOverview['open_meteo']['reliability']>): string | null {
  const usable = rows.filter((r) => r.n >= 10);
  if (usable.length < 3) return null;
  const n = usable.reduce((a, r) => a + r.n, 0);
  const wMeanF = usable.reduce((a, r) => a + r.mean_forecast * r.n, 0) / n;
  const wMeanO = usable.reduce((a, r) => a + r.observed_freq * r.n, 0) / n;
  const delta = wMeanF - wMeanO;
  if (Math.abs(delta) < 0.05) return '预报数字与实际基本一致，可以按面值相信';
  if (delta > 0) {
    return `预报普遍虚高：平均说的比实际多约 ${Math.round(delta * 100)} 个百分点（如说 60% 实际约 ${Math.max(0, Math.round((0.6 - delta) * 100))}%）`;
  }
  return `预报普遍保守：实际比说的更爱下雨约 ${Math.round(-delta * 100)} 个百分点`;
}

function BigStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[10px] bg-[#F2F2F7] p-3">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-bold text-slate-800">{value}</div>
      {note && <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{note}</div>}
    </div>
  );
}

function SourceCard({ title, question, src, windowDays }: { title: string; question: string; src: StatsOverview['open_meteo']; windowDays: number }) {
  const dec = src.decomposition ?? null;
  const bss = src.bss ?? null;  // deterministic sources omit bss entirely
  const verdict = bss !== null ? bssVerdict(bss) : null;
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        <span className="text-[10px] text-slate-400">近 {windowDays} 天 · n={src.n}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">这一条回答：{question}</p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <BigStat
          label={'比「只看历史平均」聪明多少（BSS）'}
          value={bss === null ? '不适用' : bss.toFixed(2)}
          note={bss === null ? '确定性预报没有概率可打分'
            : bss > 0 ? `同样的信息量，比直接翻历史账本准 ${Math.round(bss * 100)}%`
            : '暂时还不如直接翻历史账本'}
        />
        <BigStat
          label="说下雨时准不准（准确率）"
          value={pct(src.accuracy)}
          note={src.accuracy === null ? '' : `n=${src.n} 小时样本`}
        />
      </div>

      {verdict && (
        <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${verdict.tone}`}>
          {verdict.label}
        </span>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">
          漏报率 {pct(src.pod === null ? null : 1 - src.pod)}
          {src.pod_ci && ` (${Math.round((1 - src.pod_ci[1]) * 100)}~${Math.round((1 - src.pod_ci[0]) * 100)}%)`}
        </span>
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">
          误报率 {pct(src.far)}
          {src.far_ci && ` (${Math.round(src.far_ci[0] * 100)}~${Math.round(src.far_ci[1] * 100)}%)`}
        </span>
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">Heidke {src.heidke ?? '—'}</span>
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">Peirce {src.peirce ?? '—'}</span>
        {src.brier !== null && src.brier !== undefined && (
          <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">Brier {src.brier.toFixed(3)}</span>
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
            误差拆解：数字虚高 {dec.reliability.toFixed(2)} · 能区分下不下 {dec.resolution.toFixed(2)} ·
            天气本身的随机 {dec.uncertainty.toFixed(2)}（这个季节 {pct(dec.base_rate)} 的小时在下雨）
          </div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full">
            <div className="bg-rose-400" style={{ width: `${dec.reliability / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
            <div className="bg-sky-400" style={{ width: `${dec.resolution / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
            <div className="bg-slate-300" style={{ width: `${dec.uncertainty / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
          </div>
          <div className="mt-0.5 text-[9px] text-slate-400">
            红=报大话的损失（越少越好） 蓝=真本事（越多越好） 灰=老天爷的随机（谁也消不掉）
          </div>
        </div>
      )}
    </section>
  );
}

function ReliabilityChart({ rows }: { rows: NonNullable<StatsOverview['open_meteo']['reliability']> }) {
  const verdict = reliabilityVerdict(rows);
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">它说的 60%，实际是 60% 吗？</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">这一条回答：预报的数字本身可不可信</p>
      {verdict && (
        <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-[11px] font-medium leading-relaxed text-slate-700">
          💡 {verdict}
        </p>
      )}
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
        <span className="absolute bottom-0.5 right-1 text-[9px] text-slate-400">预报说的% →</span>
        <span className="absolute left-1 top-0.5 text-[9px] text-slate-400">↑ 实际下的%</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        点落在虚线上=说到做到；整体在虚线下方=爱报大话；气泡越大=这个区间的样本越多。
      </p>
    </section>
  );
}

const BUCKET_LABEL: Record<string, string> = {
  l3: '临出门看', l12: '当天安排', l24: '明天订场', l48: '提前两天',
};

function LeadDecay({ data }: { data: Record<string, LeadBucket> }) {
  const keys = ['l3', 'l12', 'l24', 'l48'];
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">提前多久看的预报才算数？</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        这一条回答：隔天的预报能不能信、提前几天订场该信什么
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
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">几点钟的预报最容易骗你？</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        这一条回答：哪些时段的"没雨"要打个问号（漏报 = 实际下了但预报没说）
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
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">哪个球场的预报最靠谱？</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">
        这一条回答：同样是预报，在哪被骗的概率小一点
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        横条是可信范围（95% 置信区间），竖线是估计值。<b>两条横条有重叠 = 这两个球场没有实际差别</b>，
        别纠结名次。全港平均 {pct(data.group_rate)}。样本少的球场已自动向平均靠拢。
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
  const [guideOpen, setGuideOpen] = useState(false);

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
      <MyReportCard />
      <div className="ios-card mx-4 mt-3 p-3">
        <button
          onClick={() => setGuideOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-[12px] font-bold text-slate-800"
        >
          <span>📊 这页是什么？怎么读？（点开 30 秒入门）</span>
          <span aria-hidden>{guideOpen ? '−' : '+'}</span>
        </button>
        {guideOpen && (
          <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-600">
            <p>1. 本站持续把"预报当时怎么说的"存档，和"实际下没下"自动对账——这页就是对账结果。</p>
            <p>2. 每个数字都带样本量 n：n 越小越会抖，别把小样本的数字当真理；显示"积累中"就是还不够。</p>
            <p>3. 和"历史平均"比的分数（BSS）才是真本事：因为香港本来就不常下雨，闭眼说"没雨"也能蒙对 88%。</p>
          </div>
        )}
      </div>
      <SourceCard
        title="Open-Meteo 逐小时概率预报" question="中期预报（2-48 小时）到底有没有用"
        src={overview.open_meteo} windowDays={overview.window_days}
      />
      {overview.open_meteo.reliability && overview.open_meteo.reliability.length > 0 && (
        <ReliabilityChart rows={overview.open_meteo.reliability} />
      )}
      <SourceCard
        title="天文台临近预报（0-2 小时）" question="出门前最该信的那份雷达预报表现如何"
        src={overview.hko_f3} windowDays={overview.window_days}
      />
      <LeadDecay data={decay} />
      <HourProfile profile={profile} />
      <Ranking data={ranking} />
    </div>
  );
}
