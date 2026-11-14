import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import ReminderPoller from './components/ReminderPoller';
import FeedbackSheet from './components/FeedbackSheet';
import Icon from './components/Icon';
import { LANG_META, useLang, useT } from './i18n';
import type { Lang } from './i18n';

const Home = lazy(() => import('./pages/Home'));
const CourtList = lazy(() => import('./pages/CourtList'));
const CourtDetail = lazy(() => import('./pages/CourtDetail'));
const Best = lazy(() => import('./pages/Best'));
const Insights = lazy(() => import('./pages/Insights'));
const Admin = lazy(() => import('./pages/Admin'));

function SegmentedTabs() {
  const { t } = useLang();
  const tabs = [
    { to: '/courts', label: t('tab.courts') },
    { to: '/best', label: t('tab.best') },
    { to: '/insights', label: t('tab.insights') },
  ];
  return (
    <nav aria-label={t('app.navigation')} className="flex rounded-[10px] bg-[#E9E9EB] p-[2px] text-[13px] font-semibold">
      {tabs.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/courts'}
          className={({ isActive }) =>
            `whitespace-nowrap rounded-[8px] min-h-11 flex items-center justify-center px-3 py-1 transition-colors ${
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
      className="min-h-11 shrink-0 rounded-full bg-[#E9E9EB] px-2.5 py-1 text-[12px] font-semibold text-[#3C3C43] active:bg-[#D8D8DC]"
    >
      {LANG_META.find((m) => m.id === next[lang])?.label}
    </button>
  );
}

export default function App() {
  const t = useT();
  const [fbOpen, setFbOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const location = useLocation();
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [location.pathname]);
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
        <a href="#main-content" className="skip-link">{t('app.skip')}</a>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2.5">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#34C759] text-white">
              <Icon name="ball" className="h-5 w-5" strokeWidth={1.6} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold leading-tight tracking-tight">{t('app.title')}</div>
              <div className="truncate text-[10px] leading-tight text-[#8E8E93]">
                {t('app.subtitle')}
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-1 max-[480px]:w-full max-[480px]:justify-between">
            <LangButton />
            <SegmentedTabs />
          </div>
        </div>
      </header>

      {!online && <div role="status" className="border-y border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('app.offline')}</div>}
      <main id="main-content" tabIndex={-1} className="pb-16">
        <Suspense fallback={<div role="status" className="p-8 text-center text-sm text-slate-600">{t('common.loading')}</div>}>
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
        </Suspense>
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
