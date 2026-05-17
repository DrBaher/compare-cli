# Changelog

All notable changes to this project will be documented in this file. The
format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
and the project adheres to semantic versioning once it leaves 0.x.

## 0.1.0 — 2026-05-17

Initial release. Single-file Node.js CLI for clause-aware drift detection
between two contract versions. Part of the contract-operations suite
([cli.drbaher.com](https://cli.drbaher.com)).

### Added

- **Clause-aware drift detection** with five-class spectrum: `clean`,
  `cosmetic`, `typographic`, `substantive`, `moved` (plus `added` and
  `removed` for clauses missing on one side). The exit code is the
  contract — `0` safe to sign, `2` substantive (do not sign), `3`
  cosmetic/typographic only (informational), `4` moved-only, `1` I/O.
- **Multi-format inputs.** `.docx` via `jszip`, `.pdf` via `pdfjs-dist`
  (legacy ESM build, Node-friendly), `.md` / `.txt` as UTF-8, and `-`
  for stdin. Same-format and cross-format comparisons both work; cross
  to/from PDF surfaces a lossiness warning.
- **Clause detection cascade**: H2 headings (`## Title`) → numbered
  bold-prefix (`**1. Title**`) → ALL-CAPS lines (`CONFIDENTIALITY
  OBLIGATIONS`) → synthetic single-clause fallback. Fallbacks only fire
  when the previous tier returns empty (matches template-vault-cli
  v0.3.0).
- **Two normalization passes** define the cosmetic / typographic /
  substantive boundary deterministically. Cosmetic strips whitespace
  noise and Unicode-presentation glyphs (curly quotes, em-dashes, NBSP);
  typographic additionally lowercases, removes thousands separators
  inside numbers, strips `.00` decimal-zero suffixes, and flips the
  Oxford comma. Everything else — singular/plural, tense, negation,
  sentence-meaningful punctuation — is substantive.
- **Move detection** via LIS (longest increasing subsequence) over the
  candidate-side indices of pairs sorted by base-side index, after
  alignment by normalized clause title. Exact, no fuzzy threshold. Per
  §8.3 the `moved` class is suppressed when the body class is non-clean
  (substantive wins).
- **`--from-negotiation NEG.json` flag** reads the agreed text from
  nda-review-cli's `negotiation.json`. Supports both the minimum schema
  (`{ rounds: [{ text, agreed: true }] }`) and the de-facto current
  nda-review-cli format (`clause_status` with all values `"agreed"`).
  No agreed round → exit 2 with a clear error.
- **`--strict` upgrades typographic → substantive**; `--strict-cosmetic`
  upgrades cosmetic → substantive. The two flags are independent. Pass
  both to upgrade both. The class still reports its original label in
  `--json` so the caller can see *why* the strict mode tripped.
- **`--json` mode** with a stable shape across v1.x. Stable top-level
  keys (`ok`, `exit_class`, `exit_code`, `base`, `candidate`, `summary`,
  `differences`, `warnings`) and stable per-difference keys (`class`,
  `clause_title`, `clause_index_base`, `clause_index_candidate`, `base`,
  `candidate`). Indices are 1-based; `null` on the side where the clause
  is missing. See [COMPARE_SCHEMA.md §10](./COMPARE_SCHEMA.md).
- **`--why` block** on stderr with structured `key=value` lines:
  detection tiers, alignment method, class counts, exit decision, strict
  mode state. Same posture as draft-cli's `--why`.
- **`--silent` / `-q`** suppresses all stderr (warnings and `--why`)
  for fully-quiet pipeline use. Exit code unchanged.
- **`--output PATH`** writes the report to a file instead of stdout.
  `--output -` is the standard "fall back to stdout" form. Works with
  both human and `--json` output.
- **`--demo`** flag for a zero-file 30-second first run against two
  bundled fixtures (the negotiated NDA and a candidate with a substantive
  Term-clause change). `--demo --json` runs the same comparison in JSON
  mode. The demo deliberately exits 2 so the contract is demonstrated.
- **`--completion bash|zsh`** flag emits a hand-rolled shell completion
  script. No third-party generator. Completes top-level flags, the
  `--completion` shell name, and file paths for `--from-negotiation` and
  `--output`.
- **PDF zero-text safety.** If pdfjs-dist returns empty text from a PDF
  (scanned image without OCR), the CLI exits 1 with the message
  `extracted zero characters from <PATH>; PDF may be a scanned image
  without an OCR layer` rather than silently reporting zero drift. The
  brief flagged this case explicitly; the CLI surfaces it honestly.
- **ANSI color** honors `NO_COLOR` and `FORCE_COLOR`; auto-disables off-TTY.
- **GitHub Actions CI**: Ubuntu × macOS × Node 18 / 20 / 22 test matrix,
  coverage gate at 80% line, and smoke job that packs + installs + runs
  `--version` + `--demo --json`.
- **GitHub Actions publish**: npm Trusted Publishing on `v*` tag push,
  with version-vs-tag check and `--provenance` attestation. Bootstrap
  `NPM_TOKEN` fallback matches draft-cli's current shape pending OIDC
  resolution upstream.

### Exit codes (locked)

| Code | Meaning |
|------|---------|
| `0` | No drift detected, safe to sign |
| `1` | I/O error — input not found, unreadable, malformed |
| `2` | Substantive drift detected (or `--strict`/`--strict-cosmetic` tripped) |
| `3` | Cosmetic-only or typographic-only drift (informational) |
| `4` | Clause(s) moved but content identical |

Documented in AGENTS.md and never re-numbered without a major-version bump.

### Runtime dependencies (locked)

Exactly two, both reused from the suite:

- `jszip ^3.10.1` — `.docx` extraction (same pin as draft-cli)
- `pdfjs-dist ^5.7.284` — `.pdf` extraction (same major as sign-cli)

Everything else (clause detection, LCS, diff classification, ANSI, argv
parsing, `.env` reader) is hand-rolled stdlib. No telemetry. No network
calls. **No LLM tier in v1** — comparison is deterministic by nature;
adding non-determinism here would defeat the contract.

### Test suite

135 tests across nine files, mirroring draft-cli's per-concern layout.
98.59% line coverage on `compare-cli.mjs`, well over the 80% gate.

### Notes

- Configuration contract is captured in
  [COMPARE_SCHEMA.md](COMPARE_SCHEMA.md), reviewed and locked before code.
- The clause-detection algorithm is duplicated from template-vault-cli
  pending its publication. See "Reconciliation debt" below.

### Reconciliation debt

Two specs are tracked as known v2 reconciliation items, not bugs:

1. **Clause detection logic duplicated from template-vault-cli.**
   template-vault-cli isn't published yet, so v1 re-implements the H2 +
   bold-prefix + ALL-CAPS rule in this file. When template-vault-cli
   ships a published library, v2 either imports it or shells out — the
   rule itself stays unchanged.
2. **`negotiation.json` minimum schema diverges from the de-facto
   nda-review-cli release.** The brief specified a minimum
   `{ round, text, agreed: true }`; nda-review-cli today emits richer
   rounds with `clause_status` mapping clause names to `"agreed"` /
   `"disputed"`. v1 reads both — minimum first, `clause_status all
   agreed` as a fallback. v2 will unify when the suite converges on a
   shared schema document.

### Deferred (post-v0.1.0 candidates)

- **Semantic comparison** (paraphrase, synonym, "at any time" ≡ "from
  time to time"). Would require an LLM tier; defeats determinism. If
  added later, must be env-gated like draft-cli's T5.
- **N-way diff** (3+ versions, lineage tracking).
- **Track-changes consumption** (Word's TC metadata as ground truth).
- **Inline `.docx` redline output**. That's nda-review-cli's
  `generate-redlines`.
- **Batch / folder mode** (`compare base.docx received-folder/*.pdf`).
- **Image / signature comparison**.
- **Hash-chain verification** of `negotiation.json`. That's
  nda-review-cli's `negotiate validate`.
- **Sub-clause / paragraph-level move detection**. v1 moves are detected
  at the clause-title level only.
