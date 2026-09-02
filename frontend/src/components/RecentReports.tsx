import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RecentReport } from '../types';
import Icon from './Icon';

const INTENSITY_LABEL: Record<string, string> = {
  none: '没下雨', light: '小雨', moderate: '中雨', heavy: '大雨',
};
const INTENSITY_ICON: Record<string, string> = {
  none: 'sun', light: 'drizzle', moderate: 'rain', heavy: 'storm',
};

function timeAgo(iso: string): string {
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} 分钟前`;
  return `${Math.floor(min / 60)} 小时前`;
}

export default function RecentReports({ courtId }: { courtId: string }) {
  const [reports, setReports] = useState<RecentReport[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.recentReports(courtId)
      .then((r) => { if (!cancelled) setReports(r.reports); })
      .catch(() => { if (!cancelled) setReports([]); });
    load();
    const id = setInterval(load, 120_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [courtId]);

  if (reports === null) return null;
  if (reports.length === 0) {
    return (
      <p className="mt-2 text-[11px] leading-relaxed text-[#8E8E93]">
        <Icon name="people" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
        近 3 小时没有球友上报——到场上报一次，帮大家看清实况
      </p>
    );
  }

  return (
    <div className="mt-2.5 border-t border-black/5 pt-2.5">
      <p className="text-[11px] font-semibold text-[#3C3C43]">
        <Icon name="people" className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-[#8E8E93]" />
        球友最近上报
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {reports.slice(0, 4).map((r) => (
          <li key={r.reported_at} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            r.was_raining ? 'bg-[#E5F1FB] text-[#0071E3]' : 'bg-[#E8F8ED] text-[#1B7A3D]'
          }`}>
            <Icon name={INTENSITY_ICON[r.intensity] ?? 'sun'} className="h-3 w-3" />
            {timeAgo(r.reported_at)} · {INTENSITY_LABEL[r.intensity] ?? r.intensity}
          </li>
        ))}
      </ul>
    </div>
  );
}
