# Codeberg Transition MCP

An open-source ChatGPT MCP App for planning, executing, and verifying migrations from GitHub to [Codeberg](https://codeberg.org) or another Forgejo instance.

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
