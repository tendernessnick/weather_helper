import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CheckinReport as ReportData, CheckinSession } from '../types';
import { getDeviceId } from '../device';
import Icon from './Icon';
import { useLang } from '../i18n';
import type { TKey } from '../i18n';

const TAG_STYLE: Record<string, { labelKey: TKey; cls: string }> = {
  win: { labelKey: 'mr.tag.win', cls: 'bg-[#E8F8ED] text-[#1B7A3D]' },
  clean: { labelKey: 'mr.tag.clean', cls: 'bg-[#F2F2F7] text-[#3C3C43]' },
  ambush: { labelKey: 'mr.tag.ambush', cls: 'bg-[#FFE5E5] text-[#C0392B]' },
  hit: { labelKey: 'mr.tag.hit', cls: 'bg-[#E5F1FB] text-[#0071E3]' },
};

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function SessionRow({ s }: { s: CheckinSession }) {
  const { t, lang } = useLang();
  const tag = TAG_STYLE[s.tag] ?? TAG_STYLE.clean;
  const name = lang === 'en' ? (s.court_name_en ?? s.court_name)
    : lang === 'hant' ? (s.court_name_tc ?? s.court_name) : s.court_name;
  return (
    <li className="flex items-center gap-2 py-1.5 text-[12px]">
      <span className="w-9 shrink-0 text-[#8E8E93]">{fmtDay(s.played_at)}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <span className="text-[10px] text-[#8E8E93]">{s.duration_hours}h</span>
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tag.cls}`}>
        {t(tag.labelKey)}
      </span>
    </li>
  );
}

export default function MyReportCard() {
  const { t } = useLang();
  const [report, setReport] = useState<ReportData | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const deviceId = getDeviceId();

  useEffect(() => {
    api.myReport().then(setReport).catch(() => setReport(null));
  }, []);

  const claim = async () => {
    const code = codeInput.trim();
    if (!code) return;
    try {
      const r = await api.peekCode(code);
      if (!r.exists) {
        setCodeMsg(t('mr.noRecord'));
        return;
      }
      localStorage.setItem('wh_device_id', code.toLowerCase());
      setCodeMsg(t('mr.claimed', { c: r.checkins, r: r.reports }));
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setCodeMsg(String((err as Error).message ?? err));
    }
  };

  return (
    <section className="ios-card mx-4 mt-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">{t('mr.title')}</h2>
        {report && report.total > 0 && (
          <span className="text-[10px] text-[#8E8E93]">{t('mr.totalN', { n: report.total })}</span>
        )}
      </div>

      {report === null ? (
        <p className="mt-1 text-[11px] text-[#8E8E93]">{t('common.loading')}</p>
      ) : report.total === 0 ? (
        <p className="mt-1 text-[11px] leading-relaxed text-[#6D6D72]">
          {t('mr.empty')}
        </p>
      ) : (
        <>
          <div className="mt-2 flex gap-2 text-center text-[10px]">
            <div className="flex-1 rounded-[10px] bg-[#F2F2F7] py-1.5">
              <div className="text-lg font-bold text-[#1B7A3D]">{report.total}</div>{t('mr.statTotal')}
            </div>
            <div className="flex-1 rounded-[10px] bg-[#F2F2F7] py-1.5">
              <div className="text-lg font-bold text-[#0071E3]">{report.rain_sessions}</div>{t('mr.statRain')}
            </div>
            <div className="flex-1 rounded-[10px] bg-[#F2F2F7] py-1.5">
              <div className="text-lg font-bold text-[#F5A623]">{report.gamble_wins}</div>{t('mr.statWin')}
            </div>
          </div>
          <ul className="mt-1 divide-y divide-black/5">
            {report.sessions.slice(0, 8).map((s) => <SessionRow key={s.played_at} s={s} />)}
          </ul>
        </>
      )}

      {/* recovery code */}
      <button onClick={() => setCodeOpen((v) => !v)}
              className="mt-2 flex items-center gap-1 text-[10px] text-[#007AFF]">
        <Icon name="people" className="h-3 w-3" />
        {t('mr.recover')}
      </button>
      {codeOpen && (
        <div className="mt-2 rounded-[10px] bg-[#F2F2F7] p-2.5">
          <p className="text-[10px] text-[#6D6D72]">{t('mr.codeCurrent')}</p>
          <p className="mt-0.5 break-all font-mono text-[11px] font-semibold text-[#3C3C43]">{deviceId}</p>
          <div className="mt-2 flex gap-1.5">
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
                   placeholder={t('mr.codePlaceholder')}
                   className="min-w-0 flex-1 rounded-[8px] border-0 bg-white px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-[#0071E3]/40" />
            <button onClick={claim}
                    className="shrink-0 rounded-[8px] bg-[#007AFF] px-2.5 py-1.5 text-[11px] font-semibold text-white">
              {t('mr.claim')}
            </button>
          </div>
          {codeMsg && <p className="mt-1 text-[10px] text-[#007AFF]">{codeMsg}</p>}
        </div>
      )}
    </section>
  );
}
