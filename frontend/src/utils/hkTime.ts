/** All weather timestamps are Hong Kong local time. Older API responses omit
 * the offset; never let the device's timezone reinterpret those timestamps. */
export const HK_TIME_ZONE = 'Asia/Hong_Kong';
export const HOUR_MS = 60 * 60 * 1000;

export function hkTimestamp(value: string | number | Date): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const text = value.trim();
  if (!text) return Number.NaN;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return Date.parse(hasOffset ? normalized : `${normalized}+08:00`);
}

export function hkFormat(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  locale = 'en-GB',
): string {
  const timestamp = hkTimestamp(value);
  if (!Number.isFinite(timestamp)) return '—';
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: HK_TIME_ZONE }).format(timestamp);
}

export function hkDateKey(value: string | number | Date = Date.now()): string {
  const timestamp = hkTimestamp(value);
  if (!Number.isFinite(timestamp)) return '';
  // sv-SE renders stable YYYY-MM-DD using the explicitly selected timezone.
  return hkFormat(timestamp, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'sv-SE');
}

export function hkHour(value: string | number | Date = Date.now()): number {
  return Number(hkFormat(value, { hour: '2-digit', hourCycle: 'h23' }));
}

/** Epoch start of the containing Hong Kong hour (HK has no DST). */
export function hkFloorHour(value: string | number | Date = Date.now()): number {
  return Math.floor(hkTimestamp(value) / HOUR_MS) * HOUR_MS;
}
