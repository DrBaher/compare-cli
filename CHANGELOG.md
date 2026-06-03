# Changelog

All notable changes to this project will be documented in this file. The
format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
and the project adheres to semantic versioning once it leaves 0.x.

> **Repo workspaces (2026-05-17).** This repo now hosts two npm packages
> via [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces):
> the existing `compare-cli` at the root, and a new `compare-cli-mcp` in
> [`mcp/`](./mcp/) (MCP server wrapping the CLI for agent pipelines).
> The two packages version independently — entries below cover **compare-cli**
> only. See [`mcp/README.md`](./mcp/README.md) for `compare-cli-mcp` and
> [`docs/mcp.md`](./docs/mcp.md) for the design contract.

## 0.4.2 — 2026-06-03

Security/robustness fixes from a follow-up source audit.

### Fixed
- **Terminal-injection hardening.** C0 control characters (except `\n`/`\t`) are stripped
  from counterparty-controlled strings in the human formatter (clause titles/bodies,
  intra-diff text, and docx track-change author names) to prevent ANSI/terminal injection
  on a TTY. `--json`/SARIF output is unaffected.
- **`--catalog`/`--completion` fast-paths** now resolve even with `--require-signoffs` set
  (they no longer trip the negotiation guard).
- **Structured error envelopes preserved.** The `--json` input-error envelope is
  pretty-printed and carries `exit_class:"error"`; an `--output` write failure in
  `--json`/`--sarif` mode emits a structured error envelope instead of plain text.

## 0.4.1 — 2026-05-31

### Fixed
- **`--catalog json` mislabeled `--strict` semantics.** The agent-facing
  discovery catalog described `--strict` as upgrading "cosmetic/typographic
  drift to substantive", but `--strict` only upgrades *typographic* drift;
  cosmetic drift requires the separate `--strict-cosmetic`. The catalog help
  string now reads "Upgrade typographic drift to substantive (exit 2)." to
  match `HELP_TEXT`, `computeExitClass`, and `COMPARE_SCHEMA.md` §7.1. Since
  the catalog is the machine-readable contract agents read, this corrects a
  contract-level inaccuracy. (`--strict-cosmetic`'s catalog entry was already
  correct.)

## 0.4.0 — 2026-05-23

### Added
- **`compare --catalog json`** — the suite-wide discovery contract
  (`{name, bin, version, description, flags, exitCodes}`), so an agent learns
  every flag and the exit-code spectrum at startup instead of hardcoding them.
- Friendly first-run hint on a bare `compare` invocation (was a terse error);
  AGENTS.md aligned to the suite's section headings; README/docs cross-links.

## 0.3.0 — 2026-05-17

Minor: surface WordprocessingML track-changes metadata from `.docx` inputs.
**Informational only** — TC presence does NOT change the exit-code
classification (text-diff remains the source of truth in v0.3.x). A
future version may use TC as ground truth where both sides have it.

### Added

- **`extractDocxTrackChanges(buf)`** — new exported function that parses
  `<w:ins>` and `<w:del>` elements from `word/document.xml`. Returns a
  flat list of `{ op: "ins" | "del", text, author, date }` in document
  order. Robust to malformed input (non-zip / missing document.xml → empty
  array, no throw).
- **`readInput` on `.docx` populates `track_changes`** on the returned
  side object. Non-docx inputs do not have this field (consumers should
  treat missing as `[]`).
- **`--json` output includes `base.track_changes` and
  `candidate.track_changes`** as stable arrays. Always present on the
  base/candidate side object — empty `[]` when the input isn't `.docx` or
  has no TC. Each entry has shape `{ op, text, author, date }`.
- **Human report surfaces TC** when either side has it: counts of
  insertions / deletions and unique authors, as an addendum after the
  per-clause differences block. Skipped when neither side has TC.
- **`--why` surfaces TC counts** as `why: track_changes.base=N
  track_changes.candidate=M` when at least one side has TC. Omitted when
  both are zero, same posture as the clause-filter line.
