# BellekPad G0.1 — Electron Desktop Bridge + Editor Input Spike

**Milestone:** secure frontend ↔ native storage connection with a working local writing surface. **NOT a finished rich-text editor**, artboard system, installer, or packaging/signing release.

## Architecture in working code

\`\`\`text
desktop/ui/index.html + app.js + styles.css
           | strict context isolation
desktop/preload.cjs         (four fixed methods; no generic IPC)
           | validated Electron IPC, main-frame only
desktop/main.js             (sandboxed Chromium, local static protocol)
           |
src/desktop-document-service.js (pure Node service/API)
           |
src/local-document-vault.js      (versioned original EFSS Markdown)
           |
per-user app.getPath("userData")/vault
\`\`\`

- The domain service handles \`list\`, \`open\`, \`create\` and \`saveDraft\` for **paper/project** only; request arguments contain IDs, not paths. Payload title and body limits and strict JSON structure are validated in the main process, not just the UI.
- Source and revision are handled by the existing LocalDocumentVault. Overwrites require the exact prior SHA-256 revision. The service preserves existing metadata fields when saving a draft.
- Preload exports four specific methods; **never** ipcRenderer or unrestricted send/invoke. Main accepts only IPC requests from the actual editor window's trusted main frame.
- Renderer is \`sandbox: true\`, \`contextIsolation: true\`, \`nodeIntegration: false\`. New windows, navigation and webviews are blocked; device permission requests denied. CSP prohibits external scripts, network connections, frames and objects.
- Local \`bellekpad://app/\` serves only explicitly permitted checked-in HTML/CSS/JS paths. No arbitrary file paths, notes, model files or local filesystem documents can be fetched as URLs.
- Native documents reside under Electron's **per-user application data directory**, not in the Git repository. No unapproved cloud or model access.
- The renderer shows a native plain-text \`contenteditable="plaintext-only"\` proof and an **own AST** read-only preview. It is explicitly a G0 input/IPC spike, **not** the visual block, typography or layout editor. Preview uses \`textContent\` and creates safe DOM nodes, not unsanitized \`innerHTML\`.

## Installation and running (Windows desktop first)

Requires Node >= 20 (Node 22 recommended) and npm. Electron is the **only** approved external dev/runtime host; there is no imported rich-text or UI framework.

\`\`\`powershell
git clone https://github.com/saygiylasunar/efss.bellekpad.git
cd efss.bellekpad
npm install
npm run desktop
\`\`\`

The package pins Electron \`44.9.3\` as a development dependency. No packaged \`.exe\`, installer, signing, auto-update, PDF export or Linux/macOS smoke run has been produced. An Electron executable must be installed by \`npm install\`. The current CI runs **Node-only contract/syntax/privacy tests**, not the Electron GUI; do not infer runtime correctness from green CI.

## Manual smoke tests (pending real desktop confirmation)

1. Launch desktop, verify local \`bellekpad://app\` loads without preload/CSP errors.
2. New page → enter title and Turkish body with emoji → wait for saved state → close/relaunch → open the same note and compare bytes.
3. Type during an in-flight save and verify the next version is not lost; force a conflict via a second session and ensure it is surfaced rather than overwritten.
4. Try Ctrl+S, native text selection, right-click/paste, undo/redo, IME composition and clipboard HTML; no script should execute or leak a filesystem path.
5. Ensure only allowed static resources load; attempt navigating to a remote URL and opening a new window; both blocked.
6. Test on Windows/Vivaldi Chromium and Electron; repeat on Firefox as web-host spike where applicable.

## Known limitations (not hidden)

- Text is currently plain within the editable host; the adjacent preview **does not implement full CommonMark/GFM** or render all inline syntax. Table/callout insertion, text styling, multi-artboard layout, slash commands and positioning are **not yet implemented**.
- Browser-native \`contenteditable\` selection/IME re-conciliation is not yet backed by full text transaction/caret mapping. The G0 screen is an input smoke-test surface and does not claim perfect undo/IME behavior.
- Autosave is revision-aware and avoids overwriting newer versions, but a crash or forced kill can lose unsaved text; IndexedDB/local draft recovery is still planned. The UI may show a close warning, not a durable last-resort backup.
- The Electron user-data vault is separate from the repository's CLI \`.efss/vault\`; **no automatic migration** occurs. Future import/backup must be explicit.
- No production lockfile/install build was generated in this integration step. Electron is pinned, but transitive installs should be locked before distribution.
- A privileged desktop main process exists and needs further security audit before handling untrusted extension packs, icon uploads or remote content.

## Next G0.2 (focus)

Implement a pure transaction reducer with typed document/node positions, grapheme-safe selection mapping, inverse steps/undo, then replace the temporary plaintext host with a model-backed visual text frame. **Do not** expand shell privileges or import a third-party editor.
