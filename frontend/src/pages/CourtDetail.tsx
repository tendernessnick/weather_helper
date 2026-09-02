import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { CalibrationInfo, Court, CourtScores, WeatherResponse } from '../types';
import NowcastStrip from '../components/NowcastStrip';
import HourlyBars from '../components/HourlyBars';
import ScoreCard from '../components/ScoreCard';
import ReportSheet from '../components/ReportSheet';
import SubscribeBox from '../components/SubscribeBox';
import PersistenceCard from '../components/PersistenceCard';
import Icon from '../components/Icon';

/** Plain-language verdict for the next few hours, computed from zones. */
function VerdictBanner({ weather }: { weather: WeatherResponse }) {
  const hours = weather.hourly.slice(0, 6);
  if (hours.length === 0) return null;

  const worst = hours.reduce<string>((acc, h) => {
    const z = h.zone ?? 'go';
    if (z === 'no' || acc === 'no') return 'no';
    if (z === 'edge' || acc === 'edge') return 'edge';
    return 'go';
  }, 'go');
  const worstHour = hours.find((h) => (h.zone ?? 'go') === worst);
  const hhmm = worstHour ? new Date(worstHour.hour).getHours().toString().padStart(2, '0') + ':00' : '';
  const pop = worstHour ? (worstHour.corrected_pop ?? worstHour.pop) : 0;

  const look = {
    go: { tile: 'bg-[#34C759]', icon: 'ball' as const, text: 'text-[#1B7A3D]' },
    edge: { tile: 'bg-[#FF9500]', icon: 'drizzle' as const, text: 'text-[#8A6100]' },
    no: { tile: 'bg-[#FF3B30]', icon: 'storm' as const, text: 'text-[#B3261E]' },
  }[worst] ?? {
    tile: 'bg-[#34C759]', icon: 'ball' as const, text: 'text-[#1B7A3D]',
  };

  const sentence = worst === 'go'
    ? <>未来 {hours.length} 小时没有下雨风险，放心安排</>
    : worst === 'edge'
      ? <>整体可以安排；{hhmm} 前后概率略高（{pop}%），属边缘时段，带把伞赌一把</>
      : <>{hhmm} 前后有较高下雨风险（{pop}%），建议改期或换个时段</>;

  return (
    <div className="mx-4 mt-4 flex items-center gap-3 rounded-[16px] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white ${look.tile}`}>
        <Icon name={look.icon} className="h-5 w-5" />
      </span>
      <p className={`text-[13px] font-semibold leading-relaxed ${look.text}`}>
        {sentence}
      </p>
    </div>
  );
}

