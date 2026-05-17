// v0.2.0 additions: --check, --require-signoffs, --only-clauses/--ignore-clauses,
// intra-clause word diff, --sarif output.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  parseClausePatterns,
  clauseTitleMatches,
  applyClauseFilters,
  wordDiff,
  wordDiffChangeDensity,
  buildReportSarif,
  formatReportHuman,
  readNegotiation,
  main,
  EXIT,
} from "../compare-cli.mjs";
import { CaptureStream, tmp, makeFile, runMain } from "./_helpers.mjs";

// ---------------------------------------------------------------------------
// #6 --check
// ---------------------------------------------------------------------------

test("--check implies --silent", () => {
  const { opts } = parseArgs(["--check", "a.md", "b.md"]);
  assert.equal(opts.check, true);
  assert.equal(opts.silent, true);
});

test("--check suppresses stdout and stderr; exit code is the only signal", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## A\nbody.");
  const cand = makeFile(dir, "cand.md", "## A\nbody changed.");
  const { code, out, err } = await runMain(main, [base, cand, "--check"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  assert.equal(out, "");
  assert.equal(err, "");
});

test("--check on identical input exits 0 with no output", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## A\nidentical body.");
  const cand = makeFile(dir, "cand.md", "## A\nidentical body.");
  const { code, out, err } = await runMain(main, [base, cand, "--check"]);
  assert.equal(code, EXIT.OK);
  assert.equal(out, "");
  assert.equal(err, "");
});

test("--check skips --output writes (only exit code matters)", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## A\nbody.");
  const cand = makeFile(dir, "cand.md", "## A\nbody changed.");
  const outPath = `${dir}/report.txt`;
  const { code } = await runMain(main, [base, cand, "--check", "--output", outPath]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  // outPath must NOT have been created.
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(outPath), false);
});

// ---------------------------------------------------------------------------
// #2 --require-signoffs
// ---------------------------------------------------------------------------

test("--require-signoffs without --from-negotiation is a usage error", () => {
  assert.throws(() => parseArgs(["--require-signoffs", "a.md", "b.md"]), /requires --from-negotiation/);
});

test("--require-signoffs: both signoffs populated → passes through", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "## A\nbody.", agreed: true }],
    signoffs: { a: "Alice 2026-05-01", b: "Bob 2026-05-02" },
  }));
  const text = readNegotiation(path, { requireSignoffs: true });
  assert.equal(text, "## A\nbody.");
});

test("--require-signoffs: signoffs missing → exit 2 with clear message", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "x", agreed: true }],
  }));
  assert.throws(
    () => readNegotiation(path, { requireSignoffs: true }),
    (e) => e.exit === EXIT.SUBSTANTIVE && /not signed off/.test(e.message) && /signoffs\.a/.test(e.message) && /signoffs\.b/.test(e.message),
  );
});

test("--require-signoffs: only one party signed → exit 2, lists the missing party", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "x", agreed: true }],
    signoffs: { a: "Alice 2026-05-01" },
  }));
  assert.throws(
    () => readNegotiation(path, { requireSignoffs: true }),
    (e) => e.exit === EXIT.SUBSTANTIVE && /signoffs\.b/.test(e.message) && !/signoffs\.a and signoffs\.b/.test(e.message),
  );
});

test("--require-signoffs: signoff with empty string counts as missing", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "x", agreed: true }],
    signoffs: { a: "Alice 2026-05-01", b: "" },
  }));
  assert.throws(() => readNegotiation(path, { requireSignoffs: true }), (e) => /signoffs\.b/.test(e.message));
});

test("default (no --require-signoffs): missing signoffs does NOT block", () => {
  const dir = tmp();
  const path = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "## A\nbody.", agreed: true }],
  }));
  // No signoffs key at all — still returns the text by default.
  assert.equal(readNegotiation(path), "## A\nbody.");
});

