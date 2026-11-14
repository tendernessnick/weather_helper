import { useFavorites } from '../hooks/useFavorites';
import { useLang } from '../i18n';

export default function FavoriteButton({ courtId }: { courtId: string }) {
  const { lang } = useLang();
  const { favorites, toggle } = useFavorites();
  const active = favorites.includes(courtId);
  const label = lang === 'en' ? (active ? 'Remove from favourites' : 'Save court')
    : lang === 'hant' ? (active ? '取消收藏' : '收藏球場') : (active ? '取消收藏' : '收藏球场');
  return <button type="button" aria-label={label} title={label} aria-pressed={active}
    onClick={() => toggle(courtId)}
    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl ${active ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white/70 text-slate-500'}`}>
    <span aria-hidden="true">{active ? '★' : '☆'}</span>
  </button>;
}
