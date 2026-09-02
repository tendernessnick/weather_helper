import { useEffect, useState } from 'react';
import { api } from '../api';
import type { BestResponse } from '../types';
import Icon from '../components/Icon';
import RainMap from '../components/RainMap';
import { districtName, useLang } from '../i18n';
import type { TKey } from '../i18n';

const ZONE_BG: Record<string, string> = {
  go: 'bg-[#E8F8ED]', edge: 'bg-[#FFF4E5]', no: 'bg-[#FFE5E5]',
};
const ZONE_TEXT: Record<string, string> = {
  go: 'text-[#1B7A3D]', edge: 'text-[#8A6100]', no: 'text-[#C0392B]',
};
const ZONE_KEY: Record<string, TKey> = { go: 'zone.go', edge: 'zone.edge', no: 'zone.no' };

export default function Best() {
  const { t, lang } = useLang();
  const [data, setData] = useState<BestResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.best(selected ?? undefined)
      .then(setData)
      .catch((err) => setError(String(err.message ?? err)));
  }, [selected]);

  if (error) return <div className="p-8 text-center text-sm text-[#FF3B30]">{error}</div>;
  if (!data) return <div className="p-8 text-center text-sm text-[#8E8E93]">{t('common.loading')}</div>;

  const chips = data.hours.slice(0, 18);
  const median = data.city_median_pop ?? 0;
  const betterHours = data.hours
    .filter((h) => h.city_median_pop + 15 < median)
    .slice(0, 3);

  return (
    <div className="pb-4">
      <RainMap />

      {/* hour selector */}
      <div className="px-4 pt-3">
        <p className="text-[12px] text-[#6D6D72]">{t('best.pick')}</p>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {chips.map((h) => {
            const hh = new Date(h.hour).getHours();
            const isSel = (selected ?? data.hour) === h.hour;
            const isNextDay = new Date(h.hour).getDate() !== new Date().getDate();
            return (
              <button
                key={h.hour}
                onClick={() => setSelected(h.hour)}
                className={`flex min-w-[52px] shrink-0 flex-col items-center rounded-[12px] px-2 py-1.5 text-[12px] font-semibold ${
                  isSel ? 'bg-[#007AFF] text-white' : 'bg-white text-[#3C3C43]'
                }`}
              >
                <span>{isNextDay ? t('best.tomorrow') : ''}{t('best.hour', { hh: hh.toString().padStart(2, '0') })}</span>
                <span className={`text-[10px] font-normal ${isSel ? 'text-white/80' : 'text-[#8E8E93]'}`}>
                  {t('best.city', { p: Math.round(h.city_median_pop) })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* city-level banner */}
      {median >= 50 && (
        <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#FF9500] text-white">
            <Icon name="drizzle" className="h-5 w-5" />
          </span>
          <p className="text-[12px] font-semibold leading-relaxed text-[#8A6100]">
            {t('best.wetBanner', { p: Math.round(median) })}
            {betterHours.length > 0 && (
              <>{t('best.wetBetter', { hours: betterHours.map((h) => t('best.hour', { hh: String(new Date(h.hour).getHours()) })).join('、') })}</>
            )}
          </p>
        </div>
      )}

      {/* ranking */}
      <ul className="mt-3 space-y-2 px-4">
        {data.courts.slice(0, 20).map((c, i) => (
          <li key={c.court_id}>
            <a href={`/courts/${c.court_id}`} className="ios-card flex items-center gap-3 p-3 active:bg-[#E5E5EA]">
              <span className="w-5 text-center text-[13px] font-bold text-[#8E8E93]">{i + 1}</span>
              <div className={`flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded-[10px] ${ZONE_BG[c.zone]}`}>
                <span className={`text-[15px] font-bold ${ZONE_TEXT[c.zone]}`}>{c.corrected_pop}%</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">
                  {lang === 'en' ? (c.name_en ?? c.name_sc) : lang === 'hant' ? (c.name_tc ?? c.name_sc) : c.name_sc}
                </div>
                <div className="truncate text-[11px] text-[#8E8E93]">
                  {districtName(c.district_tc, c.district_en ?? '', lang)} · {t('best.official', { p: c.pop, z: t(ZONE_KEY[c.zone]) })}
                </div>
              </div>
              <span className="shrink-0 text-black/25">
                <Icon name="chevron" className="h-4 w-4" strokeWidth={2.2} />
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-4 text-[10px] leading-relaxed text-[#8E8E93]">
        {t('best.footnote')}
      </p>
    </div>
  );
}
