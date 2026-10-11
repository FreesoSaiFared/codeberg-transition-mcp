# Step-by-step-guide-quarrying (S2GQ)

**Definition.** Convert an existing, credited operational how-to into a structured, executable and testable guide, then use a capable actuator (ABP for UI paths, provider API for machine actions) instead of re-deriving the procedure.

This is a **development technique**, not an invitation to ignore changes in the current service. The upstream guide supplies the recipe; live readback supplies the proof.

## Quarry contract

1. **Capture provenance.** Record the original URL, title, author, update date, and extraction date, with explicit steps and constraints. Prefer source Markdown when provided. Never claim an uncited instruction came from the source.
2. **Normalize each step.** Map every UI instruction to `{id, action, target, verify}`. Keep the human wording for ABP's visual navigation and add a machine API equivalent if one exists.
3. **Identify preconditions.** Credentials, account privileges, endpoint existence, existing repository states, target visibility and irreversible operations. Missing prerequisites become blocked states, not silent failures.
4. **Execute incrementally.** Use the precise known UI route in ABP when authenticated; otherwise prefer validated provider APIs. No guessing selectors or inventing button positions. Take a readback receipt after each meaningful action.
5. **Test semantics, not just navigation.** For a push mirror: GET the destination's push mirrors and verify the remote URL and `sync_on_commit=true`; verify source/destination commit SHA before declaring it synchronized.
6. **Record divergences.** If current Forgejo differs from a 2023 guide, explicitly document the difference and fix the adapter; never silently reinterpret the source.
7. **Evolve from evidence.** When live APIs/UI change, update the structured recipe, implementation and fixtures, then rerun smoke/regression tests. Reject silent self-modifying production behavior.
8. **Preserve an audit trail.** Source citation, command/UI action, output, status, error, timestamp and verification evidence. Secrets never enter transcripts, logs, URLs or repository files.

## Implemented recipe: Codeberg → GitHub

Source: [Kaksi Koivua, *Setting up a push mirror from Codeberg to GitHub* (12 January 2023)](https://kaksikoivua.hashnode.dev/setting-up-a-push-mirror-from-codeberg-to-github).

Canonical machine-readable quarry: [`guides/codeberg-to-github-push-mirror.json`](../guides/codeberg-to-github-push-mirror.json).

This yields **12 user-interface actions** and the following verified API mapping, based on the currently served Codeberg Forgejo OpenAPI schema:

| Guide action | Forgejo API / existing helper |
|---|---|
| Create a writable GitHub repository | GitHub connector or GitHub API `POST /user/repos` after approval |
| Set Codeberg's Git Remote Repository URL | `POST /api/v1/repos/{owner}/{repo}/push_mirrors` with `remote_address` |
| Enter username and PAT in Authorization | `remote_username` and `remote_password` (never put PAT in URL) |
| Select Sync when new commits are pushed | `sync_on_commit: true` |
| Click Add Push Mirror | authenticated Forgejo POST |
| Inspect added push mirror | `GET /api/v1/repos/{owner}/{repo}/push_mirrors` |
| Force a one-off sync | `POST /api/v1/repos/{owner}/{repo}/push_mirrors-sync` |

**Credentials:** The original guide uses a GitHub classic PAT with `public_repo`; a dedicated fine-grained token granting repository Contents write is preferable when the current GitHub UI/Codeberg feature supports it. For private GitHub mirrors, public-only authorization is insufficient. `GITHUB_MIRROR_TOKEN` is intentionally distinct from `GITHUB_TOKEN` and `GITHUB_MIGRATE_TOKEN`; the mirror token *must* be provided to Codeberg, because Codeberg performs the pushes.

**Divergence guard:** A GitHub repository that still has history absent from Codeberg must not be silently overwritten. The MCP refuses diverged default-branch commit SHAs. Developers can manually reconcile branches and re-preview.

**Scope:** Git branches and tags are mirrored, but Codeberg issues, PRs, CI configuration and release metadata do not automatically become GitHub-native resources. Source-of-truth rules belong in project documentation.

## ABP execution adapter

The `codeberg_push_mirror_guide` tool exposes the quarry in JSON so ChatGPT can operate the existing ABP-i9ES MCP directly. When ABP has the authenticated Codeberg session, its browser tabs and normal click/type actions can follow each `steps[].ui` instruction. The model should read the current page and verify every resulting state using the tool's `verify` field. Prefer the automatic `codeberg_push_mirror_preview` / `codeberg_push_mirror_enable` tools for batch work. Do not transfer browser cookies between contexts or extract tokens into chat.

ABP inspection on 2026-10-11 confirmed the original guide's instructions through `browser_text`. The Codeberg API inspector confirmed the four API fields above from the live Forgejo schema. The guide is **ingested and implemented**, not yet proof of a successful live mirror (which requires a dedicated GitHub mirror token).
