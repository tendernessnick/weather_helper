export interface Court {
  id: string;
  name_en: string;
  name_tc: string;
  name_sc: string;
  district_en: string;
  district_tc: string;
  address_en: string;
  address_tc: string;
  court_no: string;
  opening_hours: string;
  phone: string;
  lat: number;
  lon: number;
  letter: string;
}

export interface NowcastBadge {
  fetched_at: string;
  max_mm: number;
  rain: boolean;
}

export interface CourtSummary {
  n: number;
  accuracy: number | null;
  sufficient_samples: boolean;
}

export interface CourtListItem extends Court {
  nowcast: NowcastBadge | null;
  score: CourtSummary | null;
}

export interface NowcastStep {
  ending: string;
  mm: number;
}

export interface HourlyItem {
  hour: string;
  pop: number;
  mm: number;
  weather_code: number;
  wind_kmh: number;
}

export interface Metrics {
  n: number;
  hits: number;
  misses: number;
  false_alarms: number;
  correct_negatives: number;
  accuracy: number | null;
  pod: number | null;
  far: number | null;
  brier: number | null;
  sufficient_samples: boolean;
}

export interface SourceScores {
  station: Metrics;
  user: Metrics;
}

export interface CourtScores {
  window_days: number;
  min_samples: number;
  open_meteo: SourceScores;
  hko_f3: SourceScores;
}

export interface CurrentWeather {
  icon: number[];
  iconUpdateTime: string;
  temperature?: { data: { place: string; value: number; unit: string }[] };
  humidity?: { data: { place: string; value: number; unit: string }[] };
  uvindex?: string;
  warningMessage?: string[];
  updateTime: string;
  [key: string]: unknown;
}

export interface WeatherResponse {
  court_id: string;
  nowcast: { fetched_at: string | null; steps: NowcastStep[] };
  hourly: HourlyItem[];
  current: CurrentWeather | null;
  warnings: string[];
  sources: Record<string, string>;
}

export interface ReportStatus {
  cooldown_remaining_sec: number;
  reports_today: number;
  daily_limit: number;
}

export interface Reminder {
  court_id: string;
  court_name: string;
  play_hhmm: string;
  risky: boolean;
  pop: number | null;
}
