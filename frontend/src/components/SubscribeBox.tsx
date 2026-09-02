import { useEffect, useState } from 'react';
import { api } from '../api';
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

export default function SubscribeBox({ court }: { court: Court }) {
  const [enabled, setEnabled] = useState(false);
  const [playAt, setPlayAt] = useState(defaultPlayAt());
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'err'>('ok');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.pushPublicKey().then((r) => setEnabled(r.enabled && !!r.public_key))
      .catch(() => setEnabled(false));
  }, []);

  const subscribe = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('此浏览器不支持推送通知');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('未获得通知权限');

      const { public_key } = await api.pushPublicKey();
      if (!public_key) throw new Error('服务器未配置推送');

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
      setMessage('已订阅：开打前 30 分钟若有下雨风险会通知你。');
      setTone('ok');
    } catch (err) {
      setMessage(String((err as Error).message ?? err));
      setTone('err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold">下雨风险提醒</h2>
      {!enabled ? (
        <p className="mt-1 text-[11px] text-slate-400">服务器未配置推送（需要在部署时设置 VAPID 密钥）</p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="datetime-local"
            value={playAt}
            onChange={(e) => setPlayAt(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          />
          <button
            onClick={subscribe}
            disabled={busy}
            className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white shadow disabled:bg-slate-300"
          >
            {busy ? '订阅中…' : '开打前30分钟提醒我'}
          </button>
        </div>
      )}
      {message && (
        <p className={`mt-2 text-xs ${tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>{message}</p>
      )}
    </section>
  );
}