- **SARIF `runs[].invocations[].properties` includes `track_changes_base`
  and `track_changes_candidate`** counts. CI dashboards can flag the
  presence of pre-existing TC on either side without re-parsing.

### Tests

191 → 206 (added 15). New file `tests/test_track_changes.mjs` covers the
unit parser, `readInput` integration, `--json` surface, human report,
`--why` line, and SARIF properties. `tests/_helpers.mjs`'s `makeDocx`
now supports inline TC ops in run arrays (`{type: "ins"|"del", text,
author, date}`).

### Out of scope for 0.3.0

- **TC as ground truth.** If a substantive text-diff result conflicts
  with what TC says, the current behavior reports the text-diff result.
  A future version (v0.4.0?) may invert this: if `<w:ins>` / `<w:del>`
  metadata exists, treat the per-op author/date as the authoritative
  record of the change and use TC content to populate the diff payload
  instead of re-deriving.
- **Clause attribution.** TC ops are returned as a flat list; the agent
  / human can correlate to clauses by matching the surrounding text. A
  future version may add `clause_index` to each op.
- **TC outside body paragraphs** (header / footer / footnotes / tables).
  v0.3.0 only reads `word/document.xml`; the other parts are silently
  skipped.

## 0.2.1 — 2026-05-17

Patch: small polish on the v0.2.0 features (`--why` now surfaces filter
state; SARIF emits valid Windows-path URIs) plus a CI/infra workflow for
GitHub Releases auto-generation. No behavior change to existing inputs;
two narrow follow-ups + one new workflow.

### Added

- **GitHub Releases workflow.** New `.github/workflows/release.yml` fires on
  every `v*` tag push and creates a GitHub Release object whose body is
  the matching `## <version>` section verbatim from `CHANGELOG.md`. Runs
  in parallel with `publish.yml` — they're independent (a release-yml
  failure doesn't block npm publish, and vice versa). Future tags get
  GitHub Releases automatically; the existing v0.1.0 / v0.1.1 / v0.2.0
  tags are backfilled manually via `gh release create` after this lands.
- **README badges:** npm version, CI status, license, Node engine
  range. Cheap, increases discoverability.

### Changed

- **`--why` block surfaces clause-filter state** when `--only-clauses` or
  `--ignore-clauses` is set, or when something was actually suppressed:
  `why: filter.only_clauses=term|payment filter.ignore_clauses=- filter.suppressed=3`.
  Omitted when no filters set and nothing suppressed, so it doesn't add
  noise to runs that don't use the feature.
- **SARIF `pathToFileUri` handles Windows absolute paths.** Was missing
  this case in v0.2.0 — `C:\Users\alice\foo.docx` now becomes
  `file:///C:/Users/alice/foo.docx` per the file-URI scheme. Relative
  paths still pass through unchanged (SARIF v2.1.0 allows). The function
  is now exported for direct testing.

### Repo infrastructure (one-time, not in the PR diff)

- **Repo description set** to the one-paragraph elevator pitch from
  README.md + suite link. Set via `gh api -X PATCH` (a settings change,
  not a PR change).
- **Branch protection enabled on `main`** — required status checks are
  the six existing CI jobs (`test (ubuntu × node 20/22)`,
  `test (macos × node 20/22)`, `coverage`, `smoke`). PRs cannot merge
  until all six pass. Admin override remains available
  (`enforce_admins=false`) for emergency hotfixes. Force-pushes and
  branch deletion both blocked.

### Tests

186 → 191 (added 5: three `--why` filter-info cases, two SARIF
Windows-path cases).

## 0.2.0 — 2026-05-17

Minor: six new flags / output behaviors, no breaking changes. Drives
compare-cli toward two new workflows: **unattended CI gating** (via
`--sarif`, `--check`, and clause filters) and **safer negotiation-driven
comparison** (via `--require-signoffs`).

### Added

- **Intra-clause word-level diff in human output.** Substantive changes
  inside a clause body now render inline as `[-removed-]{+added+}` (or
  red/green color in a TTY) instead of two separate `- base / + candidate`
  lines. Falls back to the original two-line format when (a) the combined
  base+candidate exceeds 600 chars or (b) more than ~70% of the body
  changed (intra-diff becomes unreadable). `--no-intra-diff` opts out
  globally. JSON / SARIF output unchanged — they carry structured `base`
  and `candidate` strings already, so consumers can render their own diff.
