// Clause detection: H2 → bold-prefix → ALL-CAPS → synthetic fallback
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectClauses, isAllCapsHeading, normalizeTitle } from "../compare-cli.mjs";

test("H2 detection finds clauses by ## headers", () => {
  const text = `## Purpose

Some purpose text.

## Term

Term text.`;
  const { tier, clauses } = detectClauses(text);
  assert.equal(tier, "h2");
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].title, "Purpose");
  assert.equal(clauses[0].body, "Some purpose text.");
  assert.equal(clauses[1].title, "Term");
  assert.equal(clauses[1].body, "Term text.");
});

test("H2 detection numbered headers preserve their title", () => {
  const text = `## 1. Purpose

Body 1.

## 2.1 Term

Body 2.`;
  const { tier, clauses } = detectClauses(text);
  assert.equal(tier, "h2");
  assert.equal(clauses[0].title, "1. Purpose");
  assert.equal(clauses[1].title, "2.1 Term");
});

test("bold-prefix fallback fires only when H2 returns empty", () => {
  const text = `Some preamble.

**1. Purpose**

Body 1.

**2. Term**

Body 2.`;
  const { tier, clauses } = detectClauses(text);
  assert.equal(tier, "bold-prefix");
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].title, "1. Purpose");
});

test("ALL-CAPS fallback fires only when previous tiers return empty", () => {
  const text = `Some preamble paragraph.

CONFIDENTIALITY OBLIGATIONS

The receiving party agrees to hold information in confidence.

NON-COMPETE

The parties shall not compete for two years.`;
  const { tier, clauses } = detectClauses(text);
  assert.equal(tier, "all-caps");
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].title, "CONFIDENTIALITY OBLIGATIONS");
});

test("synthetic single-clause fallback when no tier matches", () => {
  const text = `Just a paragraph of running text with no structure.`;
  const { tier, clauses } = detectClauses(text);
  assert.equal(tier, "synthetic");
  assert.equal(clauses.length, 1);
  assert.equal(clauses[0].title, "Document");
  assert.equal(clauses[0].body, text);
});

test("H2 wins over bold-prefix and ALL-CAPS even when both are present", () => {
  const text = `## Real H2

H2 body.

**1. Pretend numbered**

Bold body.

ALL CAPS HEADING

Caps body.`;
  const { tier, clauses } = detectClauses(text);
  assert.equal(tier, "h2");
  assert.equal(clauses.length, 1);
});

test("isAllCapsHeading rejects short, all-lower, and bracketed lines", () => {
  assert.equal(isAllCapsHeading("OK"), false);             // < 3 chars
  assert.equal(isAllCapsHeading("hello"), false);          // not caps
  assert.equal(isAllCapsHeading("[BRACKETED]"), false);    // bracketed
  assert.equal(isAllCapsHeading("OR"), false);             // single short token
  assert.equal(isAllCapsHeading("WORD"), true);            // single long token
  assert.equal(isAllCapsHeading("TWO WORDS"), true);
  assert.equal(isAllCapsHeading("CONFIDENTIALITY OBLIGATIONS"), true);
  assert.equal(isAllCapsHeading("Mixed CASE Heading"), false);
  assert.equal(isAllCapsHeading("123 456"), false);        // no letters
});

test("normalizeTitle strips numbering, lowercases, collapses whitespace, trims punct", () => {
  assert.equal(normalizeTitle("1. Term and Survival"), "term and survival");
  assert.equal(normalizeTitle("2.1  Notices"), "notices");
  assert.equal(normalizeTitle("Term and Survival"), "term and survival");
  assert.equal(normalizeTitle("Notices:"), "notices");
  assert.equal(normalizeTitle("  TERM   "), "term");
});

test("normalizeTitle aligns numbered and unnumbered variants", () => {
  // The detectClauses pipeline passes the matched title text only (without
  // the leading '## ' markdown prefix), so the alignment we care about is
  // between e.g. '1. Term' and 'Term'.
  assert.equal(normalizeTitle("1. Term"), normalizeTitle("Term"));
});

test("H2 body extends to next H2 or EOF", () => {
  const text = `## A

Line 1 of A.
Line 2 of A.

## B

Line 1 of B.`;
  const { clauses } = detectClauses(text);
  assert.equal(clauses[0].body, "Line 1 of A.\nLine 2 of A.");
  assert.equal(clauses[1].body, "Line 1 of B.");
});

test("CRLF line endings normalized", () => {
  const text = "## A\r\nBody A.\r\n## B\r\nBody B.";
  const { clauses } = detectClauses(text);
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].body, "Body A.");
});

