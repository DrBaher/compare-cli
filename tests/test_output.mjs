// --json, --why, --silent, --output, color
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main, EXIT, colorEnabled, paint } from "../compare-cli.mjs";
import { tmp, makeFile, runMain, CaptureStream } from "./_helpers.mjs";

const BASE = `## 1. Purpose

Purpose body.

## 2. Term

The term is two years.
`;

const CAND_SUBSTANTIVE = `## 1. Purpose

Purpose body.

## 2. Term

The term is three years.
`;

const CAND_COSMETIC = `## 1. Purpose

Purpose body.

## 2. Term

The   term  is two years.
`;

test("--json emits the documented stable keys", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const { code, out, err } = await runMain(main, [a, b, "--json"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  const r = JSON.parse(out);
  for (const k of ["ok", "exit_class", "exit_code", "base", "candidate", "summary", "differences", "warnings"]) {
    assert.ok(k in r, `top-level key '${k}' missing`);
  }
  for (const k of ["path", "format", "lossiness", "clauses_total"]) {
    assert.ok(k in r.base, `base.${k} missing`);
    assert.ok(k in r.candidate, `candidate.${k} missing`);
  }
  for (const k of ["clauses_total", "clauses_changed", "clauses_moved", "clauses_added", "clauses_removed", "differences"]) {
    assert.ok(k in r.summary, `summary.${k} missing`);
  }
  for (const k of ["cosmetic", "typographic", "substantive", "added", "removed", "moved"]) {
    assert.ok(k in r.summary.differences, `summary.differences.${k} missing`);
  }
  for (const d of r.differences) {
    for (const k of ["class", "clause_title", "clause_index_base", "clause_index_candidate", "base", "candidate"]) {
      assert.ok(k in d, `differences[].${k} missing`);
    }
  }
  assert.equal(r.exit_code, 2);
  assert.equal(r.exit_class, "substantive");
  assert.equal(r.ok, false);
  // stderr empty under --json (no extra noise on the side channel)
  assert.equal(err, "");
});

test("--json mode: clean comparison reports ok=true and empty differences", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", BASE);
  const { code, out } = await runMain(main, [a, b, "--json"]);
  assert.equal(code, EXIT.OK);
  const r = JSON.parse(out);
  assert.equal(r.ok, true);
  assert.equal(r.exit_class, "clean");
  assert.equal(r.differences.length, 0);
});

test("--why block writes structured key=value lines to stderr", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const { err } = await runMain(main, [a, b, "--why"]);
  assert.match(err, /^why: input\.base=/m);
  assert.match(err, /^why: input\.candidate=/m);
  assert.match(err, /^why: detection\.tier\.base=h2/m);
  assert.match(err, /^why: classes\.cosmetic=\d+ typographic=\d+ substantive=\d+/m);
  assert.match(err, /^why: exit_class=substantive exit_code=2/m);
  assert.match(err, /^why: strict=false strict_cosmetic=false/m);
});

test("--silent suppresses stderr (warnings and why)", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const { code, err } = await runMain(main, [a, b, "--why", "--silent"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  assert.equal(err, "");
});

test("--silent short flag -q is equivalent", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const { err } = await runMain(main, [a, b, "--why", "-q"]);
  assert.equal(err, "");
});

test("--output PATH writes report to file, not stdout", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const outPath = join(dir, "report.txt");
  const { code, out } = await runMain(main, [a, b, "--output", outPath]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  assert.equal(out, ""); // nothing on stdout
  const written = readFileSync(outPath, "utf8");
  assert.match(written, /substantive/);
});

test("--output - is equivalent to no --output (stdout)", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const { out } = await runMain(main, [a, b, "--output", "-"]);
  assert.match(out, /substantive/);
});

test("--output with --json writes JSON to file", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const outPath = join(dir, "report.json");
  await runMain(main, [a, b, "--json", "--output", outPath]);
  const r = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(r.exit_class, "substantive");
});

test("--json input error: pretty-printed envelope with ok:false + exit_class + exit_code", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const missing = join(dir, "does-not-exist.md");
  const { code, out } = await runMain(main, [a, missing, "--json"]);
  assert.equal(code, EXIT.IO);
  const r = JSON.parse(out);
  assert.equal(r.ok, false);
  assert.equal(r.exit_class, "error");
  assert.equal(r.exit_code, EXIT.IO);
  assert.ok(typeof r.error === "string" && r.error.length > 0);
  // Pretty-printed (multi-line), matching the success envelope's 2-space indent.
  assert.match(out, /\n  "error":/);
});

test("--output write failure in --json mode emits a structured error (not plain text)", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  // Point --output at a path whose parent is a file → ENOTDIR on write.
  const notADir = makeFile(dir, "blocker", "x");
  const badOut = join(notADir, "report.json");
  const { code, out, err } = await runMain(main, [a, b, "--json", "--output", badOut]);
  assert.equal(code, EXIT.IO);
  // The JSON contract is preserved: error is structured on stderr.
  const r = JSON.parse(err);
  assert.equal(r.ok, false);
  assert.equal(r.exit_class, "error");
  assert.equal(r.exit_code, EXIT.IO);
  assert.match(r.error, /cannot write/);
  // stdout stays clean (no half-written report, no plain-text error).
  assert.equal(out, "");
});

test("colorEnabled honors NO_COLOR (forced off)", () => {
  const fakeTTY = { isTTY: true };
  assert.equal(colorEnabled(fakeTTY, { NO_COLOR: "1" }), false);
});

test("colorEnabled honors FORCE_COLOR (forced on)", () => {
  const noTTY = { isTTY: false };
  assert.equal(colorEnabled(noTTY, { FORCE_COLOR: "1" }), true);
});

test("colorEnabled defaults to TTY status when no env vars set", () => {
  assert.equal(colorEnabled({ isTTY: true }, {}), true);
  assert.equal(colorEnabled({ isTTY: false }, {}), false);
});

test("paint emits ANSI when enabled, plain when disabled", () => {
  const tty = { isTTY: true };
  const noTty = { isTTY: false };
  assert.match(paint(tty, "red", "x", {}), /\x1b\[31m/);
  assert.equal(paint(noTty, "red", "x", {}), "x");
});

test("human report mentions clause title and uses [class] tag", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makeFile(dir, "b.md", CAND_SUBSTANTIVE);
  const { out } = await runMain(main, [a, b]);
  assert.match(out, /\[substantive\]/);
  assert.match(out, /Term/);
  assert.match(out, /verdict:/);
});

test("PDF warning surfaces to stderr in human mode", async () => {
  const { makePdf } = await import("./_helpers.mjs");
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makePdf(dir, "b.pdf", BASE.split("\n"));
  const { err } = await runMain(main, [a, b]);
  assert.match(err, /extracted from PDF/);
});

test("PDF warning surfaces inside JSON warnings[]", async () => {
  const { makePdf } = await import("./_helpers.mjs");
  const dir = tmp();
  const a = makeFile(dir, "a.md", BASE);
  const b = makePdf(dir, "b.pdf", BASE.split("\n"));
  const { out } = await runMain(main, [a, b, "--json"]);
  const r = JSON.parse(out);
  assert.ok(r.warnings.some((w) => /extracted from PDF/.test(w)));
});
