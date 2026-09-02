"""Coordinate helpers: LCSD DMS parsing and haversine distance."""
import math
from typing import Final

EARTH_RADIUS_KM: Final = 6371.0


def dms_to_decimal(value: str) -> float:
    """Convert LCSD degree-minute-second strings like '22-18-43' to decimal.

    HK is entirely north/east so no hemisphere sign handling is needed.
    """
    parts = value.strip().split("-")
    if len(parts) != 3:
        raise ValueError(f"unexpected DMS coordinate: {value!r}")
    deg, minutes, seconds = (float(p) for p in parts)
    return deg + minutes / 60.0 + seconds / 3600.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return haversine_km(lat1, lon1, lat2, lon2) * 1000.0
