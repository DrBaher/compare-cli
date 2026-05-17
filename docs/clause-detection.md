# Clause Detection Rule (v1)

This document specifies the **clause-detection cascade** used by both
[`compare-cli`](https://github.com/DrBaher/compare-cli) (Node.js) and
[`template-vault-CLI`](https://github.com/DrBaher/template-vault-CLI) (Python).
The rule is language-agnostic; the two CLIs each implement it natively because
inter-language library reuse would force a Python runtime dependency on Node
users (and vice versa).

This file is the **source of truth**. When the rule changes, both
implementations must change in lockstep and the version on the title line below
must bump.

> **Rule version: 1.0** (mirrors template-vault-CLI v0.3.0 behavior, as of
> compare-cli v0.1.1).

---

## 1. The cascade

Run four tiers in order. The first tier that returns a non-empty list of
clauses wins. Fallbacks fire **only** when the previous tier returns empty —
not when it produces a "weak" result. Once a tier wins, the lines other tiers
would match against are treated as paragraph content.

### Tier 1 — H2 (`## Title`)

Match each line against:

```
^##\s+(.+?)\s*$
```

The captured group (trimmed) is the clause title.

### Tier 2 — Bold-prefix numbered (`**1. Title**`)

Match each line against:

```
^\*\*(\d+(?:\.\d+)*\.?\s+.+?)\*\*\s*$
```

The captured group (trimmed) is the clause title. Examples that match:
`**1. Purpose**`, `**2.3 Term**`, `**4. Confidentiality.**`. Examples that
don't match: `**Purpose**` (no number), `**1.**` (no title text after the
number).

### Tier 3 — ALL-CAPS heading

A line is an ALL-CAPS heading if `isAllCapsHeading(trimmed_line)` returns true:

1. At least 3 characters.
2. Doesn't start with `[`.
3. Contains at least one ASCII letter.
4. Every ASCII letter in the string is uppercase. Non-letter characters are
   ignored (digits, punctuation, whitespace OK).
5. Either: tokens (split on whitespace) ≥ 2, OR a single token whose
   letters-only form has ≥ 4 letters.

Examples that match: `CONFIDENTIALITY OBLIGATIONS`, `TERM`, `1. DEFINITIONS`,
`SECTION A`. Examples that don't: `Title` (mixed case), `OK` (single token, 2
letters), `[BRACKETED]` (starts with `[`), `123` (no letters).

The matched line (trimmed) is the clause title.

### Tier 4 — Synthetic fallback

If none of the above tiers produced any clauses, the entire document becomes
one clause titled `"Document"` with the whole text as its body. This lets
downstream comparison still run on plaintext or unstructured input.

---

## 2. Title-to-body resolution

For tiers 1–3, once title lines are located:

1. Each clause body is the lines **between** its title and the next title
   (exclusive of both).
2. Body text is joined with `\n` and trimmed.
3. Title lines themselves are not part of any clause body.
4. Content before the first title is discarded (not assigned to a clause).
5. Content after the last title belongs to the last clause.

---

## 3. Why a strict cascade

The biggest failure mode of pattern-based clause detection is **false-positive
ALL-CAPS lines inside a structured document**: section names, defined terms,
emphasis. If a document has real `## H2` headings AND an emphasized
`CONFIDENTIAL` label in the body, the ALL-CAPS tier would over-segment the
document if it ran in parallel.

The strict cascade prevents this: if H2 finds even one clause, ALL-CAPS lines
become paragraph content. Same for bold-prefix vs ALL-CAPS. This produces
fewer, larger clauses, which is the right bias for clause-level diff (over-
segmentation creates spurious "added"/"removed" pairs).

---

## 4. Inputs not yet covered by v1

- Hierarchical structure (sub-clauses, schedules, exhibits) — v1 produces a
  flat clause list. Schedules embedded in the body become long paragraphs.
- Roman-numeral titles (`I. Purpose`, `II. Term`) — not matched. Documents
  using Roman numerals as the sole structure fall through to the synthetic
  tier.
- Line-broken titles (a title that wraps to two lines) — only the first line
  matches; the rest is paragraph content.

These are intentional v1 limits. v2 may extend the tiers; this doc bumps
version when it does.

---

## 5. Implementations

| Repo | File | Function |
|---|---|---|
| compare-cli | `compare-cli.mjs` | `detectClauses`, `isAllCapsHeading`, `detectByTitleLines` |
| template-vault-CLI | `template_vault_cli.py` | (Python equivalents — see that repo's source) |

**When this doc changes**, open coordinated PRs in both repos. The golden
test in compare-cli (`tests/test_clauses.mjs` → "clause-detection rule golden"
suite) pins the exact tier precedence and corner cases listed here; a
template-vault-CLI equivalent should pin the same.

---

## 6. Changelog

- **1.0** (2026-05-17, with compare-cli v0.1.1) — initial extracted spec.
  Codifies the cascade that was already implemented in compare-cli v0.1.0 and
  template-vault-CLI v0.3.0. No behavior change.
