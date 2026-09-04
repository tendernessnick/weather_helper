import type { NowcastStep } from '../types';
import Icon from './Icon';
import { useLang } from '../i18n';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function NowcastStrip({
  steps, fetchedAt,
}: { steps: NowcastStep[]; fetchedAt: string | null }) {
  const { t } = useLang();
  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">{t('now.title')}</h2>
        <span className="text-[12px] text-[#8E8E93]">
          {fetchedAt ? t('now.updated', { t: fmtTime(fetchedAt) }) : ''}
        </span>
      </div>
      {steps.length === 0 ? (
        <p className="mt-3 text-xs text-[#8E8E93]">{t('now.empty')}</p>
      ) : (
        <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {steps.map((step) => {
            const raining = step.mm >= 0.05;
            return (
              <li
                key={step.ending}
                className={`flex min-w-[68px] flex-col items-center rounded-[12px] px-2 py-2 ${
                  raining ? 'bg-[#E5F1FB] text-[#0071E3]' : 'bg-[#F2F2F7] text-[#8E8E93]'
                }`}
              >
                <span className="text-xs font-medium">{fmtTime(step.ending)}</span>
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
