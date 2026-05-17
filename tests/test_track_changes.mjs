// v0.3.0: extract WordprocessingML track-changes metadata from .docx.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractDocxTrackChanges,
  readInput,
  main,
  EXIT,
} from "../compare-cli.mjs";
import { tmp, makeDocx, runMain } from "./_helpers.mjs";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// extractDocxTrackChanges — unit
// ---------------------------------------------------------------------------

test("extractDocxTrackChanges: no TC ops → empty array", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "plain.docx", ["## Term", "The term is two (2) years."]);
  const ops = await extractDocxTrackChanges(readFileSync(path));
  assert.deepEqual(ops, []);
});

test("extractDocxTrackChanges: one insertion captured with author + date", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "ins.docx", [
    "## Term",
    [
      { text: "The term is " },
      { type: "ins", text: "three (3)", author: "Alice", date: "2026-05-17T10:00:00Z" },
      { text: " years." },
    ],
  ]);
  const ops = await extractDocxTrackChanges(readFileSync(path));
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0], { op: "ins", text: "three (3)", author: "Alice", date: "2026-05-17T10:00:00Z" });
});

test("extractDocxTrackChanges: one deletion captured with author + date", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "del.docx", [
    "## Term",
    [
      { text: "The term is " },
      { type: "del", text: "two (2)", author: "Bob", date: "2026-05-17T11:00:00Z" },
      { text: " years." },
    ],
  ]);
  const ops = await extractDocxTrackChanges(readFileSync(path));
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0], { op: "del", text: "two (2)", author: "Bob", date: "2026-05-17T11:00:00Z" });
});

test("extractDocxTrackChanges: interleaved ins+del returned in document order", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "both.docx", [
    "## Term",
    [
      { text: "The term is " },
      { type: "del", text: "two (2)", author: "Alice", date: "2026-05-17T10:00:00Z" },
      { type: "ins", text: "three (3)", author: "Alice", date: "2026-05-17T10:00:01Z" },
      { text: " years." },
    ],
  ]);
  const ops = await extractDocxTrackChanges(readFileSync(path));
  assert.equal(ops.length, 2);
  assert.equal(ops[0].op, "del");
  assert.equal(ops[0].text, "two (2)");
  assert.equal(ops[1].op, "ins");
  assert.equal(ops[1].text, "three (3)");
});

test("extractDocxTrackChanges: missing author/date are empty strings (not crash)", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "noauth.docx", [
    "## A",
    [
      { type: "ins", text: "x" },  // no author, no date
    ],
  ]);
  const ops = await extractDocxTrackChanges(readFileSync(path));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].author, "");
  assert.equal(ops[0].date, "");
});

test("extractDocxTrackChanges: invalid buffer (not a zip) → empty array (no crash)", async () => {
  const ops = await extractDocxTrackChanges(Buffer.from("not a zip"));
  assert.deepEqual(ops, []);
});

test("extractDocxTrackChanges: zip without word/document.xml → empty array", async () => {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("other.txt", "hi");
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const ops = await extractDocxTrackChanges(buf);
  assert.deepEqual(ops, []);
});

// ---------------------------------------------------------------------------
// readInput integration
// ---------------------------------------------------------------------------

test("readInput on .docx with TC populates track_changes", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "tc.docx", [
    "## A",
    [
      { text: "body " },
      { type: "ins", text: "added", author: "Alice", date: "2026-05-17T10:00:00Z" },
    ],
  ]);
  const input = await readInput(path);
  assert.equal(input.format, "docx");
  assert.ok(Array.isArray(input.track_changes));
  assert.equal(input.track_changes.length, 1);
  assert.equal(input.track_changes[0].op, "ins");
});

test("readInput on plain .md returns no track_changes field", async () => {
  // Non-docx inputs don't have track_changes; downstream consumers default to [].
  const { tmp: t, makeFile } = await import("./_helpers.mjs");
  const dir = t();
  const path = makeFile(dir, "x.md", "## A\nbody.");
  const input = await readInput(path);
  assert.equal(input.format, "markdown");
  assert.equal(input.track_changes, undefined);
});

// ---------------------------------------------------------------------------
// End-to-end: JSON output surfaces track_changes
// ---------------------------------------------------------------------------

