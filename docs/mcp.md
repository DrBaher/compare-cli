# MCP Server Design (compare-cli-mcp v1)

This document is the design contract for an **MCP (Model Context Protocol)
server that wraps [`compare-cli`](https://github.com/DrBaher/compare-cli)**.
It is a planning artifact only — no code ships in the PR that introduces this
file. The implementation lands in a follow-up PR informed by the decisions
locked here.

The in-suite reference implementation we draw from is
[sign-cli's MCP server](https://github.com/DrBaher/sign-cli/blob/main/src/lib/mcp-server.ts)
(stdio + JSON-RPC, protocol revision `2024-11-05`, snake_case tool names).
Where the design diverges from sign-cli's choices, the reason is called out
inline. compare-cli is the current MCP gap in the contract-ops suite;
once shipped, it sits next to the `--from-negotiation` reader as the second
agent-driven entry point into the pre-signature gate.

> **Design version: 1.0** (target package `compare-cli-mcp` **v0.1.0**;
> wraps the `compare-cli` **v0.1.1** stable surface as documented in
> [AGENTS.md](../AGENTS.md) and [COMPARE_SCHEMA.md](../COMPARE_SCHEMA.md)).

---

## 1. Packaging — separate `compare-cli-mcp` package

A new npm package `compare-cli-mcp`, source-controlled in this repo under a
top-level `mcp/` directory with its own `package.json`. Single-file entry at
`mcp/compare-cli-mcp.mjs`, mirroring the single-file posture of the parent
CLI.

```
compare-cli/                         # this repo
├── compare-cli.mjs                  # the existing CLI (untouched)
├── package.json                     # the existing CLI's package (untouched)
├── mcp/
│   ├── compare-cli-mcp.mjs          # MCP server, single file
│   ├── package.json                 # name: "compare-cli-mcp", bin: "compare-mcp"
│   └── tests/                       # MCP-level integration tests
└── docs/mcp.md                      # this file
```

### 1.1. Dependency posture

| Dep                          | Kind               | Why                                                                                                |
|------------------------------|--------------------|----------------------------------------------------------------------------------------------------|
| `compare-cli`                | **peer dep**       | The MCP server runs the CLI's exported `main()` / pipeline. Peer (not runtime) avoids version drift and lets operators upgrade compare-cli independently. |
| `@modelcontextprotocol/sdk`  | **runtime dep**    | Provides the JSON-RPC stdio scaffolding so we don't hand-roll a transport like sign-cli does (sign-cli predates the SDK going stable). |

**This preserves compare-cli's "two runtime deps only" rule.** Bundling the
MCP server into the existing `compare-cli` package was the alternative; it
was rejected because every non-MCP user would acquire `@modelcontextprotocol/sdk`
as a third runtime dep with no opt-out. Auditors and air-gapped consumers
care about that surface.

### 1.2. Divergence from sign-cli

sign-cli ships its MCP server inside the main `sign-cli` package. That choice
is reasonable for sign-cli (already a multi-file TypeScript codebase with
many runtime deps; one more changes nothing). compare-cli's single-file,
two-runtime-deps posture is the load-bearing property; separating the
package keeps it intact.

### 1.3. Versioning

`compare-cli-mcp` versions independently from `compare-cli`. v0.1.0 of the
MCP package targets v0.1.x of compare-cli. Major bumps in compare-cli that
break the `--json` shape force a major bump in `compare-cli-mcp`. Minor and
patch bumps in compare-cli do not (the MCP shape is downstream of the stable
`--json` shape, which itself is locked across v1.x per
[AGENTS.md](../AGENTS.md)).

---

## 2. Tool shape — one tool per CLI invocation pattern

The CLI has three top-level invocation patterns. Each becomes its own MCP
tool.

| MCP tool                  | CLI equivalent                                       | Purpose                                                |
|---------------------------|------------------------------------------------------|--------------------------------------------------------|
| `compare_files`           | `compare BASE CANDIDATE [options]`                   | The headline two-document comparison.                  |
| `compare_with_negotiation`| `compare --from-negotiation NEG.json CANDIDATE [...]`| Base is read from nda-review-cli's `negotiation.json`. |
| `compare_demo`            | `compare --demo [--json]`                            | Zero-file smoke test against bundled fixtures.         |

A single mega-tool `compare` taking the union of all 15 flags as named
parameters was the alternative. It was rejected because agents pick tools by
matching task to description; a tool whose description has to enumerate
"sometimes you need flags A, B, C; other times you need flags D, E, F" is a
worse fit for tool-use reasoning than three tools each with a tight
description.

`compare_demo` exists for the same reason `--demo` exists on the CLI: an
agent should be able to confirm the server is wired up end-to-end without
constructing a fixture. It deliberately returns `exit_class: "substantive"`
because the bundled fixtures contain a deliberate Term-clause change.

### 2.1. Out of scope for v1

- **Tools mirroring `--completion`.** Shell completion is a CLI surface; no
  MCP analogue.
- **A `compare_negotiation_validate` tool.** Hash-chain verification is
  nda-review-cli's `negotiate validate`, not compare-cli's job (matches
  [ARCHITECTURE.md](../ARCHITECTURE.md) and the v1 non-goals in
  [AGENTS.md](../AGENTS.md)).
- **Resources / prompts capabilities.** v1 advertises only `tools`. Adding
  `resources` (e.g. a `compare://demo-fixtures/negotiated.md` resource) is a
  v2 candidate; nothing in v1 needs it.

---

## 3. Input shape — path XOR inline, per side

Each side (BASE, CANDIDATE) accepts **exactly one of** two input modes:

- `path` — absolute or working-directory-relative path the server reads.
- `content_base64` — base64-encoded bytes the server decodes in memory. For
  binary formats (`.docx`, `.pdf`) this is the only safe inline channel.

For convenience, a third inline channel `content_text` accepts UTF-8
markdown / plaintext directly without base64. When `content_text` is used,
the format is inferred from the optional `format` hint (`"md"` | `"txt"`),
defaulting to `"txt"`.

### 3.1. Example: `compare_files` input schema

```json
{
  "type": "object",
  "properties": {
    "base": {
      "type": "object",
      "oneOf": [
        { "required": ["path"] },
        { "required": ["content_base64"] },
        { "required": ["content_text"] }
      ],
      "properties": {
        "path":           { "type": "string", "description": "Filesystem path the server will read." },
        "content_base64": { "type": "string", "description": "Base64 bytes. Required for .docx / .pdf inline." },
        "content_text":   { "type": "string", "description": "UTF-8 text. Convenience channel for md/txt." },
        "format":         { "type": "string", "enum": ["docx","pdf","md","txt"], "description": "Required with content_base64; optional with content_text (default txt)." }
      }
    },
    "candidate": { "type": "object", "...": "same shape as base" },
    "strict":           { "type": "boolean", "default": false, "description": "Upgrade typographic drift to substantive (exit 2 in CLI; exit_class: \"substantive\" here)." },
    "strict_cosmetic":  { "type": "boolean", "default": false, "description": "Upgrade cosmetic drift to substantive." },
    "include_human_report": { "type": "boolean", "default": false, "description": "Also return the human-readable report as a second text content block." }
  },
  "required": ["base", "candidate"]
}
```

The `oneOf` constraint is enforced server-side too — JSON Schema validation
in MCP clients is uneven, and the server cannot trust the client to have
checked.

### 3.2. Security implication of accepting `path`

**The server reads any file the server process can read.** That includes
SSH keys, `.env` files, `~/.aws/credentials`, anything in the home directory
of the user running the MCP server. An agent that is allowed to call
`compare_files` with an arbitrary `path` argument is effectively granted
read access to the entire filesystem of the host, scoped to the process UID.

Mitigations the design prescribes:

1. **Tool descriptions name this explicitly.** The `path` field description
   in the schema reads, verbatim: *"Server reads this path with the
   process's privileges. Operators running this server for an unattended
   agent should restrict the working directory via `COMPARE_MCP_BASE_DIR`
   or run the server under a least-privileged user."*
2. **Optional base-dir lockdown via env var.** If `COMPARE_MCP_BASE_DIR`
   is set, the server resolves every `path` argument against it and rejects
   any resolution that escapes the directory (i.e. after `realpath`,
   the result must be a descendant of `realpath(COMPARE_MCP_BASE_DIR)`).
   Symlink traversal is collapsed before the check. Out-of-tree paths return
   an MCP error with code `PATH_OUTSIDE_BASE_DIR`.
3. **Documented recommendation: dedicated UID.** The README for
   `compare-cli-mcp` will recommend running the server under a user account
   that owns only the document directories it should be able to read.

The inline modes (`content_base64`, `content_text`) carry no such risk and
should be the default an agent reaches for when the bytes are already in
its context. Tool descriptions nudge that direction.

---

## 4. Output shape — structured payload primary, human report optional

Every successful tool call returns:

1. **`structuredContent`** — the exact JSON shape documented in
   [AGENTS.md](../AGENTS.md), byte-for-byte identical to what
   `compare --json` writes to stdout. Top-level keys: `ok`, `exit_class`,
   `exit_code`, `base`, `candidate`, `summary`, `differences`, `warnings`.
   Agents consume this; it is the contract.
2. **`content[0]`** — a `{ "type": "text", "text": <JSON string> }` block
   carrying the same JSON serialized. This is a redundant carrier for MCP
   clients that don't yet read `structuredContent` (some agent loops only
   look at `content`). Older clients see the JSON; newer clients see the
   typed object.
3. **`content[1]`** (optional) — when the caller passes
   `include_human_report: true`, a second `{ "type": "text", "text": <report> }`
   block carrying the human-readable report (the same text the CLI writes
   to stdout when `--json` is not set). The agent surfaces this verbatim to
   its user when a human-readable summary is wanted.

`outputSchema` is declared on each tool and matches `structuredContent`
exactly. This lets generic agent loops validate the response without
per-tool special casing — same property sign-cli exploits where it can.

### 4.1. Why JSON-first, human-second

The opposite ordering (human report primary, JSON optional) was considered
and rejected. Agents using compare-cli are pre-signature gates: the
machine-actionable shape (`exit_class`, `differences[]`) is what gates the
sign action. The human report is a downstream consequence — a presentation
detail for the agent's user, not the agent's decision input. Putting it
primary would invite agents to LLM-parse the human report instead of
reading the structured fields, which is exactly the failure mode the stable
JSON shape exists to prevent.

### 4.2. Warning surface

The CLI's `warnings[]` (e.g. PDF lossiness, `--from-negotiation` per-side
notes) flows through unchanged in `structuredContent.warnings`. The MCP
server adds no warnings of its own to the payload; if MCP-level concerns
arise (e.g. a path was rewritten under `COMPARE_MCP_BASE_DIR`), they go
into a top-level `mcp_warnings[]` field that's namespaced to avoid
colliding with the stable CLI shape.

