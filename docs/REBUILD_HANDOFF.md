# Rebuild handoff — clean architecture baseline

Source of truth: rebuild/web-ai-core. Old Electron G0.x implementation is preserved on main; do not copy wholesale or merge the stale editor PR. This branch was created from main with a new Git tree, removing obsolete Electron, legacy node workers, old workflows and the source-only editor.

## Implemented as source
- Python core: workflow validation and compilation using live Comfy /object_info; DAG/required port/type/literal checks.
- Managed Comfy supervisor: fixed operator-configured Python executable and main.py, no shell/renderer process arguments, true readiness, collision preflight, stop during start, failure states.
- Comfy adapter: /system_stats, /object_info, /prompt, /history/{id}, targeted /api/jobs/{id}/cancel.
- Workspace: user-selected data root; SQLite WAL, version checks for note **and workflow draft** updates, consistent database backup.
- Workflow drafts: versioned schema v1, offline create/list/open/update, geometry/inputs/edges persisted; duplicate IDs/dangling refs/nonfinite coordinates and stale revisions rejected. Saved drafts are not claimed to be executable until checked against live Comfy node definitions. React Flow Save/Open uses the same API.
- EFSS line projection: first lossless source-preservation slice with opaque unknown lines and hash/revision preconditions.
- FastAPI local routes and React Flow editor wired together; Tiptap Notes first limited editing slice.
- GitHub Actions: Python core/API contract tests and production TypeScript/Vite build.

## Deliberately not claimed
- Real Comfy integration with loaded weights on Windows; automatic engine/venv installation, runtime version pinning; generalized multi-engine scheduling and Windows job-object process cleanup.
- Full EFSS Markdown rich editing, symbols, multiple lines, tables and source-level semantic AST conversions.
- **Still missing:** immutable generation-job snapshots, revisioned preset overrides, SSE/WebSocket fanout and file/gallery output; current persisted drafts are not yet run artifacts.
- Chat LLM runtime, multi-agent sessions and conversation UI.
- Session authentication, mobile layout acceptance, installer, distribution/Comfy GPL audit and coordinated asset backup.

## First next executable acceptance path
1. Provide BELLEKPAD_DATA_ROOT (a real writable directory; never silently create a Roaming data root).
2. Install backend dependencies, start local API, build frontend and open the same-origin UI.
3. Configure a trusted Comfy Python environment and main.py, then start managed runtime from BellekPad UI.
4. Check that /object_info matches actual available node types; make a valid graph and compile it.
5. Submit, observe genuine Comfy job ID, read history and verify the output file/artifact end to end.
6. Verify known EFSS line edit + unknown-source roundtrip; test conflict and backup.
7. Workflow **draft** persistence already exists; next add immutable execution-job snapshots, real progress/output handling, and browser E2E testing after an actual Comfy run.

The primary product decisions live in [DECISIONS.md](DECISIONS.md). All engine lifecycle errors must be visible, with no fake READY. No mandatory VRAM size limit. Keep UI technical controls aligned with available backend contracts.
