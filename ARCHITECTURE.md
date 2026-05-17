# Architecture

A walk-through of how `compare-cli` is shaped and why. Read this before
contributing — it explains the constraints that drove the design.

## Runtime baseline

Node ≥ 20. The hard pin upward is `pdfjs-dist@^5.7.284`, which declares
`engines.node: ">=22.13.0 || >=24"` but works at runtime on Node 20. We
keep Node 20 in the CI matrix to widen reach; Node 22 is the formally
supported lower bound for the pdfjs path. Node 18 was the original
brief target but cannot satisfy the pdfjs pin; the suite-wide alignment
with sign-cli (which is also on `pdfjs-dist@^5.7.284`) won that
trade-off.

## Single-file CLI

`compare-cli.mjs` is one file. Helpers, detection, classification, the
report builders, and `main()` all live in it. There is no `src/`
directory, no build step, no compiled output. Run it directly:

```sh
node compare-cli.mjs --demo
```

The file is exported as ESM so the test suite can `import` individual
functions. The `if (isMain)` block at the bottom runs `main()` only when
the file is invoked directly, not when imported.

Trade-off: the file is large and you have to scroll. The upside is that
the entire CLI is in one place, has one set of imports, and can be
vendored or audited as a single artifact.

## The pipeline

```
read input(base)        read input(candidate)
       │                        │
       ▼                        ▼
  text + lossiness         text + lossiness
       │                        │
       ▼                        ▼
   detectClauses             detectClauses
   (h2 → bold-prefix →       (same cascade)
    ALL-CAPS → synthetic)
       │                        │
       └────────┬───────────────┘
                ▼
          alignClauses
       (group by normalized title)
                │
                ▼
   per-pair classifyDiff
   (clean / cosmetic / typographic / substantive)
                │
                ▼
          detectMoves
   (LIS over candIdx of pairs sorted by baseIdx)
                │
                ▼
        computeExitClass
   (substantive > strict upgrades > typographic/cosmetic > moved > clean)
                │
                ▼
        buildReportJson
   + formatReportHuman / --json / --output
                │
                ▼
              exit
```

Each phase produces a deterministic output the next phase consumes. The
order is fixed; `runCompare()` in `compare-cli.mjs` orchestrates it.

## Why no LLM tier

draft-cli has a T5 LLM tier as the last resort in a placeholder-detection
cascade. compare-cli deliberately does not. Comparison is deterministic by
nature — given two strings, "are they the same after normalization?" has
exactly one answer. Adding an LLM here would mean "are they *semantically*
the same?" which:

1. Introduces non-determinism. The same `compare A B` could exit 0 one run
   and 2 the next.
2. Defeats the contract. The whole point of a pre-signature gate is that
   it's reproducible — you sign because the bytes match, not because a
   model says they do.

If a semantic comparison mode is added in v2, it must be env-gated the
same way draft-cli's T5 is, and the default mode stays deterministic.

## Two normalization passes, three classes

`classifyDiff(a, b)` returns exactly one of four values: `clean`,
`cosmetic`, `typographic`, `substantive`. The classification is layered:

```
if a === b                                    → clean
else if cosmeticNormalize(a) === cosmeticNormalize(b)        → cosmetic
else if typographicNormalize(a) === typographicNormalize(b)  → typographic
else                                                          → substantive
```

`cosmeticNormalize` is whitespace + Unicode-presentation glyphs (NBSP →
space, curly quotes → straight, em-dash → hyphen, ellipsis → `...`).

`typographicNormalize` builds on cosmetic and additionally lowercases,
removes thousands separators inside numbers, strips `.00` decimal-zero
suffixes, and removes the Oxford comma.

**What's deliberately not normalized** is documented in
[COMPARE_SCHEMA.md §5.3](./COMPARE_SCHEMA.md): singular/plural, tense,
negation, list punctuation. If something is substantive in one normalize
pass it stays substantive — never silently demoted. The locked rules
mean the class boundary doesn't drift with implementation changes.

