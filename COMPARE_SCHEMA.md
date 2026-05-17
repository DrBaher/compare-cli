# COMPARE_SCHEMA — v1 contract

This document locks the **detection, classification, and `--from-negotiation`
contract** for `compare-cli` v1 *before code is written*. It is the source of
truth for what the CLI does; the test suite asserts against it; the `--json`
output shape is stable across minor versions once this spec ships.

If you change the spec, bump the minor version and document the change in
CHANGELOG.md under "Schema-contract change".

Sibling reference: this file is the analogue of [draft-cli's
`PARAM_SCHEMA.md`](https://github.com/DrBaher/draft-cli/blob/main/PARAM_SCHEMA.md).
Posture and shape match.

---

## 1. Stack & posture

- **Single-file Node.js CLI** (`compare-cli.mjs`). ESM. Node ≥ 20 (pinned upward by `pdfjs-dist@^5.7.284`, which formally requires `>=22.13` but works at runtime on Node 20). MIT.
- **Runtime dependencies — exactly two, both reused from the suite:**
  - `jszip ^3.10.1` — `.docx` extraction (same pin as draft-cli).
  - `pdfjs-dist ^5.7.284` — `.pdf` extraction (same major as sign-cli).
- **Everything else** is hand-rolled stdlib: clause detection, LCS, diff
  classification, `.env` parsing, ANSI color, argv parsing.
- **Local-first, deterministic.** No telemetry, no network, **no LLM tier in
  v1**. Determinism is the whole point of a pre-signature gate; an LLM would
  defeat the contract. If an LLM mode is added in v2 it must be opt-in and
  env-gated the same way draft-cli's T5 is.

---

## 2. Inputs and outputs

`compare-cli` takes **exactly two positional arguments**: `BASE` (what was
agreed) and `CANDIDATE` (what's being put forward).

```sh
compare BASE CANDIDATE              # human report to stdout
compare BASE CANDIDATE --json       # JSON to stdout
compare BASE CANDIDATE --strict     # upgrade typographic → substantive
compare --from-negotiation NEG.json CANDIDATE   # BASE comes from negotiation.json
```

Bidirectional but **ordered**: a clause that exists in CANDIDATE but not BASE
is "added"; the reverse is "removed". These are different exit-2 events with
different human-readable framing.

### 2.1. Accepted input formats

| Extension | Reader | Lossiness | Notes |
|-----------|--------|-----------|-------|
| `.docx`   | `jszip` + regex over `word/document.xml` (same approach as draft-cli T3) | `none` | Run boundaries are flattened; whitespace inside runs is preserved. |
| `.pdf`    | `pdfjs-dist` per-page text-content extraction | `extracted` | Whitespace between text items is reconstructed; layout-sensitive differences may surface as false positives. |
| `.md` / `.markdown` / `.txt` / no extension | Read as UTF-8 | `none` | Pass-through. |
| `-` (stdin) | Read all of stdin as UTF-8 | `none` | Either side may be `-`, but not both. |

Empty extracted text from a `.pdf` (e.g. scanned-then-not-OCRed) is a hard
**exit 1** with the message:

```
error: extracted zero characters from <PATH>; PDF may be a scanned image without an OCR layer
```

We do NOT silently report zero drift in that case — that's the failure mode
the brief explicitly told us to avoid.

### 2.2. Lossiness disclaimer

When either side is `.pdf`, the report includes a warning:

```
warning: candidate was extracted from PDF; layout-sensitive differences may surface as false positives
```

In `--json` mode the same string lands in `warnings[]`. Human mode prints it
to **stderr** so stdout stays clean for pipelines.

### 2.3. Output destinations

- **Human report**: stdout. ANSI color when stdout is a TTY; honors `NO_COLOR`
  (any non-empty value disables) and `FORCE_COLOR` (any non-empty value
  enables). Same rule draft-cli uses. Diagnostics (warnings, `--why` block)
  go to **stderr**.
- **`--json` mode**: structured payload to stdout, nothing else. Warnings go
  into `warnings[]` on the payload, not stderr.
- **`--output PATH`**: write the human report (or JSON, if `--json` is set) to
  `PATH` instead of stdout. `--output -` is the same as omitting the flag
  (Unix convention).
- **`--silent` / `-q`**: suppress all stderr output. Exit code is unchanged.
  Matches draft-cli's `--silent`.

---

## 3. Pipeline

Comparison runs in four ordered phases. Each phase produces a deterministic
output that the next consumes.

```
Phase 1   Extract                  → canonical text per side
Phase 2   Detect clauses           → ordered list of {title, body} per side
Phase 3   Align + classify         → per-clause classification (clean | cosmetic | typographic | substantive | added | removed)
Phase 4   Detect moves             → mark clauses whose body matches but position differs
```

The exit code is computed from the aggregate of phase 3 + phase 4 results
(see §7).

---

## 4. Clause detection

Lifted from `template-vault-cli`'s `detect_clauses` algorithm. v1 duplicates
the rule; v2 reconciles when template-vault-cli ships an importable library.

### 4.1. Rule cascade

1. **H2 headings.** Lines matching `^##\s+(.+?)\s*$` (after `\r\n` → `\n`
   normalization). Body of a clause is everything from the line after the H2
   to (but not including) the next H2 or end-of-document.
2. **Bold-prefix fallback.** Lines matching `^\*\*(\d+\.?\s+.+?)\*\*\s*$` —
   numbered bold-prefix headings like `**1. Purpose**` or `**3.2 Term**`.
3. **ALL-CAPS fallback.** Lines that satisfy ALL of:
   - At least 3 characters long
   - At least one letter
   - Every letter character is uppercase
   - At least two whitespace-separated tokens, OR the single token is ≥ 4
     letters long (avoids matching `X`, `OR`, `IF`)
   - Line does not start with `[` (defensive against `[BOLD]` markers)

**Fallbacks fire only when the previous tier returned zero clauses on that
side.** This is the same rule template-vault-cli locked in v0.3.0 — fallbacks
can't shadow real H2 sections.

### 4.2. Synthetic single-clause fallback

If all three tiers return zero clauses, the entire document is wrapped in one
synthetic clause titled `"Document"`. This makes plain-text and unstructured
inputs still comparable — the diff degrades to "the whole text differs in
these ways" rather than erroring.

### 4.3. Clause title normalization

Titles are normalized for **alignment** (matching base ↔ candidate clauses)
only — not for display. The display title is the raw matched text.

Normalization for alignment:
1. Strip leading numbering (`1.`, `1.2`, `1.2.3` followed by whitespace).
2. Lowercase.
3. Collapse whitespace runs to single space.
4. Strip leading/trailing whitespace and trailing punctuation.

Example: `"## 1. Term and Survival"` and `"## Term and Survival"` align to the
same normalized title `"term and survival"`.

---

## 5. Normalization passes

The three difference classes (§6) are defined by which normalizations a pair
of strings survive. Two normalization passes are layered:

### 5.1. Cosmetic-normalize

Removes "punctuation-and-whitespace" presentation noise. Two strings that are
equal after cosmetic-normalize have **cosmetic-only** differences.

Operations, applied in order:
1. `\r\n` → `\n`, then `\r` → `\n`
2. NBSP (`U+00A0`) and other Unicode space separators → ASCII space
3. Curly quotes `‘’“”` → `'` and `"`
4. Em-dash `—` and en-dash `–` → `-`
5. Ellipsis `…` → `...`
6. Collapse runs of whitespace (incl. `\n`) to a single space
7. Trim leading and trailing whitespace

### 5.2. Typographic-normalize

Builds on cosmetic-normalize. Additionally collapses presentation-of-meaning
differences that don't change semantics. Two strings that are equal after
typographic-normalize (but not after cosmetic-normalize alone) have
**typographic** differences.

Operations, applied in order, **after cosmetic-normalize**:
1. Lowercase
2. Remove thousands separators inside numbers: `$1,000` → `$1000`,
   `1,234,567` → `1234567`. (Pattern: a digit followed by `,` followed by
   three digits, the `,` is removed.)
3. Remove decimal-zero suffix: `$1000.00` → `$1000`, `5.0%` → `5%`.
4. Remove the Oxford comma: `a, b, and c` → `a, b and c`.

### 5.3. What's deliberately NOT normalized away

- **Word order** — `"the Company"` vs `"Company"` is substantive.
- **Singular/plural** — `"obligation"` vs `"obligations"` is substantive.
- **Tense** — `"agreed"` vs `"agree"` is substantive.
- **Negation** — `"will"` vs `"will not"` is substantive (and the most
  important thing this CLI exists to catch).
- **Punctuation that carries meaning** — periods inside lists, semicolons
  separating list items, parens introducing definitions. Cosmetic normalize
  only touches whitespace and Unicode-presentation glyphs, never `,` `.` `;`
  `(` `)`.

---

## 6. The three difference classes (locked)

Given two clauses with the same aligned title, classify their body texts:

| Class           | Definition                                                              | Example                                                                                       |
|-----------------|-------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| **clean**       | Bodies are byte-identical.                                              | `"Term: 2 years"` vs `"Term: 2 years"`                                                        |
| **cosmetic**    | Bodies differ but `cosmetic-normalize(b) == cosmetic-normalize(c)`.     | `"Term: 2  years"` vs `"Term: 2 years"`  •  `'don’t'` vs `"don't"`  •  `"a—b"` vs `"a-b"` |
| **typographic** | Not cosmetic, but `typographic-normalize(b) == typographic-normalize(c)`. | `"$1,000"` vs `"$1000"`  •  `"Acme"` vs `"ACME"`  •  `"a, b, and c"` vs `"a, b and c"`        |
| **substantive** | Not equal under any normalization.                                      | `"2 years"` vs `"3 years"`  •  `"will not"` vs `"will"`  •  Word added/removed.               |

A pair of clauses gets exactly one class. **Mixed classes within one clause
collapse to the strongest** (substantive > typographic > cosmetic > clean).

### 6.1. Clause-level classifications beyond the three

- **added** — title exists in candidate, no aligning title in base.
- **removed** — title exists in base, no aligning title in candidate.
- **moved** — title exists in both, body is clean, but the *position* in the
  ordered clause sequence differs. See §8.

Added and removed clauses both count as substantive drift (they change the
agreement). Moved clauses are §8.

---

## 7. Exit-code spectrum (locked)

| Code | Meaning                                                                          |
|------|----------------------------------------------------------------------------------|
| `0`  | No drift detected. Every clause is `clean`. Safe to sign.                        |
| `1`  | I/O error — input not found, unreadable, malformed `.docx`/`.pdf`, empty PDF text. |
| `2`  | Substantive drift — at least one clause is `substantive`, `added`, or `removed`. Or `--strict` was set and at least one clause is `typographic`. Or `--strict-cosmetic` was set and at least one clause is `cosmetic`. |
| `3`  | Cosmetic-only or typographic-only drift — no substantive/added/removed/moved, but at least one clause is `cosmetic` or `typographic`. Informational; doesn't block. |
| `4`  | Moved clauses only — at least one clause is `moved`, no other class is present.  |

**Precedence when multiple classes are present:**

```
substantive | added | removed   → exit 2
                else, if --strict and any typographic  → exit 2
                else, if --strict-cosmetic and any cosmetic  → exit 2
moved (anything)                → if no exit-2 trigger and no cosmetic/typographic → exit 4
                                  else if no exit-2 trigger → exit 3 (the cosmetic/typographic wins because moved is silent under §8.3)
cosmetic | typographic          → exit 3 (if no exit-2 trigger and no moved-only state)
all clean                       → exit 0
```

This means **moved + cosmetic = exit 3** (the cosmetic class is more
informative). Moved is only exit 4 when it's the *only* signal.

### 7.1. `--strict` and `--strict-cosmetic` (locked)

- **`--strict`** (typographic → substantive): a clause classified `typographic`
  is treated as `substantive` for exit-code purposes. The clause's class in
  the JSON payload still reports `"typographic"` (so the user can see *why*
  the strict mode tripped); only the aggregate exit code is upgraded.
- **`--strict-cosmetic`** (cosmetic → substantive): same semantics, applied to
  `cosmetic` instead of `typographic`. **Does not imply `--strict`** — the two
  flags are independent. Pass both to upgrade both.

---

## 8. Move detection (LCS on clause titles)

After §6 classification finishes, run a separate pass that detects when a
clause appears in **both** sides with **clean** body but **different
position**.

### 8.1. Algorithm

1. Build `base_titles` = ordered list of normalized titles in BASE.
2. Build `cand_titles` = ordered list of normalized titles in CANDIDATE.
3. Compute the longest common subsequence (LCS) of the two lists.
4. For every title that appears in **both** lists but is **not in the LCS**,
   it has "moved" — its position changed even though its title is the same.
5. Apply the "moved" classification only to clauses where the body is also
   `clean`. If the body is `cosmetic`/`typographic`/`substantive`, the
   classification *also* stays (i.e. "moved + substantive" is reported under
   `differences[]` as substantive — moved is silent there, because once the
   body changed, the move is no longer the interesting signal).

### 8.2. No threshold tunable

LCS is exact. There is no "fuzzy" match threshold for v1. Either the
normalized title appears in both sides or it doesn't.

### 8.3. Move + cosmetic precedence

When a clause is both `moved` and `cosmetic`/`typographic`, the difference is
reported once with the cosmetic/typographic class; `moved` is suppressed for
that clause. (Otherwise the report doubles up on noise: "this clause moved
AND had its quotes restyled" → not actionable as a *move*; the user can see
the order shift in the clauses list.)

---

## 9. `negotiation.json` minimum schema (`--from-negotiation`)

`--from-negotiation NEG.json CANDIDATE` reads `NEG.json`, extracts the
last-agreed text, and uses it as BASE. Then compares against CANDIDATE.

### 9.1. Minimum schema (what compare-cli requires)

`compare-cli` v1 is **schema-version-permissive**: it reads the minimum it
needs and ignores everything else. Required shape:

```json
{
  "rounds": [
    {
      "round": 1,
      "text": "<full agreed text of this round>",
      "agreed": true
    }
  ]
}
```

- `rounds` MUST be a non-empty array.
- Each round MUST have `text` (string).
- Each round MAY have `round` (integer), `agreed` (boolean), and any other
  fields (silently ignored by v1).

### 9.2. "Latest agreed round" resolution

`compare-cli` picks the BASE text using this **three-tier** resolution order
(first match wins):

1. **Top-level convergence status** (preferred — the signal `nda-review-cli`
   itself uses): if `parsed.status` is one of `"converged"`, `"signed_off"`,
   or `"finalized"`, the **last round's `text`** (highest-indexed round with
   a string `text`) is BASE. These three states all mean "all clauses agreed
   and stable" per nda-review-cli's [state-file
   reference](https://github.com/DrBaher/nda-review-cli/blob/main/docs/reference/state-file.md).
2. **Per-round explicit-agreed** (the minimum schema documented in §9.1):
   walk `rounds` from last to first. The first round with `agreed === true`
   wins; its `text` is BASE.
3. **Per-round `clause_status` fallback** (historical compatibility with
   pre-`status` nda-review-cli outputs): walk from last to first. A round
   counts as "agreed" if it has a `clause_status` object and **every value**
   in that object equals the string `"agreed"`. The first such round wins;
   its `text` is BASE.
4. If none of the three tiers finds an agreed round → **exit 2** with:

   ```
   error: --from-negotiation: no agreed round found in <PATH>
          (expected top-level status: "converged" | "signed_off" | "finalized",
           or a round with agreed: true,
           or a round with clause_status all "agreed")
   ```

Tier 1 was added in v0.1.1 as the authoritative reading. Tiers 2 and 3 are
kept because tier 2 is the minimum schema documented in §9.1 (used by
synthetic tests and any non-nda-review-cli caller), and tier 3 supports
legacy state files emitted before `nda-review-cli` computed the top-level
status. **Convergence on a single signal** (and removal of the now-
redundant tiers) is tracked under CHANGELOG.md "Reconciliation debt".

### 9.3. Hash-chain verification (out of scope for v1)

`compare-cli` v1 does **not** verify the negotiation's hash chain.
Verification is nda-review-cli's job (`negotiate validate`). If a user wants
to verify the chain before reading the latest-agreed text, they pipe through
`negotiate validate` first. This avoids importing nda-review-cli's
verification code or re-implementing it in Node.

If the JSON is malformed (not parseable, no `rounds[]`, all rounds missing
`text`), exit 1 with a clear error.

---

## 10. `--json` output shape (stable across minor versions)

```json
{
  "ok": true,
  "exit_class": "clean",
  "exit_code": 0,
  "base":      { "path": "negotiated.docx",   "format": "docx", "lossiness": "none",      "clauses_total": 12 },
  "candidate": { "path": "ready-to-sign.pdf", "format": "pdf",  "lossiness": "extracted", "clauses_total": 12 },
  "summary": {
    "clauses_total": 12,
    "clauses_changed": 2,
    "clauses_moved": 1,
    "clauses_added": 0,
    "clauses_removed": 0,
    "differences": {
      "cosmetic": 4,
      "typographic": 1,
      "substantive": 3,
      "added": 0,
      "removed": 0,
      "moved": 1
    }
  },
  "differences": [
    {
      "class": "substantive",
      "clause_title": "Term and Survival",
      "clause_index_base": 7,
      "clause_index_candidate": 7,
      "base":      "<original body text>",
      "candidate": "<changed body text>"
    },
    {
      "class": "moved",
      "clause_title": "Notices",
      "clause_index_base": 9,
      "clause_index_candidate": 4,
      "base":      "<body text>",
      "candidate": "<body text>"
    }
  ],
  "warnings": [
    "candidate was extracted from PDF; layout-sensitive differences may surface as false positives"
  ]
}
```

### 10.1. Stable keys

The following keys are stable across v1.x; renaming or removing any of them
is a major-version change:

- Top: `ok`, `exit_class`, `exit_code`, `base`, `candidate`, `summary`, `differences`, `warnings`.
- `base` / `candidate`: `path`, `format`, `lossiness`, `clauses_total`, `track_changes` (added in v0.3.0; `.docx` TC metadata, flat list of `{op, text, author, date}`, always present, empty `[]` when input isn't `.docx` or has no TC; informational only — see §10.9).
- `summary`: `clauses_total`, `clauses_changed`, `clauses_moved`, `clauses_added`, `clauses_removed`, `differences` (sub-object with the six class counts), `suppressed_by_filter` (count of differences dropped by `--only-clauses` / `--ignore-clauses`; added in v0.2.0).
- `differences[].`: `class`, `clause_title`, `clause_index_base`, `clause_index_candidate`, `base`, `candidate`.

### 10.2. `exit_class` enumeration

One of: `"clean"`, `"cosmetic"`, `"typographic"`, `"substantive"`, `"moved"`.
The mapping to `exit_code` is: `clean→0`, `cosmetic→3`, `typographic→3`,
`substantive→2`, `moved→4`. Under `--strict`, `typographic→2`; under
`--strict-cosmetic`, `cosmetic→2`.

### 10.3. `clause_index_*` when one side is missing

For `class: "added"`, `clause_index_base` is `null`. For `class: "removed"`,
`clause_index_candidate` is `null`. Indices are **1-based** (matching how a
human counts clauses).

### 10.4. `differences[]` ordering

Sorted by `clause_index_base` ascending (with `null`s last). Tie-broken by
`clause_index_candidate` ascending. Deterministic across runs.

---

### 10.5. Clause filters (`--only-clauses` / `--ignore-clauses`)

Added in v0.2.0. Both flags accept a comma-separated list of
case-insensitive substring patterns. Patterns match against the
**normalized** clause title (numbering stripped via `normalizeTitle`).
Application order:

1. `--only-clauses` (if set): keep only differences whose clause title
   matches at least one pattern.
2. `--ignore-clauses` (if set): from the surviving set, drop any whose
   clause title matches at least one pattern.

The result is what feeds into exit-code classification *and* the
`differences[]` array in `--json` / `--sarif`. The dropped count is
reported as `summary.suppressed_by_filter`. The filters do **not** alter
the per-side `clauses_total` (which still counts the structural totals).

### 10.6. `--require-signoffs`

Added in v0.2.0. Use only with `--from-negotiation`. The
`negotiation.json` file must have a top-level `signoffs` object with
**both** `signoffs.a` and `signoffs.b` as non-empty strings (per
nda-review-cli's [state-file
reference](https://github.com/DrBaher/nda-review-cli/blob/main/docs/reference/state-file.md)).
If either is missing or empty: exit 2 with the message
`--require-signoffs: <path> is not signed off by both parties`.

Default behavior (without the flag) is unchanged — the reader returns
the agreed text regardless of signoff state.

### 10.7. `--sarif` output (SARIF v2.1.0)

Added in v0.2.0. `--sarif` is mutually exclusive with `--json`. Output
is a single SARIF v2.1.0 document on stdout. Each `differences[]` entry
becomes one `runs[0].results[i]` with:

- `ruleId`: `compare-cli.<class>` (e.g. `compare-cli.substantive`).
- `level`: `error` for `substantive`; `warning` for `cosmetic` /
  `typographic`; `note` for `added` / `removed` / `moved`.
- `message.text`: `[<class>] <clause_title> — <short summary>`.
- `locations[0]`: the candidate file (`file://` URI for absolute paths).
- `relatedLocations[0]` (when applicable): the base file.

Run-level metadata:

- `tool.driver.name`: `compare-cli`.
- `tool.driver.version`: the running version (e.g. `0.2.0`).
- `invocations[0].exitCode`: the compare-cli exit code (0/2/3/4).
- `invocations[0].properties.exit_class`: the exit-class enum value.
- `invocations[0].properties.suppressed_by_filter`: count dropped by clause filters.

Designed for `github/codeql-action/upload-sarif@v3` — substantive
differences surface as inline PR annotations in the GitHub review UI.

### 10.8. `--check`

Added in v0.2.0. Suppresses all output (both stdout and stderr). Implies
`--silent`. The exit code (0/1/2/3/4) is the only output. `--output`
writes are skipped under `--check` (the caller has declared they only
care about the exit code).

### 10.9. `track_changes` (.docx WordprocessingML metadata)

Added in v0.3.0. For each side (`base` and `candidate`), the
`track_changes` field is an array of TC operations parsed from
`word/document.xml`'s `<w:ins>` and `<w:del>` elements, in document
order. Shape per entry:

```json
{ "op": "ins" | "del", "text": "...", "author": "...", "date": "..." }
```

- `op` — `"ins"` (insertion) or `"del"` (deletion).
- `text` — the inserted/deleted text content, with XML entities decoded.
- `author` — value of the `w:author` attribute, or `""` if absent.
- `date` — value of the `w:date` attribute (ISO 8601), or `""` if absent.

**Always present.** Empty `[]` when the input is not `.docx` or has no
TC ops. Consumers should treat missing/empty as "no TC information."

**Informational only in v0.3.x.** TC presence does **not** change
`exit_class` or `differences[]`. The text-diff path remains the source
of truth — `extractDocxText` already includes `<w:ins>` content (it's
part of the final document) and excludes `<w:del>` content (which has
been deleted). TC metadata supplements that with author/date provenance.

A future version may invert this: where both sides have TC, use the TC
records as ground truth and populate `differences[]` from them. That's
a v0.4.0+ change and will bump major if it alters `exit_class` semantics.

Surfaces alongside `track_changes`:
- Human report: a "track-changes (Word):" addendum block summarizing
  insertion / deletion counts and unique authors (when at least one side
  has TC).
- `--why`: a `why: track_changes.base=N track_changes.candidate=M` line
  (when at least one side has non-zero TC).
- `--sarif`: `runs[].invocations[].properties.track_changes_base` and
  `track_changes_candidate` carry the counts.

---

## 11. `--why` output

Same shape as draft-cli's `--why` block — structured key=value lines on
**stderr**, plain text, never colored, never paginated. Always available
unless `--silent` is set.

```
why: input.base=negotiated.docx format=docx lossiness=none clauses=12
why: input.candidate=ready-to-sign.pdf format=pdf lossiness=extracted clauses=12
why: detection.tier=h2
why: alignment.method=lcs.titles
why: classes.cosmetic=4 typographic=1 substantive=3 added=0 removed=0 moved=1
why: exit_class=substantive exit_code=2
why: strict=false strict_cosmetic=false
```

Same `key=value` convention draft-cli uses. Stable line prefixes; ordering is
deterministic.

---

## 12. Error shapes

All error lines go to **stderr**, prefixed `error:`. ANSI red on TTY; honors
`NO_COLOR`/`FORCE_COLOR`. Exit code matches §7.

```
error: input not found: ./negotiated.docx                                  (exit 1)
error: malformed .docx: ./contract.docx (not a valid zip)                  (exit 1)
error: extracted zero characters from ./contract.pdf;
       PDF may be a scanned image without an OCR layer                     (exit 1)
error: --from-negotiation: no agreed round found in ./negotiation.json     (exit 2)
error: both inputs cannot be stdin (-)                                     (exit 1)
error: unknown flag: --typographicc (did you mean --strict-cosmetic?)      (exit 1)
```

Argument-parse errors are exit 1 (I/O class for the purposes of v1; this
matches draft-cli's posture, where arg-parse → `UsageError` → `EXIT.IO`).

---

## 13. Demo mode

`compare --demo` runs a zero-file 30-second first run against two bundled
fixture strings (the negotiated text and a slightly-drifted candidate). Same
posture as draft-cli's `--demo` — no flag needed, no file needed, prints the
report and exits with the demo's natural exit code (which is **2** because
the bundled fixtures have a deliberate substantive change so the demo also
demonstrates the headline exit-code contract).

`compare --demo --json` runs the same comparison in JSON mode.

---

## 14. Out of scope for v1 (deferred — schema is forward-compatible)

The `--json` shape, exit codes, and `negotiation.json` minimum schema are all
designed to extend without breaking.

- **Semantic comparison** (paraphrase, synonym, "at any time" ≡ "from time to
  time"). Would require an LLM tier; defeats determinism. v2 if added must be
  env-gated like draft-cli's T5.
- **N-way diff** (3+ versions, lineage tracking).
- **Track-changes consumption** (Word's TC metadata as ground truth).
- **Inline `.docx` redline output**. That's nda-review-cli's `generate-redlines`.
- **Batch / folder mode** (`compare base.docx received-folder/*.pdf`).
- **Image / signature comparison**.
- **Hash-chain verification** of `negotiation.json` (nda-review-cli's job).
- **Sub-clause / paragraph-level move detection.** v1 moves are detected at
  the clause-title level only.

Forward-compatibility hooks reserved in the spec:

- `differences[]` entries may grow new fields without breaking readers; the
  existing keys (`class`, `clause_title`, `clause_index_base`,
  `clause_index_candidate`, `base`, `candidate`) are stable.
- `summary.differences` may grow new class counts (e.g. `semantic: N`) when
  a future class lands. Readers that sum only the known six will see the
  same number they see today.
- `negotiation.json` reader may grow support for hash-chain verification (a
  `--verify-chain` flag) without changing the resolution rule in §9.2.

---

## 15. Honest things flagged (acknowledged in v1)

These are the design fuzzy points the brief told us to surface. Each is
locked here; reconciliation tracked in CHANGELOG.md.

1. **Clause-detection rule lives in two languages by design.**
   `template-vault-CLI` (Python) is the conceptual home of the H2 +
   bold-prefix + ALL-CAPS rule, but it's a CLI not an importable Node
   library — and forcing a Python runtime on compare-cli users to share
   code would be worse than the duplication. The rule itself is now
   extracted as [docs/clause-detection.md](./docs/clause-detection.md), and
   both repos implement against that spec. Tracked under CHANGELOG.md
   "Reconciliation debt" → coordinate rule changes across both repos and
   bump the spec version in lockstep.
2. **`negotiation.json` reader accepts three signals for back-compat.**
   §9.2 specifies the three-tier resolution: top-level `status: converged`
   (preferred), per-round `agreed: true` (minimum schema), per-round
   `clause_status` all `"agreed"` (historical fallback). Tracked under
   CHANGELOG.md "Reconciliation debt" → collapse to a single signal when
   the suite settles on one schema doc; removal of deprecated tiers will
   require a major bump.
3. **Cosmetic vs typographic boundary.** §5 and §6 fix the rule:
   *cosmetic survives whitespace + Unicode-presentation normalization;
   typographic additionally survives case + number-format normalization*.
   `Acme` vs `ACME` is typographic (case-only); `$1,000` vs `$1000` is
   typographic. `"Acme Corp"` vs `"Acme Corporation"` is substantive
   (different tokens). If a difference doesn't cleanly fall into one of the
   three classes during implementation, **we stop and revise this doc** —
   we don't invent a fourth class quietly.
4. **PDF text extraction is layout-lossy.** §2.2 surfaces a warning whenever
   either side is a `.pdf`. If extraction returns zero characters, §2.1
   says exit 1 with a clear "may be a scanned image" message — never silent
   zero-drift.
5. **Coverage target ≥ 80%.** Same gate as draft-cli's CI. If we can't reach
   80% line cleanly on real test cases, CHANGELOG.md notes which paths are
   uncovered and why (rather than padding with low-value tests).

---

## 16. Locked decisions (audit trail)

| # | Decision | Locked at |
|---|----------|-----------|
| Q1 | Two runtime deps (`jszip`, `pdfjs-dist`); no others. | §1 |
| Q2 | Clause detection: H2 → bold-prefix fallback → ALL-CAPS fallback. Fallbacks only if previous tier returned empty. Mirrors template-vault-cli v0.3.0. | §4.1 |
| Q3 | Synthetic single-clause fallback when no tier matches. | §4.2 |
| Q4 | Cosmetic-normalize = whitespace + Unicode-presentation glyphs. | §5.1 |
| Q5 | Typographic-normalize = cosmetic + lowercase + number-formatting + Oxford comma. | §5.2 |
| Q6 | Three classes (cosmetic, typographic, substantive) + clean + added/removed + moved. No fourth class without a spec bump. | §6 |
| Q7 | Mixed classes within one clause collapse to strongest. | §6 |
| Q8 | Move detection = LCS over normalized clause titles; no fuzzy threshold. | §8.1 |
| Q9 | Move + cosmetic/typographic/substantive collapses to the non-move class. | §8.3 |
| Q10 | Exit codes: 0/1/2/3/4 per §7. | §7 |
| Q11 | `--strict` and `--strict-cosmetic` are independent; pass both for both. | §7.1 |
| Q12 | `negotiation.json` reader supports both minimum (`agreed: true`) and de-facto (`clause_status` all `"agreed"`). | §9.2 |
| Q13 | `--json` keys stable across v1.x. | §10.1 |
| Q14 | `--why` block on stderr, key=value, deterministic order. | §11 |
| Q15 | PDF zero-text extraction is exit 1, not silent zero-drift. | §2.1 |
| Q16 | Hash-chain verification deferred to v2 (nda-review-cli's job). | §9.3 |

---

End of v1 contract. Implementation, tests, and docs must match this file
exactly. Changes to this file require a CHANGELOG.md entry and a minor
version bump (or major if a stable key in §10.1 or an exit code in §7 moves).
