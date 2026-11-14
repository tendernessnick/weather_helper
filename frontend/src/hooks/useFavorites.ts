import { useSyncExternalStore } from 'react';

const KEY = 'wh_favorite_courts';
let cached: string[] = [];
let memoryOnly = false;
let rawValue: string | null | undefined;
const listeners = new Set<() => void>();

function read(): string[] {
  if (memoryOnly) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== rawValue) {
      rawValue = raw;
      const value: unknown = raw ? JSON.parse(raw) : [];
      cached = Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === 'string'))] : [];
    }
  } catch { /* private mode: keep in-memory favourites */ }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, read);
  const toggle = (id: string) => {
    const current = read();
    cached = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    try {
      rawValue = JSON.stringify(cached);
      localStorage.setItem(KEY, rawValue);
    } catch { memoryOnly = true; }
    listeners.forEach((listener) => listener());
  };
  return { favorites, toggle };
}
