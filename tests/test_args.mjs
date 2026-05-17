// parseArgs + UsageError shape
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, UsageError, main } from "../compare-cli.mjs";
import { runMain } from "./_helpers.mjs";

test("two positionals are BASE and CANDIDATE", () => {
  const { opts } = parseArgs(["a.docx", "b.pdf"]);
  assert.equal(opts.base, "a.docx");
  assert.equal(opts.candidate, "b.pdf");
});

test("--from-negotiation takes one positional (the candidate)", () => {
  const { opts } = parseArgs(["--from-negotiation", "n.json", "c.pdf"]);
  assert.equal(opts.fromNegotiation, "n.json");
  assert.equal(opts.candidate, "c.pdf");
  assert.equal(opts.base, null);
});

test("--from-negotiation=PATH form works", () => {
  const { opts } = parseArgs(["--from-negotiation=n.json", "c.pdf"]);
  assert.equal(opts.fromNegotiation, "n.json");
});

test("missing both positionals is a usage error", () => {
  assert.throws(() => parseArgs([]), UsageError);
});

test("one positional without --from-negotiation is a usage error", () => {
  assert.throws(() => parseArgs(["only.docx"]), UsageError);
});

test("--from-negotiation with no positional is a usage error", () => {
  assert.throws(() => parseArgs(["--from-negotiation", "n.json"]), UsageError);
});

test("both stdin is a usage error", () => {
  assert.throws(() => parseArgs(["-", "-"]), /both inputs cannot be stdin/);
});

test("unknown flag suggests nearest known flag", () => {
  try { parseArgs(["--strictt", "a", "b"]); assert.fail("should throw"); }
  catch (e) {
    assert.ok(e instanceof UsageError);
    assert.match(e.message, /--strict/);
  }
});

test("--strict and --strict-cosmetic are independent", () => {
  const a = parseArgs(["--strict", "a", "b"]).opts;
  assert.equal(a.strict, true); assert.equal(a.strictCosmetic, false);
  const c = parseArgs(["--strict-cosmetic", "a", "b"]).opts;
  assert.equal(c.strict, false); assert.equal(c.strictCosmetic, true);
  const both = parseArgs(["--strict", "--strict-cosmetic", "a", "b"]).opts;
  assert.equal(both.strict, true); assert.equal(both.strictCosmetic, true);
});

test("--silent / -q are equivalent", () => {
  const a = parseArgs(["--silent", "a", "b"]).opts;
  const b = parseArgs(["-q", "a", "b"]).opts;
  assert.equal(a.silent, true);
  assert.equal(b.silent, true);
});

test("--output requires a value", () => {
  assert.throws(() => parseArgs(["--output"]), /--output requires a value/);
});

test("--completion takes bash or zsh only", () => {
  const a = parseArgs(["--completion", "bash"]).opts;
  assert.equal(a.completion, "bash");
  assert.throws(() => parseArgs(["--completion", "fish"]), /unknown shell/);
});

test("--help and --version short-circuit before positional check", () => {
  assert.doesNotThrow(() => parseArgs(["--help"]));
  assert.doesNotThrow(() => parseArgs(["--version"]));
});

test("-- end-of-flags marker", () => {
  const { opts } = parseArgs(["--", "--this-is-a-filename", "b"]);
  assert.equal(opts.base, "--this-is-a-filename");
  assert.equal(opts.candidate, "b");
});

test("--help prints usage to stdout and exits 0", async () => {
  const { code, out, err } = await runMain(main, ["--help"]);
  assert.equal(code, 0);
  assert.match(out, /USAGE/);
  assert.equal(err, "");
});

test("--version prints version to stdout and exits 0", async () => {
  const { code, out, err } = await runMain(main, ["--version"]);
  assert.equal(code, 0);
  assert.match(out, /compare-cli /);
  assert.equal(err, "");
});

test("argv parse error exits 1 with stderr message", async () => {
  const { code, out, err } = await runMain(main, ["--no-such-flag", "a", "b"]);
  assert.equal(code, 1);
  assert.match(err, /unknown flag/);
  assert.equal(out, "");
});
