import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../api';
import type { CourtListItem } from '../types';
import Icon from '../components/Icon';
import { Link, useSearchParams } from 'react-router-dom';
import FavoriteButton from '../components/FavoriteButton';
import RequestError from '../components/RequestError';
import { useFavorites } from '../hooks/useFavorites';
import { useWeatherClock } from '../hooks/useWeatherClock';
import { hkTimestamp } from '../utils/hkTime';
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
  const now = useWeatherClock();
  if (!court.nowcast || now - hkTimestamp(court.nowcast.fetched_at) > 25 * 60_000) {
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
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const district = params.get('district') ?? '';
  const onlyFavorites = params.get('saved') === '1';
  const { favorites } = useFavorites();
  const [retry, setRetry] = useState(0);
  const update = (key: string, value: string) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const text = (a: string, b: string, c: string) => lang === 'en' ? c : lang === 'hant' ? b : a;
  const [courts, setCourts] = useState<CourtListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.courts('', '', controller.signal)
      .then((data) => { if (!controller.signal.aborted) setCourts(data.courts); })
      .catch((err) => { if (!controller.signal.aborted) setError(String(err.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  // 57 courts are fetched once; filtering never waits for a network round trip.
  const districts = useMemo(() => [...new Map(courts.map((c) => [c.district_en, c])).values()]
    .sort((a, b) => districtName(a.district_tc, a.district_en, lang).localeCompare(districtName(b.district_tc, b.district_en, lang))), [courts, lang]);
  const filtered = useMemo(() => courts.filter((court) => {
    const query = search.trim().toLocaleLowerCase();
    const aliases = court.district_tc.replaceAll('區', '区').replaceAll('觀', '观').replaceAll('灣', '湾').replaceAll('東', '东').replaceAll('黃', '黄').replaceAll('龍', '龙').replaceAll('離', '离').replaceAll('門', '门');
    const haystack = [court.name_sc, court.name_tc, court.name_en, court.district_tc, court.district_en, aliases].join(' ').toLocaleLowerCase();
    return (!query || haystack.includes(query)) && (!district || court.district_en === district)
      && (!onlyFavorites || favorites.includes(court.id));
  }), [courts, search, district, onlyFavorites, favorites]);

  const grouped = useMemo(() => {
    const map = new Map<string, CourtListItem[]>();
    for (const court of filtered) {
      const list = map.get(court.letter) ?? [];
      list.push(court);
      map.set(court.letter, list);
    }
    return map;
  }, [filtered]);

  const activeLetters = LETTERS.filter((l) => grouped.has(l));

  useEffect(() => () => { document.body.style.userSelect = ''; }, []);

  const jump = (letter: string, smooth = true) => {
    document
      .getElementById(`letter-${letter}`)
      ?.scrollIntoView({ behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto', block: 'start' });
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
            onLostPointerCapture={endDrag}
          >
            <ul className="flex flex-col items-center gap-[1px] rounded-full border border-white/70 bg-white/45 py-1.5 text-[9.5px] font-semibold text-[#6D6D72] shadow-[0_4px_16px_-8px_rgba(17,17,20,0.22)] backdrop-blur-xl">
              {activeLetters.map((letter) => (
                <li key={letter}>
                  <button
                    data-letter={letter}
                    onClick={() => jump(letter)}
                    className="flex h-[15px] w-5 items-center justify-center rounded-full active:bg-[#0071E3]/15 active:text-[#0071E3]"
                  >
                    {letter}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {seekLetter && (
            <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-[22px] border border-white/25 bg-[#1A1A1E]/70 text-4xl font-bold text-white shadow-[0_16px_40px_-12px_rgba(17,17,20,0.5)] backdrop-blur-xl">
                {seekLetter}
              </div>
            </div>
          )}
        </>
      )}

      <div className="px-4 pt-5">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-800">HONG KONG · 18 DISTRICTS</p>
            <h1 className="mt-1 text-2xl font-bold">{text('找到你的下一场', '找到你的下一場', 'Find your next court')}</h1>
          </div>
          <span className="text-xs text-slate-600">{text('时间均为香港时间', '時間均為香港時間', 'Hong Kong time')}</span>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={search}
            onChange={(e) => update('q', e.target.value)}
            aria-label={t('list.search')}
            type="search"
            placeholder={t('list.search')}
            className="w-full rounded-full border border-white/70 bg-white/55 min-h-11 py-2 pl-9 pr-3 text-[15px] shadow-[0_2px_10px_-6px_rgba(17,17,20,0.15)] backdrop-blur-md outline-none placeholder:text-[#8E8E93] focus:border-[#0071E3]/40 focus:ring-2 focus:ring-[#0071E3]/25"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button aria-pressed={onlyFavorites} onClick={() => update('saved', onlyFavorites ? '' : '1')}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${onlyFavorites ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-white bg-white/70 text-slate-700'}`}>
            <span aria-hidden="true">★ </span>{text('我的收藏', '我的收藏', 'Saved')} · {favorites.length}
          </button>
          <select aria-label={text('筛选地区', '篩選地區', 'Filter district')} value={district}
            onChange={(e) => update('district', e.target.value)} className="min-h-11 min-w-0 max-w-full rounded-full border border-white bg-white/70 px-3 text-sm text-slate-700">
            <option value="">{text('全部地区', '全部地區', 'All districts')}</option>
            {districts.map((c) => <option key={c.district_en} value={c.district_en}>{districtName(c.district_tc, c.district_en, lang)}</option>)}
          </select>
          {(search || district || onlyFavorites) && <button onClick={() => setParams({})} className="min-h-11 px-2 text-sm font-medium text-blue-800">{text('清除筛选', '清除篩選', 'Clear filters')}</button>}
        </div>
        <p className="mt-2 text-[12px] text-[#6D6D72]" role="status">
          {t('list.count', { n: filtered.length })}
        </p>
      </div>

      {error && (
        <RequestError onRetry={() => setRetry((n) => n + 1)} />
      )}
      {loading && (
        <div className="space-y-2 px-4 pt-2" aria-label="loading">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 rounded-[14px] border border-white/70 bg-white/70 p-3"
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
      {!loading && !error && filtered.length === 0 && (
        <div className="p-8 text-center text-sm text-[#8E8E93]">{onlyFavorites && favorites.length === 0 ? text('点球场旁的 ☆ 收藏，常去的球场下次一眼找到。收藏只保存在本机。', '點球場旁的 ☆ 收藏，常去的球場下次一眼找到。收藏只保存在本機。', 'Tap ☆ beside a court to save it for next time. Saved on this device only.') : t('list.noMatch')}</div>
      )}

      {/* List keeps a dedicated right gutter (pr-7) for the A-Z rail. */}
      <div className="pl-4 pr-7 pt-2">
        <ul>
          {!loading && !error && activeLetters.map((letter) => (
            <li key={letter} id={`letter-${letter}`} className="scroll-mt-16">
              <div className="sticky top-[60px] z-10 -ml-1 py-0.5">
                <span className="inline-block rounded-full border border-white/70 bg-white/55 px-2.5 py-[3px] text-[11px] font-bold tracking-[0.08em] text-[#6D6D72] shadow-[0_2px_8px_-4px_rgba(17,17,20,0.18)] backdrop-blur-md">
                  {letter}
                </span>
              </div>
              <ul className="space-y-2 pb-1">
                {(grouped.get(letter) ?? []).map((court) => (
                  <li key={court.id} className="flex items-center gap-1 rounded-[14px] border border-white/80 bg-white/70 pr-2 shadow-[0_1px_1px_rgba(17,17,20,0.03),0_6px_16px_-10px_rgba(17,17,20,0.14)]">
                    <Link to={`/courts/${court.id}`} className="flex min-w-0 flex-1 items-center gap-1 rounded-[14px] p-3.5 active:bg-[#E5E5EA]/80">
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
                    </Link>
                    <FavoriteButton courtId={court.id} />
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