## Clause detection

`detectClauses(text)` runs a four-tier cascade, returning `{ tier, clauses
}`. The tiers mirror template-vault-cli v0.3.0:

1. **H2** — `^##\s+(.+?)\s*$`
2. **Bold-prefix** — `^\*\*(\d+(?:\.\d+)*\.?\s+.+?)\*\*\s*$`
3. **ALL-CAPS** — lines that pass `isAllCapsHeading`: ≥ 3 chars, ≥ 1
   letter (all uppercase), and either ≥ 2 whitespace-separated tokens or
   one ≥ 4-letter token. Doesn't start with `[`.
4. **Synthetic** — whole document as one clause titled `"Document"`.

**Fallbacks fire only when the previous tier returns empty.** This is the
key constraint from template-vault-cli: you can't have ALL-CAPS lines
shadowing real H2 sections. If H2 finds even one clause, the H2 result is
the answer; ALL-CAPS lines are interpreted as paragraph content.

The synthetic fallback exists so plaintext and unstructured inputs still
compare — the diff degrades to "the whole text differs in these ways"
rather than erroring.

Clause-detection logic is **duplicated** from template-vault-cli pending
its publication. CHANGELOG.md's "Reconciliation debt" section tracks this.

## Alignment

`alignClauses(baseClauses, candClauses)` matches clauses by **normalized
title**, not by position. Two clauses pair if their normalized titles are
equal. Normalization (`normalizeTitle`) strips leading numbering (`1.`,
`1.2`, `1.2.3`), lowercases, collapses whitespace, and trims trailing
punctuation. So `"## 1. Term and Survival"` and `"## Term and Survival"`
align as the same clause.

When the same title appears multiple times on a side (definitions
sections often have multiple `**Definition**` blocks), titles pair in
order: first base "Definition" with first candidate "Definition", second
with second. Clauses without a partner go to `added` or `removed`.

## Move detection (LIS)

`detectMoves(pairs)` runs **after** classification, over the full set of
title pairs (not just clean-body pairs). The algorithm:

1. Sort pairs by `baseIdx` ascending.
2. Compute the longest **strictly increasing subsequence** (LIS) of the
   resulting `candIdx` sequence.
3. Any pair not in the LIS has "moved" — its candidate position is out of
   order relative to its base position.

LIS over `O(n log n)` is short enough to inline (~25 lines).

Move detection is exact, not fuzzy. Either the normalized title appears on
both sides or it doesn't.

**Why over all pairs, not just clean pairs?** Suppose base is
`[A, B, C, D]` and candidate is `[B, A, C, D']` (where `D'` is D with
substantive changes). The pair `{A, B}` swap is detectable only when the
algorithm sees the full ordered set of paired titles. Restricting to
clean-only pairs would miss the swap if the surrounding context contained
any modified body. After the LIS finishes, the `moved` *classification* is
only emitted for clean bodies (per §8.3) — moved + substantive collapses
to substantive in the report.

## Input extraction

### `.docx` via jszip

`extractDocxText(buf)` uses `jszip` to unzip the file, reads
`word/document.xml`, and regex-extracts paragraph text. Same approach as
draft-cli T3:

```js
const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g;
// inside each <w:p>: <w:t>...</w:t> runs
```

The XML surface we care about is narrow enough that regex is robust. We
don't take a full XML parser dependency.

### `.pdf` via pdfjs-dist

`extractPdfText(buf)` uses `pdfjs-dist/legacy/build/pdf.mjs` — the ESM
build that works in Node without DOM polyfills. Per-page extraction with
`page.getTextContent()`, then text items joined with sensible whitespace
based on the per-item `transform[5]` Y coordinate (Y change > 1 unit → new
line).

PDF extraction is **layout-lossy**. The CLI surfaces a warning whenever
either side is a PDF. If extraction returns zero characters (a scanned
image without OCR), the CLI exits 1 with an explicit "scanned image"
message — **never silent zero-drift**. This honesty rule is non-negotiable.

