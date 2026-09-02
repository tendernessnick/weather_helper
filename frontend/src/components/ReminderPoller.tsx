import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Reminder } from '../types';

interface Toast extends Reminder {
  id: string;
}

/** Polls for due polling-mode reminders (fallback when Web Push is
 * unavailable) and shows them as a system notification when possible,
 * otherwise as an in-page banner. Mounted once at the app root. */
export default function ReminderPoller() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const deliver = (r: Reminder) => {
      const text = r.risky
        ? `${r.court_name}：${r.play_hhmm} 前后降水概率约 ${r.pop}%，留意场地情况`
        : `${r.court_name}：${r.play_hhmm} 时段目前无雨风险，放心打球 ☀️`;
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('球场下雨风险提醒', { body: text, icon: '/icon.svg' });
          n.onclick = () => {
            window.focus();
            window.location.href = `/courts/${r.court_id}`;
          };
          return;
        } catch {
          /* fall through to banner */
        }
      }
      setToasts((prev) => [...prev, { ...r, id: crypto.randomUUID() }]);
    };

    const tick = () => {
      api.checkReminders()
        .then((res) => res.reminders.forEach(deliver))
        .catch(() => { /* server unreachable; retry next tick */ });
    };
    const id = setInterval(tick, 60_000);
    void tick();
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(
      () => setToasts((prev) => prev.slice(1)), 60_000);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`ios-card border-l-4 p-3 shadow-lg ${
            t.risky
              ? 'border-amber-300 bg-amber-50/95'
              : 'border-[#34C759]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-medium leading-relaxed">
              {t.risky ? '🌧️ ' : '☀️ '}{t.play_hhmm} 提醒
              <div className="mt-0.5 font-normal text-slate-600">{t.court_name}</div>
              <div className={t.risky ? 'text-amber-800' : 'text-emerald-800'}>
                {t.risky
                  ? `降水概率约 ${t.pop}%，出门前再看一眼临近预报`
                  : '该时段目前无雨风险'}
              </div>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded px-1 text-slate-400 hover:text-slate-600"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <a
            href={`/courts/${t.court_id}`}
            className="mt-1.5 inline-block text-[11px] font-semibold text-sky-700 underline"
          >
            查看球场天气 →
          </a>
        </div>
      ))}
    </div>
  );
}
