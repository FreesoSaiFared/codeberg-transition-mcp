# Semantic continuity: adaptive review translation rather than a universal PR

## Thesis

A GitHub pull request, GitLab merge request, Forgejo pull request, Gerrit change, and SourceHut email patch series are **not instances of one universally lossless pull-request data type**. Each is a platform-specific view of a collaborative change process. Treating them as a common record with only intersecting fields discards both technical and social information.

Our alternative is **AI-mediated semantic continuity**:

> Whenever a destination cannot express a source fact natively, the bridge retains the source evidence, tries a suitable alternative representation, and asks AI to infer or anticipate useful semantic equivalents. Every inference remains labeled, reversible and traceable to source observations.

This is not license to hallucinate missing history. It allows reasoned and auditable compensation for missing expressiveness.

## Runtime implementation (feature branch)

- `src/semantic.mjs`: `captureChange`, `assessProjection`, `intervene`, `reconstruct`, `reproject`.
- `src/semantic-journal.mjs`: `saveSemanticReceipt`, `loadSemanticReceipt`.
- `src/tools.mjs`: `codeberg_semantic_preview`, `codeberg_semantic_intervene`, `codeberg_semantic_receipt`, `codeberg_semantic_reproject`.
- `ui/dashboard.html` and `ui/app.mjs`: interactive section 06, with direct MCP calls and host-mediated `App.sendMessage()` to ask ChatGPT for evidence-backed semantic interventions.
- `test/semantic.test.mjs`: empirical preservation, inference provenance, invalid native approvals, tamper evidence and future re-projection.

## The process

**1. Observe before translating.** Extract change title, body, Git references, revisions, review events, diff anchors, state transitions and identity claims. Assign each fact a stable `sourceId` and retrievable `sourceLocator`. Retain this evidence as the canonical envelope.

**2. Assess the destination.** Declare its supported semantic capabilities. For each observed fact, either project it into a native field or mark an explicit gap. The existence of a similarly named field does not by itself prove identical semantics; read back provider state after execution.

**3. Preserve a sidecar before dumbing down.** Put every original fact, source link, actor assertion, revision information and positional review anchor in a private checksummed receipt. If a field gets flattened into prose in the destination, the exact original survives outside that prose.

**4. Invite bounded AI intervention.** For gaps, ChatGPT may interpret a discussion, infer intended next steps, summarize unavailable concepts, propose a linked issue, or identify that a line comment refers to a changed patch set. AI must cite the source IDs underlying each claim, declare confidence and specify where the interpretation could be represented.

**5. Anticipate downstream requirements.** An inferred review thread can request follow-up validation; an unavailable numeric review vote can be explained in an attributed note; lost patch-set boundaries can remain addressable by revision links. AI can suggest a better route if an earlier projection is shown to lose meaningful content.

**6. Never mistake interpretation for authority.** An AI guess cannot cast a review vote, authenticate an external user, assert passing CI, or merge a change. Those transitions require corresponding provider evidence or a separately authorized human/system action.

**7. Reconstruct and reproject.** New destination providers and future API upgrades can project from the preserved original evidence, not the already-flattened export. AI hypotheses remain hypotheses even when the new destination has a native field that resembles them.

## Example: Gerrit → GitHub

A source Gerrit change contains patch set 3, a `Code-Review +2` vote, a resolved inline thread and a successful CI result.

GitHub can represent the inline discussion and CI status, but does not have an identical native Gerrit patch-set or numeric vote object. A naive translator might turn `+2` into “Approved” and lose the patch-set revision.

The semantic bridge instead emits:

| Source observation | GitHub projection | Sidecar / AI intervention |
| --- | --- | --- |
| Patch set 3 / commit ID | PR commit/ref where feasible | Preserve exact patch-set number, source URL and commit |
| Gerrit numeric `Code-Review +2` | No automatic formal approval | Attributed informational note; preserve numeric vote, actor and source evidence |
| Resolved inline thread | Review thread if anchor matches | Preserve original file anchor, resolution provenance and discussion link |
| Verified successful CI | Native check only via an authorized check integration | Preserve result without forging a Github status check |

AI might infer: “This reviewer endorsed patch set 3 in the original Gerrit workflow.” It should **not** infer: “This user approved the GitHub PR.” The former is an interpretation of sourced history; the latter would fabricate a platform-native action.

## Semantics aren't only fields

Every adapter must distinguish at least:

- **Fact** — an observed provider event with source ID and immutable evidence link.
- **Representation** — where a particular fact appears on the destination.
- **Inference** — a model's evidence-backed hypothesis or explanation.
- **Authority** — whether the recipient platform is allowed to record the action as native.
- **Continuity** — whether future changes can recover the original source state.

Three kinds of success are independently measured: source evidence integrity, destination expressiveness, and verified native behavioral equivalence. **Evidence recoverable** does not imply **full platform parity**.

## API calls in ChatGPT

1. Call `codeberg_semantic_preview` with `source` and `target` to obtain native projection plus gaps.
2. Interpret the gaps using ChatGPT reasoning, creating only evidence-cited `inferences` with `type`, `claim`, `basedOn`, `confidence` and `route`.
3. Call `codeberg_semantic_intervene` with the same source, target and inferences; it stores an immutable private sidecar receipt if requested.
4. Call `codeberg_semantic_receipt` to verify reconstruction, or `codeberg_semantic_reproject` to target another provider without losing the original.

The dashboard's **ASK CHATGPT TO REPAIR GAPS** button uses the MCP Apps `App.sendMessage` interface where supported by the host. The host can refuse or require consent; this is an interactive request, not a guaranteed autonomous model invocation.

## Current limitations and safe next implementation

The prototype does **not** yet fetch complete live PR timelines automatically or write translated native objects to GitHub, Codeberg, Gerrit or GitLab. It accepts a structured evidence envelope supplied by ChatGPT or another verified provider adapter, performs projection/AI-hypothesis validation, and optionally saves a local receipt. Unauthenticated or partial evidence must remain labeled as such.

Next attach source-specific collectors (review events, patch sets, inline threads and state transitions) and destination planners with disposable repository tests. Enable actual writes only after receipts prove idempotence, identity mapping, conflict resolution, authorization and API readback.

## Sources inspected

- [GitHub review-comment REST fields](https://docs.github.com/en/rest/pulls/comments): commit IDs, paths, hunks and line anchors.
- [GitLab discussions API](https://docs.gitlab.com/api/discussions/): notes, resolvable discussions and diff positions.
- [Gerrit Changes REST API](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html): patch-set revision-specific comments and review label votes.
- [MCP Apps sendMessage API](https://github.com/modelcontextprotocol/ext-apps/blob/main/src/app.ts): host-mediated, user-initiated chat messages.
