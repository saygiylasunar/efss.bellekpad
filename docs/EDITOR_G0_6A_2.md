# G0.6A.2 — Balanced inline selection transactions (first accepted slice)

**Date:** 2026-10-22. **Repository:** saygiylasunar/efss.bellekpad **Branch:** main. **Version:** 0.2.8. **Verified implementation commit:** 2c31b07280fbda48ffcf06f72d24374f621cda61.

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

Remain within **G0.6A.2**: implement partial cross-mark split/reopen with source-preservation oracle and property-like regressions; then support further safe mixed B/I/S formatting. Do not weaken checks to “make the test pass.” When verified, proceed to G0.6B multi-line/Enter/Backspace. Update this document and \`docs/DEV_HANDOFF.md\` as implementation advances.
