# Acceptance gates

## R0 foundation (this commit)
- [x] Branch isolation: main is not rewritten.
- [x] Clean tree from scratch: no Electron, legacy scripts, old CI or editor files.
- [x] Workflow compiled with live node schema; unknown/mismatched/cyclic graphs rejected.
- [x] EFSS opaque lines preserved and edits revision checked.
- [x] Revisioned EFSS draft API supports new lines / Enter / safe line deletion with opaque-block invariants; core and HTTP regression tests.
- [ ] Real Windows Tiptap multiline save, reload and paste/IME/selection acceptance; advanced EFSS rich editing still open.
- [x] All SQLite temporary/snapshot read connections explicitly closed; regression tests assert handles are released.
- [ ] Windows NTFS backup+verify retest following observed WinError 32.
- [x] SQLite online backup is a transactionally consistent DB snapshot.
- [x] Managed subprocess lifecycle and API boundaries implemented.
- [x] Local Comfy installation UI → validated profile → SQLite v3+ → managed subprocess fixed args contract tested, including configuration lock while running.
- [x] Model Registry R2.5: approved-root-only discovery, symlink skip, metadata-only scan, transactional replacement, SQL-filtered paging and metadata-only deletion tested in Core/API.
- [x] Registry metadata retained through portable SQLite workspace backup; schema v3→v4 additive update tested with existing state.
- [x] Selected model UUID → registered root → bounded GGUF/Safetensors header inspector → API → Models UI; corruption/stale/symlink defense tested.
- [ ] Actual GGUF/Safetensors runner compatibility, tokenizer/encoder dependency and real-model activation; header inspection is not inference support.
- [x] Native Windows 3.13 CI job added alongside Ubuntu API/core test and frontend build (its success/failure is checked on each commit).
- [ ] Real Comfy installation through browser UI: start, readiness, node palette, image output and stop on Windows.
- [x] Workflow draft v1 storage: save while Comfy offline, list/open, layout roundtrip, optimistic revision conflict and backup tested through HTTP.
- [x] React Flow Save/Open UI binds to backend endpoints; TypeScript/Vite build passes.
- [x] Generation job stored before Comfy submit; API state, targeted cancellation and ambiguous submit failures tested with fake runtime.
- [x] Owned image preview and opt-in archive API + React UI; SHA-256 validation, offline retrieval and tamper detection tested with fake runtime.
- [x] Workspace schema v1→v2 migration does not discard existing notes/workflows or downgrade a future schema.
- [ ] Crash reconciliation after unknown submission; idempotent job/image archive requests.
- [ ] Real browser click-to-save/reopen end-to-end acceptance (not replaced by TypeScript compilation).
- [ ] Real Comfy startup, job-state/cancellation and image output on Windows verified.
- [x] Portable DB + archived-image ZIP snapshot: API creation, integrity verification, CLI offline restore to new root, corruption/missing asset and overwrite refusal tested with local filesystem.
- [ ] Real Windows/NTFS restore, running multi-worker concurrency and browser click E2E acceptance.
- [ ] Real Tiptap editor ↔ EFSS rich-schema roundtrip verified.
- [ ] Browser end-to-end and model inference verified.
- [ ] Process-tree kill, auth, dependency lockfiles, runtime packaging and licensing audit.

## Release gate
No unit-test count replaces a real UI → API → engine → output → persistence test.
No unavailable capability gets a fake UI button. No backend feature is complete until
the same action works through its user-facing interface and survives failure/recovery.
