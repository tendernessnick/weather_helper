"""Global configuration, read from environment variables with sensible defaults."""
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# Hong Kong has no DST; a fixed UTC+8 offset keeps all HKO/Open-Meteo local-time
# arithmetic simple and dependency-free.
HK_TZ = timezone(timedelta(hours=8))


def hk_now() -> datetime:
    return datetime.now(HK_TZ).replace(tzinfo=None)


def floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get(
        "DATABASE_URL", "sqlite:///./weather.db"))

    # --- verification rules ---
    window_days: int = field(default_factory=lambda: _env_int("WINDOW_DAYS", 30))
    rain_mm_threshold: float = field(default_factory=lambda: _env_float("RAIN_MM_THRESHOLD", 0.1))
    nowcast_mm_threshold: float = field(default_factory=lambda: _env_float("NOWCAST_MM_THRESHOLD", 0.05))
    pop_rain_threshold: int = field(default_factory=lambda: _env_int("POP_RAIN_THRESHOLD", 50))
    min_samples: int = field(default_factory=lambda: _env_int("MIN_SAMPLES", 20))

    # --- anti-abuse rules ---
    geofence_meters: float = field(default_factory=lambda: _env_float("GEOFENCE_METERS", 500))
    max_gps_accuracy_meters: float = field(default_factory=lambda: _env_float("MAX_GPS_ACCURACY_METERS", 300))
    cooldown_hours: float = field(default_factory=lambda: _env_float("REPORT_COOLDOWN_HOURS", 2))
    daily_report_limit: int = field(default_factory=lambda: _env_int("DAILY_REPORT_LIMIT", 10))
    max_speed_kmh: float = field(default_factory=lambda: _env_float("MAX_SPEED_KMH", 250))

    # --- web push (optional; push API disabled when not set) ---
    vapid_private_key: str = field(default_factory=lambda: os.environ.get("VAPID_PRIVATE_KEY", ""))
    vapid_public_key: str = field(default_factory=lambda: os.environ.get("VAPID_PUBLIC_KEY", ""))
    vapid_subject: str = field(default_factory=lambda: os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com"))

    admin_token: str = field(default_factory=lambda: os.environ.get("ADMIN_TOKEN", ""))
    cors_origins: str = field(default_factory=lambda: os.environ.get("CORS_ORIGINS", "*"))

    # --- upstream sources ---
    lcsd_courts_url: str = "https://www.lcsd.gov.hk/datagovhk/facility/facility-tc.json"
    hko_hourly_rainfall_url: str = "https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php?lang=en"
    hko_rhrread_url: str = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en"
    hko_nowcast_csv_url: str = "https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv"
    open_meteo_url: str = "https://api.open-meteo.com/v1/forecast"


settings = Settings()
