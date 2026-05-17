// Per-clause classification (clean/cosmetic/typographic/substantive)
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDiff } from "../compare-cli.mjs";

test("byte-identical → clean", () => {
  assert.equal(classifyDiff("Term: 2 years", "Term: 2 years"), "clean");
});

test("whitespace-only diff → cosmetic", () => {
  assert.equal(classifyDiff("Term: 2  years", "Term: 2 years"), "cosmetic");
});

test("curly-quote diff → cosmetic", () => {
  assert.equal(classifyDiff("don’t", "don't"), "cosmetic");
});

test("em-dash diff → cosmetic", () => {
  assert.equal(classifyDiff("a—b", "a-b"), "cosmetic");
});

test("case-only diff → typographic", () => {
  assert.equal(classifyDiff("Acme", "ACME"), "typographic");
});

test("thousands-separator diff → typographic", () => {
  assert.equal(classifyDiff("$1,000", "$1000"), "typographic");
});

test("Oxford-comma diff → typographic", () => {
  assert.equal(classifyDiff("a, b, and c", "a, b and c"), "typographic");
});

test("word change → substantive", () => {
  assert.equal(classifyDiff("two years", "three years"), "substantive");
});

test("negation flip → substantive", () => {
  assert.equal(classifyDiff("will not disclose", "will disclose"), "substantive");
});

test("singular/plural → substantive", () => {
  assert.equal(classifyDiff("obligation", "obligations"), "substantive");
});

test("mixed: word change plus cosmetic → substantive (strongest wins)", () => {
  // The brief locks: §6 "Mixed classes within one clause collapse to the
  // strongest". A single classify call applied to a body always returns one
  // class — and since substantive doesn't normalize away, the call returns
  // substantive even if cosmetic noise is also present.
  assert.equal(classifyDiff("don’t  exceed two years", "don't exceed three years"), "substantive");
});
