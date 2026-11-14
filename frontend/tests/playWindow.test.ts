import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePlayWindow as evaluate, hourRisk, riskZone, resolvePlayStart } from '../src/utils/playWindow.ts';
import type { ForecastHour, FreshnessInfo } from '../src/utils/playWindow.ts';
import { hkDateKey, hkFloorHour, hkFormat, hkHour, hkTimestamp } from '../src/utils/hkTime.ts';
import type { HourlyItem } from '../src/types.ts';

const now = hkTimestamp('2026-11-14T17:30:00+08:00');
function evaluatePlayWindow(hourly: ForecastHour[], start: string | number, durationHours: number,
  at = now, source?: FreshnessInfo, radar?: FreshnessInfo, online = true) {
  return evaluate(hourly, start, durationHours, at, source ?? {
    status: 'fresh', fetched_at: new Date(hkFloorHour(at)).toISOString(), max_age_minutes: 180,
  }, radar, online);
}
function hour(at: string, risk = 10, fetchedAt = '2026-11-14T17:00:00+08:00'): HourlyItem {
  return { hour: at, fetched_at: fetchedAt, stale: false, pop: risk, corrected_pop: risk,
    mm: 0, weather_code: 0, wind_kmh: 5 };
}

test('naive weather timestamps remain Hong Kong time on any device', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['America/Phoenix', 'UTC', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(hkTimestamp('2026-11-14T18:00:00'), hkTimestamp('2026-11-14T10:00:00Z'));
      assert.equal(hkFormat('2026-11-14T18:00:00'), '18:00');
      assert.equal(hkDateKey('2026-11-14T18:00:00Z'), '2026-11-15');
      assert.equal(hkHour('2026-11-14T18:00:00Z'), 2);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('session takes the highest hour, not the first hour or an event probability', () => {
  const result = evaluatePlayWindow([hour('2026-11-14T18:00', 10), hour('2026-11-14T19:00', 70)], '2026-11-14T18:00', 2, now);
  assert.equal(result.peak, 70);
  assert.equal(result.zone, 'no');
  assert.equal(result.covered, 2);
  assert.equal(result.reason, null);
});

test('window ignores rain outside selected session', () => {
  const result = evaluatePlayWindow([hour('2026-11-14T18:00', 10), hour('2026-11-14T19:00', 80)], '2026-11-14T18:00', 1, now);
  assert.equal(result.peak, 10);
  assert.equal(result.zone, 'go');
});

test('risk boundaries agree with backend (30 is lower, 60 is moderate)', () => {
  assert.equal(riskZone(30), 'go');
  assert.equal(riskZone(31), 'edge');
  assert.equal(riskZone(60), 'edge');
  assert.equal(riskZone(61), 'no');
});

test('a missing interior hour cannot produce a green verdict', () => {
  const result = evaluatePlayWindow([hour('2026-11-14T18:00'), hour('2026-11-14T20:00')], '2026-11-14T18:00', 3, now);
  assert.equal(result.reason, 'partial');
  assert.equal(result.zone, null);
  assert.equal(result.slots[1].item, null);
});

test('an outdated low forecast cannot produce a green verdict', () => {
  const result = evaluatePlayWindow([hour('2026-11-14T18:00', 0, '2026-11-14T12:00')], '2026-11-14T18:00', 1, now);
  assert.equal(result.reason, 'stale');
  assert.equal(result.zone, null);
});

test('missing or future issue timestamps do not imply fresh data', () => {
  const withoutIssue = hour('2026-11-14T18:00');
  delete withoutIssue.fetched_at;
  assert.equal(evaluate([withoutIssue], withoutIssue.hour, 1, now).reason, 'stale');
  const futureIssue = hour('2026-11-14T18:00', 0, '2026-11-14T18:00');
  assert.equal(evaluatePlayWindow([futureIssue], futureIssue.hour, 1, now).reason, 'stale');
});

test('stale or missing source metadata overrides a fresh-looking per-hour timestamp', () => {
  const item = hour('2026-11-14T18:00');
  const result = evaluatePlayWindow([item], item.hour, 1, now,
    { status: 'stale', fetched_at: '2026-11-14T10:00', max_age_minutes: 180 });
  assert.equal(result.zone, null);
  assert.equal(result.reason, 'stale');
  assert.equal(evaluatePlayWindow([item], item.hour, 1, now,
    { status: 'missing', fetched_at: '2026-11-14T17:00', max_age_minutes: 180 }).zone, null);
  assert.equal(evaluate([item], item.hour, 1, now).zone, null);
});

test('cross-midnight coverage uses full dates', () => {
  const result = evaluatePlayWindow([hour('2026-11-14T23:00', 10, '2026-11-14T22:00'), hour('2026-11-15T00:00', 40, '2026-11-14T22:00')],
    '2026-11-14T23:00', 2, hkTimestamp('2026-11-14T22:30'));
  assert.equal(result.covered, 2);
  assert.equal(result.zone, 'edge');
  assert.equal(hkFormat(result.end), '01:00');
});

test('no rows, invalid risks and a passed start fail closed', () => {
  assert.equal(evaluatePlayWindow([], '2026-11-14T18:00', 2, now).reason, 'missing');
  const invalid = hour('2026-11-14T18:00', Number.NaN);
  assert.equal(hourRisk(invalid), null);
  assert.equal(evaluatePlayWindow([invalid], invalid.hour, 1, now).zone, null);
  assert.equal(evaluatePlayWindow([hour('2026-11-14T17:00')], '2026-11-14T17:00', 1, now).reason, 'past');
});

test('fused value has priority without silently accepting nonfinite values', () => {
  const item = { ...hour('2026-11-14T18:00', 10), fused_pop: 80 };
  assert.equal(hourRisk(item), 80);
  assert.equal(hourRisk({ ...item, fused_pop: Infinity }), null);
});

test('radar contribution cannot remain green after its 25-minute freshness window', () => {
  const item = { ...hour('2026-11-14T18:00', 10), fused_pop: 3, fused_swirls: true };
  const radar = { status: 'fresh' as const, fetched_at: '2026-11-14T17:20', max_age_minutes: 25 };
  assert.equal(evaluatePlayWindow([item], item.hour, 1, now, undefined, radar).zone, 'go');
  const later = hkTimestamp('2026-11-14T17:46');
  assert.equal(evaluatePlayWindow([item], item.hour, 1, later, undefined, radar).reason, 'stale');
});

test('offline retained data cannot produce a lower-risk verdict', () => {
  const item = hour('2026-11-14T18:00');
  const result = evaluatePlayWindow([item], item.hour, 1, now, undefined, undefined, false);
  assert.equal(result.reason, 'offline');
  assert.equal(result.zone, null);
});

test('an explicit linked hour remains selected even when its forecast is missing', () => {
  const available = [hkTimestamp('2026-11-14T18:00'), hkTimestamp('2026-11-14T20:00')];
  const selected = resolvePlayStart(available, '2026-11-14T19:00');
  assert.equal(selected, hkTimestamp('2026-11-14T19:00'));
  const result = evaluatePlayWindow(available.map((at) => hour(new Date(at).toISOString())), selected!, 1);
  assert.equal(result.reason, 'missing');
  assert.equal(resolvePlayStart(available, null), available[0]);
  assert.equal(resolvePlayStart(available, 'invalid'), available[0]);
});

test('a linked hour that passed while the page stayed open is not silently replaced', () => {
  const selected = resolvePlayStart([hkTimestamp('2026-11-14T19:00')], '2026-11-14T18:00');
  assert.equal(selected, hkTimestamp('2026-11-14T18:00'));
});
