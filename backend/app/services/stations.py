"""HKO automatic rain-gauge stations with approximate published coordinates.

The hourlyRainfall open-data feed gives station *names* only, so this table maps
names to positions for nearest-station matching. The gauges are fixed physical
sites; the coordinates below are public approximate values (good to well under a
km, which is enough for nearest-station assignment). A station missing from this
table is simply skipped during mapping.
"""

STATION_COORDS: dict[str, tuple[float, float]] = {
    "Lau Fau Shan": (22.466, 113.983),
    "Wetland Park": (22.470, 113.999),
    "Shui Pin Wai": (22.444, 114.023),
    "Shek Kong": (22.435, 114.076),
    "Tai Mei Tuk": (22.474, 114.234),
    "Tai Po Market": (22.445, 114.165),
    "Pak Tam Chung": (22.378, 114.331),
    "Kau Sai Chau": (22.337, 114.342),
    "Sai Kung": (22.379, 114.278),
    "Tseung Kwan O": (22.317, 114.259),
    "Clear Water Bay": (22.294, 114.291),
    "Waglan Island": (22.184, 114.303),
    "Cheung Chau": (22.210, 114.030),
    "Peng Chau": (22.284, 114.038),
    "Ngong Ping": (22.255, 113.905),
    "Hong Kong International Airport": (22.313, 113.918),
    "Ta Kwu Ling": (22.511, 114.162),
    "Sheung Shui": (22.505, 114.125),
    "Tai Lung": (22.500, 114.131),
    "Tsuen Wan Ho Koon": (22.367, 114.109),
    "Tuen Mun": (22.391, 113.977),
    "Sha Tin": (22.371, 114.179),
    "Cheung Ching": (22.348, 114.104),
    "Sham Shui Po": (22.330, 114.148),
    "Hong Kong Observatory": (22.302, 114.162),
    "King's Park": (22.315, 114.167),
    "Broadcast Drive": (22.336, 114.172),
    "Kai Tak": (22.325, 114.210),
    "San Po Kong": (22.333, 114.199),
    "Kwun Tong": (22.313, 114.226),
    "Shau Kei Wan": (22.282, 114.240),
    "Happy Valley": (22.269, 114.187),
    "The Peak": (22.272, 114.145),
    "Magazine Gap": (22.260, 114.177),
    "Stanley": (22.218, 114.213),
    "Wong Chuk Hang": (22.249, 114.173),
}


def _normalize(name: str) -> str:
    # The feed uses typographic apostrophes ("King's Park"); the table uses ASCII.
    return name.replace("\u2019", "'").strip().lower()


_COORDS_BY_NAME = {_normalize(k): v for k, v in STATION_COORDS.items()}


def station_coords(name: str) -> tuple[float, float] | None:
    """Coordinates for a station name, or None if the station is not in the table."""
    return _COORDS_BY_NAME.get(_normalize(name))
