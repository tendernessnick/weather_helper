import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CourtListItem } from '../types';
import Icon from './Icon';

// HK display bbox (covers all 54 courts plus margin)
const LAT0 = 22.14, LAT1 = 22.56, LON0 = 113.82, LON1 = 114.45;
const W = 340, H = Math.round(W * (LAT1 - LAT0) / (LON1 - LON0) * 0.82);

interface MapStep { ending: string; cells: [number, number, number][] }
interface RainMapData { fetched_at: string; steps: MapStep[] }

const STEP_LABELS = ['+30分', '+1时', '+1.5时', '+2时'];

function project(lat: number, lon: number): [number, number] {
  return [(lon - LON0) / (LON1 - LON0) * W, (LAT1 - lat) / (LAT1 - LAT0) * H];
}

function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, d = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * d / 2) ** 2
    + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin((lon2 - lon1) * d / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function compassOf(latFrom: number, lonFrom: number, latTo: number, lonTo: number): string {
  const dy = latTo - latFrom, dx = lonTo - lonFrom;
  if (Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004) return '头顶';
  const ang = Math.atan2(dx, dy) * 180 / Math.PI; // 0=N, 90=E
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(((ang + 360) % 360) / 45) % 8];
}

function cellColor(mm: number): string {
  if (mm >= 5) return 'rgba(2,100,220,0.85)';
  if (mm >= 2) return 'rgba(2,132,199,0.65)';
  if (mm >= 0.5) return 'rgba(56,160,220,0.45)';
  return 'rgba(120,190,235,0.3)';
}

export default function RainMap() {
  const [map, setMap] = useState<RainMapData | null>(null);
  const [courts, setCourts] = useState<CourtListItem[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const load = () => Promise.all([
    fetch('/api/map/rain').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    api.courts('', ''),
  ]).then(([m, c]) => {
    if (m) setMap(m);
    setCourts(c.courts);
  }).catch(() => {});

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  const step = map?.steps?.[stepIdx];
  const nearest = useMemo(() => {
    if (!me || !step || step.cells.length === 0) return null;
    let best = { km: Infinity, lat: 0, lon: 0 };
    for (const [lat, lon] of step.cells) {
      const km = kmBetween(me.lat, me.lon, lat, lon);
      if (km < best.km) best = { km, lat, lon };
    }
    return best.km === Infinity ? null : best;
  }, [me, step]);

  const locate = () => {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setMe({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const updatedAgo = map
    ? Math.max(0, Math.round((Date.now() - new Date(map.fetched_at).getTime()) / 60000))
    : null;

  return (
    <section className="ios-card mx-4 mt-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">雨团现在在哪</h2>
        <span className="text-[10px] text-[#8E8E93]">
          {updatedAgo !== null ? `${updatedAgo} 分钟前更新 · 每 12 分钟` : '加载中'}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-[#6D6D72]">这一条回答：雨离我多远、往哪边走</p>

      {step && (
        <div className="relative mt-2 overflow-hidden rounded-[12px] bg-[#0F2033]" style={{ height: H }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
            {/* subtle lat/lon grid */}
            {[1, 2, 3, 4].map((i) => (
              <line key={`v${i}`} x1={W * i / 5} y1={0} x2={W * i / 5} y2={H}
                    stroke="#1E3A55" strokeWidth="0.6" />
            ))}
            {[1, 2, 3, 4].map((i) => (
              <line key={`h${i}`} x1={0} y1={H * i / 5} x2={W} y2={H * i / 5}
                    stroke="#1E3A55" strokeWidth="0.6" />
            ))}
            {/* wet cells */}
            {step.cells.map(([lat, lon, mm]) => {
              const [x, y] = project(lat, lon);
              if (x < 0 || x > W || y < 0 || y > H) return null;
              return <rect key={`${lat},${lon}`} x={x - 3} y={y - 3} width="6" height="6"
                           rx="1" fill={cellColor(mm)} />;
            })}
            {/* courts */}
            {courts.map((c) => {
              const [x, y] = project(c.lat, c.lon);
              if (x < 0 || x > W || y < 0 || y > H) return null;
              const wet = c.nowcast?.rain;
              return <circle key={c.id} cx={x} cy={y} r="2.2"
                             fill={wet ? '#FF5A5F' : '#34C759'} fillOpacity="0.9"
                             stroke="#fff" strokeWidth="0.6" />;
            })}
            {/* user */}
            {me && (() => {
              const [x, y] = project(me.lat, me.lon);
              return (
                <g>
                  <circle cx={x} cy={y} r="4" fill="none" stroke="#FFD60A" strokeWidth="1.2" />
                  <circle cx={x} cy={y} r="1.6" fill="#FFD60A" />
                </g>
              );
            })()}
          </svg>
          <div className="absolute bottom-1.5 left-2 flex items-center gap-2 text-[9px] text-white/60">
            <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-[#34C759]" />球场无雨</span>
            <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-[#FF5A5F]" />球场有雨</span>
            <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-[#38A0DC]" />雨团</span>
          </div>
        </div>
      )}

      {/* step switcher + locate */}
      <div className="mt-2 flex items-center gap-1.5">
        {(map?.steps ?? []).map((_, i) => (
          <button key={i} onClick={() => setStepIdx(i)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    i === stepIdx ? 'bg-[#007AFF] text-white' : 'bg-[#F2F2F7] text-[#3C3C43]'
                  }`}>
            {STEP_LABELS[i] ?? `+${(i + 1) * 30}分`}
          </button>
        ))}
        <button onClick={locate} disabled={locating}
                className="ml-auto flex items-center gap-1 rounded-full bg-[#F2F2F7] px-2.5 py-1 text-[11px] font-semibold text-[#007AFF]">
          <Icon name="pin" className="h-3 w-3" />
          {locating ? '定位中…' : me ? '已定位' : '看雨离我多远'}
        </button>
      </div>

      {me && nearest && (
        <p className="mt-2 rounded-[10px] bg-[#F2F2F7] p-2 text-[11px] font-medium leading-relaxed text-[#3C3C43]">
          💡 离你最近的雨团在<span className="font-bold">{compassOf(me.lat, me.lon, nearest.lat, nearest.lon)}方向约 {nearest.km.toFixed(0)} 公里</span>
          {nearest.km < 8 ? '——就在附近，出门前盯紧临近预报' : nearest.km < 20 ? '——还有段距离，留意移向' : '——暂时威胁不大'}
        </p>
      )}
      <p className="mt-1.5 text-[9px] leading-relaxed text-[#8E8E93]">
        由本站每 12 分钟抓取的天文台全港降雨临近预报网格自绘；蓝格越深雨越大。点"看雨离我多远"需要在手机上允许定位。
      </p>
    </section>
  );
}
