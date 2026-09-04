import { api } from './api';
import { storage } from './storage';

const REF_SOURCE_KEY = 'wh_ref_source';

/** Attribution for one page load: a ?from= / ?utm_source= campaign tag wins
 *  and sticks on the device (first touch), otherwise fall back to the source
 *  remembered from the device's first tagged visit, then "direct". Reports
 *  fire-and-forget — any failure stays silent; tracking must never break UX.
 *  Used to measure referral traffic from partner links (e.g. TennisGo). */
let tracked = false;

export function trackVisit(): void {
  if (tracked) return; // StrictMode double-invokes effects in dev
  tracked = true;
  try {
    const params = new URLSearchParams(window.location.search);
    const tag = (params.get('from') ?? params.get('utm_source') ?? '')
      .trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    const source = tag || storage.get(REF_SOURCE_KEY) || 'direct';
    if (tag) storage.set(REF_SOURCE_KEY, tag);
    api.visit(source, window.location.pathname).catch(() => { /* silent */ });
  } catch {
    /* never let attribution break a page load */
  }
}
