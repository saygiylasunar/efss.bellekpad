# Acceptance gates

## R0 foundation (this commit)
- [x] Branch isolation: main is not rewritten.
- [x] Clean tree from scratch: no Electron, legacy scripts, old CI or editor files.
- [x] Workflow compiled with live node schema; unknown/mismatched/cyclic graphs rejected.
- [x] EFSS opaque lines preserved and edits revision checked.
- [x] SQLite online backup is a transactionally consistent DB snapshot.
- [x] Managed subprocess lifecycle and API boundaries implemented.
- [ ] Real Comfy startup, cancellation and image output on Windows verified.
- [ ] Real Tiptap editor ↔ EFSS rich-schema roundtrip verified.
- [ ] Browser end-to-end and model inference verified.
- [ ] Process-tree kill, auth, dependency lockfiles, runtime packaging and licensing audit.

## Release gate
No unit-test count replaces a real UI → API → engine → output → persistence test.
No unavailable capability gets a fake UI button. No backend feature is complete until
the same action works through its user-facing interface and survives failure/recovery.
