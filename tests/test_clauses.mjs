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
