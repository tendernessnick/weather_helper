import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { courtName, useLang } from '../i18n';
import type { TKey } from '../i18n';
import type { AdminOverview as AdminData, AdminSource } from '../types';

const TOKEN_KEY = 'wh_admin_token';

const DOT: Record<string, string> = {
  ok: 'bg-[#34C759]',
  warn: 'bg-[#FF9500]',
  stale: 'bg-[#FF3B30]',
  missing: 'bg-[#FF3B30]',
};

const SRC_LABEL: Record<AdminSource['key'], TKey> = {
  nowcast: 'admin.source.nowcast',
  rainfall: 'admin.source.rainfall',
  current: 'admin.source.current',
  forecast: 'admin.source.forecast',
};

const JOB_LABEL: Record<string, TKey> = {
  ingest_nowcast: 'admin.job.ingest_nowcast',
  ingest_rainfall: 'admin.job.ingest_rainfall',
  ingest_current: 'admin.job.ingest_current',
  ingest_open_meteo: 'admin.job.ingest_open_meteo',
  push_check: 'admin.job.push_check',
  purge: 'admin.job.purge',
  climate_update: 'admin.job.climate_update',
};

const REASON_LABEL: Record<string, TKey> = {
  rejected_accuracy: 'admin.reason.rejected_accuracy',
  rejected_geofence: 'admin.reason.rejected_geofence',
  rejected_cooldown: 'admin.reason.rejected_cooldown',
  rejected_speed: 'admin.reason.rejected_speed',
  rejected_daily_limit: 'admin.reason.rejected_daily_limit',
  rejected_bad_data: 'admin.reason.rejected_bad_data',
};

const INTENSITY_STYLE: Record<string, string> = {
  none: 'bg-[#E9E9EB] text-[#6D6D72]',
  light: 'bg-[#E5F1FB] text-[#0071E3]',
  moderate: 'bg-[#FFF4E5] text-[#8A6100]',
  heavy: 'bg-[#FFE5E5] text-[#C0392B]',
};