---

## 5. Exit-code mapping — substantive drift is success, not error

The CLI returns one of five exit codes. The MCP protocol has no exit codes
— a tool call either returns content or returns an error envelope
(`isError: true`). The mapping:

| CLI exit | `exit_class`                  | MCP response                                                                 |
|----------|-------------------------------|------------------------------------------------------------------------------|
| `0`      | `clean`                       | Success-with-content. `structuredContent.exit_class: "clean"`.               |
| `2`      | `substantive`                 | **Success-with-content.** `exit_class: "substantive"`. Diff in `differences[]`. |
| `3`      | `cosmetic` / `typographic`    | Success-with-content. `exit_class` carries the actual class.                 |
| `4`      | `moved`                       | Success-with-content. `exit_class: "moved"`.                                 |
| `1`      | n/a (I/O / arg / scanned PDF) | **MCP error.** `isError: true`, structured error envelope (see §5.1).        |

**The headline decision: substantive drift is a successful tool call.** The
agent asked "what's different between these two documents?" and the server
answered. That an exit-2 came back tells the agent's caller "do not sign";
it does **not** tell the agent "the tool failed." The agent reads
`exit_class` and routes accordingly — same logic that exists in the CLI's
shell-script invocation pattern documented in
[AGENTS.md §Pre-signature gate](../AGENTS.md).

