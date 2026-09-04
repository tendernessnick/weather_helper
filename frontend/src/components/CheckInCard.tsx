import { useState } from 'react';
import { api } from '../api';
import Icon from './Icon';
import { serverMsg, useLang } from '../i18n';
import type { Court } from '../types';

export default function CheckInCard({ court }: { court: Court }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'err'>('ok');

  const durations = [
    { h: 0.5, label: t('check.half') },
    { h: 1, label: t('check.one') },
    { h: 2, label: t('check.two') },
  ];

  const submit = async (h: number) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.checkin(court.id, h);
      setMessage(t('check.done'));
      setTone('ok');
      setOpen(false);
    } catch (err) {
      setMessage(serverMsg(String((err as Error).message ?? err), t));
      setTone('err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ios-card mx-4 mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">{t('check.title')}</h2>
          <p className="mt-0.5 text-[12px] text-[#8E8E93]">
            {t('check.note')}
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-full bg-[#007AFF] px-3.5 py-2 text-[13px] font-semibold text-white active:opacity-80"
        >
          <Icon name="ball" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          {t('check.cta')}
        </button>
      </div>

      {open && (
        <div className="mt-2.5 flex gap-2">
          {durations.map((d) => (
            <button key={d.h} onClick={() => submit(d.h)} disabled={busy}
                    className="flex-1 rounded-[12px] bg-[#F2F2F7] py-2 text-[12px] font-semibold text-[#3C3C43] active:bg-[#E5E5EA] disabled:opacity-50">
              {d.label}
            </button>
          ))}
        </div>
      )}

      {message && (
        <p className={`mt-2 text-xs ${tone === 'ok' ? 'text-[#1B7A3D]' : 'text-[#C0392B]'}`}>
          {message}
        </p>
      )}
    </section>
  );
}
