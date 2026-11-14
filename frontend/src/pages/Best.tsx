import { useEffect, useState } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';
import RequestError from '../components/RequestError';
import FavoriteButton from '../components/FavoriteButton';
import { hkDateKey, hkHour, hkFormat, hkTimestamp } from '../utils/hkTime';
import { useWeatherClock } from '../hooks/useWeatherClock';
import { sourceIsFresh } from '../utils/playWindow';
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
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const now = useWeatherClock();
  const text = (a: string, b: string, c: string) => lang === 'en' ? c : lang === 'hant' ? b : a;

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setLoading(true);
    api.best(selected ?? undefined, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setData(next); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected, retry]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRetry((n) => n + 1); };
    const timer = window.setInterval(refresh, 5 * 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  if (!data && error) return <RequestError onRetry={() => setRetry((n) => n + 1)} />;
  if (!data) return <div role="status" className="p-8 text-center text-sm text-slate-600">{t('common.loading')}</div>;

  const chips = data.hours.slice(0, 18);
  const usable = sourceIsFresh(data.data_status, now) && hkTimestamp(data.hour) >= now && navigator.onLine;
  const median = data.city_median_pop;
  const betterHours = data.hours
    .filter((h) => median !== null && h.city_median_pop + 15 < median)
    .slice(0, 3);

  return (
    <div className="pb-4">
      <div className="px-4 pb-1 pt-5">
        <h1 className="text-2xl font-bold">{text('换个球场，或换个时间', '換個球場，或換個時間', 'A better court. A better time.')}</h1>
        <p className="mt-1 text-sm text-slate-600">{text('先选香港时间，再比较有新鲜预报的球场。', '先選香港時間，再比較有新鮮預報的球場。', 'Choose a Hong Kong time, then compare courts with fresh forecasts.')}</p>
      </div>
      <RainMap />

      {/* hour selector */}
      <div className="px-4 pt-3">
        <p className="text-[12px] text-[#6D6D72]">{t('best.pick')}</p>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {chips.map((h) => {
            const hh = hkHour(h.hour);
            const isSel = hkTimestamp(selected ?? data.hour) === hkTimestamp(h.hour);
            const isNextDay = hkDateKey(h.hour) !== hkDateKey();
            return (
              <button
                key={h.hour}
                aria-pressed={isSel}
                onClick={() => setSelected(h.hour)}
                className={`flex min-h-14 min-w-[64px] shrink-0 flex-col items-center rounded-[12px] px-2 py-1.5 text-[12px] font-semibold ${
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
      {!loading && !error && usable && median !== null && median >= 50 && (
        <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#FF9500] text-white">
            <Icon name="drizzle" className="h-5 w-5" />
          </span>
          <p className="text-[12px] font-semibold leading-relaxed text-[#8A6100]">
            {t('best.wetBanner', { p: Math.round(median) })}
            {betterHours.length > 0 && (
              <>{t('best.wetBetter', { hours: betterHours.map((h) => t('best.hour', { hh: String(hkHour(h.hour)) })).join('、') })}</>
            )}
          </p>
        </div>
      )}

      <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <p role="status">{loading ? t('common.loading') : `${hkFormat(data.hour, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} HKT · ${usable ? data.available_courts ?? data.courts.length : 0}/${data.total_courts ?? '—'} ${text('球场有可用预报', '球場有可用預報', 'courts with forecasts')}`}</p>
        <button disabled={loading} onClick={() => setRetry((n) => n + 1)} className="min-h-11 px-3 font-semibold text-blue-800 disabled:opacity-50">{text('刷新', '重新整理', 'Refresh')}</button>
      </div>
      {error && <RequestError onRetry={() => setRetry((n) => n + 1)} />}
      {!loading && !error && (!usable || data.courts.length === 0) && <div role="status" className="ios-card mx-4 mt-3 p-5 text-sm text-slate-700">{text('这个时段暂无新鲜预报，无法推荐球场。请选择其他时段或稍后刷新；缺数据不代表无雨。', '這個時段暫無新鮮預報，無法推薦球場。請選其他時段或稍後重新整理；缺資料不代表無雨。', 'No fresh forecasts for this time. Choose another time or refresh later. Missing data does not mean dry weather.')}</div>}
      {/* Hide the previous hour's ranking while another selection loads. */}
      <ul aria-busy={loading} className="mt-3 space-y-2 px-4">
        {!loading && !error && usable && data.courts.slice(0, 20).map((c, i) => (
          <li key={c.court_id} className="ios-card flex items-center pr-2">
            <Link to={`/courts/${c.court_id}?start=${encodeURIComponent(data.hour)}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-[20px] p-3 active:bg-[#E5E5EA]">
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
            </Link>
            <FavoriteButton courtId={c.court_id} />
          </li>
        ))}
      </ul>
      <p className="mt-2 px-4 text-[10px] leading-relaxed text-[#8E8E93]">
        {t('best.footnote')}
      </p>
    </div>
  );
}
