from app.services.geo import distance_meters, dms_to_decimal, haversine_km


def test_dms_to_decimal():
    # 22 deg 18 min 43 sec
    assert abs(dms_to_decimal("22-18-43") - (22 + 18 / 60 + 43 / 3600)) < 1e-9
    assert abs(dms_to_decimal("114-11-18") - (114 + 11 / 60 + 18 / 3600)) < 1e-9


def test_dms_rejects_garbage():
    import pytest
    with pytest.raises(ValueError):
        dms_to_decimal("22.2828")
    with pytest.raises(ValueError):
        dms_to_decimal("")


def test_haversine_known_distance():
    # Victoria Park (22.2803, 114.1930) to Kowloon Park (~3.4 km straight line)
    d = haversine_km(22.2803, 114.1930, 22.3000, 114.1670)
    assert 3.0 < d < 4.0


def test_distance_meters_zero_for_same_point():
    assert distance_meters(22.28, 114.19, 22.28, 114.19) < 1.0
