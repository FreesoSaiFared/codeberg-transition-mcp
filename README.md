# Codeberg Transition MCP

An open-source ChatGPT MCP App for planning, executing, and verifying migrations from GitHub to [Codeberg](https://codeberg.org) or another Forgejo instance.

## Development model

**Codeberg is primary; GitHub is a continuously updated publication mirror.** After a one-time GitHub → Codeberg import, enable a Codeberg → GitHub **push mirror** with `sync_on_commit=true`. The MCP offers `codeberg_push_mirror_preview`, `codeberg_push_mirror_enable`, `codeberg_push_mirror_status`, and `codeberg_push_mirror_sync`. This updates Git refs only (not issues or PRs) and requires a separate `GITHUB_MIRROR_TOKEN` held privately on the MCP host.

This implementation was **quarried directly** from [Kaksi Koivua’s step-by-step mirroring guide](https://kaksikoivua.hashnode.dev/setting-up-a-push-mirror-from-codeberg-to-github). See [Step-by-step-guide-quarrying](docs/STEP-BY-STEP-GUIDE-QUARRYING.md) and the [machine-readable 12-step recipe](guides/codeberg-to-github-push-mirror.json) for browser/ABP execution and verification.

## Goals

- Retain Git history and optionally migrate issues, pull requests, labels, releases, milestones, wiki and LFS.
- Let ChatGPT coordinate its installed GitHub connector with this Forgejo/Codeberg connector.
- Preview **all** owned repositories and require explicit approval before writing to Codeberg.
- Preserve GitHub repositories as a fallback; no automatic deletion or archival.
- Provide an interactive **MCP Apps `ui://` dashboard**, not a text-only skill.
- Produce per-repository verification receipts, errors and resumable progress.
- Respect Codeberg's [2026 policy on LLM-heavy repositories](https://blog.codeberg.org/protecting-our-floss-commons-from-llms.html). This software can target other Forgejo hosts if Codeberg is unsuitable.

## Status

Initial implementation under construction. Do **not** use this repository to migrate production projects until the integration tests and installation checks are passing. The GitHub host was intentionally used for development and distribution.

## Security model

GitHub inventory credentials never travel to Codeberg. A separate read-limited source migration token is needed for GitHub metadata/private repositories because Forgejo's migration API sends that credential to the destination. Credential handling, operator consent, protected transport and verification are release-blocking.

The project is independent of Codeberg e.V., Forgejo, GitHub and OpenAI.

## License

MIT; see LICENSE.
