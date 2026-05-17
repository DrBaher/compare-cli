// End-to-end: --demo, --completion, clause-grouping summary
import { test } from "node:test";
import assert from "node:assert/strict";
import { main, EXIT, completionScript } from "../compare-cli.mjs";
import { tmp, makeFile, runMain } from "./_helpers.mjs";

test("--demo runs against bundled fixtures and exits 2 (substantive)", async () => {
  const { code, out } = await runMain(main, ["--demo"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  assert.match(out, /substantive/);
  assert.match(out, /Term/);
});

test("--demo --json runs the comparison in JSON mode", async () => {
  const { code, out } = await runMain(main, ["--demo", "--json"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  const r = JSON.parse(out);
  assert.equal(r.exit_class, "substantive");
});

test("--completion bash emits a complete() function", () => {
  const s = completionScript("bash");
  assert.match(s, /_compare_cli_complete/);
  assert.match(s, /--strict-cosmetic/);
  assert.match(s, /complete -F /);
});

test("--completion zsh emits a #compdef directive", () => {
  const s = completionScript("zsh");
  assert.match(s, /#compdef compare/);
  assert.match(s, /--strict-cosmetic/);
});

test("--completion via main writes the script to stdout, exit 0", async () => {
  const { code, out } = await runMain(main, ["--completion", "bash"]);
  assert.equal(code, EXIT.OK);
  assert.match(out, /_compare_cli_complete/);
});

test("clause-aware grouping: many internal changes in one clause = 1 substantive entry", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", `## Term

Sentence one with value alpha. Sentence two with value beta. Sentence three with value gamma.
`);
  const b = makeFile(dir, "b.md", `## Term

Sentence one with value XXX. Sentence two with value YYY. Sentence three with value ZZZ.
`);
  const { code, out } = await runMain(main, [a, b, "--json"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  const r = JSON.parse(out);
  // All three word changes live inside the single Term clause → exactly one
  // entry in differences[].
  assert.equal(r.differences.length, 1);
  assert.equal(r.differences[0].class, "substantive");
  assert.equal(r.summary.clauses_changed, 1);
});
