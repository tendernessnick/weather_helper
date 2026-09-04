import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLang } from '../i18n';
import type { Court } from '../types';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buf = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

function defaultPlayAt(): string {
  // datetime-local value one hour from now, rounded to the half hour
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() >= 30 ? 30 : 0, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const { t } = useLang();
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
    setBusy(true);
    setMessage(null);
    try {
      let pushOk = false;
      if (pushEnabled && 'serviceWorker' in navigator && 'PushManager' in window) {
        try {
          if (await requestNotificationPermission() !== 'granted') {
            throw new Error(t('sub.noPerm'));
          }
          const { public_key } = await api.pushPublicKey();
          if (!public_key) throw new Error(t('sub.noServer'));
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(public_key),
          });
          const json = sub.toJSON() as {
            endpoint: string;
            keys: { p256dh: string; auth: string };
          };
          // datetime-local strings are naive local time - the backend stores HK
          // local time, so send it unchanged instead of converting to UTC.
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
        // System notification still improves the polling experience when the
        // tab is in the background; denial just means in-page banners only.
        await requestNotificationPermission();
        await api.subscribePolling({
          court_id: court.id,
          play_at: playAt,
          hours_before: 0.5,
        });
        setMessage(t('sub.poll'));
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
      <div className="mt-2 flex items-center gap-2">
        <input
          type="datetime-local"
          value={playAt}
          onChange={(e) => setPlayAt(e.target.value)}
          className="rounded-[10px] border-0 bg-[#F2F2F7] px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-[#0071E3]/40"
        />
        <button
          onClick={subscribe}
          disabled={busy}
          className="rounded-full bg-[#007AFF] px-3.5 py-2 text-[13px] font-semibold text-white disabled:bg-black/20"
        >
          {busy ? t('sub.busy') : t('sub.cta')}
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs leading-relaxed ${tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
          {message}
        </p>
      )}
    </section>
  );
}
