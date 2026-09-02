import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CourtListItem } from '../types';
import { HK_LAND } from '../assets/hkGeo';
import Icon from './Icon';

// HK display bbox (covers all 54 courts plus margin)
const LAT0 = 22.14, LAT1 = 22.56, LON0 = 113.82, LON1 = 114.45;
const W = 340, H = Math.round(W * (LAT1 - LAT0) / (LON1 - LON0) * 0.82);
// one 0.02° grid cell in viewBox units (~10.8 x 8.9) — cells render at full footprint
const CELL_W = W / (LON1 - LON0) * 0.02;
const CELL_H = H / (LAT1 - LAT0) * 0.02;

interface MapStep { ending: string; cells: [number, number, number][] }
interface RainMapData { fetched_at: string; steps: MapStep[] }

const STEP_LABELS = ['+30分', '+1时', '+1.5时', '+2时'];

// Static place-name anchors; kept sparse so the data layer stays dominant.
const DISTRICT_LABELS: { name: string; lon: number; lat: number }[] = [
  { name: '深圳', lon: 114.06, lat: 22.53 },
  { name: '上水', lon: 114.13, lat: 22.49 },
  { name: '屯门', lon: 113.97, lat: 22.39 },
  { name: '沙田', lon: 114.19, lat: 22.385 },
  { name: '荃湾', lon: 114.11, lat: 22.36 },
  { name: '将军澳', lon: 114.258, lat: 22.315 },
  { name: '九龙', lon: 114.168, lat: 22.325 },
  { name: '港岛', lon: 114.152, lat: 22.268 },
  { name: '大屿山', lon: 113.938, lat: 22.25 },
];

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
  if (mm >= 5) return 'rgba(1,84,214,0.9)';
  if (mm >= 2) return 'rgba(2,132,199,0.7)';
  if (mm >= 0.5) return 'rgba(56,160,220,0.5)';
  return 'rgba(120,190,235,0.32)';
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-1.5 left-2 flex items-center gap-2 text-[9px] text-white/60">
      <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-[#34C759]" />球场无雨</span>
      <span className="flex items-center gap-0.5"><span className="inline-block h-2 w-2 rounded-[2px] bg-[#FF5A5F]" />球场有雨</span>
      <span className="flex items-center gap-0.5">
        {[0.1, 0.5, 2, 5].map((mm) => (
          <span key={mm} className="inline-block h-2 w-2.5 rounded-[2px]" style={{ background: cellColor(mm) }} />
        ))}
        雨(半小时mm)
      </span>
    </div>
  );
}

