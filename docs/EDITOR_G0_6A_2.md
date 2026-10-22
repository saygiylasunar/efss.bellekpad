# G0.6A.2 — Balanced inline selection transactions (first accepted slice)

**Date:** 2026-10-22. **Repository:** saygiylasunar/efss.bellekpad **Branch:** main. **Version:** 0.2.8. **Verified implementation commits:** 2c31b07280fbda48ffcf06f72d24374f621cda61 (complete marks) and 7ecb9e71417805f11b8c39d2395aa5230e1c0381 (partial single-level split).

## Implemented

- **Cross-style text replacement and deletion** are now allowed when an editor selection fully contains the affected Markdown mark region(s). \`planInlineTextEdit()\` expands the source splice to consume complete invisible wrappers, without altering any visible text or style **outside the selection**. A transaction replaces the entire range and remains one Undo step.
- Multiple fully included marked sections and surrounding plain text can be replaced together; completely deleting one styled section removes orphan delimiters rather than leaving broken \`****\`.
- Unicode grapheme boundaries and the same revision-aware \`TextEditorSession\` are used. Caller output includes \`operation: "balanced-marker-splice"\` for precise audit/tests.
- **One strictly limited mixed formatting case:** wrapping a complete marked span and adjacent plain text with an additional mark when the resulting EFSS inline parser confirms **every character retains its previous marks and gains the requested mark**. Example: selecting “kalın B” in \`A **kalın** B\` and applying strike → \`A ~~**kalın** B~~\`. Style changes that cannot be proven lossless fail closed (including most partially intersecting/nested spans and ambiguous \`*\` combinations).
- **Clipboard correctness:** cut now updates the clipboard only if the corresponding source-aware deletion succeeds. Rejected edits leave the document intact and do not masquerade as a completed cut.
- Source-view editing, unknown EFSS extension bytes and CRLF data remain lossless. No imported rich text editor or extra package; no Electron privilege changes.

## Verified cases

- \`A **kalın** B\`: reversed visual selection of “kalın B” → Delete → \`A \`; Undo restores all source markers and original selection. Partial “lın B” deletion is explicitly rejected and must leave the document unchanged.
- The same selected run can acquire strike across existing strong and plain runs, with strong still present; Undo restores original.
- Entire formatted span deletion removes wrapper, local edit of a substring inside bold preserves wrapper, multiple complete formatted regions can be atomically replaced.
- Inline selection with emoji, CRLF, unknown \`:::efss.*\` and nested formatting continue to be protected by model tests.
- **CI for commit \`2c31b07\`:** \`core-checks\` **230/230 Node tests**, sanity pass. \`desktop-smoke\`: **Windows + Ubuntu/Xvfb success**, running the actual Electron shell and synthetic native input/selection events. Run IDs: [core #39734376967](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39734376967), [desktop #39734376964](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39734376964).
- A first CI run failed in the new mixed-style formatting test: the outside-style invariant was incorrectly checked with inserted *visible length zero*. Fixed to pass the length of the original selected visible content, then both workflows passed. The error was in the new validation algorithm; it was not silenced by deleting tests.

## Still not done — DO NOT claim full G0.6A acceptance

1. **Partial cross-mark selection**, e.g. selecting “lın B” in \`A **kalın** B\`, is rejected. Requires an explicitly designed balanced closing/opening marker splitter that preserves the bold “ka” and replaces the selected region without orphan delimiters. Nested partial selections are more complex.
2. Ordinary **bold/italic applied across mixed formatted/plain runs** can generate delimiter collisions (\`***\`). The planner currently checks the result and rejects unsafe styles; strike has a verified positive path. For fuller support, design a safe run canonicalizer that checks precise per-character marks and wraps/splits.
3. DOM selection direction after cross-mark replacements and the resulting caret restoration need more GUI tests. Actual physical keyboard, IME composition, paste events, cut clipboard permissions and screenreader still need coverage.
4. Multi-line paragraph and natural Enter/Backspace split/merge across blocks are G0.6B, **not implemented**.
5. The whole Flow view still re-renders more often than necessary.

## Next authorized step

Remain within **G0.6A.2**: extend the verified single-level close/reopen split to nested/overlapping marks where parsing proves losslessness; then support further safe mixed B/I/S formatting. Do not weaken checks to “make the test pass.” When verified, proceed to G0.6B multi-line/Enter/Backspace. Update this document and \`docs/DEV_HANDOFF.md\` as implementation advances.

## Verified follow-up: partial single-level split (commit `7ecb9e7`)

- A new `partialBoundarySplice()` computes marker closures/openings for a selected region crossing only simple non-nested mark boundaries. Candidate source is reparsed and checked for exact visible output and original **unselected** mark traces. Unsupported nested partial interactions are rejected.
- `test/editor-inline-selection.test.js` covers rich→plain partial replacement, plain→rich partial replacement and nested rejection. `desktop/smoke.mjs` covers partial deletion retaining a styled prefix and Undo.
- **Core CI 232/232 tests, sanity passing; both Windows/Linux Electron smoke passing** for `7ecb9e7`. [Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39735156830) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39735156806). Physical keyboard and IME remain untested by this synthetic input smoke.

## Verified follow-up: bounded nested partial selection (commit `6f27e29`)

- The partial-boundary planner now handles **some nested mark boundaries**, not just non-nested marks. Fully enclosing wrappers survive unchanged; affected styles that end inside a selection close innermost-first, while those starting inside reopen outermost-first. Every candidate is reparsed and must retain visible text and all unselected mark traces.
- Concrete case: `A ~~sil **kalın** metin~~ Z`; replacing reverse-selected `lın metin Z` with `yenisi` yields `A ~~sil **ka**~~yenisi`. When the outer strike extends beyond the selection, it remains intact and the nested strong can still close safely.
- Ambiguous nested strong/emphasis asterisk delimiter collisions **remain explicitly unsupported**: parsing or style verification failure is a non-mutating rejection. The two previously refused nested B/I cases are still regression tests.
- Three new Node tests cover nested close order, retained enclosing wrapper, reverse selection/Undo/Redo and CRLF + opaque unknown EFSS data. Desktop GUI smoke adds nested DOM reverse selection, beforeinput replacement, Undo/Redo, save/open and exact source verification.
- **Verification on source commit `6f27e29182b11e03e602e4cbbf737eea514f8629`: 235/235 Node tests, 0 failures; sanity/check succeeded. Real Windows and Ubuntu/Xvfb Electron jobs both succeeded.** [Core #39746791881](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39746791881) · [Desktop #39746791837](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39746791837).
- Not validated: physical keyboard/IME, assistive technology, large document performance, general mixed B/I/S toggle, unambiguous rendering of all nested asterisk cases, and multi-block editing. **G0.6A is still open.**

## Verified follow-up: mixed partial formatting + atomic selection history (`a41c246`, `9e534eb`)

- `wrapMixedMarkedSelection()` now builds a **candidate** balanced Markdown splice for partial mark selection. Full visible regions include their invisible wrappers; intersected styles close/reopen around the requested mark; wrappers enclosing both endpoints remain unchanged. Every candidate is reparsed and checked against exact visible text, all unselected style traces and per-selected-character accumulated marks. No reparse proof = **no mutation**.
- Safe positive cases: `A **kalın** B` with selected `lın B` plus strike produces `A **ka**~~**lın** B~~`; selecting `düz ka` in `A düz **kalın** B` produces `A ~~düz **ka**~~**lın** B`. A subset of mixed B/I is supported when surrounding delimiter types do not collide: `A ~~sil~~ B` may become `A *~~sil~~ B*` or `A **~~sil~~ B**`.
- The native Flow formatter preserves forward/reverse DOM selection direction. `TextEditorSession.dispatch({ type: 'replaceRange', ..., selectionAfter })` validates the post-edit typed anchor/focus **before mutation**, records it in the same journal entry and replays it on Redo. Undo restores its original reverse selection; source markers remain untouched by visual restoration. Invalid grapheme positions fail without creating history.
- Four new inline formatting regression tests + two transaction engine tests; Electron smoke checks backward mixed selection, rendering, Undo/Redo direction and vault roundtrip (including unknown EFSS block).
- **Verified:** `a41c246` and `9e534eb` passed their core and Windows/Ubuntu Electron workflows. Final code commit `9e534ebfd29e4cbae32585f55613a60cddc4bfda`: **241/241 Node, sanity/check, Windows/Linux smoke succeeded.** [Core #39778195357](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39778195357) · [Desktop #39778195348](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/39778195348).
- Still unsupported: ambiguous adjacent bold/italic asterisk delimiters, full nested B/I/S toggling, true physical-keyboard/IME validation, cross-block natural editing, large-document performance and assistive tech. Those are not claimed as accepted.