export default function CourtDetail() {
  const { id } = useParams<{ id: string }>();
  const [court, setCourt] = useState<Court | null>(null);
  const [scores, setScores] = useState<CourtScores | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [calibration, setCalibration] = useState<CalibrationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError(null);
    setNotFound(false);
    Promise.all([
      fetch(`/api/courts/${id}`).then((r) => {
        if (!r.ok) throw new Error('球场不存在');
        return r.json();
      }),
      api.courtWeather(id),
      api.courtCalibration(id).catch(() => null),
    ])
      .then(([courtData, weatherData, calib]) => {
        setCourt(courtData);
        setScores(courtData.scores);
        setWeather(weatherData);
        setCalibration(calib);
      })
      .catch((err) => {
        if (String(err.message) === '球场不存在') setNotFound(true);
        else setError(String(err.message ?? err));
      });
  }, [id]);

  if (notFound) {
    return <div className="p-8 text-center text-sm text-slate-500">球场不存在，<a href="/" className="text-[#007AFF] underline">返回列表</a></div>;
  }
  if (error) {
    return <div className="p-8 text-center text-sm text-[#FF3B30]">{error}</div>;
  }
  if (!court || !weather) {
    return <div className="p-8 text-center text-sm text-[#8E8E93]">加载中…</div>;
  }

  const temp = weather.current?.temperature?.data
    ?.find((t) => t.place === 'Hong Kong Observatory')?.value;
  const humidity = weather.current?.humidity?.data?.[0]?.value;
  const microclimate = calibration?.divergence?.microclimate;

  return (
    <div>
      <section className="ios-card mx-4 mt-4 p-4">
        <h1 className="text-[21px] font-bold tracking-tight">{court.name_sc}</h1>
        <p className="mt-0.5 text-[12px] text-[#8E8E93]">{court.name_tc} · {court.name_en}</p>
        <div className="mt-3 space-y-1.5 text-[12px] text-[#3C3C43]/90">
          <p className="flex items-start gap-1.5">
            <Icon name="pin" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
            <span>{court.district_tc} · {court.address_tc || court.address_en}</span>
          </p>
          <p className="flex items-start gap-1.5">
            <Icon name="ball" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
            <span>{court.court_no || '—'}</span>
          </p>
          <p className="flex items-start gap-1.5">
            <Icon name="clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
            <span>{court.opening_hours || '—'}</span>
          </p>
          {court.phone && (
            <p className="flex items-center gap-1.5">
              <Icon name="phone" className="h-3.5 w-3.5 shrink-0 text-[#8E8E93]" />
              <span>{court.phone}</span>
            </p>
          )}
        </div>
        {(temp !== undefined || humidity !== undefined) && (
          <p className="mt-3 border-t border-black/5 pt-2.5 text-[12px] text-[#6D6D72]">
            当前市区 {temp ?? '—'}°C · 湿度 {humidity ?? '—'}%
          </p>
        )}
      </section>

      {weather.warnings.length > 0 && (
        <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#FF9500] text-white">
            <Icon name="warn" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[12px] font-bold text-[#8A6100]">天文台生效警告</p>
            <ul className="mt-0.5 list-inside list-disc text-[11px] leading-relaxed text-[#8A6100]/90">
              {weather.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      <VerdictBanner weather={weather} />

      {microclimate && (
        <div className="ios-card mx-4 mt-3 flex gap-3 p-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#AF52DE] text-white">
            <Icon name="people" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[12px] font-bold text-[#6929A8]">微气候球场</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#6929A8]/90">
              到场球友与最近天文台测站的观测多次分歧。本球场请更依赖临近预报与球友上报，
              测站口径的评分仅供参考。
            </p>
          </div>
        </div>
      )}

      <NowcastStrip steps={weather.nowcast.steps} fetchedAt={weather.nowcast.fetched_at} />
      <HourlyBars hourly={weather.hourly} />
      {calibration && calibration.basis && (() => {
        const deltas = calibration.mapping
          .map((m) => (m.official_pct - m.corrected * 100) / 100)
          .filter((d) => Number.isFinite(d));
        const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
        const interpretation = Math.abs(avgDelta) < 0.05
          ? '目前预报数字与实际接近，直接看官方概率即可'
          : avgDelta > 0
            ? `预报普遍虚高约 ${Math.round(avgDelta * 100)} 个百分点：说 ${Math.round(avgDelta * 100) + 40}% 时实际约 40%，以校正后的黑点为准`
            : `预报普遍保守约 ${Math.round(-avgDelta * 100)} 个百分点：实际比预报说的更容易下雨，留点余量`;
        return (
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">预报数字准不准？</h2>
            <p className="mt-1.5 rounded-[10px] bg-[#F2F2F7] p-2.5 text-[12px] font-medium leading-relaxed text-[#3C3C43]">
              💡 {interpretation}
            </p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-[#8E8E93]">
              依据近 30 天「官方预报 vs 实际下雨」对照（{calibration.basis === 'court' ? '本球场专属口径' : '全港合并口径，本球场样本积累中'}，
              n={calibration.n}）。下表左边是预报说的，右边是实际发生的：
            </p>
            <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px]">
              {calibration.mapping.map((m) => (
                <div key={m.official_pct} className="rounded-[8px] bg-[#F2F2F7] py-1.5">
                  <div className="text-[#8E8E93]">预报{m.official_pct}%</div>
                  <div className="text-sm font-bold text-slate-800">
                    实际{Math.round(m.corrected * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
      {weather.persistence && <PersistenceCard data={weather.persistence} />}
      {scores && <ScoreCard scores={scores} />}
      <ReportSheet court={court} />
      <SubscribeBox court={court} />
    </div>
  );
}
