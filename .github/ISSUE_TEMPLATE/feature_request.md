---
name: Feature request
about: A new flag, output mode, or behavior change
title: "feat: "
labels: enhancement
---

## The use case

<!-- One paragraph. What workflow does this enable? Who needs it? -->

## Proposed shape

<!-- How would you invoke it? What's the flag name, the input, the
output? Example commands or JSON payloads are gold. -->

```sh
compare base.docx cand.docx --new-flag ARGS
```

## Why compare-cli specifically

<!-- This tool's contract is *deterministic, clause-aware drift between
two contract versions*. Features that drift from that contract (LLM tier,
batch mode, image comparison, hash-chain validation) are deliberately
out of scope. If your idea is in tension with the contract, say why it
should still land. See CHANGELOG.md "Deferred candidates" for items
already considered. -->

## Trade-offs

<!-- Anything this would break, slow down, or complicate? Any new
runtime dependencies needed? (The CLI ships with exactly two: jszip and
pdfjs-dist. Adding a third is a real decision.) -->

## Related

<!-- Other tools in the suite that might already cover this:
- draft-cli (template filling, parties.json)
- nda-review-cli (negotiation state, redlines, hash chains)
- sign-cli (PAdES signatures, RFC 3161)
- template-vault-CLI (clause vaulting, swap/upgrade)
- docx2pdf-cli (DOCX → PDF) -->