test("--require-signoffs end-to-end via main()", async () => {
  const dir = tmp();
  const neg = makeFile(dir, "neg.json", JSON.stringify({
    rounds: [{ round: 1, text: "## A\nbody.", agreed: true }],
  }));
  const cand = makeFile(dir, "cand.md", "## A\nbody.");
  const { code, err } = await runMain(main, ["--from-negotiation", neg, cand, "--require-signoffs"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  assert.match(err, /not signed off/);
});

// ---------------------------------------------------------------------------
// #3 --only-clauses / --ignore-clauses
// ---------------------------------------------------------------------------

test("parseClausePatterns: splits on comma, trims, lowercases, drops empties", () => {
  assert.deepEqual(parseClausePatterns("Term, Payment,  Notices"), ["term", "payment", "notices"]);
  assert.deepEqual(parseClausePatterns("ONE,,two,,"), ["one", "two"]);
  assert.equal(parseClausePatterns(""), null);
  assert.equal(parseClausePatterns(",,,"), null);
  assert.equal(parseClausePatterns(null), null);
});

test("clauseTitleMatches: substring match against normalized title", () => {
  // normalizeTitle strips leading numbering and lowercases — "1. Term and Survival" → "term and survival"
  assert.equal(clauseTitleMatches("1. Term and Survival", ["term"]), true);
  assert.equal(clauseTitleMatches("Notices", ["term", "payment"]), false);
  assert.equal(clauseTitleMatches("Confidentiality Obligations", ["confiden"]), true);
});

test("applyClauseFilters: --only-clauses keeps only matching", () => {
  const diffs = [
    { class: "substantive", clause_title: "1. Term", base: "x", candidate: "y" },
    { class: "substantive", clause_title: "2. Payment", base: "x", candidate: "y" },
    { class: "substantive", clause_title: "3. Notices", base: "x", candidate: "y" },
  ];
  const r = applyClauseFilters(diffs, { onlyClauses: ["term"] });
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].clause_title, "1. Term");
  assert.equal(r.suppressed_count, 2);
});

test("applyClauseFilters: --ignore-clauses drops matching", () => {
  const diffs = [
    { class: "substantive", clause_title: "1. Term", base: "x", candidate: "y" },
    { class: "substantive", clause_title: "2. Notices", base: "x", candidate: "y" },
  ];
  const r = applyClauseFilters(diffs, { ignoreClauses: ["notices"] });
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].clause_title, "1. Term");
  assert.equal(r.suppressed_count, 1);
});

test("applyClauseFilters: --only + --ignore composes (ignore wins inside the only-set)", () => {
  const diffs = [
    { class: "substantive", clause_title: "1. Term", base: "x", candidate: "y" },
    { class: "substantive", clause_title: "2. Payment", base: "x", candidate: "y" },
    { class: "substantive", clause_title: "3. Term Survival", base: "x", candidate: "y" },
    { class: "substantive", clause_title: "4. Notices", base: "x", candidate: "y" },
  ];
  // Keep only Term*-titled clauses, but ignore anything mentioning "survival".
  const r = applyClauseFilters(diffs, { onlyClauses: ["term"], ignoreClauses: ["survival"] });
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].clause_title, "1. Term");
  assert.equal(r.suppressed_count, 3);
});

test("applyClauseFilters: no filters → kept = input, suppressed = 0", () => {
  const diffs = [{ class: "substantive", clause_title: "1. Term", base: "x", candidate: "y" }];
  const r = applyClauseFilters(diffs, {});
  assert.equal(r.kept.length, 1);
  assert.equal(r.suppressed_count, 0);
});

test("--only-clauses end-to-end: exit code reflects only-set", async () => {
  // Two substantive changes; --only-clauses suppresses one. Exit code should
  // still be 2 (substantive) — but if --only filters out ALL substantive,
  // it'd flip to 0.
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## Term\noriginal term.\n\n## Notices\noriginal notices.");
  const cand = makeFile(dir, "cand.md", "## Term\noriginal term.\n\n## Notices\nchanged notices.");
  // Both clauses unchanged-then-Notices-changed; ignore Notices → exit 0.
  const { code, out } = await runMain(main, [base, cand, "--ignore-clauses", "notices", "--json"]);
  assert.equal(code, EXIT.OK);
  const r = JSON.parse(out);
  assert.equal(r.summary.suppressed_by_filter, 1);
  assert.equal(r.differences.length, 0);
});

