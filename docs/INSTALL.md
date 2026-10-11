# Install and connect

The project currently targets **Node.js 22+** and Forgejo or Codeberg. It is a pre-release. Test on non-critical repositories before importing all projects.

## 1. Run locally

```bash
git clone https://github.com/FreesoSaiFared/codeberg-transition-mcp.git
cd codeberg-transition-mcp
npm install --no-audit --no-fund
npm run ui:build
npm test
npm start
```

The MCP HTTP endpoint defaults to `http://127.0.0.1:8767/mcp`. Check `http://127.0.0.1:8767/healthz`; do not expose this HTTP service to the public internet.

## 2. Configure provider tokens

Create `~/.config/codeberg-transition-mcp/env` for the provided Linux systemd unit, or export environment variables before starting manually. Never commit tokens.

| Environment variable | Meaning |
| --- | --- |
| `CODEBERG_URL` | `https://codeberg.org` or your own Forgejo base URL |
| `CODEBERG_TOKEN` | Personal token created in Codeberg Settings → Applications |
| `GITHUB_TOKEN` | GitHub token for inventory and verification; stays on this MCP host |
| `GITHUB_MIGRATE_TOKEN` | **Separate**, minimally scoped GitHub read token needed for metadata/private imports; is transmitted to destination Forgejo |
| `GITHUB_MIRROR_TOKEN` | Separate GitHub repository Contents write token used by Codeberg to push commits. Do not reuse a broad inventory token. |
| `MCP_GATEWAY_TOKEN` | Required when listening off loopback; does not replace HTTPS and proper ChatGPT OAuth |

With **no** `GITHUB_MIGRATE_TOKEN`, choose Git-only mode if you want public history without issue/release metadata. Creating a separate migration token and revoking it afterwards is recommended. Avoid using your full-permission GitHub token as the migration token.

## 3. Connect ChatGPT (recommended: Secure MCP Tunnel)

ChatGPT now supports [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for private servers. Create a tunnel associated with your intended ChatGPT workspace in Platform tunnel settings; run OpenAI's official `tunnel-client` locally against the HTTP endpoint; verify its `doctor`/ready status.

In **ChatGPT → Plugins → + → Add custom MCP server**, select **Tunnel**, select your tunnel, configure authorization, and install the resulting plugin. Do not confuse a browser skill with a real MCP App: the plugin should list the `codeberg_migration_dashboard` tool and render its `ui://codeberg-transition/dashboard.html` resource.

Public distribution instead requires a stable HTTPS endpoint plus standards-compliant OAuth 2.1, and is **not implemented** in this pre-release. Never publish an unauthenticated instance offering migration write operations.

## 4. Codeberg-first GitHub publication mirrors

Use `codeberg_push_mirror_preview` to inspect all owned Codeberg repositories and existing GitHub targets. The preview refuses diverged default-branch histories and shows absent destinations. With `createMissing=true`, the approved execution can create empty missing GitHub repositories before configuring mirrors. Review visibility carefully, particularly when publishing private projects.

Set `GITHUB_MIRROR_TOKEN` on i9ES with write access to the intended GitHub repositories; the dedicated token will be transmitted to **Codeberg** as the mirroring service, never embedded in a remote URL. Use `codeberg_push_mirror_enable` with the exact confirmation phrase and approval. This creates a Codeberg push mirror, enables `sync_on_commit`, optionally requests an initial sync and verifies GitHub's default-branch SHA. Treat pending status as asynchronous, not success.

GitHub issues, pull requests, wiki and release metadata are **not** continuously synchronized by Git push mirroring. Codeberg remains source of truth.

See [guide quarrying](STEP-BY-STEP-GUIDE-QUARRYING.md) for the source guide, UI fallback in ABP and verified Forgejo API correspondence.

## 5. Preview, approve, and verify

Ask ChatGPT to use the existing GitHub connector for the account inventory, pass it to `codeberg_migration_preview`, review collisions, and then display `codeberg_migration_dashboard`. Actual execution requires exact confirmation text and an explicit Codeberg policy acknowledgment.

`codeberg_migrate_all_repositories` never deletes or archives GitHub originals. Treat `awaiting_verification` as pending, not success. Compare each default-branch commit SHA after import and separately inspect issues, pull requests and release assets.

## Codeberg policy

Read [Codeberg's 2026 policy on LLM-managed repositories](https://blog.codeberg.org/protecting-our-floss-commons-from-llms.html). The project supports independent Forgejo instances as an alternative. Do not mass-import repositories against a forge's terms.

## i9ES deployment

The `deploy/codeberg-transition-mcp.service` unit is configured specifically for the canonical i9ES path at `/mnt/SERVE/10-Projects/codeberg-transition-mcp`. Other users should adapt its working directory and Node binary path. On i9ES it is linked and enabled using:

```bash
systemctl --user link /mnt/SERVE/10-Projects/codeberg-transition-mcp/deploy/codeberg-transition-mcp.service
systemctl --user enable --now codeberg-transition-mcp.service
systemctl --user status codeberg-transition-mcp.service
```

## Adaptive maintenance

Use the `codeberg_live_capabilities` MCP tool to check the live Forgejo OpenAPI. It reports API endpoint counts, supported importer fields and missing invariants. Any schema drift should drive an observable code/test/verification iteration, **not** silent production rewrites. Every migration plan is saved as a private atomic receipt and all source repositories remain untouched.
