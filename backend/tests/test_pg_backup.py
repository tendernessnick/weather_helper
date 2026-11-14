"""Backup failure boundaries: authentication, scope, retention and secret hygiene."""
import base64
import hashlib
import json
import subprocess
import zipfile
from contextlib import nullcontext
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from app.services import pg_backup as backup


def config(**changes):
    return backup.BackupConfig(
        database_url="postgresql+psycopg://weather:private-db-password@localhost:5432/weather?sslmode=require",
        storage_url="https://example.api.tcloudbasegateway.com",
        storage_token="private-storage-token", encryption_key=b"K" * 32, **changes)


def make_archive(path: Path):
    raw = b"PGDMP-example-custom-archive"
    manifest = {"format": "weather-pg-v1", "created_at": "2026-11-14T14:00:00+00:00",
                "schema": "weather_helper", "tables": {name: {"rows": 1} for name in backup.TABLES},
                "dump_sha256": hashlib.sha256(raw).hexdigest()}
    with zipfile.ZipFile(path, "w") as handle:
        handle.writestr("database.dump", raw)
        handle.writestr("manifest.json", json.dumps(manifest))
    return path


def test_encryption_roundtrip_uses_fresh_nonce_and_authenticates_every_byte(tmp_path):
    original = make_archive(tmp_path / "source.zip")
    first, second = tmp_path / "first", tmp_path / "second"
    backup.encrypt_file(original, first, b"K" * 32)
    backup.encrypt_file(original, second, b"K" * 32)
    assert first.read_bytes() != second.read_bytes()
    out = tmp_path / "decrypted.zip"
    backup.decrypt_file(first, out, b"K" * 32)
    assert out.read_bytes() == original.read_bytes()
    data = bytearray(first.read_bytes())
    data[25] ^= 1
    first.write_bytes(data)
    invalid = tmp_path / "invalid.zip"
    with pytest.raises(backup.BackupError, match="authentication"):
        backup.decrypt_file(first, invalid, b"K" * 32)
    assert not invalid.exists()


def test_decryption_wrong_key_does_not_leave_plaintext_or_overwrite_existing_file(tmp_path):
    source = tmp_path / "source"
    source.write_bytes(b"private user data")
    encrypted = tmp_path / "encrypted"
    backup.encrypt_file(source, encrypted, b"K" * 32)
    with pytest.raises(backup.BackupError):
        backup.decrypt_file(encrypted, tmp_path / "failed", b"X" * 32)
    assert not (tmp_path / "failed").exists()
    with pytest.raises(backup.BackupError, match="overwrite"):
        backup.decrypt_file(encrypted, source, b"K" * 32)
    assert source.read_bytes() == b"private user data"


@pytest.mark.parametrize("schema", ["public", "auth", "storage", "pg_temp", "a;drop table x", "a/b"])
def test_platform_or_unsafe_schemas_rejected(schema):
    with pytest.raises(backup.BackupError, match="schema"):
        config(schema=schema)


def test_secrets_not_in_config_repr_or_subprocess_arguments(monkeypatch):
    cfg = config()
    assert "private" not in repr(cfg)
    calls = []
    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 1, stderr=b"password=private-db-password")
    monkeypatch.setattr(backup.subprocess, "run", fake_run)
    monkeypatch.setenv("PGHOST", "wrong-host")
    with pytest.raises(backup.BackupError, match=r"pg_dump failed \(exit 1\)") as error:
        backup._run(["pg_dump", "--no-password"], cfg.database_url, 60)
    command, args = calls[0]
    assert "private" not in repr(command)
    assert "private" not in str(error.value)
    assert args["env"]["PGPASSWORD"] == "private-db-password"
    assert args["env"]["PGHOST"] == "localhost"
    assert args["env"]["PGSSLMODE"] == "require"


def test_archive_rejects_path_traversal_and_dump_checksum_mismatch(tmp_path):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("../outside", b"bad")
    with pytest.raises(backup.BackupError, match="members"):
        backup.validate_archive(archive, tmp_path)
    assert not (tmp_path.parent / "outside").exists()
    manifest = {"format": "weather-pg-v1", "schema": "weather_helper",
                "tables": dict.fromkeys(backup.TABLES, {}), "dump_sha256": "0" * 64}
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("database.dump", b"wrong dump")
        handle.writestr("manifest.json", json.dumps(manifest))
    with pytest.raises(backup.BackupError, match="checksum"):
        backup.validate_archive(archive, tmp_path)


