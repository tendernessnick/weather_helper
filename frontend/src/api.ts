import { getDeviceId } from './device';
import type {
  AdminActivity, AdminOverview, BestResponse, CalibrationInfo, CheckinReport,
  CourtListItem, CourtRankRow, CourtScores, DisagreementStats, DryRanking,
  HourProfileRow, LatestReport, LeadBucket, QualityTrend, RecentReport,
  Reminder, ReportStatus, StatsOverview, WeatherResponse,
} from './types';

const DEVICE_ID = getDeviceId();

export class ApiError extends Error {
  detail: unknown;
  status: number;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': DEVICE_ID,
      ...(init?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    let detail: unknown = null;
    try {
      detail = await resp.json();
    } catch {
      /* non-JSON error body */
    }
    const message =
      typeof detail === 'object' && detail !== null && 'detail' in detail
        ? detailMessage((detail as Record<string, unknown>).detail)
        : `request failed (${resp.status})`;
    throw new ApiError(resp.status, message, detail);
  }
  return resp.json() as Promise<T>;
}

function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    return String((detail as Record<string, unknown>).message);
  }
  return 'request failed';
}

export const api = {
  courts: (search: string, prefix: string) =>
    request<{ total: number; courts: CourtListItem[] }>(
      `/api/courts?search=${encodeURIComponent(search)}&prefix=${prefix}`),

  courtScores: (id: string) => request<CourtScores>(`/api/courts/${id}/scores`),

  courtWeather: (id: string) => request<WeatherResponse>(`/api/courts/${id}/weather`),

  reportStatus: (courtId: string) =>
    request<ReportStatus>(`/api/reports/status?court_id=${encodeURIComponent(courtId)}`),

  submitReport: (body: {
    court_id: string; intensity: string; lat: number; lon: number;
    accuracy_m: number | null;
  }) => request<{ status: string; cooldown_remaining_sec: number }>('/api/reports', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  pushPublicKey: () =>
    request<{ enabled: boolean; public_key: string | null }>('/api/push/public-key'),

  subscribe: (body: {
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    court_id: string;
    play_at: string;
    hours_before: number;
  }) => request<{ status: string }>('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  subscribePolling: (body: {
    court_id: string;
    play_at: string;
    hours_before: number;
  }) => request<{ status: string; mode: string }>('/api/subscriptions/polling', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  checkReminders: () =>
    request<{ reminders: Reminder[] }>('/api/reminders/check'),

  statsOverview: () => request<StatsOverview>('/api/stats/overview'),

  leadDecay: () =>
    request<Record<'l3' | 'l12' | 'l24' | 'l48', LeadBucket>>('/api/stats/lead-decay'),

  hourlyProfile: () =>
    request<{ threshold_pct: number; profile: HourProfileRow[] }>('/api/stats/hourly-profile'),

  courtsRanking: () =>
    request<{ group_rate: number | null; courts: CourtRankRow[] }>('/api/stats/courts'),

  qualityTrend: (days: number) =>
    request<QualityTrend>(`/api/stats/quality-trend?days=${days}`),

  dryRanking: (month: number) =>
    request<DryRanking>(`/api/stats/dry-ranking?month=${month}`),

  disagreement: () => request<DisagreementStats>('/api/stats/disagreement'),

  courtCalibration: (id: string) =>
    request<CalibrationInfo>(`/api/courts/${id}/calibration`),

  recentReports: (id: string) =>
    request<{ reports: RecentReport[] }>(`/api/courts/${id}/reports/recent`),

  latestReports: (limit: number = 5) =>
    request<{ reports: LatestReport[] }>(`/api/reports/latest?limit=${limit}`),

  health: () =>
    request<{ status: string; db: Record<string, string | number | null> }>('/api/health'),

  best: (hour?: string) =>
    request<BestResponse>(`/api/best${hour ? `?hour=${encodeURIComponent(hour)}` : ''}`),

  checkin: (courtId: string, durationHours: number) =>
    request<{ status: string }>('/api/checkins', {
      method: 'POST',
      body: JSON.stringify({ court_id: courtId, duration_hours: durationHours }),
    }),

  myReport: () => request<CheckinReport>('/api/checkins/report'),

  peekCode: (code: string) =>
    request<{ exists: boolean; checkins: number; reports: number }>(
      `/api/checkins/peek?code=${encodeURIComponent(code)}`),

  adminOverview: (token: string) =>
    request<AdminOverview>('/api/admin/overview', {
      headers: { 'X-Admin-Token': token },
    }),

  adminActivity: (token: string, days: number) =>
    request<AdminActivity>(`/api/admin/activity?days=${days}`, {
      headers: { 'X-Admin-Token': token },
    }),
};