const DB_TABLES: [string, TKey][] = [
  ['courts', 'admin.table.courts'],
  ['forecast_snapshots', 'admin.table.forecast_snapshots'],
  ['observations', 'admin.table.observations'],
  ['nowcast_snapshots', 'admin.table.nowcast_snapshots'],
  ['climatology_cells', 'admin.table.climatology_cells'],
  ['user_reports_total', 'admin.table.user_reports_total'],
  ['accepted_user_reports', 'admin.table.accepted_user_reports'],
  ['checkins', 'admin.table.checkins'],
  ['push_subscriptions', 'admin.table.push_subscriptions'],
];

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <div className="rounded-[10px] bg-[#F2F2F7] p-3">
      <div className={`text-[22px] font-bold tabular-nums tracking-tight ${tone ?? ''}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

export default function Admin() {
  const { t, lang } = useLang();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [input, setInput] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const [filter, setFilter] = useState<'all' | 'accepted' | 'rejected'>('all');

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const handleFailure = useCallback((e: unknown) => {
    if (e instanceof ApiError && (e.status === 401 || e.status === 503)) {
      localStorage.removeItem(TOKEN_KEY);
      setToken('');
      setInput('');
      setGateMsg(e.status === 503 ? t('admin.tokenNotConfigured') : t('admin.tokenInvalid'));
    } else {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  const load = useCallback(async () => {
    try {
      const d = await api.adminOverview(token);
      setData(d);
      setFetchedAt(Date.now());
      setNowTick(Date.now());
      setLoadErr(null);
    } catch (e) {
      handleFailure(e);
    }
  }, [token, handleFailure]);

  // Poll every 60s while a token is held.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const run = () => { if (alive) load(); };
    run();
    const id = setInterval(run, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [token, load]);

  const submitToken = async () => {
    const tk = input.trim();
    if (!tk) return;
    setGateBusy(true);
    setGateMsg(null);
    try {
      const d = await api.adminOverview(tk);
      localStorage.setItem(TOKEN_KEY, tk);
      setToken(tk);
      setData(d);
      setFetchedAt(Date.now());
      setNowTick(Date.now());
    } catch (e) {
      if (e instanceof ApiError) {
        setGateMsg(e.status === 503 ? t('admin.tokenNotConfigured') : t('admin.tokenInvalid'));
      } else {
        setGateMsg(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setGateBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setData(null);
    setLoadErr(null);
  };

  // Server-clock reference so "x ago" stays truthful between polls.
  const serverNowMs = data
    ? new Date(data.server_now).getTime() + (nowTick - fetchedAt)
    : nowTick;
  const ageSec = (iso: string | null | undefined) =>
    iso ? Math.max(0, Math.round((serverNowMs - new Date(iso).getTime()) / 1000)) : null;

  const fmtDur = (sec: number | null | undefined): string => {
    if (sec == null) return '—';
    if (sec < 60) return t('admin.t.sec', { n: sec });
    if (sec < 3600) return t('admin.t.min', { n: Math.max(1, Math.round(sec / 60)) });
    if (sec < 86400) return t('admin.t.hour', { n: Math.round(sec / 3600) });
    return t('admin.t.day', { n: Math.round(sec / 86400) });
  };
  const fmtAgo = (sec: number | null | undefined) =>
    sec == null ? '—' : t('admin.ago', { t: fmtDur(sec) });

  const jobName = (id: string) => {
    const key = JOB_LABEL[id];
    return key ? t(key) : id;
  };
  const reasonLabel = (status: string) => {
    const key = REASON_LABEL[status];
    return key ? t(key) : status;
  };

  const filteredReports = useMemo(() => {
    if (!data) return [];
    return data.recent_reports.filter(r =>
      filter === 'all' ? true
        : filter === 'accepted' ? r.status === 'accepted'
          : r.status !== 'accepted');
  }, [data, filter]);

  // --- token gate ---
  if (!token) {
    return (
      <div className="mx-auto max-w-md px-4 pt-12">
        <section className="ios-card p-5">
          <h2 className="text-[15px] font-bold tracking-tight">{t('admin.title')}</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">{t('admin.subtitle')}</p>
          <label className="ios-header mt-4 block">{t('admin.tokenLabel')}</label>
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitToken(); }}
            placeholder={t('admin.tokenPlaceholder')}
            className="mt-1.5 w-full rounded-[10px] bg-[#E9E9EB] px-3 py-2.5 text-[14px] outline-none focus:ring-2 focus:ring-[#0071E3]/40"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">{t('admin.tokenHint')}</p>
          <button
            onClick={submitToken}
            disabled={gateBusy || !input.trim()}
            className="mt-4 w-full rounded-full bg-[#34C759] px-3.5 py-2.5 text-[14px] font-semibold text-white disabled:bg-black/20"
          >
            {gateBusy ? t('admin.entering') : t('admin.enter')}
          </button>
          {gateMsg && <p className="mt-3 text-[12px] leading-relaxed text-[#C0392B]">{gateMsg}</p>}
        </section>
      </div>
    );
  }

  // --- dashboard ---
  const rejectedToday = data ? data.reports_today.total - data.reports_today.accepted : 0;
  const reasons = data
    ? Object.entries(data.reports_today.by_status).filter(([, v]) => v > 0)
    : [];
  const trendMax = data ? Math.max(...data.reports_trend_7d.map(d => d.count)) : 0;

  return (
    <div className="pb-4">
      <div className="mx-4 mt-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold tracking-tight">{t('admin.title')}</h1>
          {data && (
            <p className="mt-0.5 text-[11px] text-slate-500">
              {t('admin.updatedAgo', { t: fmtDur(Math.round((nowTick - fetchedAt) / 1000)) })}
              {' · '}
              {t('admin.uptime', { t: fmtDur(data.uptime_sec) })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={load}
            className="rounded-full bg-[#E9E9EB] px-3 py-1.5 text-[12px] font-semibold text-[#3C3C43] active:bg-[#D8D8DC]"
          >
            {t('admin.refresh')}
          </button>
          <button
            onClick={logout}
            className="rounded-full bg-[#E9E9EB] px-3 py-1.5 text-[12px] font-semibold text-[#C0392B] active:bg-[#D8D8DC]"
          >
            {t('admin.logout')}
          </button>
        </div>
      </div>

      {loadErr && (
        <div className="mx-4 mt-3 rounded-[10px] bg-[#FFE5E5] px-3 py-2 text-[12px] leading-relaxed text-[#C0392B]">
          {t('admin.loadFail', { msg: loadErr })}
        </div>
      )}

      {!data && !loadErr && (
        <div className="p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      )}

      {data && (
        <>
          {/* data freshness */}
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">{t('admin.freshnessTitle')}</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{t('admin.freshnessNote')}</p>
            <div className="mt-1 divide-y divide-black/5">
              {data.sources.map(s => (
                <div key={s.key} className="flex items-center gap-2.5 py-2.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[s.status]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{t(SRC_LABEL[s.key])}</div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                      {s.last_data_at ? s.last_data_at.slice(11, 16) : t('admin.noData')}
                    </div>
                  </div>
                  <div className="shrink-0 text-[12px] tabular-nums text-slate-500">
                    {fmtAgo(s.age_sec)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* scheduler jobs */}
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">{t('admin.jobsTitle')}</h2>
            <div className="mt-1 divide-y divide-black/5">
              {Object.entries(data.jobs).map(([id, j]) => (
                <div key={id} className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      j.runs === 0 ? 'bg-[#8E8E93]' : j.last_error ? 'bg-[#FF3B30]' : 'bg-[#34C759]'
                    }`} />
                    <div className="min-w-0 flex-1 truncate text-[14px] font-medium">{jobName(id)}</div>
                    <div className="shrink-0 text-[11px] tabular-nums text-slate-500">
                      {t('admin.jobNext', { t: fmtDur(j.next_run_in_sec) })}
                    </div>
                  </div>
                  <div className="mt-0.5 pl-[18px] text-[11px] tabular-nums text-slate-500">
                    {j.runs === 0
                      ? (j.last_start ? t('admin.jobRunning') : t('admin.jobNever'))
                      : `${t('admin.jobStat', {
                          runs: j.runs, fails: j.failures,
                          dur: fmtDur(Math.round((j.last_duration_ms ?? 0) / 1000)),
                        })} · ${fmtAgo(ageSec(j.last_ok))}`}
                  </div>
                  {j.last_error && (
                    <div className="mt-1 break-all pl-[18px] text-[11px] leading-relaxed text-[#C0392B]">
                      {j.last_error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* today's reports */}
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">{t('admin.reportsTitle')}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat value={data.reports_today.total} label={t('admin.stat.total')} />
              <Stat value={data.reports_today.accepted} label={t('admin.stat.accepted')} />
              <Stat value={rejectedToday} label={t('admin.stat.rejected')} tone="text-[#C0392B]" />
            </div>
            {reasons.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {reasons.map(([k, v]) => (
                  <span key={k} className="rounded-full bg-[#FFE5E5] px-2 py-0.5 text-[10px] font-medium text-[#C0392B]">
                    {`${reasonLabel(k)} ${v}`}
                  </span>
                ))}
              </div>
            )}
            <h3 className="ios-header mt-4">{t('admin.trendTitle')}</h3>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {data.reports_trend_7d.map(d => {
                const h = trendMax > 0 ? Math.max(3, Math.round(d.count / trendMax * 44)) : 3;
                return (
                  <div key={d.date} className="flex flex-col items-center" title={`${d.date}: ${d.count}`}>
                    <div className="flex h-11 w-full items-end">
                      <div className={`w-full rounded-[3px] ${d.count > 0 ? 'bg-[#007AFF]/80' : 'bg-[#E5E5EA]'}`} style={{ height: `${h}px` }} />
                    </div>
                    <div className="mt-1 text-[9px] tabular-nums text-slate-400">{d.date.slice(5)}</div>
                    <div className="text-[9px] font-semibold tabular-nums text-slate-500">{d.count}</div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* recent reports feed */}
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">{t('admin.recentTitle')}</h2>
            <div className="mt-3 flex rounded-[10px] bg-[#E9E9EB] p-[2px] text-[12px] font-semibold">
              {(['all', 'accepted', 'rejected'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 rounded-[8px] px-3 py-1 transition-colors ${
                    filter === f ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#6D6D72]'
                  }`}
                >
                  {t(`admin.filter.${f}` as TKey)}
                </button>
              ))}
            </div>
            {filteredReports.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-slate-500">{t('admin.emptyReports')}</p>
            ) : (
              <ul className="divide-y divide-black/5">
                {filteredReports.map(r => (
                  <li key={r.id}>
                    <a href={`/courts/${r.court_id}`} className="flex items-center gap-2 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {courtName({ name_sc: r.court_name_sc, name_tc: r.court_name_tc, name_en: r.court_name_en }, lang)}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] tabular-nums text-slate-500">
                          {r.created_at.slice(11, 16)}
                          {' · '}
                          {r.device_id.slice(0, 8)}
                          {r.distance_m != null && ` · ${t('admin.distance', { m: Math.round(r.distance_m) })}`}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${INTENSITY_STYLE[r.intensity] ?? INTENSITY_STYLE.none}`}>
                        {t(`intensity.${r.intensity}` as TKey)}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        r.status === 'accepted' ? 'bg-[#E8F8ED] text-[#1B7A3D]' : 'bg-[#FFE5E5] text-[#C0392B]'
                      }`}>
                        {r.status === 'accepted' ? t('admin.filter.accepted') : reasonLabel(r.status)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* user activity */}
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">{t('admin.activityTitle')}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat value={data.checkins.today} label={t('admin.stat.checkinsToday')} />
              <Stat value={data.checkins.week} label={t('admin.stat.checkins7d')} />
              <Stat value={data.checkins.total} label={t('admin.stat.checkinsTotal')} />
              <Stat value={data.devices_7d} label={t('admin.stat.devices7d')} />
              <Stat value={data.subscriptions.web_push} label={t('admin.stat.subPush')} />
              <Stat value={data.subscriptions.polling} label={t('admin.stat.subPoll')} />
            </div>
          </section>

          {/* database */}
          <section className="ios-card mx-4 mt-4 p-4">
            <h2 className="text-[15px] font-bold tracking-tight">{t('admin.dbTitle')}</h2>
            {data.db.error ? (
              <p className="mt-2 text-[12px] text-[#C0392B]">{t('admin.dbUnavailable')}</p>
            ) : (
              <>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{t('admin.dbNote')}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums text-slate-600">
                  <span>{t('admin.dbSize', { v: data.db.db_size_mb ?? '—' })}</span>
                  {typeof data.db.db_file_created_at === 'string' && (
                    <span>{t('admin.dbCreated', { t: data.db.db_file_created_at.slice(0, 16).replace('T', ' ') })}</span>
                  )}
                  {typeof data.db.latest_observation === 'string' && (
                    <span>{t('admin.latestObservation', { t: data.db.latest_observation.slice(11, 16) })}</span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {DB_TABLES.map(([k, key]) => (
                    <div key={k} className="flex items-baseline justify-between border-b border-black/5 pb-1">
                      <span className="text-[11px] text-slate-500">{t(key)}</span>
                      <span className="text-[13px] font-semibold tabular-nums">
                        {typeof data.db[k] === 'number' ? (data.db[k] as number).toLocaleString() : data.db[k] ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