The alternative (substantive drift → MCP error) was rejected because:

- It conflates "drift detected" (the expected, desired output) with "the
  tool malfunctioned" (an exceptional condition). Agents would have to
  inspect error envelopes for normal-path content.
- It loses the structured `differences[]` payload — MCP error envelopes are
  not the natural place for a long structured report.
- It diverges from the CLI's own framing in [AGENTS.md](../AGENTS.md), which
  treats exit-2 as "the gate fired" not "the gate broke."

### 5.1. Genuine errors

MCP errors (`isError: true`) are reserved for:

| Trigger                                                    | Error `code`                  | Notes                                                                |
|------------------------------------------------------------|-------------------------------|----------------------------------------------------------------------|
| Path not found / unreadable                                | `INPUT_NOT_FOUND`             | Mirrors CLI exit 1 / `input not found`.                              |
| Malformed `.docx` / `.pdf`                                 | `INPUT_MALFORMED`             | Mirrors CLI exit 1 / `malformed .docx` / `malformed .pdf`.           |
| Scanned PDF with no extractable text                       | `PDF_NO_TEXT_LAYER`           | Mirrors CLI exit 1 / `extracted zero characters`.                    |
| Missing required tool arg (e.g. `base` omitted)            | `INVALID_ARGS`                | Schema-validation failure.                                           |
| Both `path` and `content_base64` set for same side         | `INVALID_ARGS`                | The `oneOf` violation, surfaced as a clear field-level error.        |
| `COMPARE_MCP_BASE_DIR` set, `path` escapes it              | `PATH_OUTSIDE_BASE_DIR`       | Server-side lockdown.                                                |
| `--from-negotiation` has no agreed round                   | `NO_AGREED_ROUND`             | This is CLI exit 2, but it's a precondition failure of `compare_with_negotiation` specifically — promoting it to an MCP error is the right call because no diff was produced. |

