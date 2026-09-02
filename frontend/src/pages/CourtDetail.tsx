import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { Court, CourtScores, WeatherResponse } from '../types';
import NowcastStrip from '../components/NowcastStrip';
import HourlyBars from '../components/HourlyBars';
import ScoreCard from '../components/ScoreCard';
import ReportSheet from '../components/ReportSheet';
import SubscribeBox from '../components/SubscribeBox';

export default function CourtDetail() {
  const { id } = useParams<{ id: string }>();
  const [court, setCourt] = useState<Court | null>(null);
  const [scores, setScores] = useState<CourtScores | null>(null);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setError(null);
    Promise.all([
      fetch(`/api/courts/${id}`).then((r) => r.json()),
      api.courtWeather(id),
    ])
      .then(([courtData, weatherData]) => {
        setCourt(courtData);
        setScores(courtData.scores);
        setWeather(weatherData);
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

      <NowcastStrip steps={weather.nowcast.steps} fetchedAt={weather.nowcast.fetched_at} />
      <HourlyBars hourly={weather.hourly} />
      {scores && <ScoreCard scores={scores} />}
      <ReportSheet court={court} />
      <SubscribeBox court={court} />
    </div>
  );
}
