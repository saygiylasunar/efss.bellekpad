# BellekPad — Platform Strategy (Desktop / Web / Mobile)

**Status:** Architectural direction, NOT an Electron integration or a working executable. Decision date: 2026-10-21.

## Product decision

**BellekPad is an offline-capable, desktop-oriented document editor, not intrinsically a browser website.** Its portable visual interface can be implemented in HTML/CSS/SVG plus BellekPad-authored JavaScript modules. This does **not** imply that a remotely hosted website or a tab-based browser workflow is the primary product.

The edit engine, document format, transaction system, layout/artboard logic, source serializer and command model **must have no dependency on Electron, Chromium's privileged Node APIs, or another shell's application-specific data format**. Rendering and native inputs are platform adapters.

Electron is **allowed as a future application shell**, despite the rule against third-party **editor engines**. A shell is not a ProseMirror/Tiptap substitute. It owns windows, desktop packaging, filesystem permissions and OS integration, not the editor's content model.

## Why Discord and Slack are relevant

Discord publicly describes launching as a web app and subsequently using Electron as a desktop wrapper for desktop functionality. Slack engineering describes a reusable web application running inside a desktop Electron shell, plus native integration for taskbar, notifications, deep links and filesystem/window behavior. These products show that **shared visual/client code and installable desktop packaging can coexist**. Their remote-service/cloud architecture and complex multi-window process structure are not requirements for BellekPad.

Relevant references:
- Discord 64-bit desktop migration: https://discord.com/blog/how-discord-seamlessly-upgraded-millions-of-users-to-64-bit-architecture
- Slack hybrid Electron architecture: https://slack.engineering/building-hybrid-applications-with-electron/
- Slack desktop shell migration: https://slack.engineering/growing-pains-migrating-slacks-desktop-app-to-browserview/
- Electron introduction: https://www.electronjs.org/docs/latest/
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security/
- Tauri architecture: https://v2.tauri.app/
- Tauri OS webview choices: https://v2.tauri.app/reference/webview-versions/

## Packaging options, not editor implementation dependencies

| Runtime | Desktop | Mobile | Benefits | Costs / risks |
|---|---|---|---|---|
| Browser web app / optional PWA | Browser window | Browser | Fast iteration and device testing, no installer | File/OS access boundaries; browser quotas; not the complete native desktop experience |
| **Electron shell** | Windows / macOS / Linux | Not an Android/iOS packaging solution | Bundled Chromium gives relatively consistent text/IME rendering, direct JavaScript/Node integration through explicit bridge, mature native packaging | Larger bundles and memory footprint; Chromium security updates, IPC isolation, platform installers |
| **Tauri v2 shell** | Windows / macOS / Linux | Android / iOS supported | System webviews, smaller distribution in typical cases, capability-limited native interface | Rust/native integration; different webview engines across OSes; additional cross-platform text/layout verification |
| Native-only editor renderer | Separate OS implementations | Platform-specific | Deep platform control | Duplicated text/layout/editor development, inconsistent semantics, large maintenance burden |

Neither Electron nor Tauri is automatically selected or installed. **Provisional prioritization: first target desktop behavior, test Electron as a minimal shell when the custom editor text-input prototype is credible**, and keep Tauri as a genuine alternative if distribution footprint/mobile becomes more important.

Important distinction: using Electron does **not** remove the browser rendering engine. It packages **Chromium**. Tauri uses the **operating system WebView** (Chromium-based WebView2 on Windows, WebKit on Apple platforms). Native text shaping, selection, font metrics and IME must still be evaluated against the selected renderer.

## Three independent planes

```text
                BELLEKPAD / DOMAIN
 EFSS Markdown ↔ Document Model ↔ Transactions
       ├── Selection positions / history
       ├── Artboard constraints / logical layout
       └── Commands and invariant validation
                      │ pure APIs
                PRESENTATION
  Custom DOM/SVG/CSS render + browser-native
    caret/IME/clipboard input reconciliation
                      │ capability-only boundary
                  HOST
   ├── Desktop: Electron main/preload IPC (candidate)
   ├── Web: IndexedDB / File System Access (optional)
   └── Mobile: responsive/touch host (future)
```

