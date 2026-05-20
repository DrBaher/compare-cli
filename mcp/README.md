# compare-cli-mcp

[![npm version](https://img.shields.io/npm/v/compare-cli-mcp.svg)](https://www.npmjs.com/package/compare-cli-mcp)

MCP (Model Context Protocol) server wrapping [`compare-cli`](https://github.com/DrBaher/compare-cli) for agent pipelines. Three tools, stdio transport, JSON-first responses with optional human report.

> Design contract: [`../docs/mcp.md`](../docs/mcp.md). This package ships the implementation; behavior and schemas track the design version.

Part of the [contract-ops suite](https://cli.drbaher.com).

---

## Install

`compare-cli-mcp` has `compare-cli` as a peer dependency, so install both:

```sh
npm install -g compare-cli@^0.3.0 compare-cli-mcp@^0.1.1
```

Then run:

```sh
compare-mcp           # spawns the MCP server on stdio
```

## Wire into an MCP client

### Claude Desktop / Claude Code

Add to your MCP-client config (e.g. `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "compare-cli": {
      "command": "compare-mcp"
    }
  }
}
```

### With base-directory lockdown (recommended for unattended use)

```json
{
  "mcpServers": {
    "compare-cli": {
      "command": "compare-mcp",
      "env": {
        "COMPARE_MCP_BASE_DIR": "/path/to/contract/documents"
      }
    }
  }
}
```

Every `path` argument the agent supplies is then resolved against `COMPARE_MCP_BASE_DIR` and rejected if it escapes the directory (symlinks collapsed). Without the env var the server reads any file the process can read — see the security note in [`../docs/mcp.md` §3.2](../docs/mcp.md).

## Tools

| Tool                       | Purpose                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `compare_files`            | Two-document comparison. Each side accepts `path`, `content_base64`, or `content_text`. |
| `compare_with_negotiation` | Base is read from nda-review-cli's `negotiation.json`. Returns `base.negotiation_resolution` so the agent can audit which signal produced the agreed text. |
| `compare_demo`             | Zero-arg synthetic comparison against bundled fixtures. Deterministically returns `exit_class: "substantive"`. Use to confirm the server is wired up. |

Tool descriptions, input schemas, and output schemas are advertised on `tools/list`. The schemas are **stable across v1.x of this package**; any change is fenced by the snapshot golden in `tests/fixtures/tools-list.json`.

## Output shape

Every successful tool call returns:

- **`structuredContent`** — the exact `compare --json` shape (top-level `ok`, `exit_class`, `exit_code`, `base`, `candidate`, `summary`, `differences`, `warnings`). Stable across compare-cli v1.x per its [AGENTS.md](../AGENTS.md). This is the contract the agent reads.
- **`content[0]`** — the same JSON serialized as a text block, for MCP clients that don't yet read `structuredContent`.
- **`content[1]`** (optional, when caller passes `include_human_report: true`) — the human-readable report.

`compare_with_negotiation` adds `structuredContent.base.negotiation_resolution` ∈ `{"status", "per_round_agreed", "clause_status"}` indicating which of the three resolution tiers produced the agreed base text.

## Errors vs drift

**Substantive drift is a successful tool call.** The agent asked what's different and the server answered. Routing on `exit_class` is the contract — error envelopes (`isError: true`) are reserved for I/O / argument failures plus one explicit precondition exception:

| Code                         | Trigger                                                  |
|------------------------------|----------------------------------------------------------|
| `INPUT_NOT_FOUND`            | Path not found / unreadable.                             |
| `INPUT_MALFORMED`            | Malformed `.docx` / `.pdf`.                              |
| `PDF_NO_TEXT_LAYER`          | Scanned PDF; pdfjs extracted zero characters.            |
| `INVALID_ARGS`               | Schema-validation failure (missing args, `oneOf` violation, etc.). |
| `PATH_OUTSIDE_BASE_DIR`      | `COMPARE_MCP_BASE_DIR` is set and the path escapes it.   |
| `NO_AGREED_ROUND`            | `compare_with_negotiation` precondition: no agreed round found. The CLI returns exit 2 here; the MCP server promotes it to an error because no comparison ran. |
| `NOT_SIGNED_OFF`             | `require_signoffs: true` and `signoffs.a` / `signoffs.b` is missing. |
| `INTERNAL_ERROR`             | Unexpected; surfaces underlying message so the agent isn't blind. |

Codes are stable across v1.x of this package.

## Running the test suite

```sh
# From the repo root:
npm install              # workspaces resolve compare-cli + compare-cli-mcp
cd mcp && npm test       # 22 tests, ~100 ms
```

The conformance + snapshot suite is in [`tests/test_protocol.mjs`](tests/test_protocol.mjs). The `tools/list` golden lives at [`tests/fixtures/tools-list.json`](tests/fixtures/tools-list.json). To regenerate the golden after an intentional schema change (also bump the minor version):

```sh
node -e 'import("./compare-cli-mcp.mjs").then(m => process.stdout.write(JSON.stringify(JSON.parse(JSON.stringify(m.TOOLS)), null, 2)))' > tests/fixtures/tools-list.json
```

## License

MIT. See `../LICENSE`.
