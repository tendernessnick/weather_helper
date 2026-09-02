import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CheckinReport as ReportData, CheckinSession } from '../types';
import { getDeviceId } from '../device';
import Icon from './Icon';

const TAG_STYLE: Record<string, { label: string; cls: string }> = {
  win: { label: '赌赢', cls: 'bg-[#E8F8ED] text-[#1B7A3D]' },
  clean: { label: '稳稳的', cls: 'bg-[#F2F2F7] text-[#3C3C43]' },
  ambush: { label: '漏网之鱼', cls: 'bg-[#FFE5E5] text-[#C0392B]' },
  hit: { label: '有言在先', cls: 'bg-[#E5F1FB] text-[#0071E3]' },
};

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function SessionRow({ s }: { s: CheckinSession }) {
  const tag = TAG_STYLE[s.tag] ?? TAG_STYLE.clean;
  return (
    <li className="flex items-center gap-2 py-1.5 text-[12px]">
      <span className="w-9 shrink-0 text-[#8E8E93]">{fmtDay(s.played_at)}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{s.court_name}</span>
      <span className="text-[10px] text-[#8E8E93]">{s.duration_hours}h</span>
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tag.cls}`}>
        {tag.label}
      </span>
    </li>
  );
}

export default function MyReportCard() {
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
        setCodeMsg('这个码名下没有记录，请检查输入');
        return;
      }
      localStorage.setItem('wh_device_id', code.toLowerCase());
      setCodeMsg(`已认领（${r.checkins} 次打卡 · ${r.reports} 次上报），刷新后生效`);
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setCodeMsg(String((err as Error).message ?? err));
    }
  };

  return (
    <section className="ios-card mx-4 mt-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold tracking-tight">我的战报</h2>
        {report && report.total > 0 && (
          <span className="text-[10px] text-[#8E8E93]">共 {report.total} 场</span>
        )}
      </div>

      {report === null ? (
        <p className="mt-1 text-[11px] text-[#8E8E93]">加载中…</p>
      ) : report.total === 0 ? (
        <p className="mt-1 text-[11px] leading-relaxed text-[#6D6D72]">
          打完球在球场页点「打卡」，这里会用本站实测档案自动回顾：
          哪几场全程无雨、哪场预报说不会下却被淋（漏网之鱼）、哪场你顶着预报赌赢了。
        </p>
      ) : (
        <>
          <div className="mt-2 flex gap-2 text-center text-[10px]">
            <div className="flex-1 rounded-[10px] bg-[#F2F2F7] py-1.5">
              <div className="text-lg font-bold text-[#1B7A3D]">{report.total}</div>总场次
            </div>
            <div className="flex-1 rounded-[10px] bg-[#F2F2F7] py-1.5">
              <div className="text-lg font-bold text-[#0071E3]">{report.rain_sessions}</div>遇雨场次
            </div>
            <div className="flex-1 rounded-[10px] bg-[#F2F2F7] py-1.5">
              <div className="text-lg font-bold text-[#F5A623]">{report.gamble_wins}</div>赌赢次数
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
        换手机/清过数据？用通行码找回战报
      </button>
      {codeOpen && (
        <div className="mt-2 rounded-[10px] bg-[#F2F2F7] p-2.5">
          <p className="text-[10px] text-[#6D6D72]">当前通行码（复制保存）：</p>
          <p className="mt-0.5 break-all font-mono text-[11px] font-semibold text-[#3C3C43]">{deviceId}</p>
          <div className="mt-2 flex gap-1.5">
            <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
                   placeholder="在新设备输入旧通行码认领"
                   className="min-w-0 flex-1 rounded-[8px] border-0 bg-white px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-[#0071E3]/40" />
            <button onClick={claim}
                    className="shrink-0 rounded-[8px] bg-[#007AFF] px-2.5 py-1.5 text-[11px] font-semibold text-white">
              认领
            </button>
          </div>
          {codeMsg && <p className="mt-1 text-[10px] text-[#007AFF]">{codeMsg}</p>}
        </div>
      )}
    </section>
  );
}
