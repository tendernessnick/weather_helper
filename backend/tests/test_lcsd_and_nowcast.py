import json
from datetime import datetime

from app.services.hko_nowcast import parse_grid, _nearest_mm
from app.services.lcsd import _letter, parse_courts


def test_parse_courts_full_record():
    record = {
        "District_en": "Wan Chai", "District_cn": "灣仔",
        "Name_en": "Victoria Park Tennis Court", "Name_cn": "維多利亞公園網球場",
        "Address_en": "<p>1 Hing Fat Street</p>", "Address_cn": "銅鑼灣",
        "Court_no_en": "13", "Phone": "2570 6186", "GIHS": "miZxcmDeKy",
        "Latitude": "22-16-57", "Longitude": "114-11-18",
        "Opening_hours_en": "7 am to 11 pm daily",
        "Ancillary_facilities_en": "", "Ancillary_facilities_cn": "",
        "Opening_hours_cn": "", "Court_no_b5": "", "Remarks_en": "", "Remarks_b5": "",
    }
    courts = parse_courts([record])
    assert len(courts) == 1
    court = courts[0]
    assert court.id == "miZxcmDeKy"
    assert court.letter == "V"
    assert abs(court.lat - 22.2825) < 0.0005
    assert abs(court.lon - 114.1883) < 0.0005
    # Traditional converted to simplified for search.
    assert court.name_sc == "维多利亚公园网球场"
    assert court.address_en == "1 Hing Fat Street"  # HTML stripped


def test_parse_courts_skips_bad_coordinates():
    record = {
        "District_en": "X", "District_cn": "X", "Name_en": "Broken Court",
        "Name_cn": "壞", "GIHS": "bad1", "Latitude": "?", "Longitude": "?",
    }
    assert parse_courts([record]) == []


def test_letter_for_non_alpha_name():
    assert _letter("123 Court") == "#"
    assert _letter("abc court") == "A"


def test_parse_grid_and_nearest():
    rows = (
        "Updated Date and Time (in Hong Kong Time),Ending Date and Time (in Hong Kong Time),"
        "Latitude (degree),Longitude (degree),Half-hourly Nowcast Accumulated Rainfall (mm)\n"
        "202609021212,202609021242,22.100,114.100,0.00\n"
        "202609021212,202609021242,22.200,114.200,1.50\n"
        "202609021212,202609021312,22.100,114.100,0.00\n"
        "202609021212,202609021312,22.200,114.200,3.00\n"
    )
    grids = parse_grid(rows)
    assert set(grids) == {datetime(2026, 9, 2, 12, 42), datetime(2026, 9, 2, 13, 12)}

    near = grids[datetime(2026, 9, 2, 12, 42)]
    # Court at 22.20/114.20 sits exactly on the second cell.
    assert _nearest_mm(near, 22.20, 114.20) == 1.50
    # Court closer to the first cell.
    assert _nearest_mm(near, 22.11, 114.11) == 0.00


def test_downsample_max_per_cell_and_wet_only():
    from app.services.hko_nowcast import downsample
    grids = {
        datetime(2026, 9, 2, 12, 42): [
            (22.201, 114.199, 1.2),   # same 0.02 cell as below
            (22.209, 114.205, 2.4),   # -> max 2.4 kept
            (22.30, 114.30, 0.03),    # below wet threshold -> dropped
            (22.40, 114.40, 0.0),     # dry -> dropped
        ],
    }
    steps = downsample(grids)
    assert len(steps) == 1
    cells = {(round(c[0], 3), round(c[1], 3)): c[2] for c in steps[0]["cells"]}
    assert cells == {(22.2, 114.2): 2.4}
