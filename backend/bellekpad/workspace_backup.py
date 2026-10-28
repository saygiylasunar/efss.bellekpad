"""Portable, verified and complete backups of the *currently supported* workspace.

Includes SQLite online snapshot plus all generation_assets referenced by it.
Never blindly archive arbitrary files from a user-controlled directory.
Models remain external; they are not workspace assets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from contextlib import closing
from pathlib import Path

FORMAT = "EFSS-BELLEKPAD-WORKSPACE"
VERSION = 1
DB_MEMBER = "database/bellekpad.sqlite3"
MANIFEST = "manifest.json"
ARCHIVE_PATTERN = re.compile(r"^workspace-[0-9a-f]{32}\.efss-backup\.zip$")
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SAFE_ASSET = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$")
MAX_FILES = 20_000
MAX_MEMBER = 256 * 1024 * 1024    # transport safeguard for an image asset, not model capacity
MAX_TOTAL = 64 * 1024 * 1024 * 1024


class BackupError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _checksum(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _json_bytes(obj: object) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode("utf-8")


def _asset_member(job_id: str, filename: str) -> str:
    if not UUID_PATTERN.fullmatch(job_id) or not SAFE_ASSET.fullmatch(filename):
        raise BackupError("BACKUP_UNSAFE_ASSET_REFERENCE")
    return f"assets/generations/{job_id}/{filename}"


def _integrity(db_path: Path) -> None:
    # Read-only for verifying an archived snapshot: no automatic schema migrations.
    with closing(sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise BackupError("BACKUP_DATABASE_INVALID")
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise BackupError("BACKUP_FOREIGN_KEY_INVALID")
        schema = db.execute("PRAGMA user_version").fetchone()[0]
        if schema != 2:
            raise BackupError("BACKUP_DATABASE_SCHEMA_UNSUPPORTED")


def _assets(db_path: Path) -> list[tuple[str, str, str, int]]:
    with closing(sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)) as db:
        return db.execute(
            "SELECT generation_id,filename,sha256,size_bytes "
            "FROM generation_assets ORDER BY generation_id,id"
        ).fetchall()


def _manifest_check(archive: zipfile.ZipFile) -> dict:
    members = archive.infolist()
    names = [m.filename for m in members]
    if not members or len(members) > MAX_FILES or len(set(names)) != len(names):
        raise BackupError("BACKUP_INVALID_MEMBER_LIST")
    if MANIFEST not in names or DB_MEMBER not in names:
        raise BackupError("BACKUP_MISSING_CORE")
    if archive.getinfo(MANIFEST).file_size > 8 * 1024 * 1024:
        raise BackupError("BACKUP_MANIFEST_TOO_LARGE")
    # Each zip member must correspond to a declared archive resource.
    try:
        manifest = json.loads(archive.read(MANIFEST))
    except (ValueError, UnicodeDecodeError, OSError, RuntimeError, KeyError) as exc:
        raise BackupError("BACKUP_MANIFEST_INVALID") from exc
    if (not isinstance(manifest, dict) or manifest.get("format") != FORMAT
            or manifest.get("version") != VERSION
            or not isinstance(manifest.get("files"), list)):
        raise BackupError("BACKUP_FORMAT_UNSUPPORTED")
    entries = manifest["files"]
    if not entries or len(entries) > MAX_FILES or len(entries) != len(members) - 1:
        raise BackupError("BACKUP_INVALID_MANIFEST_FILES")
    described: set[str] = set()
    total = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise BackupError("BACKUP_INVALID_MANIFEST_FILES")
        path, size, digest = (entry.get("path"), entry.get("bytes"), entry.get("sha256"))
        if (not isinstance(path, str)
                or (path != DB_MEMBER and not re.fullmatch(
                    r"assets/generations/[0-9a-f-]+/[0-9a-f-]+\.(?:png|jpg|webp|gif)", path))
                or path in described or path not in names
                or type(size) is not int or size < 0
                or size > (MAX_TOTAL if path == DB_MEMBER else MAX_MEMBER)
                or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)):
            raise BackupError("BACKUP_INVALID_MANIFEST_FILES")
        if path != DB_MEMBER:
            parts = path.split("/")
            _asset_member(parts[2], parts[3])
        info = archive.getinfo(path)
        if info.is_dir() or info.file_size != size:
            raise BackupError("BACKUP_FILE_SIZE_MISMATCH")
        described.add(path)
        total += size
        if total > MAX_TOTAL:
            raise BackupError("BACKUP_EXCESSIVE_SIZE")
    if described != set(names) - {MANIFEST}:
        raise BackupError("BACKUP_UNDECLARED_RESOURCE")
    return manifest


def verify_backup(path: str | Path) -> dict:
    archive_path = Path(path)
    if not archive_path.is_file():
        raise BackupError("BACKUP_NOT_FOUND")
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            manifest = _manifest_check(archive)
            for item in manifest["files"]:
                sha = hashlib.sha256()
                total = 0
                with archive.open(item["path"]) as source:
                    while chunk := source.read(1024 * 1024):
                        total += len(chunk)
                        if total > item["bytes"]:
                            raise BackupError("BACKUP_FILE_SIZE_MISMATCH")
                        sha.update(chunk)
                if total != item["bytes"] or sha.hexdigest() != item["sha256"]:
                    raise BackupError("BACKUP_CHECKSUM_MISMATCH")
            # Exact asset list matches the SQLite snapshot, not just the manifest.
            with tempfile.TemporaryDirectory(prefix="efss-verify-") as folder:
                local_db = Path(folder) / "snapshot.sqlite3"
                with archive.open(DB_MEMBER) as source, local_db.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                _integrity(local_db)
                expected = {
                    _asset_member(job_id, filename): (sha, size)
                    for job_id, filename, sha, size in _assets(local_db)
                }
                declared = {i["path"]: (i["sha256"], i["bytes"])
                            for i in manifest["files"] if i["path"] != DB_MEMBER}
                if declared != expected:
                    raise BackupError("BACKUP_ASSET_MANIFEST_MISMATCH")
            return {"valid": True, "name": archive_path.name,
                    "asset_count": len(expected), "files": len(manifest["files"]),
                    "format_version": VERSION}
    except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, RuntimeError,
            sqlite3.DatabaseError, OSError, UnicodeError) as exc:
        raise BackupError("BACKUP_CORRUPT") from exc


def create_backup(workspace) -> dict:
    """Consistent snapshot of DB and every referenced image; atomic ZIP publish.

    Assets are immutable after their database entry is committed. A snapshot
    taken before an in-flight archive commit doesn't reference that new asset.
    """
    root = workspace.root
    folder = root / "backups"
    folder.mkdir(exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".workspace-", suffix=".zip", dir=folder)
    os.close(fd)
    target = Path(temporary)
    db_fd, db_temp = tempfile.mkstemp(prefix=".db-snapshot-", suffix=".sqlite3", dir=folder)
    os.close(db_fd)
    temp_db = Path(db_temp)
    final = folder / f"workspace-{uuid.uuid4().hex}.efss-backup.zip"
    try:
        with workspace.connect() as source, closing(sqlite3.connect(temp_db)) as snapshot:
            with snapshot:  # commit the SQLite backup transaction before closing
                source.backup(snapshot)
        _integrity(temp_db)
        entries: list[dict] = []
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED,
                             allowZip64=True) as archive:
            # Stream in constant memory, even when hundreds of images exist.
            def add_file(member: str, path: Path, expected: tuple[str, int] | None = None):
                size, checksum = 0, hashlib.sha256()
                with path.open("rb") as source, archive.open(member, "w", force_zip64=True) as output:
                    while chunk := source.read(1024 * 1024):
                        size += len(chunk)
                        if size > (MAX_TOTAL if member == DB_MEMBER else MAX_MEMBER):
                            raise BackupError("BACKUP_ASSET_TOO_LARGE")
                        checksum.update(chunk)
                        output.write(chunk)
                if expected and (size != expected[1] or checksum.hexdigest() != expected[0]):
                    raise BackupError("BACKUP_ASSET_INTEGRITY_ERROR")
                entries.append({"path": member, "bytes": size, "sha256": checksum.hexdigest()})

            add_file(DB_MEMBER, temp_db)
            seen = {DB_MEMBER}
            for jid, filename, digest, expected_size in _assets(temp_db):
                member = _asset_member(jid, filename)
                path = root / member
                if member in seen or path.is_symlink() or not path.is_file():
                    raise BackupError("BACKUP_ASSET_UNAVAILABLE")
                add_file(member, path, (digest, expected_size))
                seen.add(member)
                if len(entries) > MAX_FILES:
                    raise BackupError("BACKUP_TOO_MANY_FILES")
            manifest = {"format": FORMAT, "version": VERSION,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "files": entries}
            archive.writestr(MANIFEST, _json_bytes(manifest))
        verify_backup(target)  # publish only a verified full workspace backup
        os.replace(target, final)
        return {"name": final.name, "valid": True, "asset_count": len(entries) - 1,
                "size_bytes": final.stat().st_size}
    except (OSError, sqlite3.DatabaseError, zipfile.BadZipFile) as exc:
        raise BackupError("BACKUP_IO_FAILED") from exc
    finally:
        target.unlink(missing_ok=True)
        temp_db.unlink(missing_ok=True)


def restore_backup(archive_path: str | Path, new_root: str | Path) -> dict:
    """Offline restore to a NEW directory; never overwrite a live user workspace.

    No ZipFile.extract() used. Files are allowlisted through manifest and
    written to a staging directory, then atomically renamed as a single unit.
    """
    result = verify_backup(archive_path)
    destination = Path(new_root).expanduser().absolute()
    if destination.exists() or destination == destination.parent:
        raise BackupError("RESTORE_TARGET_MUST_NOT_EXIST")
    if not destination.parent.is_dir():
        raise BackupError("RESTORE_PARENT_NOT_FOUND")
    staging = Path(tempfile.mkdtemp(prefix=".efss-restore-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            manifest = _manifest_check(archive)
            for item in manifest["files"]:
                target = staging.joinpath(*item["path"].split("/"))
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                length = 0
                with archive.open(item["path"]) as source, target.open("wb") as output:
                    while chunk := source.read(1024 * 1024):
                        length += len(chunk)
                        if length > item["bytes"]:
                            raise BackupError("BACKUP_FILE_SIZE_MISMATCH")
                        digest.update(chunk)
                        output.write(chunk)
                if length != item["bytes"] or digest.hexdigest() != item["sha256"]:
                    raise BackupError("BACKUP_CHECKSUM_MISMATCH")
        # Reverify restored DB and archive (integrity check independently).
        _integrity(staging / DB_MEMBER)
        if destination.exists():
            raise BackupError("RESTORE_TARGET_MUST_NOT_EXIST")
        os.replace(staging, destination)
        return {**result, "restored": True, "workspace_path": str(destination)}
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify or restore a BellekPad full workspace backup, offline.")
    sub = parser.add_subparsers(dest="command", required=True)
    ver = sub.add_parser("verify")
    ver.add_argument("archive")
    res = sub.add_parser("restore")
    res.add_argument("archive")
    res.add_argument("new_empty_root", help="A NEW, not-yet-existing directory")
    args = parser.parse_args()
    try:
        payload = (verify_backup(args.archive) if args.command == "verify"
                   else restore_backup(args.archive, args.new_empty_root))
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    except BackupError as exc:
        parser.exit(2, f"BellekPad backup failed: {exc.code}\n")


if __name__ == "__main__":
    main()
