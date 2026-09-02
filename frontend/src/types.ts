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

export interface ComfortInfo {
  level: 'good' | 'fair' | 'poor' | 'severe' | null;
  note: string;
}

export interface HourlyItem {
  hour: string;
  pop: number;
  corrected_pop?: number;
  climatology_pop?: number | null;
  zone?: 'go' | 'edge' | 'no';
  mm: number;
  weather_code: number;
  wind_kmh: number;
  apparent_temp?: number | null;
  humidity?: number | null;
  comfort?: ComfortInfo;
}

export interface PersistenceCard {
  month: number;
  p_still_wet_next_hour: number | null;
  p_dry_turns_wet_next_hour: number | null;
  dry_survival_1_to_4h: Record<string, number>;
  samples: number;
  grid_note: string;
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
  calibration?: { basis_n: number };
  persistence?: PersistenceCard | null;
  current: CurrentWeather | null;
  warnings: string[];
  sources: Record<string, string>;
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

export interface ReportStatus {
  cooldown_remaining_sec: number;
  reports_today: number;
  daily_limit: number;
}

export interface RecentReport {
  reported_at: string;
  intensity: 'none' | 'light' | 'moderate' | 'heavy';
  was_raining: boolean;
}

export interface CourtRankSimple {
  court_id: string;
  name_sc: string;
  name_tc?: string;
  name_en?: string;
  district_tc: string;
  district_en?: string;
  lat: number;
  lon: number;
  pop: number;
  corrected_pop: number;
  zone: 'go' | 'edge' | 'no';
}

export interface BestResponse {
  hour: string;
  city_median_pop: number | null;
  courts: CourtRankSimple[];
  hours: { hour: string; city_median_pop: number }[];
}

export interface CheckinSession {
  played_at: string;
  court_name: string;
  court_name_tc?: string;
  court_name_en?: string;
  duration_hours: number;
  rain_hours: number;
  max_mm: number;
  forecast_pop: number | null;
  verdict: string;
  tag: 'win' | 'clean' | 'ambush' | 'hit';
  observed: number;
}

export interface CheckinReport {
  total: number;
  rain_sessions: number;
  gamble_wins: number;
  sessions: CheckinSession[];
}

export interface Reminder {
  court_id: string;
  court_name: string;
  court_name_tc?: string;
  court_name_en?: string;
  play_hhmm: string;
  risky: boolean;
  pop: number | null;
}

export interface ReliabilityRow {
  lo: number;
  hi: number;
  n: number;
  mean_forecast: number;
  observed_freq: number;
  ci: [number, number] | null;
}

export interface SourceOverview {
  n: number;
  brier: number | null;
  bss: number | null;
  decomposition: {
    reliability: number; resolution: number; uncertainty: number; base_rate: number;
  } | null;
  reliability?: ReliabilityRow[];
  accuracy: number | null;
  pod: number | null;
  pod_ci: [number, number] | null;
  far: number | null;
  far_ci: [number, number] | null;
  heidke: number | null;
  peirce: number | null;
  hits: number;
  misses: number;
  false_alarms: number;
  correct_negatives: number;
  onsets?: number;
  onset_capture_rate?: number | null;
}

export interface StatsOverview {
  window_days: number;
  open_meteo: SourceOverview;
  hko_f3: SourceOverview;
}

export interface LeadBucket {
  n: number;
  brier: number | null;
  bss: number | null;
  accuracy: number | null;
  pod: number | null;
  far: number | null;
  accumulating: boolean;
}

export interface HourProfileRow {
  hour: number;
  rain_events: number;
  miss_rate: number | null;
  miss_ci: [number, number] | null;
  false_alarms: number;
}

export interface CourtRankRow {
  court_id: string;
  name_sc: string;
  name_tc?: string;
  name_en?: string;
  n: number;
  raw_accuracy: number;
  shrunk_accuracy: number;
  ci: [number, number] | null;
  misses: number;
  false_alarms: number;
  microclimate: boolean;
}

export interface CalibrationInfo {
  basis: 'pooled' | 'court';
  n: number;
  mapping: { official_pct: number; corrected: number }[];
  divergence: {
    n?: number; agreement?: number | null;
    user_rain_station_dry?: number | null; microclimate?: boolean;
  };
  zones: { green_max: number; amber_max: number };
}