test("--only-clauses end-to-end: suppressed count surfaces in human output", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## Term\noriginal.\n\n## Notices\noriginal.");
  const cand = makeFile(dir, "cand.md", "## Term\nchanged.\n\n## Notices\nchanged.");
  const { out } = await runMain(main, [base, cand, "--only-clauses", "term"]);
  assert.match(out, /suppressed by/);
});

// ---------------------------------------------------------------------------
// #1 intra-clause word diff
// ---------------------------------------------------------------------------

test("wordDiff: identical strings → all equal ops", () => {
  const ops = wordDiff("the quick brown fox", "the quick brown fox");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "equal");
});

test("wordDiff: single word changed → equal + removed + added + equal", () => {
  const ops = wordDiff("the quick brown fox", "the slow brown fox");
  // Sequence: 'the ' equal, 'quick' removed, 'slow' added, ' brown fox' equal
  const summary = ops.map((o) => o.op).join(",");
  assert.match(summary, /^equal,removed,added,equal$|^equal,added,removed,equal$/);
});

test("wordDiff: only additions → one added op (after possible equal prefix)", () => {
  const ops = wordDiff("foo", "foo bar");
  assert.ok(ops.some((o) => o.op === "added" && /bar/.test(o.text)));
  assert.ok(ops.every((o) => o.op !== "removed"));
});

test("wordDiff: only removals → one removed op", () => {
  const ops = wordDiff("foo bar", "foo");
  assert.ok(ops.some((o) => o.op === "removed" && /bar/.test(o.text)));
  assert.ok(ops.every((o) => o.op !== "added"));
});

test("wordDiff: empty inputs", () => {
  assert.deepEqual(wordDiff("", ""), []);
  const oA = wordDiff("", "added");
  assert.equal(oA.length, 1);
  assert.equal(oA[0].op, "added");
  const oR = wordDiff("removed", "");
  assert.equal(oR.length, 1);
  assert.equal(oR[0].op, "removed");
});

test("wordDiffChangeDensity: 0 for identical, ~1 for fully different", () => {
  assert.equal(wordDiffChangeDensity(wordDiff("aaa bbb", "aaa bbb")), 0);
  // "x y z" vs "a b c" — all three tokens replaced; density should be near 1.
  const d = wordDiffChangeDensity(wordDiff("x y z", "a b c"));
  assert.ok(d > 0.5);
});

test("intra-diff renders inline in human output for substantive changes", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## A\nThe term is two (2) years from the Effective Date.");
  const cand = makeFile(dir, "cand.md", "## A\nThe term is three (3) years from the Effective Date.");
  const { out } = await runMain(main, [base, cand]);
  // The word-diff tokenizer splits on whitespace, so "two" and "(2)" are
  // separate tokens → separate markers. That's fine and useful — agents and
  // humans both prefer fine-grained word changes over a single big block.
  assert.match(out, /\[-two-\]/);
  assert.match(out, /\{\+three\+\}/);
  assert.match(out, /\[-\(2\)-\]/);
  assert.match(out, /\{\+\(3\)\+\}/);
  // Should NOT have the two-line - / + fallback.
  assert.equal(out.includes("       - The term is two"), false);
});

test("--no-intra-diff falls back to two-line - / + format", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## A\nThe term is two (2) years.");
  const cand = makeFile(dir, "cand.md", "## A\nThe term is three (3) years.");
  const { out } = await runMain(main, [base, cand, "--no-intra-diff"]);
  assert.match(out, /- The term is two/);
  assert.match(out, /\+ The term is three/);
  // No inline markers.
  assert.equal(out.includes("[-"), false);
  assert.equal(out.includes("{+"), false);
});

