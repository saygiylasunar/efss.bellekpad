# R4 — Generation lifecycle and image artifacts

**State:** API + SQLite + React UI wired; CI uses a fake Comfy adapter. Real
Windows/CUDA/Comfy image generation has NOT been accepted.

## Core / API / UI contract

1. Browser sends React Flow graph; core compiles against *live* `/object_info`.
2. Backend inserts a local job with immutable compiled-prompt JSON in
   `generation_jobs` **before** sending Comfy's `POST /prompt`.
3. On Comfy success, save returned upstream UUID and mark local job queued.
   On ambiguous HTTP failure mark `submission_unknown`, **not** failed:
   the upstream engine may already have accepted the request.
4. `GET /api/generations` reads durable local records. `GET
   /api/generations/{local_uuid}` consults Comfy's job API, normalizes state,
   and conservatively falls back to history on older Comfy installations.
   Unavailable engine leaves the *last observed* state intact.
5. Cancel route targets **only** upstream IDs associated with locally owned
   jobs. Accepting a cancel is **not** evidence that the job is cancelled:
   the state changes only when Comfy confirms it.
6. After job completion, image descriptors are parsed exclusively from
   Comfy's history outputs. The browser sees a BellekPad local URL, never a
   Comfy path or user-selected file path.
7. `GET /api/generations/{id}/images/{index}` resolves a validated output
   through the Comfy adapter. Browser controls only local job id + image
   index. The server contacts `/view` on the configured loopback worker.
8. A user can select **BellekPad'e arşivle** to copy the generated image to
   the explicitly configured workspace. The application writes to a
   temporary file, fsyncs, atomically renames and records hash/metadata in
   SQLite. `GET /api/assets/{asset_uuid}` checks SHA-256 before serving
   files, independently of the Comfy process.
9. React's GenerationPanel polls job state, displays engine vs locally
   archived output distinctly and never marks an unconfirmed submission as
   succeeded.

## Job state model

`submitting → queued → running → completed|failed|cancelled`

`submitting → submission_unknown` when the upstream POST answer is lost.
Jobs may go directly from queued to a terminal state; the UI cannot assume
intermediate events were seen. Terminal states are not overwritten by stale
engine observations.

## Persistence and backup

User data only inside `BELLEKPAD_DATA_ROOT`:
- `database/bellekpad.sqlite3` — workflow draft, generation job
  immutable prompt, latest state, image index/hash.
- `assets/generations/{job_uuid}/{asset_uuid}.png|jpg|webp|gif` —
  explicitly archived images.

**Important:** `POST /api/backups` currently backs up SQLite only.
An image in `assets/` is NOT included in that snapshot. A coordinated
manifest-based asset + DB backup/restore is required before beta.

Migration is additive from workspace schema v1 to v2; a future unknown
schema is refused instead of overwritten.

## Remaining runtime acceptance and security work

- Real ComfyUI version compatibility on Windows, especially
  `/api/jobs/{id}`, targeted cancel, `/history/{id}`, `/view`.
- Reconciliation of `submission_unknown` using a stable upstream client
  reference (no automatic blind retry). Stop/restart/process-tree cleanup.
- Persistent artifact ingestion strategy: current archive is explicit,
  not automatic; source images on the Comfy side may be cleaned up.
- Large image streaming to the browser instead of buffering full asset,
  deduplicated archive calls and transactionally coordinated DB/files.
- Browser session authentication, CSRF, origin hardening and Windows E2E.
- Restore from a crash-consistent **entire** workspace backup.

The CI fake runtime tests safety and contracts, not real inference.
