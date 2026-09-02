import { NavLink, Route, Routes } from 'react-router-dom';
import CourtList from './pages/CourtList';
import CourtDetail from './pages/CourtDetail';
import Best from './pages/Best';
import Insights from './pages/Insights';
import ReminderPoller from './components/ReminderPoller';
import Icon from './components/Icon';

function SegmentedTabs() {
  const tabs = [
    { to: '/', label: '球场' },
    { to: '/best', label: '去哪打' },
    { to: '/insights', label: '洞察' },
  ];
  return (
    <nav className="flex rounded-[10px] bg-[#E9E9EB] p-[2px] text-[13px] font-semibold">
      {tabs.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `rounded-[8px] px-3 py-1 transition-colors ${
              isActive ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#6D6D72]'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-[#F2F2F7]">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-[#F9F9F9]/90 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-2.5">
          <a href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#34C759] text-white">
              <Icon name="ball" className="h-5 w-5" strokeWidth={1.6} />
            </span>
            <div>
              <div className="text-[15px] font-bold leading-tight tracking-tight">网球天气助手</div>
              <div className="text-[10px] leading-tight text-[#8E8E93]">
                香港政府球场 · 降雨实况验证
              </div>
            </div>
          </a>
          <SegmentedTabs />
        </div>
      </header>

      <main className="pb-16">
        <Routes>
          <Route path="/" element={<CourtList />} />
          <Route path="/courts/:id" element={<CourtDetail />} />
          <Route path="/best" element={<Best />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="*" element={
            <div className="p-8 text-center text-sm text-slate-500">页面不存在</div>
          } />
        </Routes>
      </main>

      <ReminderPoller />

      <footer className="px-4 pb-8 text-center text-[11px] leading-relaxed text-[#8E8E93]">
        预报数据：香港天文台 SWIRLS 临近预报 · Open-Meteo<br />
        实况核对：天文台自动站 + 球友上报 · 仅供参考
      </footer>
    </div>
  );
}
