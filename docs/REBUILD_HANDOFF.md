# Rebuild handoff — clean architecture baseline

Source of truth: rebuild/web-ai-core. Old Electron G0.x implementation is preserved on main; do not copy wholesale or merge the stale editor PR. This branch was created from main with a new Git tree, removing obsolete Electron, legacy node workers, old workflows and the source-only editor.

## Implemented as source
- Python core: workflow validation and compilation using live Comfy /object_info; DAG/required port/type/literal checks.
- Managed Comfy supervisor: fixed Python executable and Comfy main.py, now **configurable from BellekPad's own UI**, persisted in SQLite v3 with user-selected Comfy root and Python runtime, auto-discovery in known installation-local folders; no shell/renderer argv, collision preflight, true readiness and bounded startup diagnostics. See `RUNTIME_SETUP.md`.
- Comfy adapter: /system_stats, /object_info, /prompt, /history/{id}, targeted /api/jobs/{id}/cancel.
- Workspace: user-selected data root; SQLite WAL, version checks for note **and workflow draft** updates, consistent database backup.
- Workflow drafts: versioned schema v1, offline create/list/open/update, geometry/inputs/edges persisted; duplicate IDs/dangling refs/nonfinite coordinates and stale revisions rejected. Saved drafts are not claimed to be executable until checked against live Comfy node definitions. React Flow Save/Open uses the same API.
- EFSS source projection: revisioned, source-preserving ordered drafts now support new/deleted safe lines, Enter and headings, while opaque unknown syntax remains immutable with source-hash checks.
- FastAPI local routes and React Flow editor wired together; Tiptap Notes supports basic multi-line text, empty paragraphs and revision-safe edits; exotic EFSS constructs remain read-only.
- Generation lifecycle: immutable Comfy API prompt snapshot persisted before submitting, local job UUID, observed queue/running/terminal status, targeted cancel, upstream image gallery and on-demand archive into the chosen workspace with SHA-256 checks; schema v1→v2 additive migration.
- Full workspace backups: `workspace_backup.py` creates a verified portable ZIP with online SQLite snapshot plus **every referenced image file**, using SHA-256 manifest; offline restore into a *new* directory, no overwrite. `/api/workspace-backups` endpoints and Web sidebar are integrated. Legacy `/api/backups` remains DB-only; see `WORKSPACE_BACKUP.md`.
- GitHub Actions: Python core/API contract tests and production TypeScript/Vite build.

## Deliberately not claimed
- Real Comfy integration with loaded weights on Windows; automatic engine/venv installation, runtime version pinning; generalized multi-engine scheduling and Windows job-object process cleanup.
- Full EFSS Markdown rich editing, specialized EFSS symbols, advanced formatting/tables and semantic AST conversions. Basic safe multi-paragraph editing is now implemented.
- **Still missing:** preset overrides, SSE/WebSocket live events and automatic archive policy. Comfy image preview and manual image archiving have API/UI code and mocked integration tests; **no physical Comfy inference has been verified**. Legacy SQLite-only backup excludes image file bytes; the new portable workspace backup includes referenced files. Real Windows/NTFS acceptance, multi-process locking and browser E2E remain open.
- Chat LLM runtime, multi-agent sessions and conversation UI.
- Session authentication, mobile layout acceptance, installer, distribution/Comfy GPL audit and additional future asset-type backup coverage. Real Comfy Windows runtime with model weights remains unverified.

## İlk gerçek Windows arayüz denemesi — 28.10.2026

Kullanıcının tarayıcı ekran görüntüleri: BellekPad arayüzü yükleniyor; backend
motor durumu `UNCONFIGURED` (Comfy python yolu verilmediği için beklenen).
**Yeni not** ve **Tam yedek oluştur** eylemleri HTTP hatası dönüyordu.
Kök neden API `Origin` izni: Vite'nin gerçek adresi
`http://127.0.0.1:5173` iken backend mutasyonlarda yalnız
`http://localhost:5173` adresine izin veriyordu. GET çalışırken POST/PATCH
403 `UNTRUSTED_ORIGIN` veriyor; UI gerçek hata kodunu göstermeyip genel
`Not kaydedilemedi` / `Yedekleme işlemi başarısız` mesajlarını gösteriyordu.

**Yapılanlar:** backend Origin allowlist düzeltildi; iki adres için not
oluşturma+düzenleme ve tam yedek/verify POST sözleşme testleri eklendi;
frontend Note/Backup API error handling backend `error` kodunu gösteriyor.
**İkinci Windows denemesinde:** Yeni notun API üzerinde oluşturulduğu (`POST /api/notes 200`)
doğrulandı. Ancak Enter ile satır ekleyip kaydetme, önceki dar editör
sözleşmesinde `Yapı değişti` uyarısıyla durdu. Bunun üzerine EFSS kaynağını
bilinmeyen bloklara dokunmadan koruyan, yeni satır ekleme/silme ve başlık
yazmayı destekleyen `rewrite_blocks` çekirdeği ile `draft` API sözleşmesi
eklendi. Tiptap bu sözleşmeyi kullanıyor. Temel dönüşüm ve HTTP testleri var,
ama **yeni sürümde gerçek tarayıcı kaydetme kabulü henüz yapılmadı**.

Aynı denemede `POST /api/workspace-backups` **500** döndü:
`workspace_backup.py` içindeki `with sqlite3.connect(...) as db`
yalnızca SQLite transaction'ını kapatıyordu, **bağlantıyı kapatmıyordu**.
Windows'ta SQLite dosya handle'ı açık kaldığı için `TemporaryDirectory`
çıkışında `WinError 32` meydana geliyordu. Okuma bağlantıları ve backup
snapshot bağlantısı `contextlib.closing` ile açıkça kapatıldı. Açık kalan
bağlantıları test eden regresyon eklendi. **Gerçek Windows üzerinde yeni
versiyonda tekrar yedekleme/doğrulama bekleniyor.**

İlk kullanıcı arayüzünden fazlalık açıklamalar ve sürüm etiketi parçaları
kaldırıldı; fonksiyonlar korunuyor. Vite çalıştı fakat yerel
`Node v20.19.5`, `package.json` tarafından istenen `>=22.12.0`
sürümünün altında. Node 22+ güncellemesi geliştirme ortamı kabulü için gerekli.

## First next executable acceptance path
1. Provide BELLEKPAD_DATA_ROOT (a real writable directory; never silently create a Roaming data root).
2. Install backend dependencies, start local API, build frontend and open the same-origin UI.
3. Configure a trusted Comfy Python environment and main.py, then start managed runtime from BellekPad UI.
4. Check that /object_info matches actual available node types; make a valid graph and compile it.
5. Submit, observe genuine Comfy job ID, read history and verify the output file/artifact end to end.
6. Verify known EFSS line edit + unknown-source roundtrip; test conflict and backup.
7. Immutable prompt snapshots, durable jobs, image preview and opt-in image archiving are implemented. Next: real Comfy output/job-state acceptance on Windows, unknown-submission reconciliation, real Windows verification of portable assets+DB restore, and browser E2E.

The primary product decisions live in [DECISIONS.md](DECISIONS.md). All engine lifecycle errors must be visible, with no fake READY. No mandatory VRAM size limit. Keep UI technical controls aligned with available backend contracts.
