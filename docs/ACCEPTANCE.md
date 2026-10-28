# Acceptance gates

## R0 foundation (this commit)
- [x] Branch isolation: main is not rewritten.
- [x] Clean tree from scratch: no Electron, legacy scripts, old CI or editor files.
- [x] Workflow compiled with live node schema; unknown/mismatched/cyclic graphs rejected.
- [x] EFSS opaque lines preserved and edits revision checked.
- [x] SQLite online backup is a transactionally consistent DB snapshot.
- [x] Managed subprocess lifecycle and API boundaries implemented.
- [x] Workflow draft v1 storage: save while Comfy offline, list/open, layout roundtrip, optimistic revision conflict and backup tested through HTTP.
- [x] React Flow Save/Open UI binds to backend endpoints; TypeScript/Vite build passes.
- [x] Generation job stored before Comfy submit; API state, targeted cancellation and ambiguous submit failures tested with fake runtime.
- [x] Owned image preview and opt-in archive API + React UI; SHA-256 validation, offline retrieval and tamper detection tested with fake runtime.
- [x] Workspace schema v1→v2 migration does not discard existing notes/workflows or downgrade a future schema.
- [ ] Crash reconciliation after unknown submission; idempotent job/image archive requests.
- [ ] Real browser click-to-save/reopen end-to-end acceptance (not replaced by TypeScript compilation).
- [ ] Real Comfy startup, job-state/cancellation and image output on Windows verified.
- [ ] Coordinated database AND archived-image snapshot/restore verified.
- [ ] Real Tiptap editor ↔ EFSS rich-schema roundtrip verified.
- [ ] Browser end-to-end and model inference verified.
- [ ] Process-tree kill, auth, dependency lockfiles, runtime packaging and licensing audit.

## Release gate
No unit-test count replaces a real UI → API → engine → output → persistence test.
No unavailable capability gets a fake UI button. No backend feature is complete until
the same action works through its user-facing interface and survives failure/recovery.
