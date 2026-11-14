import { useLang } from '../i18n';

export default function RequestError({ onRetry }: { onRetry: () => void }) {
  const { lang } = useLang();
  const message = lang === 'en' ? 'Weather could not be loaded. Check your connection and try again.'
    : lang === 'hant' ? '未能載入天氣，請檢查網絡後重試。' : '未能加载天气，请检查网络后重试。';
  return <div role="alert" className="ios-card mx-4 my-4 p-4 text-sm text-slate-700">
    <p>{message}</p>
    <button onClick={onRetry} className="mt-2 min-h-11 rounded-full bg-blue-700 px-5 font-semibold text-white">
      {lang === 'en' ? 'Try again' : lang === 'hant' ? '重新載入' : '重新加载'}
    </button>
  </div>;
}
