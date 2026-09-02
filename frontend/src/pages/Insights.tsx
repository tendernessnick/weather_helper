import { useEffect, useState } from 'react';
import { api } from '../api';
import type {
  CourtRankRow, HourProfileRow, LeadBucket, StatsOverview,
} from '../types';
import MyReportCard from '../components/MyReportCard';
import { courtName, useLang, useT } from '../i18n';
import type { TKey, TFn } from '../i18n';

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

/** Plain-language verdict for the Brier Skill Score. */
function bssVerdict(t: TFn, bss: number): { label: string; tone: string } {
  if (bss < 0) return { label: t('ins.bss.neg'), tone: 'bg-rose-100 text-rose-700' };
  if (bss < 0.1) return { label: t('ins.bss.low'), tone: 'bg-[#FFF4E5] text-[#8A6100]' };
  if (bss < 0.25) return { label: t('ins.bss.mid'), tone: 'bg-[#E8F8ED] text-[#1B7A3D]' };
  return { label: t('ins.bss.high'), tone: 'bg-emerald-600 text-white' };
}

/** One-sentence auto-interpretation of the reliability curve. */
function reliabilityVerdict(
  t: TFn, rows: NonNullable<StatsOverview['open_meteo']['reliability']>,
): string | null {
  const usable = rows.filter((r) => r.n >= 10);
  if (usable.length < 3) return null;
  const n = usable.reduce((a, r) => a + r.n, 0);
  const wMeanF = usable.reduce((a, r) => a + r.mean_forecast * r.n, 0) / n;
  const wMeanO = usable.reduce((a, r) => a + r.observed_freq * r.n, 0) / n;
  const delta = wMeanF - wMeanO;
  if (Math.abs(delta) < 0.05) return t('ins.reliable');
  if (delta > 0) {
    return t('ins.inflated', { d: Math.round(delta * 100), r: Math.max(0, Math.round((0.6 - delta) * 100)) });
  }
  return t('ins.conservative', { d: Math.round(-delta * 100) });
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
  const { t } = useLang();
  const dec = src.decomposition ?? null;
  const bss = src.bss ?? null;  // deterministic sources omit bss entirely
  const verdict = bss !== null ? bssVerdict(t, bss) : null;
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        <span className="text-[10px] text-slate-400">{t('ins.window', { n: windowDays, n2: src.n })}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-500">{question}</p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <BigStat
          label={t('ins.bss')}
          value={bss === null ? t('ins.bssNa') : bss.toFixed(2)}
          note={bss === null ? t('ins.bssNaNote')
            : bss > 0 ? t('ins.bssPos', { p: Math.round(bss * 100) })
            : t('ins.bssNeg')}
        />
        <BigStat
          label={t('ins.acc')}
          value={pct(src.accuracy)}
          note={src.accuracy === null ? '' : t('ins.accNote', { n: src.n })}
        />
      </div>

      {verdict && (
        <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${verdict.tone}`}>
          {verdict.label}
        </span>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">
          {t('ins.miss', { v: pct(src.pod === null ? null : 1 - src.pod) })}
          {src.pod_ci && ` (${Math.round((1 - src.pod_ci[1]) * 100)}~${Math.round((1 - src.pod_ci[0]) * 100)}%)`}
        </span>
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">
          {t('ins.far', {
            v: pct(src.far),
            a: src.far_ci ? Math.round(src.far_ci[0] * 100) : '—',
            b: src.far_ci ? Math.round(src.far_ci[1] * 100) : '—',
          })}
        </span>
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">{t('ins.heidke', { v: src.heidke ?? '—' })}</span>
        <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">{t('ins.peirce', { v: src.peirce ?? '—' })}</span>
        {src.brier !== null && src.brier !== undefined && (
          <span className="rounded-full bg-[#F2F2F7] px-2 py-0.5">{t('ins.brier', { v: src.brier.toFixed(3) })}</span>
        )}
        {src.onset_capture_rate !== undefined && src.onset_capture_rate !== null && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
            {t('ins.onset', { p: pct(src.onset_capture_rate), n: src.onsets ?? 0 })}
          </span>
        )}
      </div>

      {dec && (
        <div className="mt-3">
          <div className="text-[10px] text-slate-500">
            {t('ins.decLine', {
              r: dec.reliability.toFixed(2), res: dec.resolution.toFixed(2),
              u: dec.uncertainty.toFixed(2), b: pct(dec.base_rate),
            })}
          </div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full">
            <div className="bg-rose-400" style={{ width: `${dec.reliability / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
            <div className="bg-sky-400" style={{ width: `${dec.resolution / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
            <div className="bg-slate-300" style={{ width: `${dec.uncertainty / (dec.reliability + dec.resolution + dec.uncertainty) * 100}%` }} />
          </div>
          <div className="mt-0.5 text-[9px] text-slate-400">{t('ins.decLegend')}</div>
        </div>
      )}
    </section>
  );
}

function ReliabilityChart({ rows }: { rows: NonNullable<StatsOverview['open_meteo']['reliability']> }) {
  const { t } = useLang();
  const verdict = reliabilityVerdict(t, rows);
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('ins.relTitle')}</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">{t('ins.relQuestion')}</p>
      {verdict && (
        <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-[11px] font-medium leading-relaxed text-slate-700">
          💡 {verdict}
        </p>
      )}
      <span className="mb-0.5 mt-2 block pl-1 text-[9px] text-slate-400">{t('ins.axisY')}</span>
      <div className="relative h-40 rounded-lg bg-slate-50">
        <div className="absolute inset-0">
          {[25, 50, 75].map((p) => (
            <div key={`h${p}`} className="absolute left-0 right-0 h-px bg-slate-200/70" style={{ top: `${p}%` }} />
          ))}
          {[25, 50, 75].map((p) => (
            <div key={`v${p}`} className="absolute bottom-0 top-0 w-px bg-slate-200/70" style={{ left: `${p}%` }} />
          ))}
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
        {[0, 25, 50, 75, 100].map((v) => (
          <span key={`y${v}`} className="absolute left-1 -translate-y-1/2 text-[8px] tabular-nums text-slate-400"
                style={{ top: `${100 - v}%` }}>{v}</span>
        ))}
        {[0, 25, 50, 75, 100].map((v) => (
          <span key={`x${v}`} className="absolute bottom-0 -translate-x-1/2 text-[8px] tabular-nums text-slate-400"
                style={v === 0 ? { left: 4 } : v === 100 ? { right: 4 } : { left: `${v}%` }}>{v}</span>
        ))}
      </div>
      <span className="mt-0.5 block pr-1 text-right text-[9px] text-slate-400">{t('ins.axisX')}</span>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        {t('ins.relLegend')}
      </p>
    </section>
  );
}

const BUCKET_KEY: Record<string, TKey> = {
  l3: 'ins.bucket.l3', l12: 'ins.bucket.l12', l24: 'ins.bucket.l24', l48: 'ins.bucket.l48',
};

function LeadDecay({ data }: { data: Record<string, LeadBucket> }) {
  const { t } = useLang();
  const keys = ['l3', 'l12', 'l24', 'l48'];
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('ins.decayTitle')}</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">{t('ins.decayQuestion')}</p>
      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        {keys.map((k) => {
          const b = data[k];
          return (
            <div key={k} className="rounded-lg bg-slate-50 p-2">
              <div className="text-[10px] font-medium text-slate-600">{t(BUCKET_KEY[k])}</div>
              <div className={`mt-0.5 text-xl font-bold ${
                b?.accumulating ? 'text-slate-300' : (b?.bss ?? 0) > 0.05 ? 'text-emerald-600' : 'text-amber-600'
              }`}>
                {b ? (b.accumulating ? t('common.building') : (b.bss ?? 0).toFixed(2)) : '—'}
              </div>
              <div className="text-[9px] text-slate-400">
                {b ? `n=${b.n}${b.accumulating ? '' : ` · ${t('score.miss', { p: pct(b.pod === null ? null : 1 - b.pod) })} ${t('score.far', { p: pct(b.far) })}`}` : ''}
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
  const { t } = useLang();
  const max = Math.max(0.5, ...profile.map((p) => p.miss_rate ?? 0));
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('ins.hourTitle')}</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">{t('ins.hourQuestion')}</p>
      <div className="mt-2 flex items-end gap-[2px]" style={{ height: 72 }}>
        {profile.map((p) => (
          <div key={p.hour} className="flex-1"
               title={`${p.hour}:00 · ${t('ins.miss', { v: pct(p.miss_rate) })} · ${t('ins.hourEvents', { n: p.rain_events })}`}>
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
  const { t, lang } = useLang();
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('ins.rankTitle')}</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">{t('ins.rankQuestion')}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        {t('ins.rankExplain', { p: pct(data.group_rate) })}
      </p>
      <ul className="mt-2 space-y-1">
        {data.courts.slice(0, 12).map((c, i) => (
          <li key={c.court_id} className="flex items-center gap-2 text-[11px]">
            <span className="w-4 text-right text-slate-400">{i + 1}</span>
            <a href={`/courts/${c.court_id}`} className="w-24 truncate font-medium text-slate-700">
              {courtName(
                { name_sc: c.name_sc, name_tc: c.name_tc ?? '', name_en: c.name_en ?? '' }, lang,
              )}{c.microclimate && <span title={t('ins.micro')}>🌦️</span>}
            </a>
            <div className="relative h-3.5 flex-1 rounded bg-slate-100">
              {c.ci && (
                <div className="absolute top-0.5 h-2.5 rounded bg-sky-300"
                     style={{ left: `${c.ci[0] * 100}%`, width: `${(c.ci[1] - c.ci[0]) * 100}%` }} />
              )}
              <div className="absolute top-0 h-3.5 w-0.5 bg-slate-700"
                   style={{ left: `${c.shrunk_accuracy * 100}%` }}
                   title={`n=${c.n}`} />
            </div>
            <span className="w-9 text-right font-semibold">{pct(c.shrunk_accuracy)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Insights() {
  const t = useT();
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
    return <div className="p-8 text-center text-sm text-slate-400">{t('common.loading')}</div>;
  }

  return (
    <div className="pb-4">
      <MyReportCard />
      <div className="ios-card mx-4 mt-3 p-3">
        <button
          onClick={() => setGuideOpen((v) => !v)}
          className="flex w-full items-center justify-between text-left text-[12px] font-bold text-slate-800"
        >
          <span>{t('ins.guideTitle')}</span>
          <span aria-hidden>{guideOpen ? '−' : '+'}</span>
        </button>
        {guideOpen && (
          <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-600">
            <p>{t('ins.guide1')}</p>
            <p>{t('ins.guide2')}</p>
            <p>{t('ins.guide3')}</p>
          </div>
        )}
      </div>
      <SourceCard
        title={t('ins.omTitle')} question={t('ins.omQuestion')}
        src={overview.open_meteo} windowDays={overview.window_days}
      />
      {overview.open_meteo.reliability && overview.open_meteo.reliability.length > 0 && (
        <ReliabilityChart rows={overview.open_meteo.reliability} />
      )}
      <SourceCard
        title={t('ins.f3Title')} question={t('ins.f3Question')}
        src={overview.hko_f3} windowDays={overview.window_days}
      />
      <LeadDecay data={decay} />
      <HourProfile profile={profile} />
      <Ranking data={ranking} />
    </div>
  );
}
