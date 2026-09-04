import { NavLink, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Home from './pages/Home';
import CourtList from './pages/CourtList';
import CourtDetail from './pages/CourtDetail';
import Best from './pages/Best';
import Insights from './pages/Insights';
import Admin from './pages/Admin';
import ReminderPoller from './components/ReminderPoller';
import FeedbackSheet from './components/FeedbackSheet';
import Icon from './components/Icon';
import { LANG_META, useLang, useT } from './i18n';
import type { Lang } from './i18n';
import { trackVisit } from './referral';

function SegmentedTabs() {
  const { t } = useLang();
  const tabs = [
    { to: '/courts', label: t('tab.courts') },
    { to: '/best', label: t('tab.best') },
    { to: '/insights', label: t('tab.insights') },
  ];
  return (
    <nav className="flex rounded-[10px] bg-[#E9E9EB] p-[2px] text-[13px] font-semibold">
      {tabs.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/courts'}
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
  const [fbOpen, setFbOpen] = useState(false);
  useEffect(() => {
    trackVisit();
  }, []);
  return (
    <div className="relative isolate mx-auto min-h-screen max-w-3xl overflow-hidden">
      {/* atmosphere: dawn-sky gradient + soft color blobs (Apple-weather style) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[#D7E8FF] via-[#ECF0FE] to-[#F7F1EA]" />
        <div className="absolute -left-24 -top-20 h-80 w-80 rounded-full bg-[#8EC5FF]/45 blur-3xl" />
        <div className="absolute -right-28 top-1/4 h-96 w-96 rounded-full bg-[#C9BAFF]/40 blur-3xl" />
        <div className="absolute -left-20 bottom-0 h-80 w-80 rounded-full bg-[#FFD9A8]/45 blur-3xl" />
      </div>

      <header className="sticky top-0 z-20 bg-white/30 backdrop-blur-2xl backdrop-saturate-150">
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
          <Route path="/" element={<Home />} />
          <Route path="/courts" element={<CourtList />} />
          <Route path="/courts/:id" element={<CourtDetail />} />
          <Route path="/best" element={<Best />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={
            <div className="p-8 text-center text-sm text-slate-500">{t('app.404')}</div>
          } />
        </Routes>
      </main>

      <ReminderPoller />

      <footer className="px-4 pb-8 text-center text-[11px] leading-relaxed text-[#8E8E93]">
        {t('app.footer1')}<br />
        {t('app.footer2')}
        <button
          onClick={() => setFbOpen(true)}
          className="mt-2 block w-full text-[12px] font-medium text-[#007AFF] active:opacity-60"
        >
          {t('fb.entry')}
        </button>
      </footer>

      {fbOpen && <FeedbackSheet onClose={() => setFbOpen(false)} />}
    </div>
  );
}
