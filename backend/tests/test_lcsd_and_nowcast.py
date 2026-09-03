import json
import os
from datetime import datetime

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite://")  # in-memory for tests

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import Court  # noqa: E402
from app.services import lcsd  # noqa: E402
from app.services.hko_nowcast import parse_grid, _nearest_mm  # noqa: E402
from app.services.lcsd import _letter, parse_courts, upsert_extra_courts  # noqa: E402


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _feed_court(id="feed1", lat=22.3, lon=114.19):
    return Court(id=id, name_en="Fake Feed Court", name_tc="假場", name_sc="假场",
                 district_en="Kowloon City", district_tc="九龍城區",
                 lat=lat, lon=lon, letter="F")


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


def test_upsert_extra_courts_merges_and_is_idempotent(db):
    assert upsert_extra_courts(db) == len(lcsd.EXTRA_COURTS)
    court = db.get(Court, "x-hoi-sham-park")
    assert court.name_sc == "海心公园"
    assert court.letter == "H"
    assert court.district_tc == "九龍城區"
    assert court.phone == "2334 3576"
    # A second pass must not duplicate anything.
    upsert_extra_courts(db)
    assert db.query(Court).count() == len(lcsd.EXTRA_COURTS)


def test_extra_court_skipped_when_feed_already_lists_venue(db):
    # The feed catches up with Hoi Sham Park: same venue name, far away spot.
    db.add(Court(id="feedHSP", name_en="Hoi Sham Park Tennis Courts",
                 name_tc="海心公園網球場", name_sc="海心公园网球场",
                 district_en="Kowloon City", district_tc="九龍城區",
                 lat=22.30, lon=114.15, letter="H"))
    # Same spot as the Hoi Sham Park extra, different venue name.
    db.add(_feed_court(id="feedNear", lat=22.3147, lon=114.1911))
    db.commit()
    merged = upsert_extra_courts(db)
    assert merged == len(lcsd.EXTRA_COURTS) - 1
    assert db.get(Court, "x-hoi-sham-park") is None
    assert db.get(Court, "x-jsc") is not None


def test_adjacent_distinct_venue_is_not_a_clash(db):
    # Junction Road Park's feed marker sits ~125 m from the Joint Sports
    # Centre courts; both venues must coexist.
    db.add(Court(id="aKNT1BudSS", name_en="Junction Road Park", name_tc="聯合道公園",
                 name_sc="联合道公园", district_en="Kowloon City", district_tc="九龍城區",
                 lat=22.339167, lon=114.183889, letter="J"))
    db.commit()
    assert upsert_extra_courts(db) == len(lcsd.EXTRA_COURTS)
    assert db.get(Court, "x-jsc") is not None


def test_ensure_courts_imports_feed_then_extras(db, monkeypatch):
    def fake_import(session):
        session.merge(_feed_court())
        session.commit()
        return 1
    monkeypatch.setattr(lcsd, "import_courts", fake_import)
    assert lcsd.ensure_courts(db) == 1 + len(lcsd.EXTRA_COURTS)


def test_ensure_courts_skips_feed_when_courts_exist(db, monkeypatch):
    def boom(session):
        raise AssertionError("feed import must not run when feed courts exist")
    monkeypatch.setattr(lcsd, "import_courts", boom)
    db.add(_feed_court())
    db.commit()
    assert lcsd.ensure_courts(db) == 1 + len(lcsd.EXTRA_COURTS)


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
