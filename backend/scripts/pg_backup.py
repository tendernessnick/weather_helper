"""Manual backup and recovery drill. Credentials come only from environment."""
import argparse
import base64
import json
import os
import sys
from pathlib import Path

# Works as `.venv/bin/python scripts/pg_backup.py ...` from any directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import config as _config  # noqa: E402,F401 (load optional local .env)
from app.services.pg_backup import (BackupConfig, BackupError, CloudBaseStorage,  # noqa: E402
                                    backup_once, backup_http_once, decrypt_file, restore_drill,
                                    restore_local, validate_archive, validate_http_archive)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    backup = sub.add_parser("backup", help="Create one verified encrypted backup")
    backup.add_argument("--force", action="store_true", help="Ignore the daily freshness check")
    download = sub.add_parser("download", help="Download a backup object without decrypting it")
    download.add_argument("object_key")
    download.add_argument("output", type=Path)
    decrypt = sub.add_parser("decrypt", help="Authenticate and decrypt into a new ZIP file")
    decrypt.add_argument("input", type=Path)
    decrypt.add_argument("output", type=Path)
    inspect = sub.add_parser("inspect", help="Check decrypted archive and print safe table counts")
    inspect.add_argument("archive", type=Path)
    local = sub.add_parser("restore-local", help="Verify and restore HTTP backup into a new SQLite file")
    local.add_argument("archive", type=Path)
    local.add_argument("output", type=Path)
    restore = sub.add_parser("restore-drill", help="Restore to BACKUP_RESTORE_DATABASE_URL, never production")
    restore.add_argument("archive", type=Path)
    restore.add_argument("--allow-restore", action="store_true", required=True,
                         help="Acknowledge creating tables in an explicitly separate database")
    args = parser.parse_args()
    try:
        if args.command == "backup":
            cfg = BackupConfig.from_env()
            if cfg.mode == "cloudbase_http":
                # A standalone process has no live coordinator. Build a new
                # read-only cache from revision-checked canonical RPC pages;
                # never acquire or displace the running application's writer.
                from app.persistence_http import Coordinator, HttpRemoteStore
                from app.db import Base
                from app import models as _models  # noqa: F401
                def export(path):
                    import tempfile
                    with tempfile.TemporaryDirectory(prefix="weather-cli-snapshot-") as cache_dir:
                        remote = HttpRemoteStore(os.environ.get("PERSISTENCE_API_URL", ""),
                                                 os.environ.get("PERSISTENCE_API_KEY", ""))
                        try:
                            coordinator = Coordinator(remote, Path(cache_dir) / "cache.db", Base.metadata)
                            coordinator.bootstrap_cache()
                            return coordinator.export_snapshot(path)
                        finally:
                            remote.close()
                result = backup_http_once(cfg, export, force=args.force)
            else:
                result = backup_once(cfg, force=args.force)
        elif args.command == "download":
            client = CloudBaseStorage(BackupConfig.from_env())
            try:
                client.require_private()
                client.download(args.object_key, args.output)
            finally:
                client.close()
            result = {"status": "downloaded"}
        elif args.command == "decrypt":
            key = base64.b64decode(os.environ.get("BACKUP_ENCRYPTION_KEY", ""), validate=True)
            if len(key) != 32:
                raise BackupError("BACKUP_ENCRYPTION_KEY must be base64 of 32 bytes")
            decrypt_file(args.input, args.output, key)
            result = {"status": "authenticated"}
        elif args.command == "inspect":
            import tempfile
            with tempfile.TemporaryDirectory(prefix="weather-pg-inspect-") as directory:
                import zipfile
                with zipfile.ZipFile(args.archive) as handle:
                    is_http = "weather.db" in handle.namelist()
                validate = validate_http_archive if is_http else validate_archive
                manifest, _dump = validate(args.archive, Path(directory))
            result = {"status": "valid_archive", "created_at": manifest["created_at"],
                      "schema": manifest["schema"],
                      "tables": {name: info["rows"] for name, info in manifest["tables"].items()}}
        elif args.command == "restore-local":
            result = restore_local(args.archive, args.output)
        else:
            target = os.environ.get("BACKUP_RESTORE_DATABASE_URL", "")
            if not target:
                raise BackupError("BACKUP_RESTORE_DATABASE_URL is required")
            result = restore_drill(args.archive, target, os.environ.get("DATABASE_URL", ""))
        print(json.dumps(result, ensure_ascii=False))
    except BackupError as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception:
        # Never leak connection strings through a command-line traceback.
        print('{"status":"failed","error":"invalid backup command input or environment"}', file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
