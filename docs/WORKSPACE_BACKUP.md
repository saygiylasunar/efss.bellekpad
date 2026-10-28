# EFSS BellekPad — Portable Workspace Backup (v1)

**Implemented in** `backend/bellekpad/workspace_backup.py`. This is a
**local user-data operation**, not a model-download mechanism.

## Which files are included?

A verified `.efss-backup.zip` contains:

- `database/bellekpad.sqlite3` — consistent SQLite online backup of
  notes, conversations/messages, workflows, generation jobs and asset metadata.
- `assets/generations/<job-id>/<asset-id>.png|jpg|webp|gif` —
  **every image currently referenced** by the snapshot's generation-assets
  table.
- `manifest.json` — version, file sizes and SHA-256 digests.

No model weights, external model directories, ComfyUI installation, virtual
environments, Git source code, or working `backups/` directory are copied.
Future assets or files introduced by future features **MUST be added to the
backup contract before those features ship**.

## Web application: create and verify

In the sidebar, expand **Çalışma alanı yedeği**. The **Tam yedek oluştur**
button invokes `POST /api/workspace-backups`, which performs a consistent
database snapshot and streams all referenced image files to a staging ZIP.
The ZIP is individually verified and only then published atomically under
the user's `BELLEKPAD_DATA_ROOT/backups` directory.

`GET /api/workspace-backups` lists available backup archives and
`POST /api/workspace-backups/{name}/verify` rechecks a selected archive.
**Archive contents are deliberately not exposed by unauthenticated HTTP
download endpoints.** Access the file through the data root you selected.

There remains a legacy `POST /api/backups` which makes a **database-only**
snapshot; do not rely on it to back up image files.

## Offline restore — never overwrite the current workspace

Close BellekPad / stop its backend. With the backend Python package installed:

```powershell
python -m bellekpad.workspace_backup verify "D:\\BellekPadData\\backups\\workspace-<id>.efss-backup.zip"
python -m bellekpad.workspace_backup restore "D:\\BellekPadData\\backups\\workspace-<id>.efss-backup.zip" "D:\\BellekPadRestored"
```

`D:\\BellekPadRestored` **must not already exist**. The restore operation
first fully verifies the archive, rejects path traversal/undeclared files,
streams only manifest-allowlisted resources to a temporary sibling directory,
validates the SQLite database and per-file SHA-256, then atomically moves
that directory into place.

Set `BELLEKPAD_DATA_ROOT` to the restored directory and start the backend
using the existing startup instructions. The original directory remains
untouched. Do not attempt to restore directly into a live workspace.

## Safety invariants

- No generic `ZipFile.extractall`; only verified, allowlisted paths are
  written.
- Duplicates, missing files, symlinks in the source assets, unexpected ZIP
  members, mismatched SHA-256, missing archived images and unsupported DB
  schemas cause a **failed** backup/restore rather than silently dropping data.
- Databases use an online SQLite snapshot (WAL is not directly zipped).
- The application writes archived images to unique paths and does not mutate
  them after registration. An in-flight archive not yet recorded in the
  SQLite snapshot is correctly excluded, rather than referenced without data.
- Backup ZIP creation and restore stream large images instead of holding
  the entire archive in RAM. The implementation has bounded file-count,
  asset-size and total uncompressed-size checks against malformed archives.
- Backup ZIP excludes itself and all previous backups to prevent recursion.

## Scope of validation

Python HTTP and filesystem integration tests cover a note, a saved workflow,
a generation job, its stored image and the final restored workspace.
They also exercise a modified source asset, malformed ZIP metadata, unexpected
members and refusal to overwrite existing directories.

**Still unverified:** real Windows NTFS/antivirus/file-lock behavior,
multi-process web server deployment, browser click-through E2E, malicious
concurrent filesystem modification by an external process and long-running
large-volume backup performance. Before beta the backup contract must
be extended alongside every additional workspace asset type.