function MapSvg({ step, courts, me }: { step?: MapStep; courts: CourtListItem[]; me: { lat: number; lon: number } | null }) {
  const landPath = useMemo(() => HK_LAND.map((ring) =>
    'M' + ring.map(([lon, lat]) => {
      const [x, y] = project(lat, lon);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join('L') + 'Z',
  ).join(' '), []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      {/* land mass under everything */}
      <path d={landPath} fill="#16283C" stroke="#2C4A6A" strokeWidth="0.7" strokeLinejoin="round" />
      {/* wet cells at full footprint so they read as a continuous radar field */}
      {step?.cells.map(([lat, lon, mm]) => {
        const [x, y] = project(lat, lon);
        if (x < -CELL_W || x > W + CELL_W || y < -CELL_H || y > H + CELL_H) return null;
        return <rect key={`${lat},${lon}`} x={x - CELL_W / 2} y={y - CELL_H / 2}
                     width={CELL_W} height={CELL_H} fill={cellColor(mm)} />;
      })}
      {/* place-name anchors under the data dots */}
      {DISTRICT_LABELS.map((d) => {
        const [x, y] = project(d.lat, d.lon);
        return <text key={d.name} x={x} y={y} textAnchor="middle" fontSize="6.5"
                     fill="rgba(255,255,255,0.38)" style={{ pointerEvents: 'none' }}>{d.name}</text>;
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
  );
}

export default function RainMap() {
  const [map, setMap] = useState<RainMapData | null>(null);
  const [courts, setCourts] = useState<CourtListItem[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [full, setFull] = useState(false);

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

  // fullscreen sheet: lock page scroll, close on Esc
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [full]);

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
  const updatedLabel = updatedAgo !== null ? `${updatedAgo} 分钟前更新 · 每 12 分钟` : '加载中';

  const stepChips = (map?.steps ?? []).map((_, i) => (
    <button key={i} onClick={() => setStepIdx(i)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              i === stepIdx ? 'bg-[#007AFF] text-white' : 'bg-[#F2F2F7] text-[#3C3C43]'
            }`}>
      {STEP_LABELS[i] ?? `+${(i + 1) * 30}分`}
    </button>
  ));

  const nearestNote = me && nearest && (
    <p className="rounded-[10px] bg-[#F2F2F7] p-2 text-[11px] font-medium leading-relaxed text-[#3C3C43]">
      💡 离你最近的雨团在<span className="font-bold">{compassOf(me.lat, me.lon, nearest.lat, nearest.lon)}方向约 {nearest.km.toFixed(0)} 公里</span>
      {nearest.km < 8 ? '——就在附近，出门前盯紧临近预报' : nearest.km < 20 ? '——还有段距离，留意移向' : '——暂时威胁不大'}
    </p>
  );

  return (
    <section className="ios-card mx-4 mt-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">雨团现在在哪</h2>
        <span className="text-[10px] text-[#8E8E93]">{updatedLabel}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-[#6D6D72]">这一条回答：雨离我多远、往哪边走</p>

      {step && (
        <button type="button" onClick={() => setFull(true)} aria-label="放大雨团地图"
                className="relative mt-2 block w-full cursor-pointer overflow-hidden rounded-[12px] bg-[#0F2033] text-left active:opacity-90"
                style={{ height: H }}>
          <MapSvg step={step} courts={courts} me={me} />
          <Legend />
          <span className="absolute right-1.5 top-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-semibold text-white/80">
            ⤢ 全屏
          </span>
        </button>
      )}

      {/* step switcher + locate */}
      <div className="mt-2 flex items-center gap-1.5">
        {stepChips}
        <button onClick={locate} disabled={locating}
                className="ml-auto flex items-center gap-1 rounded-full bg-[#F2F2F7] px-2.5 py-1 text-[11px] font-semibold text-[#007AFF]">
          <Icon name="pin" className="h-3 w-3" />
          {locating ? '定位中…' : me ? '已定位' : '看雨离我多远'}
        </button>
      </div>

      {nearestNote}

      <p className="mt-1.5 text-[9px] leading-relaxed text-[#8E8E93]">
        由本站每 12 分钟抓取的天文台全港降雨临近预报网格自绘；蓝格越深雨越大（浅蓝≈0.1、深蓝≥5 毫米/半小时）。
        点"看雨离我多远"需要在手机上允许定位；点地图可全屏。
      </p>

      {/* full-screen sheet */}
      {full && step && (
        <div className="sheet-up fixed inset-0 z-50 flex flex-col bg-[#F2F2F7]">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[17px] font-bold tracking-tight">雨团现在在哪</h2>
              <p className="text-[10px] text-[#8E8E93]">{updatedLabel}</p>
            </div>
            <button onClick={() => setFull(false)} aria-label="关闭全屏"
                    className="rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-[#007AFF] shadow-sm active:opacity-80">
              ✕ 完成
            </button>
          </div>
          <div className="min-h-0 flex-1 px-3">
            <div className="relative h-full overflow-hidden rounded-[16px] bg-[#0F2033]">
              <MapSvg step={step} courts={courts} me={me} />
              <Legend />
            </div>
          </div>
          <div className="space-y-2 px-4 pb-6 pt-3">
            {stepChips}
            {nearestNote}
            <div className="flex items-center gap-2">
              <button onClick={locate} disabled={locating}
                      className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-[#007AFF] shadow-sm">
                <Icon name="pin" className="h-3.5 w-3.5" />
                {locating ? '定位中…' : me ? '已定位' : '看雨离我多远'}
              </button>
              <p className="text-[9px] leading-snug text-[#8E8E93]">蓝格越深雨越大（浅蓝≈0.1、深蓝≥5 毫米/半小时）</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
