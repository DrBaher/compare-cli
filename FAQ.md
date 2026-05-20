# FAQ

## Why no LLM tier?

Comparison is deterministic by nature. The whole point of a pre-signature
gate is that it's reproducible — you sign because the bytes match, not
because a model says they do. Adding an LLM would mean the same
`compare A B` could exit 0 one run and 2 the next.

If a semantic-comparison mode lands in v2, it must be env-gated (opt-in
the same way draft-cli's T5 LLM tier is) so the default stays
deterministic.

## Why are `$1,000` vs `$1000` and `Acme` vs `ACME` only typographic, not substantive?

Because in real-world contracts, these are presentation differences, not
agreement changes. Treating them as exit 2 would generate so much noise
that the headline "exit 2 = do not sign" signal would lose its meaning.

If your domain is one where `$1,000` vs `$1000` *is* a meaningful
difference (financial term sheets, accounting documents), pass `--strict`
to upgrade typographic to substantive.

## Why are singular/plural / tense / negation always substantive?

Because in real-world contracts they almost always change the agreement.
"obligation" vs "obligations" can change which clause survives termination.
"will" vs "will not" reverses an entire indemnification. "agreed" vs
"agree" can change which past commitment binds you.

The CLI deliberately doesn't normalize these away. See
[COMPARE_SCHEMA.md §5.3](./COMPARE_SCHEMA.md).

## What's the boundary between cosmetic and typographic?

- **cosmetic** = differences that survive whitespace + Unicode-presentation
  normalization. Curly vs straight quotes, em-dash vs hyphen, NBSP vs
  space, ellipsis vs `...`, line wraps, trailing whitespace.
- **typographic** = differences that additionally survive case +
  number-formatting + Oxford comma normalization. `Acme` vs `ACME`,
  `$1,000` vs `$1000`, `5.0%` vs `5%`, `a, b, and c` vs `a, b and c`.

If a difference doesn't cleanly fall into one of the three classes during
implementation, that's flagged in COMPARE_SCHEMA.md as an honest
acknowledgment — we don't invent a fourth class quietly.

## My PDF reports "extracted zero characters". What now?

pdfjs-dist couldn't extract any text from the file. Two common causes:

1. **The PDF is a scan, not text.** Run it through OCR first
   (`ocrmypdf input.pdf output.pdf` is the easiest path), then re-run
   compare against the OCR'd file.
2. **The PDF is encrypted or password-protected.** compare-cli doesn't
   handle decryption; decrypt first with a separate tool.

The CLI exits 1 here rather than silently reporting zero drift — that's
the right failure for a pre-signature gate.

## Why is `.docx` extraction high-fidelity but `.pdf` extraction "lossy"?

`.docx` is a zip of XML. Paragraph text lives in well-defined `<w:t>`
elements. The CLI reads them in document order and concatenates — no
layout reconstruction needed.

`.pdf` is a page-coordinates format. The PDF spec doesn't preserve
"this is a paragraph" or "this is a clause heading" semantics; we have to
reconstruct line breaks from Y coordinates. That reconstruction is
heuristic and can lose subtle spacing. When either side is a PDF the CLI
surfaces a warning so you know to weigh false positives carefully.

## How does compare-cli handle duplicate clause titles?

When the same normalized title appears multiple times on a side (e.g. two
"Definitions" blocks), titles pair in order: first base "Definitions"
with first candidate "Definitions", second with second. Unpaired clauses
go to `added` or `removed`.

This is conservative — if you have duplicated titles, the alignment may
not match your intuition. Renaming to "Definitions — Persons" and
"Definitions — Confidential Information" is the cleanest fix.

## Does compare-cli verify the `negotiation.json` hash chain?

No. That's [nda-review-cli](https://github.com/DrBaher/nda-review-cli)'s
`negotiate validate`. compare-cli reads the chain for its text but
doesn't verify it. If you need integrity guarantees, run
`nda-review-cli negotiate validate` first.

A `--verify-chain` flag is reserved for v2.

## Why does `--demo` exit 2 instead of 0?

Because the bundled fixtures contain a deliberate substantive change
(the Term clause shifts from "two (2) years" to "three (3) years"). This
lets `--demo` demonstrate the headline contract — exit 2 = do not sign —
not just that the bin runs.

## How does compare-cli handle Track Changes in `.docx`?

It doesn't. v1 reads the resulting text only. If your `.docx` has
unresolved Track Changes, accept or reject them in Word before passing
to compare. This is documented as out-of-scope in
[COMPARE_SCHEMA.md §14](./COMPARE_SCHEMA.md).

## How does compare-cli handle plain-text (no clauses)?

If no detection tier matches (no H2, no `**N. Title**`, no ALL-CAPS
headings), the CLI wraps the whole document as one synthetic clause
titled `"Document"` and compares its body. The diff degrades to "the
whole text differs in these ways" rather than erroring.

## Why Node.js instead of Python?

To match the contract-ops suite's JavaScript lane.
[draft-cli](https://github.com/DrBaher/draft-cli),
[docx2pdf-cli](https://github.com/DrBaher/docx2pdf-cli), and
[sign-cli](https://github.com/DrBaher/sign-cli) are Node; sharing a
runtime, package manager, and install path keeps the suite cohesive.

## Why exactly two runtime deps?

`jszip` for `.docx` and `pdfjs-dist` for `.pdf`. Both are already used
elsewhere in the suite (draft-cli for jszip, sign-cli for pdfjs-dist) so
adding compare-cli doesn't introduce new vendor surface. Everything else
— clause detection, LCS, diff classification, ANSI color, argv parsing —
is hand-rolled stdlib.

## How do I extend the clause detection rule for my templates?

v1 has the three-tier cascade locked. If your templates use a custom
heading style that doesn't match H2, numbered bold-prefix, or ALL-CAPS,
the synthetic single-clause fallback fires and the diff degrades to
whole-document.

A `--clause-rule` extension hook is plausible for v2 but isn't shipped
today. The cleanest current path is to convert your templates to use H2
headings.