def test_restore_protects_production_before_opening_connection(tmp_path, monkeypatch):
    import psycopg
    monkeypatch.setattr(psycopg, "connect", lambda **kwargs: pytest.fail("must not connect"))
    url = "postgresql://u:p@localhost/weather"
    with pytest.raises(backup.BackupError, match="separate database"):
        backup.restore_drill(tmp_path / "archive.zip", url, url)


def test_storage_uses_bearer_private_bucket_and_full_authenticated_download_path(tmp_path):
    requests = []
    cfg = config()
    key = cfg.prefix + "20261114T000000Z-123456789abc.zip.aes256gcm"
    def transport(request):
        requests.append(request)
        if request.method == "PUT":
            assert "Authorization" not in request.headers
            assert request.url.params["token"] == "short-lived-upload-jwt"
            assert request.headers["Content-Length"] == "10"
            assert request.content == b"ciphertext"
            return httpx.Response(200, json={"Id": "1", "Key": key})
        assert request.headers["Authorization"] == "Bearer private-storage-token"
        if "/bucket/" in request.url.path:
            return httpx.Response(200, json={"id": cfg.bucket, "public": False})
        if "/object/upload/sign/" in request.url.path:
            return httpx.Response(200, json={"url": request.url.path, "token": "short-lived-upload-jwt"})
        if request.method == "GET":
            return httpx.Response(200, content=b"ciphertext")
        return httpx.Response(200, json={"Id": "1", "Key": key})
    client = httpx.Client(transport=httpx.MockTransport(transport))
    store = backup.CloudBaseStorage(cfg, client)
    store.require_private()
    source = tmp_path / "source"
    source.write_bytes(b"ciphertext")
    store.upload(key, source)
    out = tmp_path / "download"
    store.download(key, out)
    assert out.read_bytes() == b"ciphertext"
    assert "/object/authenticated/weather-helper-backups/weather-pg-v1/" in requests[-1].url.path
    with pytest.raises(backup.BackupError, match="prefix"):
        store.delete("weather-preservation-original.zip.aes256gcm")


def test_public_bucket_or_storage_errors_fail_closed_without_leaking_body():
    public = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"public": True})))
    with pytest.raises(backup.BackupError, match="private"):
        backup.CloudBaseStorage(config(), public).require_private()
    failed = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(401, text="private-storage-token")))
    with pytest.raises(backup.BackupError) as error:
        backup.CloudBaseStorage(config(), failed).require_private()
    assert "private-storage-token" not in str(error.value)


def test_signed_upload_httpx_info_logs_redact_jwt_and_preserve_numeric_arguments(caplog, tmp_path):
    import logging
    secret = "signed-upload-jwt-must-never-appear-in-logs"
    cfg = config()
    key = cfg.prefix + "20261114T000000Z-123456789abc.zip.aes256gcm"
    def transport(request):
        if request.method == "POST":
            return httpx.Response(200, json={"url": request.url.path, "token": secret})
        assert request.url.params["token"] == secret  # still sent correctly
        return httpx.Response(200, json={"Id": "1", "Key": key})
    source = tmp_path / "cipher"
    source.write_bytes(b"ciphertext")
    with caplog.at_level(logging.INFO, logger="httpx"):
        backup.CloudBaseStorage(cfg, httpx.Client(transport=httpx.MockTransport(transport))).upload(key, source)
        logging.getLogger("httpx").info("status %d %s", 200, httpx.URL("https://example.test/x?token=" + secret))
    assert secret not in caplog.text
    assert "token=<redacted>" in caplog.text
    assert "status 200" in caplog.text


class FakeStore:
    def __init__(self, cfg, corrupt=False):
        self.config, self.corrupt = cfg, corrupt
        self.objects, self.deleted = {}, []
        self.existing = []
        for i in range(4):
            stem = cfg.prefix + f"2026110{i + 1}T000000Z-123456789abc"
            self.existing.append((stem + ".verified.json", {
                "object_key": stem + ".zip.aes256gcm", "created_at": f"2026-11-0{i + 1}T00:00:00+00:00"}))
        self.existing.reverse()
    def require_private(self):
        pass
    def receipts(self):
        return self.existing
    def upload(self, key, path):
        self.objects[key] = path.read_bytes()
    def download(self, key, path):
        path.write_bytes(self.objects[key] + (b"corruption" if self.corrupt else b""))
    def put_receipt(self, key, receipt):
        self.objects[key] = receipt
    def read_json(self, key):
        return self.objects[key]
    def delete(self, key):
        self.deleted.append(key)


