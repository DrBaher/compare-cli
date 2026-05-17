# AGENTS.md

This file describes the **stable surface** of `compare-cli` for LLM agents
and downstream tooling. The exit codes and `--json` shape documented here
are stable across v1.x minor releases.

## The contract

`compare-cli` is a deterministic pre-signature gate. Given two contract
versions (`BASE` = what was agreed, `CANDIDATE` = what's being put forward),
it returns an exit code that classifies the drift between them.

| Exit | `exit_class`     | Meaning                                                             |
|------|------------------|---------------------------------------------------------------------|
| `0`  | `clean`          | No drift detected. Every clause matches. Safe to sign.              |
| `1`  | n/a              | I/O error — input not found, unreadable, malformed `.docx`/`.pdf`.  |
| `2`  | `substantive`    | Substantive drift, or `--strict`/`--strict-cosmetic` was tripped.   |
| `3`  | `cosmetic` / `typographic` | Cosmetic-only or typographic-only drift. Informational.   |
| `4`  | `moved`          | Clause(s) moved but content identical.                              |

**`stdout` is the report.** Human-readable when stdout is a TTY (with ANSI
color), structured JSON when `--json` is set, plain text otherwise.

**`stderr` is the side channel.** Warnings, the `--why` block, and error
messages go to stderr. `--silent` / `-q` suppresses all stderr output;
exit codes are unchanged. Argument-parse errors always print on the real
stderr regardless of `--silent`.

## `--json` output shape (stable across v1.x)

```json
{
  "ok": true,
  "exit_class": "clean",
  "exit_code": 0,
  "base": {
    "path": "negotiated.docx",
    "format": "docx",
    "lossiness": "none",
    "clauses_total": 12,
    "track_changes": []
  },
  "candidate": {
    "path": "ready-to-sign.pdf",
    "format": "pdf",
    "lossiness": "extracted",
    "clauses_total": 12,
    "track_changes": []
  },
  "summary": {
    "clauses_total": 12,
    "clauses_changed": 0,
    "clauses_moved": 0,
    "clauses_added": 0,
    "clauses_removed": 0,
    "differences": {
      "cosmetic": 0,
      "typographic": 0,
      "substantive": 0,
      "added": 0,
      "removed": 0,
      "moved": 0
    },
    "suppressed_by_filter": 0
  },
  "differences": [],
  "warnings": []
}
```

### Stable keys

The following keys are stable across v1.x and will not be renamed or removed
without a major-version bump:

- Top level: `ok`, `exit_class`, `exit_code`, `base`, `candidate`, `summary`,
  `differences`, `warnings`
- Per `base` / `candidate`: `path`, `format`, `lossiness`, `clauses_total`,
  `track_changes` (added in v0.3.0; `.docx` `<w:ins>` / `<w:del>` metadata as
  a flat list of `{op, text, author, date}`; always present, empty `[]` for
  non-docx inputs or docs without TC; **informational only — does not affect
  `exit_class`**)
- Per `summary`: `clauses_total`, `clauses_changed`, `clauses_moved`,
  `clauses_added`, `clauses_removed`, `differences`, `suppressed_by_filter`
  (added in v0.2.0; counts differences dropped by `--only-clauses` /
  `--ignore-clauses`)
- Per `summary.differences`: `cosmetic`, `typographic`, `substantive`,
  `added`, `removed`, `moved`
- Per `differences[]` entry: `class`, `clause_title`, `clause_index_base`,
  `clause_index_candidate`, `base`, `candidate`

### `exit_class` enumeration

One of:

- `"clean"` → exit 0
- `"cosmetic"` → exit 3
- `"typographic"` → exit 3
- `"substantive"` → exit 2 (incl. `--strict`/`--strict-cosmetic` upgrades)
- `"moved"` → exit 4

The class never changes value to mean a different exit code mid-version.

### `differences[]` ordering

Sorted by `clause_index_base` ascending, then `clause_index_candidate`
ascending. Entries with `clause_index_base: null` (i.e. `class: "added"`)
sort last. Deterministic across runs.

### `clause_index_*` semantics

1-based. `null` on the side where the clause is missing:

- `class: "added"` → `clause_index_base` is `null`, `clause_index_candidate`
  is the 1-based candidate position.
- `class: "removed"` → `clause_index_candidate` is `null`,
  `clause_index_base` is the 1-based base position.
- All other classes have both indices populated.

### Error shape under `--json`

When `--json` is set and an I/O or arg error occurs, stdout emits:

```json
{ "ok": false, "error": "<message>", "exit_code": <int> }
```

## Discovery commands

For an agent integrating compare-cli, the safe discovery sequence is:

```sh
compare --version       # confirm install + version
compare --help          # surface the flag list
compare --demo --json   # confirm the bin runs end-to-end against bundled fixtures
```

`--demo --json` exits with code `2` (the bundled fixtures contain a
deliberate substantive change). This is a fixture, not a bug — the demo
demonstrates the headline exit-code contract.

## Recommended agent invocation patterns

### Pre-signature gate in a pipeline

```sh
compare negotiated.docx ready-to-sign.pdf --json > report.json
status=$?
case $status in
  0) action=sign ;;
  2) action=review ;;
  3) action=note   ;;  # cosmetic only — log and proceed
  4) action=note   ;;  # moved only — log and proceed
  1|*) action=error ;;
esac
```

### Feeding base from negotiation state

```sh
compare --from-negotiation negotiation.json ready-to-sign.pdf --json
```

This reads `negotiation.json` (produced by
[nda-review-cli](https://github.com/DrBaher/nda-review-cli)) and uses the
latest agreed round's text as `BASE`. Three-tier resolution: top-level
`status: converged|signed_off|finalized` (preferred), per-round
`agreed: true`, per-round `clause_status` all `"agreed"`.

If no agreed round exists, `compare` exits `2` with a clear error.
compare-cli does **not** verify the hash chain — that's nda-review-cli's
`negotiate validate`. Run it first if you need integrity guarantees.

**Unattended pipelines: add `--require-signoffs`.** Errors if either
`signoffs.a` or `signoffs.b` is missing or empty in the state file —
catches the case where one party has not yet completed the
`negotiate sign-off` human-review checkpoint. The flag is opt-in
because some interactive workflows reasonably compare against agreed
text before final sign-off.

### CI gate via SARIF

```sh
compare base.docx contracts/2026/acme.docx --sarif > compare.sarif
```

Upload via `github/codeql-action/upload-sarif@v3` for inline PR
annotations. Severity mapping: substantive → `error`, cosmetic /
typographic → `warning`, added / removed / moved → `note`. The exit-
code class is also stamped on `runs[0].invocations[0].properties.exit_class`.

### Minimal CI gate via `--check`

```sh
compare base.docx cand.docx --check && echo "safe to sign" || exit $?
```

Suppresses all output — exit code is the only output. Implies `--silent`.
Convention match: `prettier --check`, `tsc --noEmit`.

### Focusing on material clauses

```sh
compare base.docx cand.docx --only-clauses Term,Payment,Indemnification --json
```

Filters the report and the exit-code classification to only the
named clauses. Case-insensitive substring match against
numbering-stripped titles. `--ignore-clauses Acknowledgments,Notices`
inverts the filter. Both flags can combine. Suppressed-difference
count surfaces in `summary.suppressed_by_filter` so the filtering is
auditable.

### Strict mode for high-stakes pipelines

```sh
compare negotiated.docx ready-to-sign.pdf --strict --strict-cosmetic
```

Treats *any* drift (cosmetic, typographic, or substantive) as exit 2.
Useful when the agreement is "byte-perfect after normalization or do
nothing" — e.g. financial term sheets where `$1,000` vs `$1000` is in
fact meaningful.

## Failure diagnosis

| Symptom                                                | Likely cause                                                                  | Recovery                                                                  |
|--------------------------------------------------------|-------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| `extracted zero characters from X.pdf`                 | PDF is a scanned image, no OCR layer                                          | Run OCR (e.g. `ocrmypdf`) before passing to compare                       |
| `malformed .docx`                                      | File isn't a valid `.docx` (not a zip, missing `word/document.xml`)           | Confirm the file isn't corrupted; check it opens in Word                  |
| `malformed .pdf`                                       | File is corrupted or not a PDF                                                | Confirm the file opens in a PDF reader                                    |
| `input not found`                                      | Path is wrong                                                                 | Check the path                                                            |
| `--from-negotiation: no agreed round found`            | Every round in the negotiation file is disputed / not-yet-agreed              | Confirm negotiation has converged before calling compare                  |
| `<n> substantive differences detected` when none expected | Cross-format compare with PDF on one side; layout artifacts surfaced as text | Convert both sides to the same format, or pass `--from-negotiation`       |

## Heuristic safety gate

The CLI **never** silently reports zero drift on a PDF with no extractable
text. If pdfjs-dist returns empty content (a scanned image without an OCR
layer), compare-cli exits 1 with an explicit "may be a scanned image"
message. The honest failure surfaces to the caller; the agent should run
OCR or escalate to a human reviewer.

## What compare-cli does NOT do (v1 scope)

- **Semantic comparison.** "From time to time" vs "at any time" reads as
  substantive drift. The CLI doesn't paraphrase-match.
- **Track-changes consumption.** Word's TC metadata is ignored; only the
  resulting text is compared.
- **Hash-chain verification** of `negotiation.json`. That's
  nda-review-cli's `negotiate validate`.
- **Signature image comparison**. Bytes in, text out — no image diff.
- **Folder / batch mode.** One BASE, one CANDIDATE per invocation.

If a v2 release adds any of the above, this file will document the
additions; v1 stable keys will remain valid.

## Programmatic API

`compare-cli.mjs` is ESM. Importable functions for in-process use:

```js
import {
  compareDocuments, computeExitClass, buildReportJson,
  detectClauses, classifyDiff, normalizeTitle,
  cosmeticNormalize, typographicNormalize,
  alignClauses, detectMoves,
  readInput, extractDocxText, extractPdfText,
  readNegotiation,
  EXIT, VERSION, main,
} from "compare-cli";
```

`main(argv, io)` accepts an argv array and an `io = { out, err, env,
stdinReader }` overrides object. Returns a `Promise<number>` (exit code).
This is how the test suite invokes the CLI without spawning a child
process; downstream agents can do the same.