test("bold-prefix only matches numbered prefix, not generic bold", () => {
  const text = `**Just bold text**

Body.

## Real H2

Real body.`;
  const { tier, clauses } = detectClauses(text);
  // **Just bold text** has no numbered prefix, so bold-prefix tier returns
  // empty. But H2 fires first anyway.
  assert.equal(tier, "h2");
  assert.equal(clauses.length, 1);
});

// ---------------------------------------------------------------------------
// Rule golden — pins the exact behavior specified in docs/clause-detection.md
// (rule v1.0). If any of these assertions break, the spec doc version must
// bump and template-vault-CLI's equivalent test must be updated in lockstep.
// ---------------------------------------------------------------------------

test("rule golden: H2 regex — `##Title` (no space) does NOT match", () => {
  // Tier 1 falls through; bold-prefix and ALL-CAPS also miss → synthetic.
  const { tier, clauses } = detectClauses("##Title\n\nBody.");
  assert.equal(tier, "synthetic");
  assert.equal(clauses[0].title, "Document");
});

test("rule golden: H2 regex — trims trailing whitespace from title", () => {
  const { clauses } = detectClauses("## Purpose   \n\nBody.");
  assert.equal(clauses[0].title, "Purpose");
});

test("rule golden: bold-prefix regex — accepts `**N. Title**`, `**N.M Title**`, `**N. Title.**`", () => {
  const text = "**1. A**\n\nx.\n\n**2.3 B**\n\ny.\n\n**4. C.**\n\nz.";
  const { tier, clauses } = detectClauses(text);
  assert.equal(tier, "bold-prefix");
  assert.equal(clauses.length, 3);
  assert.equal(clauses[0].title, "1. A");
  assert.equal(clauses[1].title, "2.3 B");
  assert.equal(clauses[2].title, "4. C.");
});

test("rule golden: bold-prefix regex — rejects `**Purpose**` (no number)", () => {
  // Tier 2 returns empty → falls to ALL-CAPS, which also misses → synthetic.
  const { tier } = detectClauses("**Purpose**\n\nBody.");
  assert.equal(tier, "synthetic");
});

test("rule golden: bold-prefix regex — rejects `**1.**` (no title after number)", () => {
  const { tier } = detectClauses("**1.**\n\nBody.");
  assert.equal(tier, "synthetic");
});

test("rule golden: isAllCapsHeading — `1. DEFINITIONS` is a match (digits + letters)", () => {
  // Digits and `.` are non-letter chars; the letters in DEFINITIONS are all
  // uppercase, and the two-token rule applies.
  assert.equal(isAllCapsHeading("1. DEFINITIONS"), true);
});

test("rule golden: isAllCapsHeading — single-token rule needs ≥4 letters", () => {
  assert.equal(isAllCapsHeading("AB"), false);   // 2 letters
  assert.equal(isAllCapsHeading("ABC"), false);  // 3 letters (1 token)
  assert.equal(isAllCapsHeading("ABCD"), true);  // 4 letters (1 token) — boundary
  assert.equal(isAllCapsHeading("A.B"), false);  // 2 letters even with punctuation
});

test("rule golden: tier precedence — H2 > bold-prefix > ALL-CAPS > synthetic", () => {
  // Strict cascade: each later tier suppressed when earlier produces results.
  assert.equal(detectClauses("## H2\n\nbody").tier, "h2");
  assert.equal(detectClauses("**1. B**\n\nbody").tier, "bold-prefix");
  assert.equal(detectClauses("CAPS WORDS\n\nbody").tier, "all-caps");
  assert.equal(detectClauses("plain text").tier, "synthetic");
});

test("rule golden: title-to-body — content before first title is discarded", () => {
  const text = "preamble line\n\n## First\n\nfirst body.\n\n## Second\n\nsecond body.";
  const { clauses } = detectClauses(text);
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0].title, "First");
  // "preamble line" must NOT appear in any clause body.
  assert.equal(clauses[0].body.includes("preamble"), false);
  assert.equal(clauses[1].body.includes("preamble"), false);
});

test("rule golden: title-to-body — title lines are not part of any body", () => {
  const { clauses } = detectClauses("## A\nA body.\n## B\nB body.");
  // Title lines themselves never appear inside a body.
  assert.equal(clauses[0].body, "A body.");
  assert.equal(clauses[1].body, "B body.");
});

test("rule golden: synthetic body is the whole input, trimmed", () => {
  const { tier, clauses } = detectClauses("   plain text body   ");
  assert.equal(tier, "synthetic");
  assert.equal(clauses[0].body, "plain text body");
});
