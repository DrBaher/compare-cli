# compare-cli examples

Sample files for trying compare-cli against realistic-shaped contract
inputs without authoring your own.

> **Not shipped with the npm package** — these live in the repo for
> hands-on exploration, not in the published tarball. Clone the repo or
> grab the raw files from
> [github.com/DrBaher/compare-cli/tree/main/examples](https://github.com/DrBaher/compare-cli/tree/main/examples)
> to use them.

## Files

| File | Purpose |
|---|---|
| [`base.md`](./base.md) | The negotiated agreement. Five clauses, plain markdown. |
| [`cand-clean.md`](./cand-clean.md) | Byte-identical to `base.md`. **Exit 0** — safe to sign. |
| [`cand-substantive.md`](./cand-substantive.md) | Term clause changed (two → three years), Confidentiality clause weakened. **Exit 2** — do not sign without review. |
| [`cand-cosmetic.md`](./cand-cosmetic.md) | Same agreement, but with curly quotes, em-dash hyphens, and Unicode non-breaking hyphens swapped in. **Exit 3** — cosmetic-only, the agreement didn't change. |
| [`negotiation.json`](./negotiation.json) | An nda-review-cli state file in the canonical shape (`status: converged`, populated `signoffs`). Use with `--from-negotiation`. |

## Try it

After installing the CLI (`npm install -g compare-cli`), from this directory:

```sh
# Clean — should exit 0
compare base.md cand-clean.md
echo $?   # 0

# Substantive drift — exit 2 with intra-clause word diff in the report
compare base.md cand-substantive.md

# Cosmetic-only — exit 3
compare base.md cand-cosmetic.md

# Strict mode — exit 2 even on cosmetic
compare base.md cand-cosmetic.md --strict-cosmetic

# Reading the agreed text from a negotiation file
compare --from-negotiation negotiation.json cand-clean.md

# CI-style check (exit code only)
compare base.md cand-substantive.md --check && echo "safe to sign"

# SARIF output (for GitHub code-scanning)
compare base.md cand-substantive.md --sarif > drift.sarif

# Filter to specific clauses
compare base.md cand-substantive.md --only-clauses Term --json
compare base.md cand-substantive.md --ignore-clauses Confidentiality
```

## Programmatic use (Node)

```js
import { main, EXIT } from "compare-cli";

const code = await main(["examples/base.md", "examples/cand-substantive.md", "--json"]);
process.exit(code);
```

## MCP-server use

If you've installed [`compare-cli-mcp`](../mcp/README.md), the same
files work via tool calls. Set `COMPARE_MCP_BASE_DIR` to this
`examples/` directory to lock the server's read scope down to just these
files.
