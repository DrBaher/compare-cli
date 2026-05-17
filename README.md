# compare-cli

> Clause-aware drift detection between two contract versions. Pre-signature
> gate for legal teams and agent pipelines. Single-file Node CLI, two runtime
> deps, deterministic by design, no LLM tier in v1.

```sh
compare negotiated.docx ready-to-sign.pdf
# exit 0 = safe to sign
# exit 2 = substantive drift, DO NOT sign without review
# exit 3 = cosmetic / typographic drift only (informational)
# exit 4 = clauses moved, content identical
```

Part of the [contract-operations suite](https://cli.drbaher.com).

> **Agent pipelines:** see [`mcp/README.md`](./mcp/README.md) for `compare-cli-mcp`, the MCP server wrapping this CLI. Three tools (`compare_files`, `compare_with_negotiation`, `compare_demo`), stdio transport, JSON-first responses. Design contract: [`docs/mcp.md`](./docs/mcp.md).

---

## Why

You negotiated a contract over several rounds with counterparty's counsel.
A few days later their paralegal sends you a `ready-to-sign.pdf`. Is the
PDF the same text you agreed to, or did something quietly shift between
"final version" and "version we put in the signing envelope"?

`compare-cli` answers that question with an exit code your CI can gate on:

- **Exit 0**: every clause matches. Safe to sign.
- **Exit 2**: substantive drift — a clause's text changed, a clause was
  added, or a clause was removed. The exact change is in the report. **Do
  not sign without review.**
- **Exit 3**: cosmetic-only (whitespace, curly quotes, em-dashes) or
  typographic-only (case, `$1,000` vs `$1000`, Oxford comma) drift.
  Informational; the agreement didn't change.
- **Exit 4**: clauses moved but content is identical. Order shifted; the
  agreement didn't change.

The CLI works on `.docx`, `.pdf`, `.md`, and plain text — including
cross-format comparisons (negotiated `.docx` vs ready-to-sign `.pdf`).

## Install

```sh
npm install -g compare-cli
```

Or run without installing:

```sh
npx -p compare-cli@latest -- compare --demo
```

(The package is `compare-cli`; the installed command is `compare`. The
`-p … -- compare` form tells `npx` which package to fetch and which bin
to run, since the two names differ.)

Requires Node ≥ 20. (Pinned by `pdfjs-dist@^5.7.284`, which we share with [sign-cli](https://github.com/DrBaher/sign-cli).)

## 30-second first run

```sh
compare --demo
```

Runs against two bundled fixtures (a negotiated NDA and a candidate where
the term silently shifted from "two (2) years" to "three (3) years") and
exits **2**. You see the headline contract — substantive drift detected,
report written, exit code asserted — without authoring a file.

```sh
compare --demo --json
```

Same comparison, structured JSON output to stdout.

## End-to-end transcript

```sh
# You negotiated this:
cat > negotiated.md <<'EOF'
## 1. Purpose
This agreement governs information exchange between Acme and Globex.

## 2. Term
The term is two (2) years from the Effective Date.

## 3. Notices
All notices shall be delivered to the addresses on the cover page.
EOF

# They sent back this:
cat > ready-to-sign.md <<'EOF'
## 1. Purpose
This agreement governs information exchange between Acme and Globex.

## 2. Term
The term is three (3) years from the Effective Date.

## 3. Notices
All notices shall be delivered to the addresses on the cover page.
EOF

# Gate on it:
compare negotiated.md ready-to-sign.md
# → substantive drift, exit 2
echo "exit: $?"

# Or feed the base from nda-review-cli's negotiation.json:
compare --from-negotiation negotiation.json ready-to-sign.pdf

# Strict mode: treat typographic drift ($1,000 vs $1000) as substantive too
compare negotiated.md ready-to-sign.md --strict
```

In a CI pipeline:

```sh
compare negotiated.docx received/$(date +%F).pdf || {
  status=$?
  case $status in
    0) echo "✓ safe to sign" ;;
    2) echo "✗ substantive drift — do not sign" ;;
    3) echo "⚠ cosmetic drift only — informational" ;;
    4) echo "⚠ clauses moved but content identical" ;;
    *) echo "✗ I/O or arg error" ;;
  esac
  exit $status
}
```

## Command reference

```
USAGE
  compare BASE CANDIDATE [options]
  compare --from-negotiation NEG.json CANDIDATE [options]
  compare --demo [--json]

ARGS
  BASE        what was agreed (.docx | .pdf | .md | .txt | - for stdin)
  CANDIDATE   what is being put forward (same formats, or -)

OPTIONS
  --from-negotiation PATH   read base text from nda-review-cli's negotiation.json
  --require-signoffs        with --from-negotiation, require both parties to have signed off
  --only-clauses PATTERNS   comma-separated; only include matching clause titles in the report + exit code
  --ignore-clauses PATTERNS comma-separated; exclude matching clause titles from the report + exit code
  --strict                  treat typographic drift as substantive (exit 2)
  --strict-cosmetic         treat cosmetic drift as substantive (exit 2)
  --json                    emit structured JSON to stdout
  --sarif                   emit SARIF v2.1.0 to stdout (for code-scanning / CI annotations)
  --no-intra-diff           disable inline word-level diff inside substantive clauses
  --why                     print structured explanation to stderr
  --silent, -q              suppress stderr
  --check                   suppress all output; communicate via exit code only (implies --silent)
  --output, -o PATH         write report to PATH instead of stdout (ignored with --check)
  --completion bash|zsh     emit shell completion script
  --demo                    run a zero-file 30-second demo
  --version, -V             print version
  --help, -h                show this help
```

### Exit codes

| Code | Meaning                                                         |
|------|-----------------------------------------------------------------|
| `0`  | No drift detected, safe to sign                                 |
| `1`  | I/O error — input not found, unreadable, malformed `.docx`/`.pdf` |
| `2`  | Substantive drift (or `--strict`/`--strict-cosmetic` was set and tripped) |
| `3`  | Cosmetic-only or typographic-only drift (informational)         |
| `4`  | Clause(s) moved but content identical                           |

Stable across minor versions. Documented in
[AGENTS.md](./AGENTS.md) and [COMPARE_SCHEMA.md](./COMPARE_SCHEMA.md).

### What counts as which class?

- **cosmetic** — whitespace runs, line wraps, curly vs straight quotes,
  em-dashes vs hyphens, NBSP vs space, ellipsis vs `...`
- **typographic** — number formatting (`$1,000` vs `$1000`,
  `5.0%` vs `5%`), Oxford comma flips, case-only differences
  (`Acme` vs `ACME`)
- **substantive** — any word change, addition, deletion, or clause
  reorganization (`will not` vs `will`, `two years` vs `three years`,
  clauses added or removed)
- **moved** — clauses whose text is byte-identical but whose position in
  the ordered clause sequence changed

The exact rules — including what is *deliberately* not normalized away
(singular/plural, tense, negation, list punctuation) — are locked in
[COMPARE_SCHEMA.md](./COMPARE_SCHEMA.md) §5–§6.

### `--json` output shape

Stable across minor versions. Top-level keys: `ok`, `exit_class`,
`exit_code`, `base`, `candidate`, `summary`, `differences`, `warnings`.
See [COMPARE_SCHEMA.md §10](./COMPARE_SCHEMA.md) for the full shape.

### `--why` output

Structured `key=value` lines on stderr describing detection tiers,
alignment method, class counts, exit decision, and strict-mode state.
Same posture as draft-cli's `--why`.

### `--from-negotiation`

Reads `nda-review-cli`'s `negotiation.json` and extracts the latest
agreed text as BASE. Three-tier resolution (preferred → fallback):
top-level `status: converged|signed_off|finalized`, per-round
`agreed: true` (minimum schema), per-round `clause_status` all
`"agreed"` (historical fallback). See
[COMPARE_SCHEMA.md §9](./COMPARE_SCHEMA.md).

Pair with **`--require-signoffs`** when running unattended: it errors
(exit 2) unless both `signoffs.a` and `signoffs.b` are non-empty in the
state file. nda-review-cli populates these when the `negotiate sign-off`
checkpoint is satisfied — a human-review gate before any agreement is
acted on.

### Clause filters

`--only-clauses Term,Payment,Indemnification` keeps only matching
clauses in the report and exit-code calculation; `--ignore-clauses
Acknowledgments,Notices` drops matching ones. Patterns are
case-insensitive substrings, matched against numbering-stripped clause
titles. Both flags can combine (`--ignore-clauses` runs after
`--only-clauses`). The number of suppressed differences is surfaced in
the human report and as `summary.suppressed_by_filter` in `--json` /
SARIF output, so the suppression is auditable.

### `--sarif` (CI / code-scanning)

`--sarif` emits a SARIF v2.1.0 document. Each substantive difference is
a result with `level: error`; cosmetic/typographic are `warning`;
added/removed/moved are `note`. Designed for GitHub Actions code-
scanning upload — substantive drift appears as inline annotations on
the candidate file in the PR review UI.

```sh
compare base.docx contracts/2026/acme.docx --sarif > compare.sarif
# upload via: github/codeql-action/upload-sarif@v3 with sarif_file=compare.sarif
```

### `--check` (exit-code-only mode)

`--check` suppresses both stdout and stderr; the exit code is the only
output. Use for CI gates and short shell pipelines:

```sh
compare base.docx cand.docx --check && echo "safe to sign"
```

Implies `--silent`. `--output` is also skipped under `--check` (you said
you only care about the exit code).

If no agreed round exists, the CLI exits 2 with a clear error.

### Working with PDFs

Text extraction from `.pdf` is layout-lossy. When either side is a PDF,
the report surfaces a warning:

```
warning: candidate was extracted from PDF; layout-sensitive differences
         may surface as false positives
```

If extraction returns zero characters (a scanned PDF without an OCR
layer), compare-cli **exits 1** with a clear message rather than
silently reporting no drift.

## Part of the contract-operations suite

[cli.drbaher.com](https://cli.drbaher.com)

- **[nda-review-cli](https://github.com/DrBaher/nda-review-cli)** — owns
  the `negotiation.json` hash-chained state file. `--from-negotiation`
  reads its output.
- **[docx2pdf-cli](https://github.com/DrBaher/docx2pdf-cli)** — the
  upstream step that turns the agreed `.docx` into the `.pdf` you put
  in the signing envelope.
- **[sign-cli](https://github.com/DrBaher/sign-cli)** — runs the actual
  signing flow; compare-cli is the gate that runs before it.
- **draft-cli** (recently joined the suite) — fills placeholders in
  templates before negotiation begins.
- **template-vault-cli** (forthcoming) — stores the canonical templates
  compare-cli will eventually share clause-detection logic with.

## Documentation

- **[COMPARE_SCHEMA.md](./COMPARE_SCHEMA.md)** — v1 contract. The single
  source of truth for what the CLI does. Implementation and tests are
  written against this file.
- **[AGENTS.md](./AGENTS.md)** — for LLM consumers and agent pipelines.
  Stable output shapes, exit codes, failure diagnosis.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — how the CLI is shaped and why.
- **[GETTING_STARTED.md](./GETTING_STARTED.md)** — 10-minute walkthrough.
- **[FAQ.md](./FAQ.md)** — common questions.
- **[SECURITY.md](./SECURITY.md)** — disclosure policy.
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — for contributors.
- **[CHANGELOG.md](./CHANGELOG.md)** — release history.

## License

[MIT](./LICENSE) © DrBaher
