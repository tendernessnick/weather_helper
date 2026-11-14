import type { HourlyItem } from '../types';
import { HOUR_MS, hkFloorHour, hkTimestamp } from './hkTime';

export type RiskZone = 'go' | 'edge' | 'no';
export type ForecastHour = HourlyItem & { fetched_at?: string | null; stale?: boolean };
export interface FreshnessInfo {
  status: 'fresh' | 'stale' | 'missing';
  fetched_at: string | null;
  age_minutes?: number | null;
  max_age_minutes: number;
}
export type WindowReason = 'missing' | 'partial' | 'stale' | 'past' | 'offline' | null;

/** Risk is an index. Do not combine hourly indices into an event probability. */
export function hourRisk(item: HourlyItem): number | null {
  const value = item.fused_pop ?? item.corrected_pop ?? item.pop;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function riskZone(risk: number): RiskZone {
  return risk > 60 ? 'no' : risk > 30 ? 'edge' : 'go';
}

export function sourceIsFresh(source: FreshnessInfo | undefined, now: number): boolean {
  if (!source?.fetched_at || source.status !== 'fresh') return false;
  const age = now - hkTimestamp(source.fetched_at);
  return Number.isFinite(age) && age >= 0 && age <= source.max_age_minutes * 60000;
}

export function hourIsStale(item: ForecastHour, now: number, source?: FreshnessInfo, radarSource?: FreshnessInfo): boolean {
  if (!sourceIsFresh(source, now)) return true;
  if (item.stale) return true;
  // The row's ensemble issue time may remain fresh for three hours while its
  // radar contribution expires after 25 minutes. Do not keep a radar-based
  // green verdict alive just because the page remained open.
  if (item.fused_swirls && !sourceIsFresh(radarSource, now)) return true;
  const fetchedAt = item.fetched_at ?? source?.fetched_at;
  if (!fetchedAt) return true;
  const age = now - hkTimestamp(fetchedAt);
  return !Number.isFinite(age) || age < 0 || age > (source?.max_age_minutes ?? 180) * 60000;
}

export function evaluatePlayWindow(
  hourly: ForecastHour[], start: string | number, durationHours: number,
  now = Date.now(), source?: FreshnessInfo, radarSource?: FreshnessInfo, online = true,
) {
  const from = hkTimestamp(start);
  const duration = Number.isInteger(durationHours) && durationHours >= 1 && durationHours <= 3 ? durationHours : 1;
  const end = from + duration * HOUR_MS;
  const byHour = new Map(hourly.map((item) => [hkTimestamp(item.hour), item]));
  const slots: { hour: number; item: ForecastHour | null; risk: number | null; stale: boolean }[] = [];
  if (Number.isFinite(from)) {
    for (let at = hkFloorHour(from); at < end; at += HOUR_MS) {
      const item = byHour.get(at) ?? null;
      slots.push({ hour: at, item, risk: item ? hourRisk(item) : null, stale: item ? hourIsStale(item, now, source, radarSource) : false });
    }
  }
  const covered = slots.filter((slot) => slot.item !== null && slot.risk !== null);
  const peak = covered.length ? Math.max(...covered.map((slot) => slot.risk!)) : null;
  const reason: WindowReason = !online ? 'offline'
    : !Number.isFinite(from) || covered.length === 0 ? 'missing'
    : from < now ? 'past'
      : covered.length !== slots.length ? 'partial'
        : covered.some((slot) => slot.stale) ? 'stale' : null;
  return { start: from, end, slots, covered: covered.length, peak, reason, zone: reason || peak === null ? null : riskZone(peak) };
}

/** Preserve an explicitly linked whole-hour choice even when the forecast for
 * that hour is missing or the time has since passed. Changing it silently
 * would answer a different question from the one the player selected. */
export function resolvePlayStart(available: number[], requested: string | null): number | undefined {
  const parsed = requested ? hkTimestamp(requested) : Number.NaN;
  return Number.isFinite(parsed) && parsed === hkFloorHour(parsed) ? parsed : available[0];
}
