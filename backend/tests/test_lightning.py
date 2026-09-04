from app.services import lightning

SAMPLE = """\ufeffDateTime,Type,Region,"lightning count"
202609040900-202609040959,Cloud-to-ground,"New Territories West",3
202609040900-202609040959,Cloud-to-ground,"New Territories East",0
202609040900-202609040959,Cloud-to-ground,"Hong Kong Island and Kowloon",1
202609040900-202609040959,Cloud-to-ground,Lantau,0
202609040900-202609040959,Cloud-to-ground,"Hong Kong territory",4
202609040900-202609040959,Cloud-to-cloud,"Hong Kong territory",9
"""


def test_parse_lhl_csv():
    data = lightning.parse_lhl_csv(SAMPLE)
    assert data["regions"] == {"ntw": 3, "nte": 0, "hki_kln": 1, "lantau": 0}
    assert data["total"] == 4
    assert data["cloud"] == 9
    assert data["period"] == "202609040900-202609040959"


def test_parse_lhl_csv_skips_garbled_rows():
    raw = SAMPLE.replace('"New Territories West",3', '"New Territories West",n/a')
    data = lightning.parse_lhl_csv(raw)
    assert "ntw" not in data["regions"]
    assert data["total"] == 4


def test_region_for_court():
    # One real court per boundary-sensitive spot (coordinates from the DB).
    cases = {
        "hki_kln": [(22.2825, 114.1883),  # Victoria Park
                    (22.3442, 114.1883)],  # Ma Chai Hang, just south of NT
        "lantau": [(22.2044, 114.0250)],  # Cheung Chau -> nearest region
        "ntw": [(22.4044, 113.9733),  # Tuen Mun
                (22.3561, 114.1058),  # Tsing Yi
                (22.4556, 114.0033)],  # Tin Shui Wai
        "nte": [(22.4558, 114.1611),  # Tai Po
                (22.5061, 114.1306),  # Sheung Shui (north band splits at 114.10)
                (22.4847, 114.1431),  # Fanling
                (22.4194, 114.2281)],  # Ma On Shan
    }
    for region, coords in cases.items():
        for lat, lon in coords:
            assert lightning.region_for_court(lat, lon) == region, (lat, lon)
