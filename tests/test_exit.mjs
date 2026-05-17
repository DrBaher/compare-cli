// Exit code spectrum (§7) including --strict / --strict-cosmetic
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXIT, main, computeExitClass } from "../compare-cli.mjs";
import { runMain, tmp, makeFile } from "./_helpers.mjs";

const TEXT_BASE = `## 1. Purpose

Purpose body.

## 2. Term

The term is $1,000 over two years.
`;

const TEXT_COSMETIC = `## 1. Purpose

Purpose body.

## 2. Term

The   term  is $1,000   over two years.
`;

const TEXT_TYPOGRAPHIC = `## 1. Purpose

Purpose body.

## 2. Term

The term is $1000 over two years.
`;

const TEXT_SUBSTANTIVE = `## 1. Purpose

Purpose body.

## 2. Term

The term is $1,000 over three years.
`;

const TEXT_ADDED = `## 1. Purpose

Purpose body.

## 2. Term

The term is $1,000 over two years.

## 3. Notices

Notice text.
`;

test("computeExitClass: all clean → 0", () => {
  const { code } = computeExitClass([], {});
  assert.equal(code, EXIT.OK);
});

test("computeExitClass: only cosmetic → 3", () => {
  const { code } = computeExitClass([{ class: "cosmetic" }], {});
  assert.equal(code, EXIT.COSMETIC);
});

test("computeExitClass: cosmetic under --strict-cosmetic → 2", () => {
  const { code } = computeExitClass([{ class: "cosmetic" }], { strictCosmetic: true });
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("computeExitClass: typographic under --strict → 2", () => {
  const { code } = computeExitClass([{ class: "typographic" }], { strict: true });
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("computeExitClass: only moved → 4", () => {
  const { class: cls, code } = computeExitClass([{ class: "moved" }], {});
  assert.equal(cls, "moved");
  assert.equal(code, EXIT.MOVED);
});

test("computeExitClass: moved + cosmetic → 3 (cosmetic wins, moved silent)", () => {
  const { code } = computeExitClass([{ class: "moved" }, { class: "cosmetic" }], {});
  assert.equal(code, EXIT.COSMETIC);
});

test("computeExitClass: substantive wins everything", () => {
  const { code } = computeExitClass([
    { class: "moved" }, { class: "cosmetic" }, { class: "typographic" }, { class: "substantive" },
  ], {});
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("end-to-end: cosmetic-only drift → exit 3 by default", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_BASE);
  const b = makeFile(dir, "b.md", TEXT_COSMETIC);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.COSMETIC);
});

test("end-to-end: cosmetic-only drift → exit 2 under --strict-cosmetic", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_BASE);
  const b = makeFile(dir, "b.md", TEXT_COSMETIC);
  const { code } = await runMain(main, [a, b, "--strict-cosmetic"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("end-to-end: typographic-only drift → exit 3 by default", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_BASE);
  const b = makeFile(dir, "b.md", TEXT_TYPOGRAPHIC);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.COSMETIC);
});

test("end-to-end: typographic-only drift → exit 2 under --strict", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_BASE);
  const b = makeFile(dir, "b.md", TEXT_TYPOGRAPHIC);
  const { code } = await runMain(main, [a, b, "--strict"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("end-to-end: substantive drift → exit 2", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_BASE);
  const b = makeFile(dir, "b.md", TEXT_SUBSTANTIVE);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("end-to-end: clause added → exit 2", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_BASE);
  const b = makeFile(dir, "b.md", TEXT_ADDED);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("end-to-end: clause removed → exit 2", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_ADDED);
  const b = makeFile(dir, "b.md", TEXT_BASE);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.SUBSTANTIVE);
});

test("end-to-end: clean → exit 0", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", TEXT_BASE);
  const b = makeFile(dir, "b.md", TEXT_BASE);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.OK);
});

test("end-to-end: pure move with identical body → exit 4", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", `## A\nBody A.\n\n## B\nBody B.\n`);
  const b = makeFile(dir, "b.md", `## B\nBody B.\n\n## A\nBody A.\n`);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.MOVED);
});

test("end-to-end: moved + content change → exit 2", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", `## A\nBody A.\n\n## B\nBody B.\n`);
  const b = makeFile(dir, "b.md", `## B\nBody B changed.\n\n## A\nBody A.\n`);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.SUBSTANTIVE);
});
