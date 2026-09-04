import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../api';
import type { CourtListItem } from '../types';
import Icon from '../components/Icon';
import { courtName, districtName, useLang } from '../i18n';

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function Stars({ accuracy, ok }: { accuracy: number | null; ok: boolean }) {
  const { t } = useLang();
  if (!ok || accuracy === null) {
    return <span className="text-[12px] text-[#8E8E93]">{t('common.building')}</span>;
  }
  const stars = Math.max(1, Math.round(accuracy * 5));
  return (
    <span className="whitespace-nowrap text-[13px]" title={t('list.starsTitle', { p: Math.round(accuracy * 100) })}>
      <span className="text-[#F5A623]">{'★'.repeat(stars)}</span>
      <span className="text-black/15">{'★'.repeat(5 - stars)}</span>
    </span>
  );
}

function NowcastBadge({ court }: { court: CourtListItem }) {
  const { t } = useLang();
  if (!court.nowcast) {
    return <span className="text-[12px] text-[#8E8E93]">{t('list.nowcastLoading')}</span>;
  }
  const { rain, max_mm } = court.nowcast;
  return rain ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E5F1FB] px-2 py-0.5 text-[11px] font-medium text-[#0071E3]">
      <Icon name="rain" className="h-3 w-3" />
      {t('list.rainBadge', { mm: max_mm.toFixed(1) })}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F8ED] px-2 py-0.5 text-[11px] font-medium text-[#1B7A3D]">
      <Icon name="sun" className="h-3 w-3" />
      {t('list.dryBadge')}
    </span>
  );
}

export default function CourtList() {
  const { t, lang } = useLang();
  const [search, setSearch] = useState('');
  const [courts, setCourts] = useState<CourtListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.courts(search, '')
        .then((data) => {
          if (!cancelled) setCourts(data.courts);
        })
        .catch((err) => {
          if (!cancelled) setError(String(err.message));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200); // debounce search input
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const grouped = useMemo(() => {
    const map = new Map<string, CourtListItem[]>();
    for (const court of courts) {
      const list = map.get(court.letter) ?? [];
      list.push(court);
      map.set(court.letter, list);
    }
    return map;
  }, [courts]);

  const activeLetters = LETTERS.filter((l) => grouped.has(l));

  const jump = (letter: string, smooth = true) => {
    document
      .getElementById(`letter-${letter}`)
      ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  };

  // --- A-Z rail: tap a letter, or press-and-drag for fast seeking ------------
  const railRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const lastLetterRef = useRef<string | null>(null);
  const [seekLetter, setSeekLetter] = useState<string | null>(null);

  const letterUnderPointer = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('button[data-letter]');
    return (el as HTMLElement | null)?.dataset.letter ?? null;
  };

  const onRailPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault(); // no native text selection while seeking
    draggingRef.current = true;
    lastLetterRef.current = null;
    document.body.style.userSelect = 'none';
    railRef.current?.setPointerCapture(e.pointerId);
    const letter = letterUnderPointer(e.clientX, e.clientY);
    if (letter) {
      lastLetterRef.current = letter;
      setSeekLetter(letter);
      jump(letter, false);
    }
  };

  const onRailPointerMove = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    const letter = letterUnderPointer(e.clientX, e.clientY);
    if (letter && letter !== lastLetterRef.current) {
      lastLetterRef.current = letter;
      setSeekLetter(letter);
      jump(letter, false);
    }
  };

  const endDrag = () => {
    draggingRef.current = false;
    document.body.style.userSelect = '';
    setTimeout(() => setSeekLetter(null), 250);
  };

  return (
    <div className="relative">
      {/* A-Z rail: fixed, vertically centred, out of the list's flow */}
      {activeLetters.length > 0 && (
        <>
          <nav
            ref={railRef}
            className="fixed top-1/2 z-30 -translate-y-1/2 w-fit touch-none select-none"
            style={{ right: 'calc(max(0px, 100vw - 48rem) / 2 + 0.3rem)' }}
            aria-label={t('list.railAria')}
            onPointerDown={onRailPointerDown}
            onPointerMove={onRailPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <ul className="flex flex-col items-center rounded-full bg-white/95 py-1 shadow-md ring-1 ring-black/5 text-[11px] font-medium text-[#0071E3]">
              {activeLetters.map((letter) => (
                <li key={letter}>
                  <button
                    data-letter={letter}
                    onClick={() => jump(letter)}
                    className="flex h-5 w-6 items-center justify-center rounded-full active:bg-[#0071E3]/15"
                  >
                    {letter}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {seekLetter && (
            <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900/80 text-3xl font-bold text-white">
                {seekLetter}
              </div>
            </div>
          )}
        </>
      )}

      <div className="px-4 pt-3">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('list.search')}
            className="w-full rounded-[10px] border-0 bg-[#E9E9EB] py-2 pl-9 pr-3 text-[15px] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#0071E3]/40"
          />
        </div>
        <p className="mt-2 text-[12px] text-[#6D6D72]">
          {t('list.count', { n: courts.length })}
        </p>
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-[12px] bg-[#FFE5E5] p-3 text-sm text-[#C0392B]">{error}</div>
      )}
      {loading && (
        <div className="space-y-2 px-4 pt-2" aria-label="loading">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 rounded-[12px] bg-white p-3"
                 style={{ animationDelay: `${i * 90}ms` }}>
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-2/5 rounded bg-[#E9E9EB]" />
                <div className="h-2.5 w-3/5 rounded bg-[#EFEFF2]" />
              </div>
              <div className="h-6 w-14 rounded-full bg-[#E9E9EB]" />
            </div>
          ))}
        </div>
      )}
      {!loading && !error && courts.length === 0 && (
        <div className="p-8 text-center text-sm text-[#8E8E93]">{t('list.noMatch')}</div>
      )}

      {/* List keeps a dedicated right gutter (pr-7) for the A-Z rail. */}
      <div className="pl-4 pr-7 pt-2">
        <ul>
          {activeLetters.map((letter) => (
            <li key={letter} id={`letter-${letter}`} className="scroll-mt-16">
              <div className="sticky top-[56px] z-10 -ml-4 bg-[#F2F2F7]/95 pl-4 pr-2 py-0.5 text-[13px] font-semibold text-[#6D6D72] backdrop-blur-sm">
                {letter}
              </div>
              <ul className="space-y-2 pb-1">
                {(grouped.get(letter) ?? []).map((court) => (
                  <li key={court.id}>
                    <a
                      href={`/courts/${court.id}`}
                      className="flex items-center gap-1 rounded-[14px] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] active:bg-[#E5E5EA]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[15px] font-semibold">{courtName(court, lang)}</span>
                          <Stars
                            accuracy={court.score?.accuracy ?? null}
                            ok={court.score?.sufficient_samples ?? false}
                          />
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-[#8E8E93]">
                          {court.name_en} · {districtName(court.district_tc, court.district_en, lang)}
                        </div>
                        <div className="mt-1.5">
                          <NowcastBadge court={court} />
                        </div>
                      </div>
                      <span className="shrink-0 text-black/25">
                        <Icon name="chevron" className="h-4 w-4" strokeWidth={2.2} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