test("--json: base.track_changes populated when base .docx has TC", async () => {
  const dir = tmp();
  const base = await makeDocx(dir, "base.docx", [
    "## A",
    [
      { text: "The term is " },
      { type: "del", text: "two (2)", author: "Alice", date: "2026-05-17T10:00:00Z" },
      { type: "ins", text: "three (3)", author: "Alice", date: "2026-05-17T10:00:01Z" },
      { text: " years." },
    ],
  ]);
  const cand = await makeDocx(dir, "cand.docx", ["## A", "The term is three (3) years."]);
  const { code, out } = await runMain(main, [base, cand, "--json"]);
  // The text-diff says "clean" because extractDocxText already includes the
  // <w:ins> text but not the <w:del> text — base reads as "three (3)" same as cand.
  assert.equal(code, EXIT.OK);
  const r = JSON.parse(out);
  assert.equal(r.base.track_changes.length, 2);
  assert.equal(r.base.track_changes[0].op, "del");
  assert.equal(r.base.track_changes[1].op, "ins");
  assert.equal(r.candidate.track_changes.length, 0);
});

test("--json: both sides have empty track_changes when both are .md", async () => {
  const { tmp: t, makeFile } = await import("./_helpers.mjs");
  const dir = t();
  const base = makeFile(dir, "base.md", "## A\nbody.");
  const cand = makeFile(dir, "cand.md", "## A\nbody.");
  const { out } = await runMain(main, [base, cand, "--json"]);
  const r = JSON.parse(out);
  assert.deepEqual(r.base.track_changes, []);
  assert.deepEqual(r.candidate.track_changes, []);
});

// ---------------------------------------------------------------------------
// Human report surfaces TC presence
// ---------------------------------------------------------------------------

test("human report shows track-changes summary block when TC present", async () => {
  const dir = tmp();
  const base = await makeDocx(dir, "base.docx", [
    "## A",
    [
      { text: "x " },
      { type: "ins", text: "y", author: "Alice", date: "2026-05-17T10:00:00Z" },
      { type: "del", text: "z", author: "Bob", date: "2026-05-17T11:00:00Z" },
    ],
  ]);
  const cand = await makeDocx(dir, "cand.docx", ["## A", "x y"]);
  const { out } = await runMain(main, [base, cand]);
  assert.match(out, /track-changes \(Word\):/);
  assert.match(out, /base\s+:\s+1 insertion\(s\), 1 deletion\(s\) \(authors: Alice, Bob\)/);
});

test("human report omits track-changes block when neither side has TC", async () => {
  const { tmp: t, makeFile } = await import("./_helpers.mjs");
  const dir = t();
  const base = makeFile(dir, "base.md", "## A\nbody.");
  const cand = makeFile(dir, "cand.md", "## A\nbody.");
  const { out } = await runMain(main, [base, cand]);
  assert.equal(/track-changes/.test(out), false);
});

// ---------------------------------------------------------------------------
// --why surfaces TC counts
// ---------------------------------------------------------------------------

test("--why surfaces track_changes counts when present", async () => {
  const dir = tmp();
  const base = await makeDocx(dir, "base.docx", [
    "## A",
    [
      { text: "x" },
      { type: "ins", text: "y", author: "A", date: "2026-05-17" },
    ],
  ]);
  const cand = await makeDocx(dir, "cand.docx", ["## A", "xy"]);
  const { err } = await runMain(main, [base, cand, "--why"]);
  assert.match(err, /why: track_changes\.base=1 track_changes\.candidate=0/);
});

// ---------------------------------------------------------------------------
// SARIF: TC counts in invocation properties
// ---------------------------------------------------------------------------

test("--sarif: invocation properties include track_changes counts", async () => {
  const dir = tmp();
  const base = await makeDocx(dir, "base.docx", [
    "## A",
    [
      { text: "x" },
      { type: "ins", text: "y", author: "A", date: "2026-05-17" },
      { type: "ins", text: "z", author: "A", date: "2026-05-17" },
    ],
  ]);
  const cand = await makeDocx(dir, "cand.docx", ["## A", "xyz"]);
  const { out } = await runMain(main, [base, cand, "--sarif"]);
  const sarif = JSON.parse(out);
  const props = sarif.runs[0].invocations[0].properties;
  assert.equal(props.track_changes_base, 2);
  assert.equal(props.track_changes_candidate, 0);
});