@pytest.fixture
def fake_backup(monkeypatch):
    import psycopg
    class FakeConnection:
        def execute(self, *args):
            return self
        def fetchone(self):
            return (True,)
        def transaction(self):
            return nullcontext()
    monkeypatch.setattr(psycopg, "connect", lambda **kwargs: nullcontext(FakeConnection()))
    monkeypatch.setattr(backup, "_make_archive", lambda connection, cfg, directory, created: make_archive(directory / "backup.zip"))


def test_backup_retention_runs_only_after_authenticated_roundtrip_and_verified_receipt(fake_backup):
    cfg = config(retention_count=3)
    store = FakeStore(cfg)
    result = backup.backup_once(cfg, force=True, storage=store)
    assert result["retention_deleted"] == 2
    assert len(store.deleted) == 4  # two archives plus their receipts
    assert all("20261101" in key or "20261102" in key for key in store.deleted)
    assert result["object_key"] not in store.deleted
    assert backup.status()["last_success"] == result["created_at"]
    assert backup.status()["inflight"] is False


def test_corrupted_upload_never_deletes_old_backups_or_writes_success_receipt(fake_backup):
    cfg = config(retention_count=2)
    store = FakeStore(cfg, corrupt=True)
    with pytest.raises(backup.BackupError, match="checksum"):
        backup.backup_once(cfg, force=True, storage=store)
    assert store.deleted == []
    assert not any(key.endswith(".verified.json") for key in store.objects)
    assert backup.status()["last_error"] == "uploaded backup checksum mismatch"
    assert backup.status()["inflight"] is False
    assert not backup._local_lock.locked()


def test_backup_recent_receipt_survives_redeploy_without_new_snapshot(fake_backup):
    from datetime import datetime, timezone
    cfg = config()
    store = FakeStore(cfg)
    key, info = store.existing[0]
    info["created_at"] = datetime.now(timezone.utc).isoformat()
    result = backup.backup_once(cfg, storage=store)
    assert result["skipped"] == "recent_verified_backup"
    assert store.objects == {}


def test_enabled_scheduler_does_not_swallow_backup_failure(monkeypatch):
    monkeypatch.setenv("BACKUP_ENABLED", "true")
    monkeypatch.setattr(backup.BackupConfig, "from_env", lambda: config())
    def fail(cfg):
        raise backup.BackupError("known safe failure")
    monkeypatch.setattr(backup, "backup_once", fail)
    with pytest.raises(backup.BackupError, match="known safe failure"):
        backup.run_scheduled_backup()


@pytest.fixture
def application_snapshot(tmp_path):
    """A real 12-table snapshot containing Unicode, BOOL and HK timestamps."""
    from datetime import datetime
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.db import Base
    from app.models import Court, Observation, CheckIn
    source = tmp_path / "source.db"
    engine = create_engine("sqlite:///" + source.as_posix())
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Court(id="court-1", name_en="Victoria", name_tc="維多利亞", name_sc="维多利亚",
                          district_en="Wan Chai", district_tc="灣仔", lat=22.28, lon=114.18, letter="V"))
        session.add(Observation(id=73, court_id="court-1", observed_hour=datetime(2026, 11, 14, 20),
                                station_name="測站", rainfall_mm=0.1, rain=True,
                                fetched_at=datetime(2026, 11, 14, 20, 5, 1, 123456)))
        session.add(CheckIn(id=44, court_id="court-1", device_id="private-device-id",
                            played_at=datetime(2026, 11, 13, 18), duration_hours=1.5,
                            created_at=datetime(2026, 11, 13, 20, 2)))
        session.commit()
    engine.dispose()
    return source


def http_exporter(source):
    def export(target):
        backup.export_sqlite_snapshot(source, target)
        return {"revision": 53, "schema_version": 1,
                "tables": {name: {"count": info["rows"]} for name, info in backup.sqlite_summary(source).items()}}
    return export


def test_http_backup_real_sqlite_encrypt_upload_download_restore_all_values(application_snapshot, tmp_path):
    cfg = config(mode="cloudbase_http", retention_count=3)
    store = FakeStore(cfg)
    result = backup.backup_http_once(cfg, http_exporter(application_snapshot), force=True, storage=store)
    assert result["format"] == "weather-pg-http-v1"
    assert result["revision"] == 53
    assert result["retention_deleted"] == 2
    cipher = tmp_path / "restore.aes256gcm"
    cipher.write_bytes(store.objects[result["object_key"]])
    archive = tmp_path / "restore.zip"
    backup.decrypt_file(cipher, archive, cfg.encryption_key)
    restored = tmp_path / "restored.db"
    report = backup.restore_local(archive, restored)
    assert report["status"] == "verified"
    assert report["tables"]["courts"] == 1
    assert report["tables"]["observations"] == 1
    assert report["tables"]["checkins"] == 1
    assert backup.sqlite_summary(restored) == backup.sqlite_summary(application_snapshot)
    assert "private-device-id" not in json.dumps(report)
    with pytest.raises(backup.BackupError, match="overwrite"):
        backup.restore_local(archive, restored)


