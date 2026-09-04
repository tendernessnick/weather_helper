import { useState } from 'react';
import { api, ApiError } from '../api';
import { serverMsg, useLang } from '../i18n';
import type { TKey } from '../i18n';
import type { Court, FeedbackCategory } from '../types';

const CATEGORIES: { key: FeedbackCategory; labelKey: TKey }[] = [
  { key: 'suggestion', labelKey: 'fb.cat.suggestion' },
  { key: 'bug', labelKey: 'fb.cat.bug' },
  { key: 'data', labelKey: 'fb.cat.data' },
  { key: 'other', labelKey: 'fb.cat.other' },
];

/** Bottom-sheet feedback form. Opened from the app footer (general) or from
 *  a court page (with the court pre-attached, category preset to data fix). */
export default function FeedbackSheet({ court, presetCategory, onClose }: {
  court?: Court | null;
  presetCategory?: FeedbackCategory;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [category, setCategory] = useState<FeedbackCategory>(presetCategory ?? 'suggestion');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = message.trim().length < 10;

  const submit = async () => {
    if (busy || tooShort) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitFeedback({
        category,
        message,
        court_id: court?.id ?? null,
        page: court ? `/courts/${court.id}` : window.location.pathname,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(serverMsg(err.message, t));
      } else {
        setError(String((err as Error).message ?? err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-[18px] bg-white p-4 shadow-xl sm:rounded-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F8ED] text-[#1B7A3D]">
              ✓
            </div>
            <p className="mt-3 text-[14px] font-semibold text-[#3C3C43]">{t('fb.done')}</p>
            <button
              onClick={onClose}
              className="mt-4 w-full rounded-full bg-[#E9E9EB] px-4 py-2.5 text-[14px] font-semibold text-[#3C3C43] active:bg-[#D8D8DC]"
            >
              {t('fb.close')}
            </button>
          </div>
        ) : (
          <>
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#E9E9EB] sm:hidden" />
            <h2 className="text-[16px] font-bold tracking-tight">{t('fb.title')}</h2>
            <p className="mt-0.5 text-[12px] text-[#8E8E93]">{t('fb.subtitle')}</p>
            {court && (
              <p className="mt-1.5 rounded-[8px] bg-[#F2F2F7] px-2.5 py-1.5 text-[12px] text-[#3C3C43]">
                {court.name_tc || court.name_en}
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCategory(c.key)}
                  className={`rounded-[10px] px-2 py-2 text-[12.5px] font-medium transition-colors ${
                    category === c.key
                      ? 'bg-[#E5F1FB] text-[#0071E3] ring-1 ring-[#0071E3]/40'
                      : 'bg-[#F2F2F7] text-[#3C3C43]'
                  }`}
                >
                  {t(c.labelKey)}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
              rows={4}
              maxLength={1000}
              placeholder={t('fb.placeholder')}
              className="mt-3 w-full resize-none rounded-[10px] bg-[#F2F2F7] px-3 py-2.5 text-[14px] leading-relaxed outline-none focus:ring-2 focus:ring-[#0071E3]/40"
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-[#8E8E93]">
              {t('fb.count', { n: message.length })}
            </p>

            {error && <p className="mt-1 text-xs leading-relaxed text-rose-600">{error}</p>}

            <button
              onClick={submit}
              disabled={busy || tooShort}
              className="mt-2 w-full rounded-full bg-[#007AFF] px-4 py-3 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,122,255,0.35)] active:bg-[#0062CC] disabled:bg-black/20 disabled:shadow-none"
            >
              {busy ? t('fb.sending') : t('fb.send')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
