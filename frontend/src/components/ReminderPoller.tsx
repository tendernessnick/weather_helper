import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Reminder } from '../types';
import { useLang } from '../i18n';

interface Toast extends Reminder {
  id: string;
}

/** Polls for due polling-mode reminders (fallback when Web Push is
 * unavailable) and shows them as a system notification when possible,
 * otherwise as an in-page banner. Mounted once at the app root. */
export default function ReminderPoller() {
  const { t, lang } = useLang();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const nameOf = (r: Reminder) =>
      lang === 'en' ? (r.court_name_en ?? r.court_name)
        : lang === 'hant' ? (r.court_name_tc ?? r.court_name) : r.court_name;

    const deliver = (r: Reminder) => {
      const text = r.risky
        ? t('remind.riskyText', { name: nameOf(r), hhmm: r.play_hhmm, p: r.pop ?? '—' })
        : t('remind.okText', { name: nameOf(r), hhmm: r.play_hhmm });
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(t('remind.title'), { body: text, icon: '/icon.svg' });
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
    // rebuild the closure when the language changes so new toasts use it
  }, [lang, t]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(
      () => setToasts((prev) => prev.slice(1)), 60_000);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 space-y-2">
      {toasts.map((tm) => (
        <div
          key={tm.id}
          className={`ios-card border-l-4 p-3 shadow-lg ${
            tm.risky
              ? 'border-amber-300 bg-amber-50/95'
              : 'border-[#34C759]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-medium leading-relaxed">
              {tm.risky ? '🌧️ ' : '☀️ '}{t('remind.banner', { hhmm: tm.play_hhmm })}
              <div className="mt-0.5 font-normal text-slate-600">{tm.court_name}</div>
              <div className={tm.risky ? 'text-amber-800' : 'text-emerald-800'}>
                {tm.risky
                  ? t('remind.riskyBody', { p: tm.pop ?? '—' })
                  : t('remind.okBody')}
              </div>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== tm.id))}
              className="shrink-0 rounded px-1 text-slate-400 hover:text-slate-600"
              aria-label={t('remind.close')}
            >
              ✕
            </button>
          </div>
          <a
            href={`/courts/${tm.court_id}`}
            className="mt-1.5 inline-block text-[11px] font-semibold text-sky-700 underline"
          >
            {t('remind.view')}
          </a>
        </div>
      ))}
    </div>
  );
}
