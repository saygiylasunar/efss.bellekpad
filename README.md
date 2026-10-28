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

**Implemented in this foundation:** a core workflow compiler, an isolated process supervisor, a version-checked EFSS line patch contract, a user-chosen SQLite workspace and online backup, a Comfy API adapter, **offline-capable versioned workflow draft create/list/open/update with SQLite revision checks and React Flow Save/Open controls**, and core/API contract tests. **Not implemented:** model inference, multi-agent chat, general rich EFSS editing, automated Comfy installation, a release installer. No fake readiness or GPU checks.

## Development (after installing Python dependencies)

From repo root:

- python -m unittest discover -s backend/tests -v
- cd frontend && npm install && npm run dev (development UI, backend listens on :8765)
- cd frontend && npm run build (built UI is served by FastAPI on :8765)
- python -m pip install -e ./backend
- Set BELLEKPAD_DATA_ROOT to an explicit writable folder before starting.
- Optional managed Comfy engine: set BELLEKPAD_COMFY_PYTHON to the trusted Comfy venv Python executable, and BELLEKPAD_COMFY_MAIN to its main.py; optionally set BELLEKPAD_COMFY_CWD.
- python -m uvicorn bellekpad.api:create_app --factory --app-dir backend --host 127.0.0.1 --port 8765

Do not expose the backend or Comfy engine on a LAN/public interface. Read docs/ARCHITECTURE.md and docs/ACCEPTANCE.md before extending.

## Release/licensing

BellekPad original code is proprietary. ComfyUI is GPL-3.0: merely using its local HTTP API for development is not a license analysis for bundling/distributing it. The **first rebuild does not vendor ComfyUI or its weights**. Distribution mode requires legal and packaging review.
