import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { CourtListItem } from '../types';

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function Stars({ accuracy, ok }: { accuracy: number | null; ok: boolean }) {
  if (!ok || accuracy === null) {
    return <span className="text-[11px] text-slate-400">数据积累中</span>;
  }
  const stars = Math.max(1, Math.round(accuracy * 5));
  return (
    <span className="whitespace-nowrap text-[13px]" title={`预报准确率 ${Math.round(accuracy * 100)}%`}>
      <span className="text-amber-500">{'★'.repeat(stars)}</span>
      <span className="text-slate-300">{'★'.repeat(5 - stars)}</span>
    </span>
  );
}

function NowcastBadge({ court }: { court: CourtListItem }) {
  if (!court.nowcast) {
    return <span className="text-[11px] text-slate-400">临近预报加载中</span>;
  }
  const { rain, max_mm } = court.nowcast;
  return rain ? (
    <span className="whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
      💧 未来2小时有雨 · ≤{max_mm.toFixed(1)}mm
    </span>
  ) : (
    <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      ☀️ 未来2小时无雨
    </span>
  );
}

export default function CourtList() {
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

  const jump = (letter: string) => {
    document.getElementById(`letter-${letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="relative">
      <div className="px-4 pt-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索球场（中/英文）或地区，如：维多利亚、Victoria、沙田"
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
        <p className="mt-2 text-[11px] text-slate-500">
          共 {courts.length} 个康文署网球场 · 列表含未来两小时降雨与预报可信度
        </p>
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      )}
      {loading && <div className="p-8 text-center text-sm text-slate-400">加载中…</div>}
      {!loading && !error && courts.length === 0 && (
        <div className="p-8 text-center text-sm text-slate-400">没有匹配的球场</div>
      )}

      {/* List keeps a dedicated right gutter (pr-8): cards and sticky letter
          headers physically end before the floating A-Z rail, so the rail can
          never be covered regardless of z-index. Letter headers share the
          exact same width as the court cards (no bleed in either direction). */}
      <div className="pl-4 pr-8 pt-2">
        <ul>
          {activeLetters.map((letter) => (
            <li key={letter} id={`letter-${letter}`} className="scroll-mt-20">
              <div className="sticky top-[60px] z-10 mb-2 rounded-md bg-slate-100/95 px-1 py-1 text-xs font-bold text-emerald-700 backdrop-blur">
                {letter}
              </div>
              <ul className="space-y-2">
                {(grouped.get(letter) ?? []).map((court) => (
                  <li key={court.id}>
                    <a
                      href={`/courts/${court.id}`}
                      className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm active:bg-slate-50"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{court.name_sc}</span>
                        <Stars
                          accuracy={court.score?.accuracy ?? null}
                          ok={court.score?.sufficient_samples ?? false}
                        />
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {court.name_en} · {court.district_tc}
                      </div>
                      <div className="mt-1.5">
                        <NowcastBadge court={court} />
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      {/* iOS-contacts-style A-Z rail: floats at the right edge of the app
          column, vertically centred in the viewport; independent of scroll. */}
      {activeLetters.length > 0 && (
        <nav
          className="sticky top-1/2 z-30 -translate-y-1/2 ml-auto mr-1 w-fit"
          aria-label="字母索引"
        >
          <ul className="flex flex-col items-center rounded-full bg-white/95 py-1.5 shadow-md ring-1 ring-slate-200 text-[9px] leading-[1.25] text-emerald-700">
            {activeLetters.map((letter) => (
              <li key={letter}>
                <button onClick={() => jump(letter)} className="px-1 py-px">
                  {letter}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