- Core never imports `electron`, `node:fs`, WebView-specific SDKs, browser `window` globals, or UI frameworks.
- Browser-facing renderer may use standard DOM, ResizeObserver, Selection/Range, CSS and SVG, but no privileged Node access.
- Desktop host adapters expose *narrow*, versioned operations (e.g. `openDocument`, `saveDocument`, `chooseExportPath`, `readAsset`, `windowControls`) rather than arbitrary filesystem access or generic code execution.
- Storage is selected per host: a native file adapter can wrap the existing Node LocalDocumentVault, the optional web build can use IndexedDB. **Same EFSS bytes and revision contract** across hosts; no different on-disk truth.
- AI/model processes, if any, live in the privileged native-service layer, and may only be invoked through explicitly authorized capabilities; never direct Markdown instructions.
- A single UI build may be deployed inside a shell or browser only if its feature availability is capability-detected and missing features are **visibly** unavailable, not silently emulated.

## Electron-specific safety boundary

If Electron is chosen:
- Enable `contextIsolation` and `sandbox`, keep `nodeIntegration` disabled in renderer, and enforce CSP.
- Use a small audited `preload` bridge and IPC sender/input validation; expose only explicit actions.
- Bundle a local application interface. No remote untrusted HTML in privileged editor windows.
- Maintain current Chromium/Electron security releases. File imports, SVG, pasted HTML and Markdown previews are untrusted data.
- Packaged desktop must work **offline**; any cloud sync is a separate opt-in feature.
- Native shell dependencies may be added only after an explicit packaging/runtime decision. This exception does **not** authorize third-party rich-text/UI editor runtimes.

## User interaction discipline, regardless of shell

Notion/Word-like visual editing with Illustrator-like numerical precision must be identical for core interactions in an installable desktop app and an optional browser UI: click-to-insert blocks, slash callouts, keyboard shortcuts, editable text frames, artboard presets, grouping, constrained row/column/grid positioning, intentional overlap in overlay mode, selection inspector. Desktop gets OS menus, native file save dialogs, multi-window behavior and shell shortcuts through the host only.

Touch-mobile UI needs **adapted controls** (inspector drawer, large targets, onscreen keyboard), not simply a desktop artboard scaled down. Artboard preset sizes describe **documents being authored**, not necessarily the device running the application.

## Decision/test gates

1. Prototype our pure editor transactions and active TextFrame input bridge **without Electron coupling**, rendered in a basic local DOM test harness.
2. Verify cursor/selection/Unicode/IME/undo interactions in Windows Chromium and Firefox. Once stable, run the **same** editor in a minimal Electron window (no filesystem privileged access yet).
3. Compare the same scripted scenarios: startup time, memory use, text layout differences, font loading, drag/clipboard/IME correctness, window behavior. Measurements are **not yet available**.
4. Add a narrow native file bridge, open/save/offline acceptance scenario, no direct `node:fs` access from visual editor. Keep the original revision-checked EFSS document format.
5. Confirm the target deployment decision. Electron Windows desktop is an **initial candidate**, not a permanent binding; web/mobile variants remain architectural options.
6. Only then decide packaging/signing/auto-update flows and extra dependencies. PDF/DPI/compression remain downstream of layout/editor correctness.

## Non-goals

- Do not recreate Chrome, Electron, Qt, a font rasterizer or OS input method engine.
- Do not add two separate core editor implementations for desktop and web.
- Do not convert the entire project to Electron or Tauri's proprietary/plugin document model.
- Do not assert mobile is automatically supported because Electron supports desktop.
- Do not treat the successful Node test suite as proof of native desktop behavior.

## Actual first implementation — G0.1

Chosen desktop host: Electron, pinned to `44.9.3` under `devDependencies`. The first checked-in shell lives under `desktop/` and exposes only the limited document service. A first DOM input surface and AST preview demonstrate connection with the existing EFSS vault. **No bundled Windows installer or real UI smoke-test has been performed.** The Node service remains testable without loading Electron; native operations are behind the guarded preload/IPC boundary. See [DESKTOP_SPIKE.md](DESKTOP_SPIKE.md).
