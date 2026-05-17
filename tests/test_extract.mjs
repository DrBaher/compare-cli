// Input extraction: docx, pdf, markdown, text, stdin
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectFormat, extractDocxText, extractPdfText, readInput, main, EXIT,
} from "../compare-cli.mjs";
import { tmp, makeFile, makeDocx, makePdf, runMain } from "./_helpers.mjs";

test("detectFormat by extension", () => {
  assert.equal(detectFormat("foo.docx"), "docx");
  assert.equal(detectFormat("foo.pdf"), "pdf");
  assert.equal(detectFormat("foo.md"), "markdown");
  assert.equal(detectFormat("foo.markdown"), "markdown");
  assert.equal(detectFormat("foo.txt"), "text");
  assert.equal(detectFormat("foo"), "text");
});

test("extractDocxText pulls paragraph text in order", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "test.docx", [
    "## Purpose",
    "Body paragraph.",
    "## Term",
    "Term body.",
  ]);
  const buf = readFileSync(path);
  const text = await extractDocxText(buf);
  assert.match(text, /## Purpose/);
  assert.match(text, /Body paragraph\./);
  assert.match(text, /## Term/);
});

test("extractPdfText pulls multi-line text from a hand-built PDF", async () => {
  const dir = tmp();
  const path = makePdf(dir, "test.pdf", [
    "## Purpose",
    "Body paragraph.",
    "## Term",
    "Term body.",
  ]);
  const buf = readFileSync(path);
  const text = await extractPdfText(buf);
  assert.match(text, /## Purpose/);
  assert.match(text, /Body paragraph\./);
  assert.match(text, /## Term/);
});

test("readInput throws exit-1 error when file is missing", async () => {
  await assert.rejects(
    readInput("/no/such/path.docx"),
    (e) => e.message.includes("input not found") && e.exit === EXIT.IO,
  );
});

test("readInput on a markdown file returns lossiness=none", async () => {
  const dir = tmp();
  const path = makeFile(dir, "a.md", "## A\nbody\n");
  const r = await readInput(path);
  assert.equal(r.format, "markdown");
  assert.equal(r.lossiness, "none");
});

test("readInput on a PDF returns lossiness=extracted", async () => {
  const dir = tmp();
  const path = makePdf(dir, "a.pdf", ["## Purpose", "Body."]);
  const r = await readInput(path);
  assert.equal(r.format, "pdf");
  assert.equal(r.lossiness, "extracted");
});

test("malformed .docx → exit 1 with clear error", async () => {
  const dir = tmp();
  const path = makeFile(dir, "bad.docx", "not a zip file at all");
  const { code, err } = await runMain(main, [path, path]);
  assert.equal(code, EXIT.IO);
  assert.match(err, /malformed \.docx/);
});

test("malformed .pdf → exit 1 with clear error", async () => {
  const dir = tmp();
  const path = makeFile(dir, "bad.pdf", "%PDF-1.4\nthis is not actually a valid pdf body");
  const { code, err } = await runMain(main, [path, path]);
  assert.equal(code, EXIT.IO);
  assert.match(err, /malformed \.pdf|extracted zero characters/);
});

test("missing input → exit 1", async () => {
  const { code, err } = await runMain(main, ["/no/such.docx", "/no/other.docx"]);
  assert.equal(code, EXIT.IO);
  assert.match(err, /input not found/);
});

test("docx vs docx: identical content → exit 0", async () => {
  const dir = tmp();
  const paragraphs = ["## A", "Body A.", "## B", "Body B."];
  const a = await makeDocx(dir, "a.docx", paragraphs);
  const b = await makeDocx(dir, "b.docx", paragraphs);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.OK);
});

test("pdf vs pdf: identical content → exit 0", async () => {
  const dir = tmp();
  const lines = ["## A", "Body A.", "## B", "Body B."];
  const a = makePdf(dir, "a.pdf", lines);
  const b = makePdf(dir, "b.pdf", lines);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.OK);
});

test("docx vs pdf: cross-format with lossiness warning surfaced", async () => {
  const dir = tmp();
  const paragraphs = ["## A", "Body A.", "## B", "Body B."];
  const a = await makeDocx(dir, "a.docx", paragraphs);
  const b = makePdf(dir, "b.pdf", paragraphs);
  const { code, err } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.OK);
  assert.match(err, /extracted from PDF/);
});

test("md vs md: identical content → exit 0", async () => {
  const dir = tmp();
  const text = "## A\nBody A.\n\n## B\nBody B.\n";
  const a = makeFile(dir, "a.md", text);
  const b = makeFile(dir, "b.md", text);
  const { code } = await runMain(main, [a, b]);
  assert.equal(code, EXIT.OK);
});

test("PDF with zero extractable text exits 1 with 'scanned image' message", async () => {
  // Build a PDF with no text content stream — pdfjs will return empty items.
  const dir = tmp();
  const path = makePdf(dir, "empty.pdf", []);
  const { code, err } = await runMain(main, [path, path]);
  assert.equal(code, EXIT.IO);
  assert.match(err, /scanned image|zero characters/);
});

test("stdin support: candidate from stdin via -", async () => {
  const dir = tmp();
  const a = makeFile(dir, "a.md", "## A\nBody A.\n");
  const text = "## A\nBody A changed.\n";
  const { code, out } = await runMain(main, [a, "-", "--json"], {
    stdinReader: async () => text,
  });
  assert.equal(code, EXIT.SUBSTANTIVE);
  const j = JSON.parse(out);
  assert.equal(j.differences[0].class, "substantive");
});

test("XML entities in docx extract correctly", async () => {
  const dir = tmp();
  const path = await makeDocx(dir, "ent.docx", ["## Purpose", "A & B < C > D"]);
  const text = await extractDocxText(readFileSync(path));
  assert.match(text, /A & B < C > D/);
});
