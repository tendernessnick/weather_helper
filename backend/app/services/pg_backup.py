"""Consistent PostgreSQL backups, authenticated encryption and private storage.

This module never restores into the running database. Operators use the CLI
in scripts/pg_backup.py with a separate empty database for recovery drills.
The CloudBase credential is a server-side Bearer token, not a CLI login token.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
import threading
import uuid
import zipfile
from contextlib import closing
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from sqlalchemy.engine import make_url

logger = logging.getLogger(__name__)
MAGIC = b"WHPG1\x00"
CHUNK = 1024 * 1024
TABLES = (
    "checkins", "climatology", "courts", "feedback", "forecast_leads",
    "forecast_snapshots", "kv_cache", "nowcast_snapshots", "observations",
    "persistence", "push_subscriptions", "user_reports",
)
_LOCK_KEY = 0x57485047424B50
_local_lock = threading.Lock()
_state = {"inflight": False, "last_success": None, "last_failure": None,
          "last_error": None, "object_key": None, "retention_deleted": 0}


class _SignedURLRedaction(logging.Filter):
    """httpx INFO logs request URLs; redact query credentials before handlers.

    Install one persistent filter instead of temporarily changing global log
    levels, which could race another application thread's network request.
    Preserve non-string arguments so normal `%d`/`%f` log formatting works.
    """
    _weather_backup_redaction = True
    _pattern = re.compile(r"([?&](?:token|access_token)=)[^&#\s\"']+", re.IGNORECASE)

    @classmethod
    def _redact(cls, value):
        if isinstance(value, httpx.URL):
            value = str(value)
        if isinstance(value, str):
            return cls._pattern.sub(r"\1<redacted>", value)
        return value

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self._redact(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(self._redact(value) for value in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: self._redact(value) for key, value in record.args.items()}
        return True


_httpx_logger = logging.getLogger("httpx")
if not any(getattr(item, "_weather_backup_redaction", False) for item in _httpx_logger.filters):
    _httpx_logger.addFilter(_SignedURLRedaction())


class BackupError(RuntimeError):
    """An operator-visible error that deliberately contains no credentials."""


def _storage_error_suffix(response: httpx.Response) -> str:
    """Keep a vendor error code for diagnosis, never echo its URL/body text."""
    try:
        payload = response.json()
        code = payload.get("code", payload.get("Code")) if isinstance(payload, dict) else None
        if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,80}", code):
            return " (" + code + ")"
    except (ValueError, TypeError):
        pass
    return ""


def _schema(value: str) -> str:
    if (not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", value)
            or value in {"public", "auth", "storage", "information_schema"}
            or value.startswith("pg_")):
        raise BackupError("invalid backup database schema")
    return value


@dataclass(frozen=True)
class BackupConfig:
    database_url: str = field(repr=False)
    schema: str = "weather_helper"
    storage_url: str = ""
    storage_token: str = field(default="", repr=False)
    bucket: str = "weather-helper-backups"
    encryption_key: bytes = field(default=b"", repr=False)
    retention_count: int = 30
    interval_seconds: int = 24 * 3600
    command_timeout: int = 1800
    mode: str = "postgresql"

    def __post_init__(self):
        _schema(self.schema)
        if self.mode not in {"postgresql", "cloudbase_http"}:
            raise BackupError("unsupported backup mode")
        if self.mode == "postgresql" and make_url(self.database_url).get_backend_name() != "postgresql":
            raise BackupError("PostgreSQL backup requires a PostgreSQL database")
        parsed = urlsplit(self.storage_url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}):
            raise BackupError("backup storage URL must be an HTTPS origin")
        if not self.storage_token or len(self.encryption_key) != 32:
            raise BackupError("backup storage token and 32-byte encryption key are required")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}", self.bucket):
            raise BackupError("invalid backup bucket")
        if not 2 <= self.retention_count <= 3650:
            raise BackupError("backup retention count must be between 2 and 3650")
        if self.interval_seconds < 3600 or not 60 <= self.command_timeout <= 7200:
            raise BackupError("invalid backup interval or command timeout")

    @property
    def prefix(self) -> str:
        return f"{'weather-pg-http-v1' if self.mode == 'cloudbase_http' else 'weather-pg-v1'}/{self.schema}/"

    @property
    def key_id(self) -> str:
        return hashlib.sha256(self.encryption_key).hexdigest()[:16]

    @classmethod
    def from_env(cls) -> "BackupConfig":
        # app.config has already loaded backend/.env in the application. The
        # standalone CLI imports it as well; secrets are never CLI arguments.
        try:
            key = base64.b64decode(os.environ.get("BACKUP_ENCRYPTION_KEY", ""), validate=True)
            return cls(
                database_url=os.environ.get("DATABASE_URL", ""),
                schema=os.environ.get("DATABASE_SCHEMA", "weather_helper"),
                storage_url=os.environ.get("BACKUP_STORAGE_URL", os.environ.get("PERSISTENCE_API_URL", "")).rstrip("/"),
                storage_token=os.environ.get("BACKUP_STORAGE_TOKEN", os.environ.get("PERSISTENCE_API_KEY", "")),
                bucket=os.environ.get("BACKUP_STORAGE_BUCKET", "weather-helper-backups"),
                encryption_key=key,
                retention_count=int(os.environ.get("BACKUP_RETENTION_COUNT", "30")),
                interval_seconds=int(os.environ.get("BACKUP_INTERVAL_SECONDS", "86400")),
                command_timeout=int(os.environ.get("BACKUP_COMMAND_TIMEOUT", "1800")),
                mode=os.environ.get("BACKUP_MODE", "cloudbase_http"),
            )
        except BackupError:
            raise
        except Exception:
            raise BackupError("invalid backup environment configuration") from None


def enabled() -> bool:
    return os.environ.get("BACKUP_ENABLED", "false").lower() in {"1", "true", "yes"}


def status() -> dict:
    return {"enabled": enabled(), **_state}


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def encrypt_file(source: Path, target: Path, key: bytes) -> None:
    """WHPG1\\0 | random 12-byte nonce | ciphertext | 16-byte GCM tag."""
    nonce = os.urandom(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    cipher.authenticate_additional_data(MAGIC)
    with source.open("rb") as src, target.open("xb") as dst:
        dst.write(MAGIC + nonce)
        for block in iter(lambda: src.read(CHUNK), b""):
            dst.write(cipher.update(block))
        dst.write(cipher.finalize())
        dst.write(cipher.tag)


def decrypt_file(source: Path, target: Path, key: bytes) -> None:
    """Delete unauthenticated plaintext on any failure; never overwrite files."""
    created = False
    try:
        with source.open("rb") as src:
            header = src.read(len(MAGIC) + 12)
            if not header.startswith(MAGIC) or source.stat().st_size < len(header) + 16:
                raise BackupError("invalid encrypted PostgreSQL archive")
            src.seek(-16, 2)
            tag = src.read(16)
            cipher = Cipher(algorithms.AES(key), modes.GCM(header[len(MAGIC):], tag)).decryptor()
            cipher.authenticate_additional_data(MAGIC)
            src.seek(len(header))
            remaining = source.stat().st_size - len(header) - 16
            with target.open("xb") as dst:
                created = True
                while remaining:
                    block = src.read(min(CHUNK, remaining))
                    if not block:
                        raise BackupError("truncated encrypted PostgreSQL archive")
                    remaining -= len(block)
                    dst.write(cipher.update(block))
                dst.write(cipher.finalize())
    except FileExistsError:
        raise BackupError("refusing to overwrite decrypted archive") from None
    except Exception:
        if created:
            target.unlink(missing_ok=True)
        raise BackupError("encrypted archive authentication failed") from None


def pg_parameters(database_url: str) -> dict[str, str]:
    """SQLAlchemy URL -> libpq values, retaining TLS query options."""
    url = make_url(database_url)
    if url.get_backend_name() != "postgresql" or not url.database:
        raise BackupError("a PostgreSQL database URL is required")
    params = {"dbname": url.database, "connect_timeout": "15"}
    for attr, key in (("host", "host"), ("port", "port"), ("username", "user"), ("password", "password")):
        value = getattr(url, attr)
        if value is not None:
            params[key] = str(value)
    for key, value in url.query.items():
        if not isinstance(value, str):
            raise BackupError("multi-valued PostgreSQL URL parameters are unsupported")
        params[key] = value
    return params


def _command_env(database_url: str) -> dict[str, str]:
    env = dict(os.environ)
    # Do not inherit libpq settings from another operator session.
    for name in tuple(env):
        if name.startswith("PG"):
            del env[name]
    mapping = {"host": "PGHOST", "port": "PGPORT", "dbname": "PGDATABASE",
               "user": "PGUSER", "password": "PGPASSWORD", "options": "PGOPTIONS",
               "sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT",
               "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY", "channel_binding": "PGCHANNELBINDING",
               "connect_timeout": "PGCONNECT_TIMEOUT", "target_session_attrs": "PGTARGETSESSIONATTRS"}
    params = pg_parameters(database_url)
    unknown = set(params) - set(mapping)
    if unknown:
        raise BackupError("unsupported pg_dump connection option")
    env.update({mapping[key]: value for key, value in params.items()})
    return env


def _run(command: list[str], database_url: str, timeout: int) -> None:
    # Error output may contain connection information. Expose a safe summary
    # only; no URL, password, SQL row values or storage token enters logs.
    try:
        result = subprocess.run(command, env=_command_env(database_url), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                check=False, timeout=timeout)
    except FileNotFoundError:
        raise BackupError(f"{command[0]} is not installed") from None
    except subprocess.TimeoutExpired:
        raise BackupError(f"{command[0]} timed out") from None
    if result.returncode:
        raise BackupError(f"{command[0]} failed (exit {result.returncode})")


def _json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return {"base64": base64.b64encode(value).decode("ascii")}
    raise TypeError(type(value).__name__)


def table_manifest(connection, schema: str) -> dict:
    """Hash every ordered row from one transaction, without loading full tables."""
    from psycopg import sql
    _schema(schema)
    found = {row[0] for row in connection.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=%s AND table_type='BASE TABLE'", (schema,))}
    if found != set(TABLES):
        raise BackupError("backup schema does not contain exactly the 12 application tables")
    out = {}
    for table in TABLES:
        columns = [row[0] for row in connection.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position", (schema, table))]
        pk = [row[0] for row in connection.execute(
            "SELECT k.column_name FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k "
            "ON t.constraint_name=k.constraint_name AND t.constraint_schema=k.constraint_schema "
            "AND t.table_name=k.table_name WHERE t.table_schema=%s AND t.table_name=%s "
            "AND t.constraint_type='PRIMARY KEY' ORDER BY k.ordinal_position", (schema, table))]
        if not pk:
            raise BackupError("backup table lacks a primary key")
        query = sql.SQL("SELECT {} FROM {}.{} ORDER BY {}").format(
            sql.SQL(",").join(map(sql.Identifier, columns)), sql.Identifier(schema),
            sql.Identifier(table), sql.SQL(",").join(map(sql.Identifier, pk)))
        digest, count = hashlib.sha256(), 0
        with connection.cursor(name=f"backup_{table}") as cursor:
            cursor.execute(query)
            for row in cursor:
                digest.update(json.dumps(row, default=_json_value, separators=(",", ":"),
                                         ensure_ascii=False, allow_nan=False).encode("utf-8") + b"\n")
                count += 1
        out[table] = {"rows": count, "columns": columns, "sha256": digest.hexdigest()}
    return out


class CloudBaseStorage:
    def __init__(self, config: BackupConfig, client: httpx.Client | None = None):
        self.config = config
        self.client = client or httpx.Client(timeout=httpx.Timeout(300, connect=20), follow_redirects=False)
        self._owned = client is None

    def close(self):
        if self._owned:
            self.client.close()

    def _url(self, route: str) -> str:
        return self.config.storage_url + "/v1/storages/" + route

    def _object_route(self, key: str, *, authenticated=False) -> str:
        if not key.startswith(self.config.prefix) or ".." in key.split("/"):
            raise BackupError("backup object is outside the dedicated prefix")
        return f"object/{'authenticated/' if authenticated else ''}{quote(self.config.bucket, safe='')}/{quote(key, safe='/')}"

    def _request(self, method: str, route: str, **kwargs):
        headers = {"Authorization": f"Bearer {self.config.storage_token}", **kwargs.pop("headers", {})}
        try:
            result = self.client.request(method, self._url(route), headers=headers, **kwargs)
        except httpx.HTTPError:
            raise BackupError("backup storage request failed") from None
        if not result.is_success:
            raise BackupError(f"backup storage request returned HTTP {result.status_code}" + _storage_error_suffix(result))
        return result

    def require_private(self):
        try:
            info = self._request("GET", "bucket/" + quote(self.config.bucket, safe="")).json()
        except (ValueError, TypeError):
            raise BackupError("invalid backup bucket response") from None
        if not isinstance(info, dict) or info.get("public") is not False:
            raise BackupError("backup bucket must be private")

    def _upload_content(self, key: str, content, size: int, content_type: str):
        # This is the official signed-upload API, verified against the real PG
        # Storage service. Direct raw POST can fail inside its COS streaming
        # handler; the signed PUT handler accepts an explicit Content-Length.
        # The upload JWT expires after 60 seconds: negotiate only when ready
        # to send, and never put this URL into logs, receipts or configuration.
        self._object_route(key)  # scope validation before obtaining a signature
        route = f"object/upload/sign/{quote(self.config.bucket, safe='')}/{quote(key, safe='/')}"
        try:
            signed = self._request("POST", route).json()
            token = signed.get("token") if isinstance(signed, dict) else None
            if not isinstance(token, str) or not token:
                raise BackupError("invalid backup upload signature")
            url = self._url(route) + "?token=" + quote(token, safe="")
            response = self.client.request("PUT", url, content=content,
                                           headers={"Content-Type": content_type, "Content-Length": str(size),
                                                    "Cache-Control": "no-store"})
            if not response.is_success:
                raise BackupError(f"signed backup upload returned HTTP {response.status_code}" + _storage_error_suffix(response))
        except (ValueError, TypeError):
            raise BackupError("invalid backup upload signature") from None
        except httpx.HTTPError:
            raise BackupError("signed backup upload failed") from None

    def upload(self, key: str, path: Path):
        with path.open("rb") as handle:
            self._upload_content(key, handle, path.stat().st_size, "application/octet-stream")

    def put_receipt(self, key: str, receipt: dict):
        raw = json.dumps(receipt).encode("utf-8")
        self._upload_content(key, raw, len(raw), "application/json")

    def read_json(self, key: str) -> dict:
        try:
            return self._request("GET", self._object_route(key, authenticated=True)).json()
        except (ValueError, TypeError):
            raise BackupError("invalid backup receipt") from None

    def download(self, key: str, target: Path):
        headers = {"Authorization": f"Bearer {self.config.storage_token}"}
        try:
            with self.client.stream("GET", self._url(self._object_route(key, authenticated=True)), headers=headers) as response:
                if not response.is_success:
                    raise BackupError(f"backup download returned HTTP {response.status_code}")
                with target.open("xb") as handle:
                    for chunk in response.iter_bytes(CHUNK):
                        handle.write(chunk)
        except httpx.HTTPError:
            target.unlink(missing_ok=True)
            raise BackupError("backup download failed") from None

    def receipts(self) -> list[tuple[str, dict]]:
        entries, cursor, seen = [], None, set()
        pattern = re.compile(re.escape(self.config.prefix) + r"\d{8}T\d{6}Z-[a-f0-9]{12}\.verified\.json$")
        for _ in range(100):
            body = {"prefix": self.config.prefix, "limit": 1000, "with_delimiter": False,
                    "sortBy": {"column": "name", "order": "desc"}}
            if cursor:
                body["cursor"] = cursor
            result = self._request("POST", "object/list/" + quote(self.config.bucket, safe=""), json=body).json()
            if not isinstance(result, dict) or not isinstance(result.get("objects"), list):
                raise BackupError("invalid backup object listing")
            for item in result["objects"]:
                name = item.get("name", "")
                if pattern.fullmatch(name):
                    receipt = self.read_json(name)
                    expected_archive = name.removesuffix(".verified.json") + ".zip.aes256gcm"
                    if (isinstance(receipt, dict) and receipt.get("format") in {"weather-pg-v1", "weather-pg-http-v1"}
                            and receipt.get("object_key") == expected_archive
                            and re.fullmatch(r"[a-f0-9]{64}", receipt.get("cipher_sha256", ""))):
                        entries.append((name, receipt))
            if not result.get("hasNext"):
                return sorted(entries, key=lambda pair: pair[0], reverse=True)
            cursor = result.get("nextCursor")
            if not cursor or cursor in seen:
                raise BackupError("invalid backup object pagination")
            seen.add(cursor)
        raise BackupError("backup object listing exceeded safety limit")

    def delete(self, key: str):
        self._request("DELETE", self._object_route(key))


def _make_archive(connection, config: BackupConfig, directory: Path, created_at: str) -> Path:
    snapshot = connection.execute("SELECT pg_export_snapshot()").fetchone()[0]
    manifest = {"format": "weather-pg-v1", "created_at": created_at, "schema": config.schema,
                "key_id": config.key_id, "tables": table_manifest(connection, config.schema)}
    dump = directory / "database.dump"
    _run(["pg_dump", "--no-password", "--format=custom", "--no-owner", "--no-privileges",
          "--strict-names", "--schema", config.schema, "--snapshot", snapshot,
          "--file", str(dump)], config.database_url, config.command_timeout)
    if not dump.is_file() or dump.stat().st_size == 0:
        raise BackupError("pg_dump did not create a nonempty archive")
    manifest["dump_sha256"] = _digest(dump)
    archive = directory / "backup.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as handle:
        handle.write(dump, "database.dump")
        handle.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    return archive


def validate_archive(archive: Path, directory: Path) -> tuple[dict, Path]:
    """Read fixed members only; no ZipFile.extract or untrusted path traversal."""
    try:
        with zipfile.ZipFile(archive) as handle:
            if sorted(handle.namelist()) != ["database.dump", "manifest.json"]:
                raise BackupError("unexpected PostgreSQL backup archive members")
            if handle.getinfo("manifest.json").file_size > 1024 * 1024:
                raise BackupError("oversized PostgreSQL backup manifest")
            manifest = json.loads(handle.read("manifest.json"))
            _schema(manifest["schema"])
            if manifest.get("format") != "weather-pg-v1" or set(manifest["tables"]) != set(TABLES):
                raise BackupError("invalid PostgreSQL backup manifest")
            dump = directory / "database.dump"
            with handle.open("database.dump") as src, dump.open("xb") as dst:
                for chunk in iter(lambda: src.read(CHUNK), b""):
                    dst.write(chunk)
            if _digest(dump) != manifest["dump_sha256"]:
                raise BackupError("PostgreSQL dump checksum mismatch")
            return manifest, dump
    except BackupError:
        raise
    except Exception:
        raise BackupError("invalid PostgreSQL backup archive") from None


def backup_once(config: BackupConfig, *, force=False, storage: CloudBaseStorage | None = None) -> dict:
    """One verified snapshot, with process + PostgreSQL advisory locks.

    Retention is applied only after ciphertext was downloaded, authenticated,
    decrypted and its ZIP/dump checksum verified. Failed uploads are never
    counted as successful backups and never trigger deletion of old backups.
    """
    import psycopg
    if not _local_lock.acquire(blocking=False):
        return {"skipped": "backup_already_running"}
    own_storage = storage is None
    storage = storage or CloudBaseStorage(config)
    _state["inflight"] = True
    try:
        storage.require_private()
        with psycopg.connect(**pg_parameters(config.database_url), autocommit=True) as connection:
            if not connection.execute("SELECT pg_try_advisory_lock(%s)", (_LOCK_KEY,)).fetchone()[0]:
                return {"skipped": "backup_already_running"}
            receipts = storage.receipts()
            now = datetime.now(timezone.utc)
            if receipts and not force:
                try:
                    previous = datetime.fromisoformat(receipts[0][1]["created_at"])
                    age = (now - previous).total_seconds()
                    if 0 <= age < config.interval_seconds:
                        _state.update(last_success=previous.isoformat(), last_error=None,
                                      object_key=receipts[0][1]["object_key"])
                        return {"skipped": "recent_verified_backup", "object_key": _state["object_key"]}
                except (ValueError, KeyError, TypeError):
                    raise BackupError("invalid backup receipt timestamp") from None
            created_at = now.isoformat(timespec="seconds")
            stem = config.prefix + now.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
            object_key = stem + ".zip.aes256gcm"
            connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            connection.read_only = True
            with tempfile.TemporaryDirectory(prefix="weather-pg-backup-") as temp:
                directory = Path(temp)
                with connection.transaction():
                    archive = _make_archive(connection, config, directory, created_at)
                cipher = directory / "backup.aes256gcm"
                encrypt_file(archive, cipher, config.encryption_key)
                receipt = {"format": "weather-pg-v1", "created_at": created_at,
                           "object_key": object_key, "key_id": config.key_id,
                           "cipher_sha256": _digest(cipher), "cipher_bytes": cipher.stat().st_size}
                storage.upload(object_key, cipher)
                downloaded = directory / "downloaded.aes256gcm"
                storage.download(object_key, downloaded)
                if _digest(downloaded) != receipt["cipher_sha256"]:
                    raise BackupError("uploaded backup checksum mismatch")
                recovered = directory / "recovered.zip"
                decrypt_file(downloaded, recovered, config.encryption_key)
                verify_dir = directory / "verified"
                verify_dir.mkdir()
                validate_archive(recovered, verify_dir)
                receipt_key = stem + ".verified.json"
                storage.put_receipt(receipt_key, receipt)
                if storage.read_json(receipt_key) != receipt:
                    raise BackupError("uploaded backup receipt mismatch")
            deleted = 0
            # The newly verified entry is part of the retention count. Its
            # receipt is immutable and timestamp/UUID names never overwrite.
            for old_receipt_key, old in receipts[max(0, config.retention_count - 1):]:
                storage.delete(old["object_key"])
                storage.delete(old_receipt_key)
                deleted += 1
            _state.update(last_success=created_at, last_error=None, object_key=object_key,
                          retention_deleted=deleted)
            logger.info("PostgreSQL backup verified; retained=%s removed=%s", config.retention_count, deleted)
            return {**receipt, "retention_deleted": deleted}
    except BackupError as exc:
        _state.update(last_failure=datetime.now(timezone.utc).isoformat(timespec="seconds"), last_error=str(exc))
        raise
    except Exception:
        error = BackupError("PostgreSQL backup failed; inspect connectivity, permissions and client compatibility")
        _state.update(last_failure=datetime.now(timezone.utc).isoformat(timespec="seconds"), last_error=str(error))
        raise error from None
    finally:
        _state["inflight"] = False
        if own_storage:
            storage.close()
        _local_lock.release()


def run_scheduled_backup() -> None:
    """Scheduler entry point; exceptions deliberately propagate to job status."""
    if enabled():
        config = BackupConfig.from_env()
        if config.mode == "cloudbase_http":
            from ..persistence_http import export_snapshot
            backup_http_once(config, export_snapshot)
        else:
            backup_once(config)


def restore_drill(archive: Path, database_url: str, source_database_url: str,
                  *, timeout=1800) -> dict:
    """Restore into a separate database and compare all 12 table row hashes.

    The caller must explicitly supply both URLs so even a mistaken shell
    environment cannot restore over the currently running application DB.
    """
    import psycopg
    from psycopg import sql
    source, target = pg_parameters(source_database_url), pg_parameters(database_url)
    identity = lambda value: (value.get("host", ""), value.get("port", "5432"), value.get("dbname"))
    if identity(source) == identity(target):
        raise BackupError("restore drill requires a separate database")
    with tempfile.TemporaryDirectory(prefix="weather-pg-restore-") as temp:
        manifest, dump = validate_archive(archive, Path(temp))
        schema = manifest["schema"]
        with psycopg.connect(**target, autocommit=True) as connection:
            actual_name = connection.execute("SELECT current_database()").fetchone()[0]
            # Different aliases resolving to the same server/database must not
            # bypass protection. Require a dedicated database name as well.
            if actual_name == source["dbname"]:
                raise BackupError("restore drill database name must differ from production")
            if connection.execute("SELECT 1 FROM pg_namespace WHERE nspname=%s", (schema,)).fetchone():
                raise BackupError("restore drill target schema must not already exist")
            _run(["pg_restore", "--no-password", "--no-owner", "--no-privileges", "--exit-on-error",
                  "--single-transaction", str(dump)], database_url, timeout)
            connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            connection.read_only = True
            with connection.transaction():
                actual = table_manifest(connection, schema)
            if actual != manifest["tables"]:
                raise BackupError("restore drill table rows or checksums differ")
            # Leave the restored database for inspection. Deliberately no DROP
            # DATABASE/SCHEMA capability in this module.
            return {"status": "verified", "created_at": manifest["created_at"],
                    "schema": schema, "tables": {name: info["rows"] for name, info in actual.items()}}


def sqlite_summary(path: Path) -> dict:
    """Canonical, type-checked row hashes shared with the migration verifier."""
    import sqlite3
    from sqlalchemy import create_engine
    from scripts.pg_migration import summarise, validate_source
    if not path.is_file():
        raise BackupError("exported SQLite snapshot does not exist")
    engine = create_engine("sqlite://", creator=lambda: sqlite3.connect(
        path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True))
    try:
        with engine.connect() as connection:
            validate_source(connection)
            return summarise(connection)
    except Exception:
        raise BackupError("exported SQLite snapshot failed integrity or canonical row verification") from None
    finally:
        engine.dispose()


def _remove_cache_tracking(connection, *, expected_revision: int | None = None) -> None:
    """Strip only the coordinator's known local metadata from a copied file.

    Pending outbox rows are never discarded. Unknown tables/triggers remain a
    hard failure rather than being silently excluded from a business backup.
    """
    tables = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'") if row[0] != "sqlite_sequence"}
    internal = {"_wh_http_meta", "_wh_http_outbox"}
    if tables - set(TABLES) - internal:
        raise BackupError("cache snapshot contains unknown tables")
    triggers = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    allowed_triggers = {f"_wh_capture_{name}_{suffix}" for name in TABLES for suffix in ("i", "d", "u")}
    if triggers - allowed_triggers:
        raise BackupError("cache snapshot contains unknown triggers")
    if not tables & internal:
        if triggers:
            raise BackupError("cache snapshot tracking metadata is incomplete")
        return
    if not internal <= tables:
        raise BackupError("cache snapshot tracking metadata is incomplete")
    expected_columns = {
        "_wh_http_meta": {"singleton", "revision"},
        "_wh_http_outbox": {"seq", "table_name", "op", "row_key", "row_json"},
    }
    for table, columns in expected_columns.items():
        if {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')} != columns:
            raise BackupError("cache snapshot tracking columns are incompatible")
    metadata = connection.execute("SELECT singleton,revision FROM _wh_http_meta").fetchall()
    if (len(metadata) != 1 or metadata[0][0] != 1 or type(metadata[0][1]) is not int
            or metadata[0][1] < 0 or (expected_revision is not None and metadata[0][1] != expected_revision)):
        raise BackupError("cache snapshot tracking revision is incompatible")
    if connection.execute("SELECT COUNT(*) FROM _wh_http_outbox").fetchone()[0] != 0:
        raise BackupError("cache snapshot has pending unsynchronized changes")
    for trigger in sorted(triggers):
        connection.execute(f'DROP TRIGGER "{trigger}"')
    connection.execute("DROP TABLE _wh_http_outbox")
    connection.execute("DROP TABLE _wh_http_meta")
    connection.commit()


def export_sqlite_snapshot(source: Path, target: Path, *, expected_revision: int | None = None) -> None:
    """Online backup API, called only while the coordinator holds its lock."""
    import sqlite3
    source, target = Path(source).resolve(), Path(target).resolve()
    if source == target or not source.is_file():
        raise BackupError("invalid cache snapshot source or target")
    created = False
    try:
        target.touch(exist_ok=False)
        created = True
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=30)) as src:
            with closing(sqlite3.connect(target, timeout=30)) as dst:
                src.backup(dst, pages=256, sleep=0.05)
                _remove_cache_tracking(dst, expected_revision=expected_revision)
                # A portable backup is self-contained, regardless of whether
                # its disposable source cache uses local WAL mode.
                if dst.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
                    raise BackupError("cache snapshot journal mode could not be made portable")
                if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise BackupError("cache snapshot failed SQLite integrity check")
    except FileExistsError:
        raise BackupError("refusing to overwrite cache snapshot target") from None
    except Exception:
        if created:
            target.unlink(missing_ok=True)
        raise BackupError("cache snapshot export failed") from None


def _make_http_archive(config: BackupConfig, directory: Path, export_snapshot, created_at: str) -> Path:
    """The persistence coordinator holds its global write lock while exporting.

    It must verify that its local cache and remote PostgreSQL revision agree
    before and after SQLite's backup API completes. The resulting file is an
    immutable copy; live cache files are never copied directly.
    """
    database = directory / "weather.db"
    metadata = export_snapshot(database)
    if not isinstance(metadata, dict) or not isinstance(metadata.get("revision"), int):
        raise BackupError("snapshot exporter did not return a verified database revision")
    tables = sqlite_summary(database)
    remote_tables = metadata.get("tables")
    if remote_tables is not None:
        if set(remote_tables) != set(TABLES):
            raise BackupError("snapshot exporter table inventory differs")
        for name, table in remote_tables.items():
            count = table.get("count", table.get("rows")) if isinstance(table, dict) else table
            if count != tables[name]["rows"]:
                raise BackupError("snapshot exporter table row counts differ")
    manifest = {"format": "weather-pg-http-v1", "created_at": created_at,
                "source": metadata.get("source", "cloudbase_postgresql_http"), "schema": config.schema,
                "schema_version": metadata.get("schema_version", 1), "revision": metadata["revision"],
                "key_id": config.key_id, "tables": tables, "file_sha256": _digest(database)}
    archive = directory / "backup.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as handle:
        handle.write(database, "weather.db")
        handle.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
    return archive


def validate_http_archive(archive: Path, directory: Path) -> tuple[dict, Path]:
    """Verify decrypted archive, SQLite integrity and all twelve row digests."""
    try:
        with zipfile.ZipFile(archive) as handle:
            if sorted(handle.namelist()) != ["manifest.json", "weather.db"]:
                raise BackupError("unexpected HTTP PostgreSQL backup archive members")
            if handle.getinfo("manifest.json").file_size > 1024 * 1024:
                raise BackupError("oversized HTTP PostgreSQL backup manifest")
            manifest = json.loads(handle.read("manifest.json"))
            _schema(manifest["schema"])
            if (manifest.get("format") != "weather-pg-http-v1"
                    or set(manifest["tables"]) != set(TABLES)
                    or not isinstance(manifest.get("revision"), int)):
                raise BackupError("invalid HTTP PostgreSQL backup manifest")
            database = directory / "weather.db"
            with handle.open("weather.db") as src, database.open("xb") as dst:
                for chunk in iter(lambda: src.read(CHUNK), b""):
                    dst.write(chunk)
            if _digest(database) != manifest["file_sha256"]:
                raise BackupError("SQLite snapshot file checksum mismatch")
            if sqlite_summary(database) != manifest["tables"]:
                raise BackupError("SQLite snapshot table checksums differ from manifest")
            return manifest, database
    except BackupError:
        raise
    except Exception:
        raise BackupError("invalid HTTP PostgreSQL backup archive") from None


def backup_http_once(config: BackupConfig, export_snapshot, *, force=False,
                     storage: CloudBaseStorage | None = None) -> dict:
    """Back up canonical CloudBase PG through the persistence coordinator.

    Daily due state lives in verified cloud receipts, so redeployment does not
    reset the clock. The scheduler checks hourly; an interrupted/failed attempt
    retries on its next check. Retention keeps 30 verified versions by default.
    """
    if config.mode != "cloudbase_http":
        raise BackupError("HTTP PostgreSQL backup requires cloudbase_http mode")
    if not _local_lock.acquire(blocking=False):
        return {"skipped": "backup_already_running"}
    own_storage = storage is None
    storage = storage or CloudBaseStorage(config)
    _state["inflight"] = True
    try:
        storage.require_private()
        receipts = storage.receipts()
        now = datetime.now(timezone.utc)
        if receipts and not force:
            try:
                previous = datetime.fromisoformat(receipts[0][1]["created_at"])
                age = (now - previous).total_seconds()
                if 0 <= age < config.interval_seconds:
                    _state.update(last_success=previous.isoformat(), last_error=None,
                                  object_key=receipts[0][1]["object_key"])
                    return {"skipped": "recent_verified_backup", "object_key": _state["object_key"]}
            except (ValueError, KeyError, TypeError):
                raise BackupError("invalid backup receipt timestamp") from None
        created_at = now.isoformat(timespec="seconds")
        stem = config.prefix + now.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
        object_key = stem + ".zip.aes256gcm"
        with tempfile.TemporaryDirectory(prefix="weather-http-backup-") as temp:
            directory = Path(temp)
            archive = _make_http_archive(config, directory, export_snapshot, created_at)
            cipher = directory / "backup.aes256gcm"
            encrypt_file(archive, cipher, config.encryption_key)
            receipt = {"format": "weather-pg-http-v1", "created_at": created_at,
                       "object_key": object_key, "key_id": config.key_id,
                       "cipher_sha256": _digest(cipher), "cipher_bytes": cipher.stat().st_size}
            storage.upload(object_key, cipher)
            downloaded = directory / "downloaded.aes256gcm"
            storage.download(object_key, downloaded)
            if _digest(downloaded) != receipt["cipher_sha256"]:
                raise BackupError("uploaded backup checksum mismatch")
            recovered = directory / "recovered.zip"
            decrypt_file(downloaded, recovered, config.encryption_key)
            verify_dir = directory / "verified"
            verify_dir.mkdir()
            manifest, _database = validate_http_archive(recovered, verify_dir)
            receipt["revision"] = manifest["revision"]
            receipt_key = stem + ".verified.json"
            storage.put_receipt(receipt_key, receipt)
            if storage.read_json(receipt_key) != receipt:
                raise BackupError("uploaded backup receipt mismatch")
        # A successful receipt is the durable success marker. Keep it even if
        # retention later fails; a deletion failure must not invalidate data.
        _state.update(last_success=created_at, last_error=None, object_key=object_key)
        deleted = 0
        for old_receipt_key, old in receipts[max(0, config.retention_count - 1):]:
            storage.delete(old["object_key"])
            storage.delete(old_receipt_key)
            deleted += 1
        _state["retention_deleted"] = deleted
        logger.info("HTTP PostgreSQL backup verified; revision=%s removed=%s", manifest["revision"], deleted)
        return {**receipt, "retention_deleted": deleted}
    except BackupError as exc:
        _state.update(last_failure=datetime.now(timezone.utc).isoformat(timespec="seconds"), last_error=str(exc))
        raise
    except Exception:
        error = BackupError("HTTP PostgreSQL backup failed; inspect persistence and private storage status")
        _state.update(last_failure=datetime.now(timezone.utc).isoformat(timespec="seconds"), last_error=str(error))
        raise error from None
    finally:
        _state["inflight"] = False
        if own_storage:
            storage.close()
        _local_lock.release()


def restore_local(archive: Path, target: Path) -> dict:
    """Restore the HTTP backup to a new SQLite file for a full recovery drill.

    No running application cache is touched. The verified file can subsequently
    be re-imported through the migration tooling during a controlled recovery.
    """
    created = False
    try:
        with tempfile.TemporaryDirectory(prefix="weather-http-restore-") as temp:
            manifest, database = validate_http_archive(archive, Path(temp))
            with database.open("rb") as src, target.open("xb") as dst:
                created = True
                for chunk in iter(lambda: src.read(CHUNK), b""):
                    dst.write(chunk)
            if _digest(target) != manifest["file_sha256"] or sqlite_summary(target) != manifest["tables"]:
                raise BackupError("restored SQLite file failed checksum verification")
            return {"status": "verified", "revision": manifest["revision"],
                    "created_at": manifest["created_at"],
                    "tables": {name: info["rows"] for name, info in manifest["tables"].items()}}
    except FileExistsError:
        raise BackupError("refusing to overwrite an existing recovery database") from None
    except Exception:
        if created:
            target.unlink(missing_ok=True)
        raise BackupError("local SQLite recovery drill failed") from None
