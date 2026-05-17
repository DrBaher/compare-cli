# compare-cli-mcp changelog

Versions independently from the parent [`compare-cli`](../CHANGELOG.md);
both packages live in the same repo under [npm workspaces](../package.json).

## 0.1.0 — 2026-05-17

Initial release. Implements [`docs/mcp.md`](../docs/mcp.md) design v1.0
end-to-end. Three tools, stdio transport, JSON-first responses.

### Added

- **Three tools** matching the parent CLI's top-level invocation patterns:
  - `compare_files` — two-document comparison.
  - `compare_with_negotiation` — base read from nda-review-cli's
    `negotiation.json`; surfaces `base.negotiation_resolution`.
  - `compare_demo` — zero-arg synthetic comparison.
- **Per-side input modes:** `path` / `content_base64` / `content_text`
  (XOR enforced server-side).
- **`structuredContent`** byte-identical to `compare --json` shape; stable
  across compare-cli v1.x.
- **Stable error codes:** `INPUT_NOT_FOUND`, `INPUT_MALFORMED`,
  `PDF_NO_TEXT_LAYER`, `INVALID_ARGS`, `PATH_OUTSIDE_BASE_DIR`,
  `NO_AGREED_ROUND`, `NOT_SIGNED_OFF`, `INTERNAL_ERROR`.
- **`COMPARE_MCP_BASE_DIR` env var** locks down `path` arguments.
- **Stdio transport** via `@modelcontextprotocol/sdk@^1.29.0`. HTTP
  transport is a v2 candidate.
- **Conformance + snapshot tests** (22) including a checked-in
  `tools/list` golden at `tests/fixtures/tools-list.json`.

### Reference

- Design contract: [`../docs/mcp.md`](../docs/mcp.md).
- In-suite reference implementation: [sign-cli's MCP
  server](https://github.com/DrBaher/sign-cli/blob/main/src/lib/mcp-server.ts).
- Parent CLI: [`compare-cli`](https://www.npmjs.com/package/compare-cli)
  ≥ 0.2.0.
