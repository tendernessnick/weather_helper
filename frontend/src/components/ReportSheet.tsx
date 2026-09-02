import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import Icon from './Icon';
import RecentReports from './RecentReports';
import type { Court } from '../types';

const INTENSITIES = [
  { key: 'none', label: '没下雨', icon: 'sun' },
  { key: 'light', label: '小雨', icon: 'drizzle' },
  { key: 'moderate', label: '中雨', icon: 'rain' },
  { key: 'heavy', label: '大雨', icon: 'storm' },
] as const;

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('设备不支持定位'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    });
  });
}

function fmtCountdown(sec: number): string {
  if (sec <= 0) return '';
  const m = Math.ceil(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分钟` : `${m} 分钟`;
}

export default function ReportSheet({ court }: { court: Court }) {
  const [status, setStatus] = useState<{ cooldown_remaining_sec: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'ok' | 'err'>('ok');

  const refreshStatus = () => {
    api.reportStatus(court.id)
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [court.id]);

  const cooldown = status?.cooldown_remaining_sec ?? 0;

  const submit = async (intensity: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const pos = await getPosition();
      const result = await api.submitReport({
        court_id: court.id,
        intensity,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
      });
      setMessage(`上报成功，谢谢！${fmtCountdown(result.cooldown_remaining_sec)}内无需重复上报。`);
      setMessageTone('ok');
      setOpen(false);
      refreshStatus();
    } catch (err) {
      if (err instanceof ApiError) {
        setMessage(err.message);
      } else if (err instanceof GeolocationPositionError) {
        setMessage('定位失败：请允许定位权限，并在空旷处重试。');
      } else {
        setMessage(String((err as Error).message ?? err));
      }
      setMessageTone('err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">我就在这个球场</h2>
          <p className="mt-0.5 text-[10px] leading-relaxed text-emerald-700">
            只有在球场 500 米内才能上报；每次上报间隔 2 小时。
            {cooldown > 0 && (
              <span className="ml-1 font-medium">
                （冷却中，剩余 {fmtCountdown(cooldown)}）
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={cooldown > 0}
          className="shrink-0 rounded-full bg-[#34C759] px-3.5 py-2 text-[13px] font-semibold text-white disabled:bg-black/20"
        >
          {cooldown > 0 ? '冷却中' : '上报实况'}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {INTENSITIES.map((item) => (
            <button
              key={item.key}
              onClick={() => submit(item.key)}
              disabled={busy}
              className="flex flex-col items-center rounded-[12px] bg-[#F2F2F7] px-1 py-2.5 text-[11px] active:bg-[#E5F1FB] disabled:opacity-50"
            >
              <Icon name={item.icon} className="h-5 w-5" strokeWidth={1.6} />
              {item.label}
            </button>
          ))}
        </div>
      )}

      <RecentReports courtId={court.id} />

      {message && (
        <p className={`mt-2 text-xs ${messageTone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
          {message}
        </p>
      )}
    </section>
  );
}
