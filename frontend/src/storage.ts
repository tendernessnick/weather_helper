/** localStorage wrapper that survives environments where storage access is
 *  blocked outright (some in-app WebViews throw SecurityError on any touch):
 *  falls back to an in-memory Map so the app keeps working for the session.
 *  Acceptable for device ids, language and admin tokens — the only things we
 *  persist. */
const mem = new Map<string, string>();

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key) ?? mem.get(key) ?? null;
    } catch {
      return mem.get(key) ?? null;
    }
  },
  set(key: string, value: string): void {
    mem.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch { /* storage blocked — memory copy above covers this session */ }
  },
  remove(key: string): void {
    mem.delete(key);
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  },
};
