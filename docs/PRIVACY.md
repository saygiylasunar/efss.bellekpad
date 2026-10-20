# Public repository privacy discipline

The public repository is for **implementation only**. Do not commit or publish:
personal documents, model search paths specific to a machine, private prompts,
private project context, training corpora, local chat exports, access keys,
session files, embedding databases, generated images, local JSONL logs, or weights.

## Gates

- `npm run sanity`: inspect tracked files in the working tree for reserved
  local-data paths, known secret patterns, non-placeholder email addresses,
  personally identifying absolute account paths, and optional private terms.
- `npm run sanity:staged`: inspect staged Git index content, preventing a
  staged secret from being hidden by an unstaged edit.
- `npm test`: Node built-in tests.
- `npm run check`: JavaScript syntax.
- GitHub Actions runs the sanitation gate before syntax checks and tests.
  The workflow uses read-only contents permission and no stored credentials.

Optional pre-commit protection is defined in `.githooks/pre-commit`.
To enable this on your own clone, explicitly run:

```sh
git config core.hooksPath .githooks
```

For project-specific terms, create the ignored local file
`.efss/private-terms.json` with a JSON array of private strings; the
check reports **categories and line numbers only**, never matched content.
This list is *not* included in GitHub Actions, so local checks are important.

## Limitations

Heuristic scans cannot prove that a repo contains no identifying detail,
encoded token, credential, account reference, or non-standard secret format.
Always review proposed changes locally **before** pushing. GitHub Actions
runs after a push; it cannot retroactively prevent public exposure. Removing
an accidentally committed secret in a later commit does not erase Git history.
Rotate exposed keys and use an appropriate history remediation process.

GitHub account names and commit attribution are inherently public metadata.
Keep non-public user information separate from the public software source.
Debug event logs are ignored locally and should be inspected before sharing.