test("intra-diff falls back to two-line format when density > 70%", () => {
  // Construct a report directly and format it; bypasses end-to-end alignment.
  const report = {
    base: { path: "b", format: "text", lossiness: "none", clauses_total: 1 },
    candidate: { path: "c", format: "text", lossiness: "none", clauses_total: 1 },
    summary: { clauses_total: 1, clauses_changed: 1, clauses_moved: 0, clauses_added: 0, clauses_removed: 0, differences: { substantive: 1, cosmetic: 0, typographic: 0, added: 0, removed: 0, moved: 0 }, suppressed_by_filter: 0 },
    differences: [{
      class: "substantive",
      clause_title: "A",
      clause_index_base: 1,
      clause_index_candidate: 1,
      base: "alpha beta gamma delta epsilon",
      candidate: "one two three four five",
    }],
    warnings: [],
    exit_class: "substantive",
    exit_code: 2,
  };
  const stream = new CaptureStream();
  const out = formatReportHuman(report, { stream });
  // High-density change → two-line fallback.
  assert.match(out, /- alpha beta/);
  assert.match(out, /\+ one two/);
});

// ---------------------------------------------------------------------------
// #5 --sarif
// ---------------------------------------------------------------------------

test("--sarif is mutually exclusive with --json", () => {
  assert.throws(() => parseArgs(["--json", "--sarif", "a.md", "b.md"]), /mutually exclusive/);
});

test("buildReportSarif emits SARIF v2.1.0 with one result per difference", () => {
  const report = {
    base: { path: "/abs/base.docx", format: "docx", lossiness: "none", clauses_total: 2 },
    candidate: { path: "/abs/cand.docx", format: "docx", lossiness: "none", clauses_total: 2 },
    summary: { suppressed_by_filter: 0, differences: { substantive: 1, cosmetic: 0, typographic: 0, added: 0, removed: 0, moved: 0 } },
    differences: [{
      class: "substantive",
      clause_title: "2. Term",
      clause_index_base: 2,
      clause_index_candidate: 2,
      base: "two years",
      candidate: "three years",
    }],
    warnings: [],
    exit_class: "substantive",
    exit_code: 2,
  };
  const sarif = buildReportSarif(report);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs.length, 1);
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, "compare-cli");
  assert.ok(run.tool.driver.version);
  assert.equal(run.results.length, 1);
  const r = run.results[0];
  assert.equal(r.ruleId, "compare-cli.substantive");
  assert.equal(r.level, "error");
  assert.match(r.message.text, /\[substantive\] 2\. Term/);
  // candidate path becomes file:// URI for absolute paths
  assert.equal(r.locations[0].physicalLocation.artifactLocation.uri, "file:///abs/cand.docx");
  // related location points to base
  assert.equal(r.relatedLocations[0].physicalLocation.artifactLocation.uri, "file:///abs/base.docx");
});

test("--sarif end-to-end: emits valid JSON shape with run/results", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## A\noriginal.");
  const cand = makeFile(dir, "cand.md", "## A\nchanged.");
  const { code, out } = await runMain(main, [base, cand, "--sarif"]);
  assert.equal(code, EXIT.SUBSTANTIVE);
  const sarif = JSON.parse(out);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].tool.driver.name, "compare-cli");
  assert.ok(Array.isArray(sarif.runs[0].results));
  assert.ok(sarif.runs[0].results.length >= 1);
  assert.equal(sarif.runs[0].invocations[0].exitCode, EXIT.SUBSTANTIVE);
  assert.equal(sarif.runs[0].invocations[0].properties.exit_class, "substantive");
});

// ---------------------------------------------------------------------------
// 0.2.1 follow-ups: --why filter info + SARIF Windows path handling
// ---------------------------------------------------------------------------

test("--why surfaces filter info when --only-clauses set", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## Term\noriginal.\n\n## Notices\noriginal.");
  const cand = makeFile(dir, "cand.md", "## Term\nchanged.\n\n## Notices\nchanged.");
  const { err } = await runMain(main, [base, cand, "--only-clauses", "term", "--why"]);
  assert.match(err, /why: filter\.only_clauses=term/);
  assert.match(err, /filter\.suppressed=1/);
});

test("--why surfaces filter info when --ignore-clauses set", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## Term\noriginal.\n\n## Notices\noriginal.");
  const cand = makeFile(dir, "cand.md", "## Term\nchanged.\n\n## Notices\nchanged.");
  const { err } = await runMain(main, [base, cand, "--ignore-clauses", "notices,term", "--why"]);
  assert.match(err, /filter\.ignore_clauses=notices\|term/);
});

