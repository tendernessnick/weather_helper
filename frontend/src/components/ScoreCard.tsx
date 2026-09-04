import type { CourtScores, Metrics } from '../types';
import { hintLines, useLang } from '../i18n';

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function VerifyLine({ label, m }: { label: string; m: Metrics }) {
  const { t } = useLang();
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
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
        <span className="whitespace-nowrap text-[11px] text-slate-500">
          n={m.n}
          {m.sufficient_samples && m.pod !== null && (
            <> · {t('score.miss', { p: pct(m.pod) })} · {t('score.far', { p: pct(m.far) })}</>
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
  const { t } = useLang();
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs font-semibold text-slate-700">{title}</div>
      <div className="text-[11px] text-slate-400">{note}</div>
      <VerifyLine label={t('score.gauge')} m={station} />
      <VerifyLine label={t('score.players')} m={user} />
    </div>
  );
}

export default function ScoreCard({ scores }: { scores: CourtScores }) {
  const { t } = useLang();
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('score.title', { n: scores.window_days })}</h2>
      <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-slate-600">
        {hintLines(t('score.explain', { m: scores.min_samples }))}
      </p>
      <div className="mt-2 space-y-2">
        <SourceCard
          title={t('score.omTitle')} note={t('score.omNote')}
          station={scores.open_meteo.station} user={scores.open_meteo.user}
        />
        <SourceCard
          title={t('score.f3Title')} note={t('score.f3Note')}
          station={scores.hko_f3.station} user={scores.hko_f3.user}
        />
      </div>
    </section>
  );
}