The error envelope shape (matching sign-cli's posture):

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "extracted zero characters from <PATH>; PDF may be a scanned image without an OCR layer" }],
  "structuredContent": { "code": "PDF_NO_TEXT_LAYER", "path": "<PATH>" }
}
```

Codes are stable across v1.x of `compare-cli-mcp`.

### 5.2. The `NO_AGREED_ROUND` exception

The CLI returns exit 2 (substantive) when `--from-negotiation` is asked to
find an agreed round and finds none. That is the CLI's pragmatic choice:
"no agreement = treat as worst-case drift." In the MCP setting we can do
better: `compare_with_negotiation` returning `NO_AGREED_ROUND` as an MCP
error is more honest because no comparison was actually performed — the
preconditions failed before any base text could be extracted. The agent
needs to know "the input was wrong" not "the agreement substantively
drifted." The `code` is stable; agents can branch on it.

This is a deliberate divergence from CLI semantics, surfaced here so the
choice is visible and reviewable. The CLI exit code is unchanged.

---

## 6. `--from-negotiation` mapping

A dedicated tool `compare_with_negotiation`. Input shape:

```json
{
  "type": "object",
  "properties": {
    "negotiation": {
      "type": "object",
      "oneOf": [
        { "required": ["path"] },
        { "required": ["content_json"] }
      ],
      "properties": {
        "path":         { "type": "string", "description": "Path to negotiation.json." },
        "content_json": { "type": "object", "description": "Inline negotiation object (already parsed)." }
      }
    },
    "candidate":            { "type": "object", "...": "same shape as compare_files.candidate" },
    "strict":               { "type": "boolean", "default": false },
    "strict_cosmetic":      { "type": "boolean", "default": false },
    "include_human_report": { "type": "boolean", "default": false }
  },
  "required": ["negotiation", "candidate"]
}
```

Resolution order in the underlying reader is unchanged (top-level
`status: converged|signed_off|finalized` → per-round `agreed: true` →
per-round `clause_status` all `"agreed"`) per
[COMPARE_SCHEMA.md §9.2](../COMPARE_SCHEMA.md). No agreed round →
`NO_AGREED_ROUND` MCP error (see §5.2).

The structured output adds one field over `compare_files`:
`structuredContent.base.negotiation_resolution` carries which of the three
resolution signals produced the agreed text (`"status"`, `"per_round_agreed"`,
`"clause_status"`) so the agent can audit the base provenance. This field
is also a candidate to backport into the CLI's `--json` output in a future
v0.x release — flagged here, not committed.

---

## 7. `--require-signoffs` mapping (forward-looking, post-v0.2.0)

The CLI flag `--require-signoffs` will land in compare-cli v0.2.0 (per the
in-flight spec; not yet implemented as of v0.1.1). When it does, the MCP
shape is:

```json
{ "require_signoffs": { "type": "boolean", "default": false } }
```

**Default: `false`** — matches the CLI default. The MCP tool description
adds the following advisory, verbatim:

> *"Agents invoking this tool in unattended pipelines (no human reviewer
> downstream) should pass `require_signoffs: true`. Doing so treats a
> negotiation that lacks per-clause signoff metadata as a precondition
> failure rather than as substantive drift, preventing the agent from
> proceeding with an underspecified base."*

The alternative — defaulting to `true` in the MCP variant — was considered
for safety, and rejected. The MCP and CLI surfaces have to agree on what
the verb "compare" means; silently inverting a default between the two
trains agents to expect different defaults from different transports, which
is a footgun in a suite where the same human writes both the shell-script
pipeline and the MCP-driven agent. **Defaults match across surfaces;
behavior changes are opt-in on both.**

---

## 8. Testing strategy

Two layers of test, both required before the first `compare-cli-mcp`
release.

### 8.1. Protocol-conformance script

A small Node script under `mcp/tests/` spawns the server over stdio and
drives it through a fixed sequence of JSON-RPC messages, asserting the
response shape at each step. The sequence:

1. `initialize` → assert `protocolVersion`, `serverInfo.name === "compare-cli-mcp"`, `capabilities.tools` advertised.
2. `tools/list` → assert exactly three tools (`compare_files`,
   `compare_with_negotiation`, `compare_demo`) with their declared input/output
   schemas. **Snapshot test** — the response is diffed against a checked-in
   `tests/fixtures/tools-list.json` golden. Schema drift fails loudly the
   same way the clause-detection golden test in
   [docs/clause-detection.md §5](./clause-detection.md) does.
3. `tools/call compare_demo` → assert `structuredContent.exit_class === "substantive"`
   (the demo deliberately trips drift).
4. `tools/call compare_files` with two trivially-equivalent inline text
   blocks → assert `exit_class === "clean"`.
5. `tools/call compare_files` with a non-existent path →
   assert `isError: true`, `structuredContent.code === "INPUT_NOT_FOUND"`.
6. `tools/call compare_with_negotiation` against a fixture with no agreed
   round → assert `code === "NO_AGREED_ROUND"`.

The script uses `@modelcontextprotocol/sdk`'s stdio client transport (the
SDK's own test harness is the natural fit if it stabilizes in the SDK
version we pin; otherwise the hand-rolled JSON-RPC driver is ~50 lines and
trivially robust).

### 8.2. Schema-stability snapshot

The `tools/list` golden in step 2 above is the contract. Bumping the
golden requires bumping the `compare-cli-mcp` minor version. This pins the
MCP wire shape exactly the way `--json`'s shape is pinned in
[AGENTS.md](../AGENTS.md), and prevents drift from sneaking in via a
description-text change or a schema-property typo.

### 8.3. What is **not** tested at the MCP layer

The compare-cli pipeline itself — clause detection, classification, move
detection, exit-class computation — is tested in compare-cli's own suite
(`tests/test_*.mjs`, 98.59% line coverage as of v0.1.1). The MCP tests
verify *adaptation* (input shape → CLI args, CLI output → MCP envelope,
error mapping), not the underlying comparison logic. No duplicate fixtures.

---

## 9. Transport — stdio only in v1

v1 ships **stdio transport only.** This matches the dominant deployment
shape (Claude Desktop, Claude Code, Cursor, all of which spawn MCP servers
as subprocesses). It also matches what sign-cli ships first in its
`serveMcpStdio`.

Streamable HTTP transport (the SDK's other transport) is a v2 candidate.
When it lands, it gates on a new `compare-mcp serve --transport http`
subcommand and a documented authentication story; v1 has no auth model
because stdio is the trust boundary (whoever can spawn the process can
already do anything the process can do).

---

## 10. Implementations

| Repo          | File                                | Status                                  | Entry                                       |
|---------------|-------------------------------------|-----------------------------------------|---------------------------------------------|
| compare-cli   | `mcp/compare-cli-mcp.mjs`           | **Planned** (this doc is the design)    | `serveMcpStdio` (named per sign-cli's shape)|
| compare-cli   | `mcp/tests/test_protocol.mjs`       | **Planned** (per §8.1)                  | Conformance + snapshot suite                |
| sign-cli      | [`src/lib/mcp-server.ts`](https://github.com/DrBaher/sign-cli/blob/main/src/lib/mcp-server.ts) | Reference implementation                | `dispatchMcp`, `serveMcpStdio`              |

**When this doc changes**, the implementation PR must reconcile against
the change before merge. The schema-stability snapshot test (§8.2) is the
mechanical enforcement: if the design says "three tools" and the code
exposes four, the golden fails.

---

## 11. Changelog

- **1.0** (2026-05-17, pre-`compare-cli-mcp` v0.1.0) — initial design.
  Locks the eight decisions: separate package, three narrow tools,
  path-XOR-inline input shape, JSON-first output with optional human
  report, success-with-content for all CLI exit codes 0/2/3/4 (errors
  reserved for I/O / arg failures plus the `NO_AGREED_ROUND` exception),
  `--from-negotiation` as a separate tool, `require_signoffs` default off
  (matches CLI), and a protocol-conformance + snapshot test strategy.
  Stdio-only transport. No code in this revision.
