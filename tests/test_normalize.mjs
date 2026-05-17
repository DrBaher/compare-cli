// cosmeticNormalize / typographicNormalize — the rules that define the
// three difference classes (§5 of COMPARE_SCHEMA.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosmeticNormalize, typographicNormalize } from "../compare-cli.mjs";

test("cosmetic: CRLF and CR collapse to LF then whitespace runs collapse", () => {
  assert.equal(cosmeticNormalize("a\r\nb"), "a b");
  assert.equal(cosmeticNormalize("a\rb"), "a b");
  assert.equal(cosmeticNormalize("a  \n  b"), "a b");
});

test("cosmetic: NBSP and other Unicode spaces -> ASCII space", () => {
  assert.equal(cosmeticNormalize("a b"), "a b");
  assert.equal(cosmeticNormalize("a b"), "a b");
});

test("cosmetic: curly quotes -> straight", () => {
  assert.equal(cosmeticNormalize("‘hi’"), "'hi'");
  assert.equal(cosmeticNormalize("“hi”"), '"hi"');
});

test("cosmetic: em-dash and en-dash -> hyphen", () => {
  assert.equal(cosmeticNormalize("a—b"), "a-b");
  assert.equal(cosmeticNormalize("a–b"), "a-b");
});

test("cosmetic: ellipsis -> ...", () => {
  assert.equal(cosmeticNormalize("a…"), "a...");
});

test("cosmetic: leading/trailing whitespace trimmed", () => {
  assert.equal(cosmeticNormalize("   hello world   "), "hello world");
});

test("cosmetic-equal pairs", () => {
  assert.equal(cosmeticNormalize("Term: 2  years"), cosmeticNormalize("Term: 2 years"));
  assert.equal(cosmeticNormalize("don’t"), cosmeticNormalize("don't"));
  assert.equal(cosmeticNormalize("a—b"), cosmeticNormalize("a-b"));
});

test("cosmetic does NOT lowercase", () => {
  assert.notEqual(cosmeticNormalize("Acme"), cosmeticNormalize("ACME"));
});

test("cosmetic does NOT remove thousands separators", () => {
  assert.notEqual(cosmeticNormalize("$1,000"), cosmeticNormalize("$1000"));
});

test("typographic: lowercases", () => {
  assert.equal(typographicNormalize("Acme"), typographicNormalize("ACME"));
  assert.equal(typographicNormalize("Hello World"), "hello world");
});

test("typographic: thousands separators removed", () => {
  assert.equal(typographicNormalize("$1,000"), typographicNormalize("$1000"));
  assert.equal(typographicNormalize("1,234,567"), typographicNormalize("1234567"));
});

test("typographic: .00 decimal-zero suffix removed", () => {
  assert.equal(typographicNormalize("$1000.00"), typographicNormalize("$1000"));
  assert.equal(typographicNormalize("5.0%"), typographicNormalize("5%"));
});

test("typographic: Oxford comma flip", () => {
  assert.equal(typographicNormalize("a, b, and c"), typographicNormalize("a, b and c"));
  assert.equal(typographicNormalize("x, y, or z"), typographicNormalize("x, y or z"));
});

test("typographic builds on cosmetic", () => {
  assert.equal(typographicNormalize("“ACME”"), typographicNormalize('"acme"'));
});

test("substantive differences survive both passes", () => {
  assert.notEqual(cosmeticNormalize("two years"), cosmeticNormalize("three years"));
  assert.notEqual(typographicNormalize("two years"), typographicNormalize("three years"));
  // singular/plural
  assert.notEqual(typographicNormalize("obligation"), typographicNormalize("obligations"));
  // negation
  assert.notEqual(typographicNormalize("will not"), typographicNormalize("will"));
});

test("typographic does NOT touch sentence-meaningful punctuation", () => {
  // Commas separating list items (without Oxford pattern) stay
  assert.notEqual(typographicNormalize("a; b"), typographicNormalize("a, b"));
  // Periods inside lists stay
  assert.notEqual(typographicNormalize("a. b"), typographicNormalize("a b"));
});
