"""ORM models. All datetimes are naive Hong Kong local time (UTC+8, no DST)."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Court(Base):
    __tablename__ = "courts"

    # LCSD GIHS venue code is stable and unique across refreshes.
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name_en: Mapped[str] = mapped_column(String(200))
    name_tc: Mapped[str] = mapped_column(String(200))
    name_sc: Mapped[str] = mapped_column(String(200))
    district_en: Mapped[str] = mapped_column(String(100))
    district_tc: Mapped[str] = mapped_column(String(100))
    address_en: Mapped[str] = mapped_column(Text, default="")
    address_tc: Mapped[str] = mapped_column(Text, default="")
    court_no: Mapped[str] = mapped_column(String(200), default="")
    opening_hours: Mapped[str] = mapped_column(Text, default="")
    phone: Mapped[str] = mapped_column(String(100), default="")
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    # First letter of English name, used for the A-Z index.
    letter: Mapped[str] = mapped_column(String(1), index=True)


class ForecastSnapshot(Base):
    """Open-Meteo hourly forecast as issued at fetched_at for target_hour.

    Upserted on every hourly ingest, so a row always holds the most recent
    forecast made before its target hour - exactly what a user saw.
    """

    __tablename__ = "forecast_snapshots"
    __table_args__ = (UniqueConstraint("court_id", "target_hour", name="uq_fc_court_hour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(20), default="open_meteo")
    target_hour: Mapped[datetime] = mapped_column(DateTime, index=True)
    precip_prob: Mapped[int] = mapped_column(Integer)  # percent 0-100
    precip_mm: Mapped[float] = mapped_column(Float, default=0.0)
    weather_code: Mapped[int] = mapped_column(Integer, default=0)
    wind_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    apparent_temp: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity: Mapped[float | None] = mapped_column(Float, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class NowcastSnapshot(Base):
    """HKO F3 gridded rainfall nowcast for one court at one issue time.

    steps_json: [{"ending": "2026-09-02T12:42", "mm": 0.0}, ...]
    (4 steps of 30-minute accumulated rainfall, target window up to +2h)
    """

    __tablename__ = "nowcast_snapshots"
    __table_args__ = (UniqueConstraint("court_id", "fetched_at", name="uq_nc_court_fetch"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    steps_json: Mapped[str] = mapped_column(Text)


class Observation(Base):
    """Hourly ground truth for a court, derived from the nearest HKO rain gauge."""

    __tablename__ = "observations"
    __table_args__ = (UniqueConstraint("court_id", "observed_hour", name="uq_obs_court_hour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    observed_hour: Mapped[datetime] = mapped_column(DateTime, index=True)
    station_name: Mapped[str] = mapped_column(String(100))
    rainfall_mm: Mapped[float] = mapped_column(Float)
    rain: Mapped[bool] = mapped_column(Boolean)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)


class UserReport(Base):
    """A user-submitted "is it raining here right now" report near a court."""

    __tablename__ = "user_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    was_raining: Mapped[bool] = mapped_column(Boolean)
    intensity: Mapped[str] = mapped_column(String(10))  # none/light/moderate/heavy
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    # accepted | rejected_geofence | rejected_cooldown | rejected_daily_limit |
    # rejected_speed | rejected_bad_data
    status: Mapped[str] = mapped_column(String(30), default="accepted", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    play_at: Mapped[datetime] = mapped_column(DateTime)
    hours_before: Mapped[float] = mapped_column(Float, default=0.5)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class ForecastLead(Base):
    """Open-Meteo forecast as first seen at a given lead-time bucket.

    Frozen on first entry into the bucket (e.g. the l24 row for target hour T
    holds the forecast issued ~24h before T), enabling lead-time decay
    analysis. Kept on the 30-day purge cycle.
    """

    __tablename__ = "forecast_leads"
    __table_args__ = (UniqueConstraint("court_id", "target_hour", "lead_bucket",
                                        name="uq_fl_court_hour_bucket"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    target_hour: Mapped[datetime] = mapped_column(DateTime, index=True)
    lead_bucket: Mapped[str] = mapped_column(String(4))  # l3 | l12 | l24 | l48
    precip_prob: Mapped[int] = mapped_column(Integer)
    precip_mm: Mapped[float] = mapped_column(Float, default=0.0)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)


class Climatology(Base):
    """10-year hourly rain frequency per court, month and hour-of-day.

    Derived from the Open-Meteo ERA5 archive (~11km grid) once via backfill;
    the raw series is never stored, only these aggregates.
    """

    __tablename__ = "climatology"
    __table_args__ = (UniqueConstraint("court_id", "month", "hour", name="uq_clim_court_mh"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    month: Mapped[int] = mapped_column(Integer)
    hour: Mapped[int] = mapped_column(Integer)
    samples: Mapped[int] = mapped_column(Integer)
    rain_count: Mapped[int] = mapped_column(Integer)


class Persistence(Base):
    """Monthly rain persistence per court from the 10-year archive.

    Transitions are 1-hour Markov counts; survival_json maps booking length
    L (1..4 hours) to P(next L hours all dry | dry now), the direct answer to
    "will my 2-hour booking stay dry".
    """

    __tablename__ = "persistence"
    __table_args__ = (UniqueConstraint("court_id", "month", name="uq_persist_court_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    month: Mapped[int] = mapped_column(Integer)
    wet_to_wet: Mapped[int] = mapped_column(Integer, default=0)
    wet_to_dry: Mapped[int] = mapped_column(Integer, default=0)
    dry_to_wet: Mapped[int] = mapped_column(Integer, default=0)
    dry_to_dry: Mapped[int] = mapped_column(Integer, default=0)
    survival_json: Mapped[str] = mapped_column(Text, default="{}")


class CheckIn(Base):
    """A player's "I played here" log entry (personal, keyed by device_id).

    Personal history only - never mixed into public scoring pools. The
    retrospective report joins each check-in against our own observation
    archive to tell the weather story of that session.
    """

    __tablename__ = "checkins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    court_id: Mapped[str] = mapped_column(String(32), index=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    played_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    duration_hours: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class Feedback(Base):
    """Free-form user feedback (suggestions, bugs, data fixes) for the admin.

    Not tied to any weather pipeline - just an inbox: submitted, listed in
    the admin dashboard, and walked through status by the admin.
    """

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    court_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # suggestion | bug | data | other
    category: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text)
    page: Mapped[str] = mapped_column(String(200), default="")
    # new | ack | resolved | dismissed
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    admin_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class KvCache(Base):
    """Small cache for upstream payloads shown verbatim (current weather, etc.)."""

    __tablename__ = "kv_cache"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class VisitLog(Base):
    """One page-load hit, attributed to an acquisition source.

    The client sends ?from=/utm_source= values (e.g. a partner app's button);
    the first source seen on a device sticks for first-touch attribution.
    Kept ~180 days so referral traffic is comparable across a whole season.
    """

    __tablename__ = "visits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(40), default="direct", index=True)
    path: Mapped[str] = mapped_column(String(200), default="/")
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
