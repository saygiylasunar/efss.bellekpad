# EFSS BellekPad — Web AI Core

**Kanonik karar defteri:** [docs/DECISIONS.md](docs/DECISIONS.md) ·
[Devir durumu](docs/REBUILD_HANDOFF.md) ·
[Kabul kapıları](docs/ACCEPTANCE.md)

This is the **clean Web-First / AI-First rebuild** on branch rebuild/web-ai-core. The previous Electron implementation remains preserved in main and its Git history. Do not merge the obsolete Electron PR into this branch.

## Architecture (R0 foundation)

- Web-first React/TypeScript front end; no Electron in this source tree.
- Python/FastAPI owns all validation, runtime lifecycles and persistence.
- A managed ComfyUI server is a **worker**, never a required second UI.
- The workflow graph is validated server-side against live ComfyUI object_info before executing.
- Tiptap/ProseMirror and EFSS are separated by a lossless, versioned conversion boundary; unsupported EFSS blocks must not disappear.
- User chooses the data root and model directories. No model files or personal notes live in Git.
- Conversation policies: Parallel / Roundtable / Orchestrated. Runtime implementations are future end-to-end slices, not pretended features.

## Important: implemented vs planned

**Implemented:** a core workflow compiler, managed process supervisor, source-preserving EFSS edit boundary, explicit SQLite workspace root, API and React Flow/Tiptap slices, revisioned offline workflow drafts, and **durable generation jobs with status/cancellation tracking, engine-history image gallery and optional local image archiving**. A schema-v2 additive migration is tested. **Not implemented:** real model inference, multi-agent chat, advanced EFSS formatting, automated Comfy installation, a release installer. Basic multi-paragraph Tiptap notes use a lossless EFSS ordered-draft contract. No fake readiness or GPU checks.

## Development (after installing Python dependencies)

**Requirements:** Python 3.11+; **Node.js 22.12+** for the current Vite toolchain. If your terminal already ends in `frontend>`, run `npm install` and `npm run dev` directly (do not `cd frontend` again).

From repo root:

- python -m unittest discover -s backend/tests -v
- cd frontend && npm install && npm run dev (development UI, backend listens on :8765)
- cd frontend && npm run build (built UI is served by FastAPI on :8765)
- python -m pip install -e ./backend
- Set BELLEKPAD_DATA_ROOT to an explicit writable folder before starting.
- Optional managed Comfy engine: set BELLEKPAD_COMFY_PYTHON to the trusted Comfy venv Python executable, and BELLEKPAD_COMFY_MAIN to its main.py; optionally set BELLEKPAD_COMFY_CWD.
- python -m uvicorn bellekpad.api:create_app --factory --app-dir backend --host 127.0.0.1 --port 8765

Do not expose the backend or Comfy engine on a LAN/public interface. Read [generation lifecycle](docs/GENERATION_LIFECYCLE.md), [architecture](docs/ARCHITECTURE.md), [workspace backup & restore](docs/WORKSPACE_BACKUP.md), and [acceptance](docs/ACCEPTANCE.md). **Portable workspace ZIP backups now contain both SQLite and referenced archived images.** The older `/api/backups` endpoint remains **database-only**; use the sidebar's **Tam yedek oluştur** for a complete supported-data backup.

## Release/licensing

BellekPad original code is proprietary. ComfyUI is GPL-3.0: merely using its local HTTP API for development is not a license analysis for bundling/distributing it. The **first rebuild does not vendor ComfyUI or its weights**. Distribution mode requires legal and packaging review.
