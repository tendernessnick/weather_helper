import { Route, Routes } from 'react-router-dom';
import CourtList from './pages/CourtList';
import CourtDetail from './pages/CourtDetail';
import ReminderPoller from './components/ReminderPoller';

export default function App() {
  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>🎾</span>
            <div>
              <div className="text-base font-bold leading-tight">网球天气助手</div>
              <div className="text-[11px] leading-tight text-slate-500">
                香港政府球场 · 逐小时降雨 · 实况验证
              </div>
            </div>
          </a>
        </div>
      </header>

      <main className="pb-16">
        <Routes>
          <Route path="/" element={<CourtList />} />
          <Route path="/courts/:id" element={<CourtDetail />} />
          <Route path="*" element={
            <div className="p-8 text-center text-slate-500">页面不存在</div>
          } />
        </Routes>
      </main>

      <ReminderPoller />

      <footer className="px-4 pb-6 text-center text-[11px] leading-relaxed text-slate-500">
        预报数据：香港天文台 SWIRLS 临近预报（0-2小时）· Open-Meteo 集合预报（逐小时概率）<br />
        实况验证：天文台自动站雨量 + 球友众包上报 · 仅供出行参考
      </footer>
    </div>
  );
}
