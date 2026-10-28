# R2 — Managed Comfy runtime integration

BellekPad owns the UI, job validation and worker process. ComfyUI remains a
locally managed *backend engine*, not a second UI you must run.

## Configure once from BellekPad

Open the **Motor ayarları** section in the left rail and select your
**existing** ComfyUI installation directory (the directory containing
`main.py` and `folder_paths.py`). Python executable can be omitted if
a supported local environment is found automatically:

- `<Comfy>/.venv/Scripts/python.exe` or `<Comfy>/venv/Scripts/python.exe`
- `<Comfy>/.venv/bin/python` or `<Comfy>/venv/bin/python`
- `<Comfy>/../python_embeded/python.exe` or `../python_embedded/python.exe`
- `<Comfy>/../.venv/Scripts/python.exe`

Or supply your own full path to the Python executable of the Comfy
environment. It must already have the required Comfy dependencies.
**The application does not install or update Comfy, CUDA, PyTorch or
weights in this slice.**

Select **Motoru kaydet**, then **Başlat**. BellekPad starts this fixed process
internally:

```text
<python_executable> <comfy_root>/main.py --listen 127.0.0.1 --port 8188
```

The UI cannot inject command-line arguments, choose a remote listener,
select arbitrary Python scripts or supply a working directory independently.
The backend performs file and installation-signature checks.

The profile is stored in the existing user-selected workspace root in
SQLite v3. On subsequent launches it is loaded automatically. Settings
cannot be changed while the owned worker is starting, ready or stopping.
No runtime model-weight or VRAM limits are imposed.

**Motor kayıtları** expands an on-demand, limited worker log when diagnostics
are needed. The default app view stays uncluttered.

## Current safety & compatibility

- Local FastAPI still binds to `127.0.0.1`. Host/Origin protection applies.
- The runtime always uses local Comfy port `8188`. Existing listener detection
  prevents claiming an unrelated Comfy process as managed.
- Offline Notes, workflow drafts and backups work without Comfy.
- Worker state is never fabricated by the frontend; it is provided by the
  backend's supervisor, which probes Comfy's health API.
- Existing external model folders remain in their original locations;
  no background recursive model scan and no model copies.
- SQLite v3 migration adds `runtime_profiles`; legacy v2 archives remain
  verifiable/restorable and the workspace upgrades on next open.
- GitHub Actions run Python contract tests on **Ubuntu and Windows Python
  3.13**, plus a frontend production build.

## Remaining for real Windows/GPU acceptance

An actual installed ComfyUI process with weights has not been exercised
through BellekPad on the user's desktop. Worker log capture and state
updates have contract tests; installed-package compatibility, custom-node
compatibility, model path interoperability, subprocess tree cleanup, job
reconciliation, streaming progress and full browser E2E still need
verification. Comfy version-specific behaviour will be handled at the engine
adapter, not as ad hoc frontend exceptions.
