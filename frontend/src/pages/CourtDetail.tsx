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

export default function CourtDetail() {
  const { id } = useParams<{ id: string }>();
  const [court, setCourt] = useState<Court | null>(null);
  const [scores, setScores] = useState<CourtScores | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [calibration, setCalibration] = useState<CalibrationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setError(null);
    Promise.all([
      fetch(`/api/courts/${id}`).then((r) => r.json()),
      api.courtWeather(id),
      api.courtCalibration(id).catch(() => null),
    ])
      .then(([courtData, weatherData, calib]) => {
        setCourt(courtData);
        setScores(courtData.scores);
        setWeather(weatherData);
        setCalibration(calib);
      })
      .catch((err) => setError(String(err.message ?? err)));
  }, [id]);

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
      {calibration && calibration.basis && (
        <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold">概率校准（预报数字 → 实测口径）</h2>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            用近 30 天「官方预报 vs 实际下雨」的对照把预报概率换算成真实频率
            （{calibration.basis === 'court' ? '本球场专属口径' : '全港池化口径（本球场样本积累中）'}，
            n={calibration.n}）。黑点即采用此换算。
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
      )}
      {weather.persistence && <PersistenceCard data={weather.persistence} />}
      {scores && <ScoreCard scores={scores} />}
      <ReportSheet court={court} />
      <SubscribeBox court={court} />
    </div>
  );
}
