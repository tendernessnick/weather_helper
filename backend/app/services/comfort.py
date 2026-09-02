"""Tennis-playing comfort classification (heat, wind; rain handled elsewhere)."""

SEVERE_AT = 35.0   # apparent temp >= this: dangerous heat
POOR_AT = 32.0
FAIR_AT = 28.0
WINDY_KMH = 25.0


def comfort_level(apparent_temp: float | None, wind_kmh: float | None) -> dict:
    """Level: good | fair | poor | severe (None when data missing).

    Tennis-specific thresholds: apparent temperature drives the rating,
    strong wind is called out separately as an advisory note.
    """
    if apparent_temp is None:
        return {"level": None, "note": "暂无体感数据"}

    if apparent_temp >= SEVERE_AT:
        level, base = "severe", f"体感 {apparent_temp:.0f}°C，极易中暑"
    elif apparent_temp >= POOR_AT:
        level, base = "poor", f"体感 {apparent_temp:.0f}°C，酷热"
    elif apparent_temp >= FAIR_AT:
        level, base = "fair", f"体感 {apparent_temp:.0f}°C，偏热多喝水"
    else:
        level, base = "good", f"体感 {apparent_temp:.0f}°C，舒适"

    notes = [base]
    if wind_kmh is not None and wind_kmh >= WINDY_KMH:
        notes.append(f"大风 {wind_kmh:.0f}km/h 影响发球")
    return {"level": level, "note": " · ".join(notes)}