def test_http_snapshot_row_count_mismatch_never_uploads_or_purges(application_snapshot):
    cfg = config(mode="cloudbase_http")
    store = FakeStore(cfg)
    def wrong_export(target):
        metadata = http_exporter(application_snapshot)(target)
        metadata["tables"]["courts"]["count"] = 7
        return metadata
    with pytest.raises(backup.BackupError, match="row counts differ"):
        backup.backup_http_once(cfg, wrong_export, force=True, storage=store)
    assert store.objects == {}
    assert store.deleted == []


def test_http_backup_recent_success_skips_export_after_redeployment():
    from datetime import datetime, timezone
    cfg = config(mode="cloudbase_http")
    store = FakeStore(cfg)
    store.existing[0][1]["created_at"] = datetime.now(timezone.utc).isoformat()
    result = backup.backup_http_once(cfg, lambda path: pytest.fail("recent backup must skip"), storage=store)
    assert result["skipped"] == "recent_verified_backup"


def test_snapshot_online_backup_preserves_source_and_refuses_overwrite(application_snapshot, tmp_path):
    before = backup._digest(application_snapshot)
    target = tmp_path / "copy.db"
    backup.export_sqlite_snapshot(application_snapshot, target)
    assert backup.sqlite_summary(target) == backup.sqlite_summary(application_snapshot)
    assert backup._digest(application_snapshot) == before
    with pytest.raises(backup.BackupError, match="overwrite"):
        backup.export_sqlite_snapshot(application_snapshot, target)
    with pytest.raises(backup.BackupError, match="source or target"):
        backup.export_sqlite_snapshot(application_snapshot, application_snapshot)


def add_cache_metadata(path, *, pending=False):
    import sqlite3
    from contextlib import closing
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE _wh_http_meta(singleton INTEGER PRIMARY KEY, revision INTEGER NOT NULL)")
        connection.execute("INSERT INTO _wh_http_meta VALUES(1,53)")
        connection.execute("CREATE TABLE _wh_http_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, "
                           "table_name TEXT NOT NULL,op TEXT NOT NULL,row_key TEXT NOT NULL,row_json TEXT)")
        connection.execute("CREATE TRIGGER _wh_capture_kv_cache_i AFTER INSERT ON kv_cache BEGIN "
                           "INSERT INTO _wh_http_outbox(table_name,op,row_key,row_json) "
                           "VALUES('kv_cache','upsert',NEW.key,NEW.value_json); END")
        if pending:
            connection.execute("INSERT INTO _wh_http_outbox(table_name,op,row_key,row_json) "
                               "VALUES('kv_cache','upsert','pending','{}')")
        connection.commit()


def test_snapshot_excludes_only_verified_cache_tracking_and_preserves_live_metadata(application_snapshot, tmp_path):
    import sqlite3
    from contextlib import closing
    expected = backup.sqlite_summary(application_snapshot)
    add_cache_metadata(application_snapshot)
    target = tmp_path / "portable.db"
    backup.export_sqlite_snapshot(application_snapshot, target, expected_revision=53)
    assert backup.sqlite_summary(target) == expected
    with closing(sqlite3.connect(target)) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables - {"sqlite_sequence"} == set(backup.TABLES)
        assert connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall() == []
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    with closing(sqlite3.connect(application_snapshot)) as connection:
        assert connection.execute("SELECT revision FROM _wh_http_meta").fetchone()[0] == 53
        assert connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall() == [("_wh_capture_kv_cache_i",)]


@pytest.mark.parametrize("pending,revision", [(True,53), (False,52)])
def test_snapshot_refuses_pending_or_stale_tracking_state(application_snapshot, tmp_path, pending, revision):
    add_cache_metadata(application_snapshot, pending=pending)
    target = tmp_path / "unsafe.db"
    with pytest.raises(backup.BackupError):
        backup.export_sqlite_snapshot(application_snapshot, target, expected_revision=revision)
    assert not target.exists()
