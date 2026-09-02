import type { PersistenceCard as PersistenceData } from '../types';
import { useLang } from '../i18n';

export default function PersistenceCard({ data }: { data: PersistenceData }) {
  const { t } = useLang();
  const s = data.dry_survival_1_to_4h ?? {};
  const twoHour = s['2'];
  const stopProb = data.p_still_wet_next_hour === null
    ? null : Math.round((1 - data.p_still_wet_next_hour) * 100);

  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('persist.title')}</h2>
      <p className="mt-0.5 text-[10px] text-slate-400">
        {t('persist.subtitle', { m: data.month })}
      </p>
      <div className="mt-2 space-y-2">
        <div className="rounded-lg bg-emerald-50 p-2.5">
          <p className="text-[11px] leading-relaxed text-emerald-900">
            <span className="font-semibold">{t('persist.dryLead')}</span>
            {twoHour !== undefined ? (
              <>{twoHour >= 0.85
                ? <><span className="text-base font-bold text-emerald-700">{Math.round(twoHour * 100)}%</span> {t('persist.dryHi', { p: Math.round(twoHour * 100) })}</>
                : twoHour >= 0.7
                  ? <><span className="text-base font-bold text-emerald-700">{Math.round(twoHour * 100)}%</span> {t('persist.dryMid', { p: Math.round(twoHour * 100) })}</>
                  : <><span className="text-base font-bold text-amber-700">{Math.round(twoHour * 100)}%</span> {t('persist.dryLo', { p: Math.round(twoHour * 100) })}</>}
              </>
            ) : t('common.building')}
          </p>
        </div>
        <div className="rounded-lg bg-sky-50 p-2.5">
          <p className="text-[11px] leading-relaxed text-sky-900">
            <span className="font-semibold">{t('persist.wetLead')}</span>
            {stopProb !== null ? (
              <><span className="text-base font-bold text-sky-700">{stopProb}%</span> {stopProb >= 60
                ? t('persist.wetHi', { p: stopProb })
                : stopProb >= 40
                  ? t('persist.wetMid', { p: stopProb })
                  : t('persist.wetLo', { p: stopProb })}{t('persist.wetTail', { m: data.month })}</>
            ) : t('common.building')}
          </p>
        </div>
      </div>
    </section>
  );
}
