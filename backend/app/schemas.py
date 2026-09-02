"""Request/response schemas."""
from datetime import datetime

from pydantic import BaseModel, Field


class ReportIn(BaseModel):
    court_id: str
    intensity: str = Field(pattern="^(none|light|moderate|heavy)$")
    lat: float = Field(ge=20, le=24)
    lon: float = Field(ge=112, le=116)
    accuracy_m: float | None = Field(default=None, ge=0, le=10000)


class ReportOut(BaseModel):
    status: str
    reason: str | None = None
    cooldown_remaining_sec: int = 0


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionInfo(BaseModel):
    endpoint: str
    keys: PushKeys


class SubscriptionIn(BaseModel):
    subscription: PushSubscriptionInfo
    court_id: str
    play_at: datetime  # HK local naive time
    hours_before: float = Field(default=0.5, ge=0.1, le=24)


class PollingSubscriptionIn(BaseModel):
    """Reminder delivered by in-page polling (no Web Push service available)."""

    court_id: str
    play_at: datetime  # HK local naive time
    hours_before: float = Field(default=0.5, ge=0.1, le=24)