- **`--require-signoffs`** (use with `--from-negotiation`). Requires
  both `signoffs.a` and `signoffs.b` to be non-empty strings in the
  `negotiation.json` state file (per
  [nda-review-cli's state-file schema](https://github.com/DrBaher/nda-review-cli/blob/main/docs/reference/state-file.md)).
  Errors with exit 2 if either is missing, listing which party is
  outstanding. Closes a safety gap: previously compare-cli would read
  agreed text even from an unsigned-off file. Default behavior unchanged
  (opt-in flag).
- **`--only-clauses PATTERNS`** and **`--ignore-clauses PATTERNS`**.
  Comma-separated case-insensitive substring patterns matched against
  numbering-stripped clause titles (`normalizeTitle`). Filters apply
  before exit-code classification — if you `--ignore-clauses Notices`
  and the only substantive change was in Notices, the run exits 0.
  Suppressed-difference count surfaces in the human report and as
  `summary.suppressed_by_filter` in JSON/SARIF so the filtering is
  auditable. The two flags compose (`--ignore` runs after `--only`).
- **`--sarif`** emits SARIF v2.1.0 to stdout. Each difference is a
  result with class-mapped severity:
  - `substantive` → `error`
  - `cosmetic` / `typographic` → `warning`
  - `added` / `removed` / `moved` → `note`
  Designed for `github/codeql-action/upload-sarif@v3` — substantive
  drift surfaces as inline annotations on the candidate file in the PR
  review UI. Mutually exclusive with `--json`.
- **`--check`** — suppresses both stdout and stderr; exit code is the
  only output. Implies `--silent`. `--output` is skipped under `--check`.
  Convention match: `prettier --check`, `tsc --noEmit`.

### Changed

- `readNegotiation(path)` now accepts an optional `{ requireSignoffs }`
  flag. Default behavior unchanged. Existing callers / synthetic
  schemas keep working.
- The `--why` block and warnings are now suppressed under `--sarif`
  the same way they are under `--json` (structured output should be
  the only thing on stdout / stderr for a structured-format run).

### Tests

154 → 186 (added 32 new tests). One new file `tests/test_additions_v020.mjs`
covers all five new flags + the four new exported helpers (`wordDiff`,
`wordDiffChangeDensity`, `parseClausePatterns`, `clauseTitleMatches`,
`applyClauseFilters`, `buildReportSarif`).

### Out of scope for 0.2.0

- **MCP server** for compare-cli was proposed alongside these additions
  but deferred to its own design pass (`docs/mcp.md`). Adds a runtime
  dep (`@modelcontextprotocol/sdk`); packaging trade-off (separate
  `compare-cli-mcp` package vs. bundle) needs explicit decision before
  implementation.

## 0.1.1 — 2026-05-17

Reconciliation pass against the sibling-CLI specs **plus** a doc fix for the
`npx` invocation published with v0.1.0. No behavior change for existing
inputs; one new accepted input (`status: "converged"` at the top level of
`negotiation.json`) and a new internal spec doc.

### Fixed

- **`npx` invocation in README.md and GETTING_STARTED.md.** The published
  v0.1.0 docs advertised `npx compare-cli@latest --demo`, which fails with
  `sh: compare: command not found` (exit 127) because the package name
  (`compare-cli`) and bin name (`compare`) differ, and npm 10.x's `npx`
  does not auto-resolve a single bin in that case. Updated both docs to
  `npx -p compare-cli@latest -- compare --demo`. No code change; the global
  install (`npm install -g compare-cli && compare --version`) was always
  fine and remains the recommended path.

### Added

- **`negotiation.json` reader recognizes the top-level `status` field.** When
  `status` is one of `"converged"`, `"signed_off"`, or `"finalized"` (the
  three states in `nda-review-cli`'s [state-file
  reference](https://github.com/DrBaher/nda-review-cli/blob/main/docs/reference/state-file.md)
  that mean "agreement is reached and stable"), the **last round's `text`**
  is taken as the agreed base. This is the authoritative signal that
  `nda-review-cli` itself uses to compute convergence; reading it directly
  avoids re-deriving from per-round `clause_status`.
- **[`docs/clause-detection.md`](./docs/clause-detection.md)** — extracted
  the H2 / bold-prefix / ALL-CAPS / synthetic cascade as a portable,
  language-agnostic spec. Cited by `compare-cli.mjs` and ARCHITECTURE.md.
  template-vault-CLI is expected to cite the same doc in a follow-up PR
  there.
- **Clause-detection golden test** (`tests/test_clauses.mjs` → "rule
  golden" suite) pinning each tier's regex, the precedence (H2 wins over
  bold-prefix wins over ALL-CAPS, synthetic only if all three are empty),
  and `isAllCapsHeading`'s corner cases. The test will fail loudly if the
  rule drifts.

### Changed

- **`negotiation.json` reader: resolution order is now three-tier.** Priority
  1 is the new top-level `status` check; priorities 2 and 3 are the existing
  per-round `agreed: true` (minimum schema) and `clause_status` all-`"agreed"`
  (de-facto schema) checks, unchanged. Error message updated to list all
  three accepted forms.
- **`COMPARE_SCHEMA.md` §9.2** rewritten for the three-tier resolution.
- **`CHANGELOG.md` "Reconciliation debt" item 1** rewritten to reflect that
  template-vault-CLI is published (v0.4.0) but is a Python CLI, not a
  library importable from Node. The cross-language duplication is structural,
  not an oversight. See item 1 in the updated "Reconciliation debt" section
  on this release.

### Reconciliation debt (updated)

Replaces the section as written for 0.1.0.

1. **Clause-detection rule maintained in two languages by design.**
   `template-vault-CLI` (v0.4.0, Python) and `compare-cli` (Node) both ship
   the H2 / bold-prefix / ALL-CAPS / synthetic cascade. There is no
   language-neutral runtime they could share without forcing every user of
   one CLI to also install the other's runtime. The rule itself is the
   shared spec, now extracted as [docs/clause-detection.md](./docs/clause-detection.md).
   **Reconciliation responsibility:** when the rule changes, both repos
   ship coordinated PRs and bump the rule version in the spec doc.
2. **`negotiation.json` schema convergence.** v0.1.1 reads three signals
   (top-level `status: converged|signed_off|finalized`, per-round
   `agreed: true`, per-round `clause_status` all `"agreed"`). The first
   covers `nda-review-cli`'s authoritative output. The second is the
   compare-cli minimum schema (useful for synthetic tests and non-nda
   callers). The third is the historical `nda-review-cli` per-round signal
   kept for back-compat. **Reconciliation responsibility:** if the suite
   adopts a single shared schema doc, the reader can collapse to one signal
   and any deprecated ones get removed with a major bump.

## 0.1.0 — 2026-05-17

> **Package name decision (pre-publish).** Published as **`compare-cli`**
> (unscoped) rather than `@drbaher/compare-cli`. The unscoped name was
> available on npm and shortens the install command (`npm i -g
> compare-cli`) at the cost of diverging from draft-cli's scoped form.
> The scoped form remains available for future use if a name collision
> ever arises. `package.json` no longer carries `publishConfig.access`
> since unscoped packages are public by default.

> **Runtime baseline correction.** The original brief targeted Node ≥ 18,
> but `pdfjs-dist@^5.7.284` (the pin we share with sign-cli for suite-wide
> alignment) declares `engines.node: ">=22.13.0 || >=24"` and `npm ci`
> fails on Node 18. Node 20 satisfies pdfjs at runtime even though it
> doesn't formally satisfy the engines string, so the published baseline
> is **Node ≥ 20**; the CI matrix is `[20, 22]`. Suite-wide alignment
> with sign-cli on the pdfjs pin won the trade-off.

Initial release. Single-file Node.js CLI for clause-aware drift detection
between two contract versions. Part of the contract-ops suite
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
