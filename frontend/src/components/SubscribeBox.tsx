import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLang } from '../i18n';
import type { Court } from '../types';
import { hkDateKey, hkFormat, hkTimestamp } from '../utils/hkTime';
import { reminderCopy } from './reminder-copy';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buf = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

export function defaultPlayAt(now = Date.now()): string {
  // The input is explicitly HK local time, even on a traveller's device.
  // HK is UTC+8 without DST, so half-hour epoch boundaries align locally.
  const timestamp = Math.floor((now + 60 * 60_000) / (30 * 60_000)) * (30 * 60_000);
  return `${hkDateKey(timestamp)}T${hkFormat(timestamp)}`;
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PUSH_TIMEOUT')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export default function SubscribeBox({ court }: { court: Court }) {
  const { t, lang } = useLang();
  const copy = reminderCopy(lang);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [playAt, setPlayAt] = useState(defaultPlayAt());
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'err'>('ok');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.pushPublicKey().then((r) => setPushEnabled(r.enabled && !!r.public_key))
      .catch(() => setPushEnabled(false));
  }, []);

  const subscribe = async () => {
    if (busy) return;
    if (!Number.isFinite(hkTimestamp(playAt)) || hkTimestamp(playAt) <= Date.now()) {
      setMessage(copy.invalidTime);
      setTone('err');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // Request permission directly from the user gesture, before network
      // awaits. Safari and iOS may refuse prompts made later in the chain.
      const permission = await requestNotificationPermission();
      let pushOk = false;
      if (pushEnabled && 'serviceWorker' in navigator && 'PushManager' in window) {
        try {
          if (permission !== 'granted') {
            throw new Error(t('sub.noPerm'));
          }
          const { public_key } = await api.pushPublicKey();
          if (!public_key) throw new Error(t('sub.noServer'));
          // ready never resolves without an active worker (e.g. dev mode).
          const reg = await within(navigator.serviceWorker.ready, 5_000);
          const sub = await within(reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(public_key),
          }), 10_000);
          const json = sub.toJSON() as {
            endpoint: string;
            keys: { p256dh: string; auth: string };
          };
          // The labelled input contains Hong Kong wall time. Keep the API's
          // naive HK format rather than reinterpreting it in the device zone.
          await api.subscribe({
            subscription: { endpoint: json.endpoint, keys: json.keys },
            court_id: court.id,
            play_at: playAt,
            hours_before: 0.5,
          });
          pushOk = true;
        } catch {
          // Push service unreachable (e.g. Google FCM blocked) or denied -
          // fall back to in-page reminders below.
        }
      }

      if (pushOk) {
        setMessage(t('sub.pushOk'));
      } else {
        await api.subscribePolling({
          court_id: court.id,
          play_at: playAt,
          hours_before: 0.5,
        });
        setMessage(copy.polling);
      }
      setTone('ok');
    } catch (err) {
      setMessage(String((err as Error).message ?? err));
      setTone('err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <h2 className="text-[15px] font-bold tracking-tight">{t('sub.title')}</h2>
      <p className="mt-1 text-[12px] text-slate-500">
        {t('sub.note')}
      </p>
      <label htmlFor={`play-at-${court.id}`} className="mt-3 block text-[12px] font-medium text-slate-600">
        {copy.timeLabel}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id={`play-at-${court.id}`}
          type="datetime-local"
          min={`${hkDateKey()}T${hkFormat(Date.now())}`}
          value={playAt}
          disabled={busy}
          onChange={(e) => { setPlayAt(e.target.value); setMessage(null); }}
          aria-invalid={tone === 'err' && message === copy.invalidTime}
          className="min-h-11 min-w-0 max-w-full flex-1 rounded-[10px] border-0 bg-[#F2F2F7] px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0071E3]/40"
        />
        <button
          onClick={subscribe}
          disabled={busy}
          className="min-h-11 rounded-full bg-[#007AFF] px-3.5 py-2 text-[13px] font-semibold text-white disabled:bg-black/20"
        >
          {busy ? t('sub.busy') : t('sub.cta')}
        </button>
      </div>
      {message && (
        <p role="status" className={`mt-2 text-xs leading-relaxed ${tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
          {message}
        </p>
      )}
    </section>
  );
}
