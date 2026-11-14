import type { NowcastStep } from '../types';
import Icon from './Icon';
import { useLang } from '../i18n';
import { hkFormat, hkTimestamp } from '../utils/hkTime';
import { useWeatherClock } from '../hooks/useWeatherClock';
import { detailCopy } from '../detail-copy';
import type { FreshnessInfo } from '../utils/playWindow';
import { sourceIsFresh } from '../utils/playWindow';

export default function NowcastStrip({
  steps, fetchedAt, freshness,
}: { steps: NowcastStep[]; fetchedAt: string | null; freshness?: FreshnessInfo }) {
  const { t, lang } = useLang();
  const now = useWeatherClock();
  const age = fetchedAt ? now - hkTimestamp(fetchedAt) : Number.NaN;
  const fresh = sourceIsFresh(freshness, now) && Number.isFinite(age) && age >= 0 && age <= (freshness?.max_age_minutes ?? 25) * 60000;
  const validSteps = steps.filter((step) => Number.isFinite(step.mm) && step.mm >= 0 && Number.isFinite(hkTimestamp(step.ending)));
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">{t('now.title')}</h2>
        <span className="text-[12px] text-[#8E8E93]">
          {fetchedAt ? t('now.updated', { t: `${hkFormat(fetchedAt)} HKT` }) : ''}
        </span>
      </div>
      {!fresh && fetchedAt && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">{detailCopy(lang, 'nowcastStale')}</p>}
      {validSteps.length === 0 ? (
        <p className="mt-3 text-xs text-[#8E8E93]">{t('now.empty')}</p>
      ) : (
        <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {validSteps.map((step) => {
            const raining = step.mm >= 0.05;
            return (
              <li
                key={step.ending}
                className={`flex min-w-[68px] flex-col items-center rounded-[12px] px-2 py-2 ${
                  fresh && raining ? 'bg-[#E5F1FB] text-[#0071E3]' : 'bg-[#F2F2F7] text-slate-600'
                }`}
              >
                <span className="text-xs font-medium">{hkFormat(step.ending)}</span>
                <span className="mt-1 text-base" aria-hidden>{raining ? <Icon name="rain" className="h-4 w-4" /> : '·'}</span>
                <span className="text-[11px] font-medium">{step.mm.toFixed(1)}mm</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-[#8E8E93]">
        {t('now.footnote')}
      </p>
    </section>
  );
}
