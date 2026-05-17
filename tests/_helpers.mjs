// Shared test utilities. Stdlib + jszip (only for synthesizing .docx fixtures).
// PDF fixtures are hand-built with a minimal in-memory writer so we don't add
// a writer dependency just to produce test inputs.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

export function tmp() {
  return mkdtempSync(join(tmpdir(), "compare-cli-test-"));
}

export function makeFile(dir, name, content) {
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

// Captures writes so tests can inspect stdout/stderr buffers.
export class CaptureStream extends Writable {
  constructor() { super(); this.chunks = []; this.isTTY = false; }
  _write(c, _enc, cb) { this.chunks.push(c); cb(); }
  get text() {
    return Buffer.concat(this.chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(String(c)))).toString("utf8");
  }
}

export function io() { return { out: new CaptureStream(), err: new CaptureStream() }; }

// Build a minimal .docx in-memory and write to disk. Returns the path.
// `paragraphs` is an array; each item is either a string or an array of run
// objects { text } (we don't need highlights for compare-cli).
export async function makeDocx(dir, name, paragraphs) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  zip.file("word/document.xml", buildDocumentXml(paragraphs));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const path = join(dir, name);
  writeFileSync(path, buf);
  return path;
}

function buildDocumentXml(paragraphs) {
  let nextId = 1;
  const xmlEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = paragraphs.map((p) => {
    const items = Array.isArray(p) ? p : [{ text: p }];
    const itemXml = items.map((item) => {
      // Track-changes insertion: { type: "ins", text, author?, date? }
      if (item.type === "ins") {
        const safe = xmlEscape(item.text);
        return `<w:ins w:id="${nextId++}" w:author="${xmlEscape(item.author || "")}" w:date="${xmlEscape(item.date || "")}"><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:ins>`;
      }
      // Track-changes deletion: { type: "del", text, author?, date? }
      if (item.type === "del") {
        const safe = xmlEscape(item.text);
        return `<w:del w:id="${nextId++}" w:author="${xmlEscape(item.author || "")}" w:date="${xmlEscape(item.date || "")}"><w:r><w:delText xml:space="preserve">${safe}</w:delText></w:r></w:del>`;
      }
      // Plain run
      return `<w:r><w:t xml:space="preserve">${xmlEscape(item.text)}</w:t></w:r>`;
    }).join("");
    return `<w:p>${itemXml}</w:p>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paras}</w:body>
</w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

// Build a minimal PDF in-memory and write to disk. Returns the path.
// `lines` is an array of strings; each becomes a line on a single page.
// We use the standard Helvetica Type1 font (built into every PDF reader),
// emit a single text object with multi-line text, and compute byte offsets
// so pdfjs-dist can parse it.
export function makePdf(dir, name, lines) {
  const path = join(dir, name);
  const buf = buildPdfBuffer(lines);
  writeFileSync(path, buf);
  return path;
}

function buildPdfBuffer(lines) {
  // Build a content stream with one line per Td move.
  const escaped = lines.map(escapePdfString);
  const stream = buildContentStream(escaped);
  const objs = [
    null, // 1-based; slot 0 is unused
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  // Assemble
  const header = "%PDF-1.4\n%\xC2\xA5\xC2\xB1\xC3\xAB\n"; // a binary marker line is conventional
  const chunks = [Buffer.from(header, "binary")];
  const offsets = [0]; // index 0 unused
  for (let i = 1; i < objs.length; i++) {
    offsets.push(chunks.reduce((s, c) => s + c.length, 0));
    chunks.push(Buffer.from(`${i} 0 obj\n${objs[i]}\nendobj\n`, "binary"));
  }
  const xrefStart = chunks.reduce((s, c) => s + c.length, 0);
  let xref = `xref\n0 ${objs.length}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i < objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "binary"));
  return Buffer.concat(chunks);
}

function buildContentStream(escapedLines) {
  let s = "BT\n/F1 12 Tf\n50 750 Td\n";
  for (let i = 0; i < escapedLines.length; i++) {
    if (i > 0) s += "0 -14 Td\n";
    s += `(${escapedLines[i]}) Tj\n`;
  }
  s += "ET";
  return s;
}

function escapePdfString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Helper to invoke main() with controlled IO and capture results.
export async function runMain(mainFn, argv, ioOverrides = {}) {
  const out = new CaptureStream();
  const err = new CaptureStream();
  const code = await mainFn(argv, { out, err, ...ioOverrides });
  return { code, out: out.text, err: err.text };
}

// Captures and restores environment variables for a single test.
export function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined || vars[k] === null) delete process.env[k];
    else process.env[k] = String(vars[k]);
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}