### Markdown / text

Read as UTF-8. No parsing. Pass-through.

### stdin

`-` as either positional means "read from stdin". Both as stdin is a
usage error.

## `negotiation.json` reader

`readNegotiation(path)` reads nda-review-cli's hash-chained state file.
The minimum schema compare-cli requires is documented in
[COMPARE_SCHEMA.md §9.1](./COMPARE_SCHEMA.md):

```json
{ "rounds": [{ "round": 1, "text": "...", "agreed": true }] }
```

For compatibility with the de-facto current nda-review-cli release, which
uses `clause_status` instead of a per-round `agreed` boolean, the reader
also accepts a round where every value in `clause_status` is `"agreed"`.
Explicit `agreed: true` wins over the fallback.

The reader does **not** verify the hash chain (that's nda-review-cli's
`negotiate validate`). It walks rounds from last to first; first agreed
wins. No agreed round → exit 2.

## ANSI color

`paint()` and `colorEnabled()` honor:

- `NO_COLOR` env (any non-empty value → off, per https://no-color.org/)
- `FORCE_COLOR` env (any non-empty value → on)
- Otherwise: on iff the target stream `isTTY`.

Color codes go to **stderr** for warnings and **stdout** for the report.
`--json` output is always plain so it pipes cleanly into downstream tools.

## Test layout

```
tests/
  _helpers.mjs          — Shared utilities: CaptureStream, runMain,
                          makeDocx (via jszip), makePdf (hand-built minimal
                          PDF with byte-offset xref so pdfjs can parse it).
  fixtures/             — Reserved for future on-disk fixtures.
  test_args.mjs         — parseArgs + UsageError.
  test_clauses.mjs      — H2 / bold-prefix / ALL-CAPS / synthetic cascade,
                          isAllCapsHeading rule, normalizeTitle.
  test_normalize.mjs    — cosmeticNormalize + typographicNormalize rules,
                          including what's deliberately not normalized.
  test_classify.mjs     — classifyDiff per-clause class assignment.
  test_align_moves.mjs  — alignClauses + detectMoves + compareDocuments
                          end-to-end (incl. move + content-change).
  test_exit.mjs         — Exit code precedence, --strict, --strict-cosmetic.
  test_extract.mjs      — .docx / .pdf / .md / .txt / stdin extraction,
                          cross-format compare, malformed inputs, scanned-PDF.
  test_negotiation.mjs  — --from-negotiation minimum schema +
                          clause_status fallback + no-agreed-round path.
  test_output.mjs       — --json shape, --why, --silent, --output, color
                          (NO_COLOR / FORCE_COLOR), PDF warnings.
  test_modes.mjs        — --demo, --completion, clause-aware grouping.
```

One concern per file. Run with `node --test tests/test_*.mjs`. Coverage
with `node --test --experimental-test-coverage tests/test_*.mjs`. Target:
≥ 80% line on `compare-cli.mjs`. Current: 98.59%.

The PDF helper (`makePdf` in `_helpers.mjs`) builds minimal Type1
Helvetica-only PDFs in memory with correctly-computed byte offsets in the
xref table, so pdfjs-dist can parse them. This lets the test suite produce
PDF fixtures without adding a writer dependency.

## Forward-compatibility hooks

- `differences[]` entries may grow new fields without breaking readers;
  the existing keys (`class`, `clause_title`, `clause_index_base`,
  `clause_index_candidate`, `base`, `candidate`) are stable.
- `summary.differences` may grow new class counts (e.g. `semantic: N`)
  when a future class lands. Readers that sum only the known six will
  see the same number they see today.
- `negotiation.json` reader may grow support for hash-chain verification
  (a `--verify-chain` flag) without changing the resolution rule in §9.2.

These hooks are reserved but unused in v1. Adding them in v2 will not
break existing v1 consumers.
