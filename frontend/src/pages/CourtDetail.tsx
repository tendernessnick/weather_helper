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

  if (worst === 'go') {
    return (
      <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
        <span className="text-xl" aria-hidden>🎾</span>
        <p className="text-xs font-semibold leading-relaxed text-emerald-800">
          未来 {hours.length} 小时没有下雨风险，放心安排
        </p>
      </div>
    );
  }
  if (worst === 'edge') {
    return (
      <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3">
        <span className="text-xl" aria-hidden>🤔</span>
        <p className="text-xs font-semibold leading-relaxed text-amber-800">
          整体可以安排；{hhmm} 前后概率略高（{pop}%），属边缘时段，带把伞赌一把
        </p>
      </div>
    );
  }
  return (
    <div className="mx-4 mt-3 flex items-center gap-2.5 rounded-xl border border-rose-300 bg-rose-50 p-3">
      <span className="text-xl" aria-hidden>🌧️</span>
      <p className="text-xs font-semibold leading-relaxed text-rose-800">
        {hhmm} 前后有较高下雨风险（{pop}%），建议改期或换个时段
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
    return <div className="p-8 text-center text-sm text-slate-500">球场不存在，<a href="/" className="text-sky-700 underline">返回列表</a></div>;
  }
  if (error) {
    return <div className="p-8 text-center text-sm text-rose-600">{error}</div>;
  }
  if (!court || !weather) {
    return <div className="p-8 text-center text-sm text-slate-400">加载中…</div>;
  }

  const temp = weather.current?.temperature?.data
    ?.find((t) => t.place === 'Hong Kong Observatory')?.value;
  const humidity = weather.current?.humidity?.data?.[0]?.value;
  const microclimate = calibration?.divergence?.microclimate;

  return (
    <div>
      <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-bold">{court.name_sc}</h1>
        <p className="text-xs text-slate-500">{court.name_tc} · {court.name_en}</p>
        <p className="mt-2 text-xs text-slate-600">
          📍 {court.district_tc} · {court.address_tc || court.address_en}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          🎾 {court.court_no || '—'} · 🕐 {court.opening_hours || '—'}
          {court.phone && <> · ☎️ {court.phone}</>}
        </p>
        {(temp !== undefined || humidity !== undefined) && (
          <p className="mt-2 text-xs text-slate-500">
            当前市区 {temp ?? '—'}°C · 湿度 {humidity ?? '—'}%
          </p>
        )}
      </section>

      {weather.warnings.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-800">⚠️ 生效警告</p>
          <ul className="mt-1 list-inside list-disc text-[11px] text-amber-800">
            {weather.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      <VerdictBanner weather={weather} />

      {microclimate && (
        <div className="mx-4 mt-3 rounded-xl border border-violet-300 bg-violet-50 p-3">
          <p className="text-xs font-bold text-violet-800">🌦️ 微气候球场</p>
          <p className="mt-1 text-[11px] leading-relaxed text-violet-800">
            到场球友与最近天文台测站的观测多次分歧（球友看到雨、测站没记录）。
            本球场请更依赖上方临近预报与球友上报，测站口径的评分仅供参考。
          </p>
        </div>
      )}

      <NowcastStrip steps={weather.nowcast.steps} fetchedAt={weather.nowcast.fetched_at} />
      <HourlyBars
        hourly={weather.hourly}
        calibrationN={weather.calibration?.basis_n}
      />
      {calibration && calibration.basis && (() => {
        const deltas = calibration.mapping
          .map((m) => (m.official_pct - m.corrected * 100) / 100)
          .filter((d) => Number.isFinite(d));
        const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
        const interpretation = Math.abs(avgDelta) < 0.05
          ? '目前预报数字与实际接近，直接看官方概率即可'
          : avgDelta > 0
            ? `预报普遍虚高约 ${Math.round(avgDelta * 100)} 个百分点：说 ${Math.round(avgDelta * 100) + 40}% 时实际约 40%，以黑点为准`
            : `预报普遍保守约 ${Math.round(-avgDelta * 100)} 个百分点：实际比预报说的更容易下雨，留点余量`;
        return (
          <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold">预报数字准不准？</h2>
            <p className="mt-1 rounded-lg bg-slate-50 p-2 text-[11px] font-medium leading-relaxed text-slate-700">
              💡 {interpretation}
            </p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
              依据近 30 天「官方预报 vs 实际下雨」对照（{calibration.basis === 'court' ? '本球场专属口径' : '全港合并口径，本球场样本积累中'}，
              n={calibration.n}）。下表左边是预报说的，右边是实际发生的：
            </p>
            <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10px]">
              {calibration.mapping.map((m) => (
                <div key={m.official_pct} className="rounded bg-slate-50 py-1.5">
                  <div className="text-slate-400">预报{m.official_pct}%</div>
                  <div className="text-sm font-bold text-slate-700">
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
