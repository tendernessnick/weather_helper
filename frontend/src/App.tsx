import { NavLink, Route, Routes } from 'react-router-dom';
import CourtList from './pages/CourtList';
import CourtDetail from './pages/CourtDetail';
import Best from './pages/Best';
import Insights from './pages/Insights';
import ReminderPoller from './components/ReminderPoller';
import Icon from './components/Icon';
import { LANG_META, useLang, useT } from './i18n';
import type { Lang } from './i18n';

function SegmentedTabs() {
  const { t } = useLang();
  const tabs = [
    { to: '/', label: t('tab.courts') },
    { to: '/best', label: t('tab.best') },
    { to: '/insights', label: t('tab.insights') },
  ];
  return (
    <nav className="flex rounded-[10px] bg-[#E9E9EB] p-[2px] text-[13px] font-semibold">
      {tabs.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `whitespace-nowrap rounded-[8px] px-3 py-1 transition-colors ${
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

/** Cycles 简 → 繁 → EN; the label shows the language you'd switch TO. */
function LangButton() {
  const { lang, setLang } = useLang();
  const next: Record<Lang, Lang> = { hans: 'hant', hant: 'en', en: 'hans' };
  return (
    <button
      onClick={() => setLang(next[lang])}
      aria-label="language"
      className="shrink-0 rounded-full bg-[#E9E9EB] px-2.5 py-1 text-[12px] font-semibold text-[#3C3C43] active:bg-[#D8D8DC]"
    >
      {LANG_META.find((m) => m.id === next[lang])?.label}
    </button>
  );
}

export default function App() {
  const t = useT();
  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-[#F2F2F7]">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-[#F9F9F9]/90 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-2.5">
          <a href="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#34C759] text-white">
              <Icon name="ball" className="h-5 w-5" strokeWidth={1.6} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold leading-tight tracking-tight">{t('app.title')}</div>
              <div className="truncate text-[10px] leading-tight text-[#8E8E93]">
                {t('app.subtitle')}
              </div>
            </div>
          </a>
          <div className="flex items-center gap-2">
            <LangButton />
            <SegmentedTabs />
          </div>
        </div>
      </header>

      <main className="pb-16">
        <Routes>
          <Route path="/" element={<CourtList />} />
          <Route path="/courts/:id" element={<CourtDetail />} />
          <Route path="/best" element={<Best />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="*" element={
            <div className="p-8 text-center text-sm text-slate-500">{t('app.404')}</div>
          } />
        </Routes>
      </main>

      <ReminderPoller />

      <footer className="px-4 pb-8 text-center text-[11px] leading-relaxed text-[#8E8E93]">
        {t('app.footer1')}<br />
        {t('app.footer2')}
      </footer>
    </div>
  );
}