test("--why does NOT add filter line when no filters set and nothing suppressed", async () => {
  const dir = tmp();
  const base = makeFile(dir, "base.md", "## A\nbody.");
  const cand = makeFile(dir, "cand.md", "## A\nbody changed.");
  const { err } = await runMain(main, [base, cand, "--why"]);
  // No filter line — keeps the why block tight when nothing's filtered.
  assert.equal(/why: filter\./.test(err), false);
});

test("SARIF pathToFileUri handles Windows absolute paths", () => {
  // Manually construct a report with Windows paths and check the SARIF output.
  const report = {
    base: { path: "C:\\Users\\alice\\base.docx", format: "docx", lossiness: "none", clauses_total: 1 },
    candidate: { path: "C:/Users/alice/cand.docx", format: "docx", lossiness: "none", clauses_total: 1 },
    summary: { suppressed_by_filter: 0, differences: { substantive: 1, cosmetic: 0, typographic: 0, added: 0, removed: 0, moved: 0 } },
    differences: [{
      class: "substantive",
      clause_title: "A",
      clause_index_base: 1,
      clause_index_candidate: 1,
      base: "x",
      candidate: "y",
    }],
    warnings: [],
    exit_class: "substantive",
    exit_code: 2,
  };
  const sarif = buildReportSarif(report);
  const r = sarif.runs[0].results[0];
  // Backslashes flipped to forward slashes; file:/// prefix per the file-URI scheme.
  assert.equal(r.locations[0].physicalLocation.artifactLocation.uri, "file:///C:/Users/alice/cand.docx");
  assert.equal(r.relatedLocations[0].physicalLocation.artifactLocation.uri, "file:///C:/Users/alice/base.docx");
});

test("SARIF pathToFileUri passes relative paths through unchanged", () => {
  const report = {
    base: { path: "contracts/base.docx", format: "docx", lossiness: "none", clauses_total: 1 },
    candidate: { path: "contracts/cand.docx", format: "docx", lossiness: "none", clauses_total: 1 },
    summary: { suppressed_by_filter: 0, differences: { substantive: 1, cosmetic: 0, typographic: 0, added: 0, removed: 0, moved: 0 } },
    differences: [{
      class: "substantive",
      clause_title: "A",
      clause_index_base: 1,
      clause_index_candidate: 1,
      base: "x",
      candidate: "y",
    }],
    warnings: [],
    exit_class: "substantive",
    exit_code: 2,
  };
  const sarif = buildReportSarif(report);
  // Relative paths stay relative — SARIF spec allows.
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "contracts/cand.docx");
});

test("--sarif maps each class to the right severity level", () => {
  const report = {
    base: { path: "b", format: "text", lossiness: "none", clauses_total: 4 },
    candidate: { path: "c", format: "text", lossiness: "none", clauses_total: 4 },
    summary: { suppressed_by_filter: 0, differences: { substantive: 1, cosmetic: 1, typographic: 1, added: 1, removed: 0, moved: 0 } },
    differences: [
      { class: "substantive", clause_title: "A", clause_index_base: 1, clause_index_candidate: 1, base: "x", candidate: "y" },
      { class: "cosmetic", clause_title: "B", clause_index_base: 2, clause_index_candidate: 2, base: "x", candidate: "y" },
      { class: "typographic", clause_title: "C", clause_index_base: 3, clause_index_candidate: 3, base: "x", candidate: "y" },
      { class: "added", clause_title: "D", clause_index_base: null, clause_index_candidate: 4, base: null, candidate: "y" },
    ],
    warnings: [],
    exit_class: "substantive",
    exit_code: 2,
  };
  const sarif = buildReportSarif(report);
  const byClass = {};
  for (const r of sarif.runs[0].results) {
    byClass[r.ruleId] = r.level;
  }
  assert.equal(byClass["compare-cli.substantive"], "error");
  assert.equal(byClass["compare-cli.cosmetic"], "warning");
  assert.equal(byClass["compare-cli.typographic"], "warning");
  assert.equal(byClass["compare-cli.added"], "note");
});
