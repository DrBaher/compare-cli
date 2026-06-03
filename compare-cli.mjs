#!/usr/bin/env node
// compare-cli — clause-aware drift detection between two contract versions.
// Part of the contract-ops suite. MIT. See LICENSE.
//
// Spec: COMPARE_SCHEMA.md
// Sibling reference: draft-cli.mjs

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

export const VERSION = "0.4.1";

// Stable exit codes. Documented in AGENTS.md and never re-numbered without a
// major-version bump.
export const EXIT = Object.freeze({
  OK: 0,
  IO: 1,
  SUBSTANTIVE: 2,
  COSMETIC: 3,
  MOVED: 4,
});

export class UsageError extends Error {
  constructor(msg) { super(msg); this.name = "UsageError"; }
}

// ----------------------------------------------------------------------------
// ANSI color (honors NO_COLOR / FORCE_COLOR per no-color.org)
// ----------------------------------------------------------------------------

export function colorEnabled(stream, env = process.env) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR) return true;
  return Boolean(stream && stream.isTTY);
}

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

export function paint(stream, color, s, env = process.env) {
  return colorEnabled(stream, env) ? `${ANSI[color] || ""}${s}${ANSI.reset}` : s;
}

// ----------------------------------------------------------------------------
// Argv parser
// ----------------------------------------------------------------------------

const KNOWN_FLAGS = Object.freeze([
  "--help", "-h",
  "--version", "-V",
  "--demo",
  "--json",
  "--sarif",
  "--why",
  "--strict",
  "--strict-cosmetic",
  "--silent", "-q",
  "--check",
  "--from-negotiation",
  "--require-signoffs",
  "--only-clauses",
  "--ignore-clauses",
  "--no-intra-diff",
  "--output", "-o",
  "--completion",
  "--catalog",
]);

export function parseArgs(argv) {
  const opts = {
    base: null,
    candidate: null,
    fromNegotiation: null,
    output: null,
    json: false,
    sarif: false,
    why: false,
    strict: false,
    strictCosmetic: false,
    silent: false,
    check: false,
    requireSignoffs: false,
    onlyClauses: null,
    ignoreClauses: null,
    noIntraDiff: false,
    help: false,
    version: false,
    demo: false,
    completion: null,
    catalog: null,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--version" || a === "-V") opts.version = true;
    else if (a === "--demo") opts.demo = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--sarif") opts.sarif = true;
    else if (a === "--why") opts.why = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--strict-cosmetic") opts.strictCosmetic = true;
    else if (a === "--silent" || a === "-q") opts.silent = true;
    else if (a === "--check") opts.check = true;
    else if (a === "--require-signoffs") opts.requireSignoffs = true;
    else if (a === "--no-intra-diff") opts.noIntraDiff = true;
    else if (a === "--only-clauses") opts.onlyClauses = parseClausePatterns(requireValue(argv, ++i, "--only-clauses"));
    else if (a.startsWith("--only-clauses=")) opts.onlyClauses = parseClausePatterns(a.slice("--only-clauses=".length));
    else if (a === "--ignore-clauses") opts.ignoreClauses = parseClausePatterns(requireValue(argv, ++i, "--ignore-clauses"));
    else if (a.startsWith("--ignore-clauses=")) opts.ignoreClauses = parseClausePatterns(a.slice("--ignore-clauses=".length));
    else if (a === "--from-negotiation") opts.fromNegotiation = requireValue(argv, ++i, "--from-negotiation");
    else if (a.startsWith("--from-negotiation=")) opts.fromNegotiation = a.slice("--from-negotiation=".length);
    else if (a === "--output" || a === "-o") opts.output = requireValue(argv, ++i, "--output");
    else if (a.startsWith("--output=")) opts.output = a.slice("--output=".length);
    else if (a === "--catalog") opts.catalog = requireValue(argv, ++i, "--catalog");
    else if (a.startsWith("--catalog=")) opts.catalog = a.slice("--catalog=".length);
    else if (a === "--completion") {
      const v = requireValue(argv, ++i, "--completion");
      if (v !== "bash" && v !== "zsh") throw new UsageError(`--completion: unknown shell '${v}' (want bash or zsh)`);
      opts.completion = v;
    }
    else if (a === "--") { /* end-of-flags marker */ for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]); break; }
    else if (a.startsWith("-") && a !== "-") throw new UsageError(`unknown flag: ${a}${suggest(a)}`);
    else positional.push(a);
  }

  // --check implies --silent (suppress stderr too) — single discoverable flag
  // for the CI use case where only the exit code matters.
  if (opts.check) opts.silent = true;

  // --json and --sarif are mutually exclusive output formats.
  if (opts.json && opts.sarif) throw new UsageError("--json and --sarif are mutually exclusive");

  // --require-signoffs is meaningful only with --from-negotiation.
  if (opts.requireSignoffs && opts.fromNegotiation === null && !opts.help && !opts.version && !opts.demo && opts.catalog === null && opts.completion === null) {
    throw new UsageError("--require-signoffs requires --from-negotiation");
  }

  if (opts.help || opts.version || opts.demo || opts.completion !== null || opts.catalog !== null) return { opts, positional };

  if (opts.fromNegotiation !== null) {
    if (positional.length !== 1) {
      throw new UsageError(`--from-negotiation expects exactly one positional (the candidate); got ${positional.length}`);
    }
    opts.candidate = positional[0];
  } else {
    if (positional.length !== 2) {
      throw new UsageError(`compare expects exactly two positionals (BASE and CANDIDATE); got ${positional.length}`);
    }
    [opts.base, opts.candidate] = positional;
  }

  if (opts.base === "-" && opts.candidate === "-") {
    throw new UsageError("both inputs cannot be stdin (-)");
  }
  return { opts, positional };
}

function requireValue(argv, i, flag) {
  const v = argv[i];
  if (v === undefined) throw new UsageError(`${flag} requires a value`);
  return v;
}

// Parse the value of --only-clauses / --ignore-clauses. Comma-separated;
// each pattern is lowercased and trimmed; empties dropped. Returned as a
// frozen list of lowercase substrings.
export function parseClausePatterns(s) {
  if (typeof s !== "string") return null;
  const parts = s.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts.length > 0 ? Object.freeze(parts) : null;
}

// Test whether a clause title matches any of a pattern list (case-insensitive
// substring). Patterns are matched against normalizeTitle(title) for
// numbering-agnostic behavior.
export function clauseTitleMatches(title, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const norm = normalizeTitle(title);
  for (const p of patterns) {
    if (norm.includes(p)) return true;
  }
  return false;
}

// Apply --only-clauses / --ignore-clauses filters to a differences[] list.
// Returns { kept, suppressed_count } where suppressed_count counts the
// classification-bearing diffs that were dropped (anything not in `kept`).
export function applyClauseFilters(differences, { onlyClauses = null, ignoreClauses = null } = {}) {
  if (!onlyClauses && !ignoreClauses) return { kept: differences, suppressed_count: 0 };
  const kept = [];
  let suppressed = 0;
  for (const d of differences) {
    let pass = true;
    if (onlyClauses && !clauseTitleMatches(d.clause_title, onlyClauses)) pass = false;
    if (pass && ignoreClauses && clauseTitleMatches(d.clause_title, ignoreClauses)) pass = false;
    if (pass) kept.push(d);
    else suppressed++;
  }
  return { kept, suppressed_count: suppressed };
}

function suggest(unknown) {
  let best = null;
  let bestD = 4;
  for (const k of KNOWN_FLAGS) {
    const d = levenshtein(unknown, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best ? ` (did you mean ${best}?)` : "";
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// ----------------------------------------------------------------------------
// Input format detection
// ----------------------------------------------------------------------------

export function detectFormat(path) {
  if (path === "-") return "text";
  const ext = extname(path).toLowerCase();
  if (ext === ".docx") return "docx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "text";
}

// ----------------------------------------------------------------------------
// Input readers
// ----------------------------------------------------------------------------

export async function readInput(path, opts = {}) {
  if (path === "-") {
    const text = await (opts.stdinReader ? opts.stdinReader() : readStdin());
    return { path, text, format: "text", lossiness: "none" };
  }
  if (!existsSync(path)) {
    const e = new Error(`input not found: ${path}`); e.exit = EXIT.IO; throw e;
  }
  const fmt = detectFormat(path);
  if (fmt === "docx") {
    let buf;
    try { buf = readFileSync(path); }
    catch (err) { const e = new Error(`cannot read ${path}: ${err.message}`); e.exit = EXIT.IO; throw e; }
    let text, trackChanges = [];
    try {
      text = await extractDocxText(buf);
      trackChanges = await extractDocxTrackChanges(buf);
    } catch (err) { const e = new Error(`malformed .docx: ${path} (${err.message})`); e.exit = EXIT.IO; throw e; }
    return { path, text, format: "docx", lossiness: "none", track_changes: trackChanges };
  }
  if (fmt === "pdf") {
    let buf;
    try { buf = readFileSync(path); }
    catch (err) { const e = new Error(`cannot read ${path}: ${err.message}`); e.exit = EXIT.IO; throw e; }
    let text;
    try { text = await extractPdfText(buf); }
    catch (err) { const e = new Error(`malformed .pdf: ${path} (${err.message})`); e.exit = EXIT.IO; throw e; }
    if (!text || text.replace(/\s/g, "").length === 0) {
      const e = new Error(`extracted zero characters from ${path}; PDF may be a scanned image without an OCR layer`);
      e.exit = EXIT.IO; throw e;
    }
    return { path, text, format: "pdf", lossiness: "extracted" };
  }
  // markdown / text
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch (err) { const e = new Error(`cannot read ${path}: ${err.message}`); e.exit = EXIT.IO; throw e; }
  return { path, text, format: fmt, lossiness: "none" };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString("utf8");
}

export async function extractDocxText(buf) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("no word/document.xml in archive");
  const xml = await docFile.async("string");
  const paragraphs = [];
  const paraRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  const matches = xml.match(paraRe) || [];
  for (const para of matches) {
    const runs = [];
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = textRe.exec(para)) !== null) runs.push(decodeXmlEntities(m[1]));
    paragraphs.push(runs.join(""));
  }
  return paragraphs.join("\n");
}

// Extract WordprocessingML track-changes ops from a .docx buffer.
// Returns a flat list of { op: "ins"|"del", text, author, date } in document
// order. Insertions (`<w:ins>`) and deletions (`<w:del>`) are returned in
// document-order interleave, but the consumer should treat the list as
// observational metadata rather than a temporal log — the spec doesn't
// guarantee chronological order within a document.
//
// v1 surfaces TC as informational (alongside text-diff classification);
// future versions may use TC as ground truth where both sides have it.
export async function extractDocxTrackChanges(buf) {
  const { default: JSZip } = await import("jszip");
  let zip;
  try { zip = await JSZip.loadAsync(buf); }
  catch { return []; }  // not a valid zip → no TC
  const docFile = zip.file("word/document.xml");
  if (!docFile) return [];
  const xml = await docFile.async("string");
  const ops = [];
  // Iterate <w:ins>...</w:ins> and <w:del>...</w:del> in document order.
  // The author/date come from attributes on the wrapping element; the text
  // content lives in <w:t> (for ins) or <w:delText> (for del) nested inside.
  const blockRe = /<w:(ins|del)\b([^>]*)>([\s\S]*?)<\/w:\1>/g;
  let m;
  while ((m = blockRe.exec(xml)) !== null) {
    const op = m[1];
    const attrs = m[2];
    const inner = m[3];
    const author = (attrs.match(/\bw:author="([^"]*)"/) || [])[1] || "";
    const date = (attrs.match(/\bw:date="([^"]*)"/) || [])[1] || "";
    const textTag = op === "del" ? "w:delText" : "w:t";
    const textRe = new RegExp(`<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${textTag}>`, "g");
    const parts = [];
    let t;
    while ((t = textRe.exec(inner)) !== null) parts.push(decodeXmlEntities(t[1]));
    ops.push({ op, text: parts.join(""), author, date });
  }
  return ops;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function extractPdfText(buf) {
  // pdfjs-dist v5 ships an ESM build at pdfjs-dist/legacy/build/pdf.mjs that
  // works in Node without DOM polyfills. The non-legacy build assumes a
  // browser environment.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const uint8 = new Uint8Array(buf);
  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let pageText = "";
    let lastY = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const transform = item.transform;
      const y = transform ? transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
        if (!/\n$/.test(pageText)) pageText += "\n";
      } else if (pageText.length > 0 && !/\s$/.test(pageText) && !/^\s/.test(item.str)) {
        pageText += " ";
      }
      pageText += item.str;
      if (item.hasEOL) {
        if (!/\n$/.test(pageText)) pageText += "\n";
      }
      lastY = y;
    }
    pages.push(pageText.trim());
  }
  return pages.join("\n\n");
}

// ----------------------------------------------------------------------------
// Clause detection — implements docs/clause-detection.md rule v1.0
// (also implemented by template-vault-CLI v0.4.0 in Python; both must update
// in lockstep when the rule changes).
// ----------------------------------------------------------------------------

export function detectClauses(text) {
  // Phase 1: H2 (## ...)
  let clauses = detectByTitleLines(text, h2Match);
  if (clauses.length > 0) return { tier: "h2", clauses };
  // Phase 2: bold-prefix
  clauses = detectByTitleLines(text, boldPrefixMatch);
  if (clauses.length > 0) return { tier: "bold-prefix", clauses };
  // Phase 3: ALL-CAPS
  clauses = detectByTitleLines(text, allCapsMatch);
  if (clauses.length > 0) return { tier: "all-caps", clauses };
  // Phase 4: synthetic single-clause fallback
  return { tier: "synthetic", clauses: [{ title: "Document", body: text.trim() }] };
}

function h2Match(line) {
  const m = line.match(/^##\s+(.+?)\s*$/);
  return m ? m[1].trim() : null;
}

function boldPrefixMatch(line) {
  const m = line.match(/^\*\*(\d+(?:\.\d+)*\.?\s+.+?)\*\*\s*$/);
  return m ? m[1].trim() : null;
}

function allCapsMatch(line) {
  const trimmed = line.trim();
  return isAllCapsHeading(trimmed) ? trimmed : null;
}

export function isAllCapsHeading(s) {
  if (s.length < 3) return false;
  if (s.startsWith("[")) return false;
  let hasLetter = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/[A-Za-z]/.test(ch)) {
      hasLetter = true;
      if (ch !== ch.toUpperCase()) return false;
    }
  }
  if (!hasLetter) return false;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return true;
  if (tokens.length === 1) {
    const letters = tokens[0].replace(/[^A-Za-z]/g, "");
    if (letters.length >= 4) return true;
  }
  return false;
}

function detectByTitleLines(text, matcher) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const titleLines = [];
  for (let i = 0; i < lines.length; i++) {
    const t = matcher(lines[i]);
    if (t !== null) titleLines.push({ title: t, line: i });
  }
  if (titleLines.length === 0) return [];
  const clauses = [];
  for (let i = 0; i < titleLines.length; i++) {
    const start = titleLines[i].line + 1;
    const end = i + 1 < titleLines.length ? titleLines[i + 1].line : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    clauses.push({ title: titleLines[i].title, body });
  }
  return clauses;
}

export function normalizeTitle(title) {
  let s = String(title);
  s = s.replace(/^\d+(?:\.\d+)*\.?\s+/, "");
  s = s.toLowerCase();
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[.,;:!?]+$/, "");
  return s;
}

// ----------------------------------------------------------------------------
// Normalization (cosmetic / typographic)
// ----------------------------------------------------------------------------

export function cosmeticNormalize(s) {
  let r = String(s);
  r = r.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  r = r.replace(/[   -   　]/g, " ");
  r = r.replace(/[‘’‚‛]/g, "'");
  r = r.replace(/[“”„‟]/g, '"');
  r = r.replace(/[–—]/g, "-");
  r = r.replace(/…/g, "...");
  r = r.replace(/\s+/g, " ");
  return r.trim();
}

export function typographicNormalize(s) {
  let r = cosmeticNormalize(s);
  r = r.toLowerCase();
  let prev;
  do {
    prev = r;
    r = r.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  } while (r !== prev);
  r = r.replace(/(\d)\.0+(?=\D|$)/g, "$1");
  r = r.replace(/,\s+(and|or)\s+/g, " $1 ");
  return r;
}

// ----------------------------------------------------------------------------
// Per-clause classification
// ----------------------------------------------------------------------------

export function classifyDiff(a, b) {
  if (a === b) return "clean";
  if (cosmeticNormalize(a) === cosmeticNormalize(b)) return "cosmetic";
  if (typographicNormalize(a) === typographicNormalize(b)) return "typographic";
  return "substantive";
}

// ----------------------------------------------------------------------------
// Alignment + move detection
// ----------------------------------------------------------------------------

export function alignClauses(baseClauses, candClauses) {
  const baseByTitle = new Map();
  baseClauses.forEach((c, i) => {
    const k = normalizeTitle(c.title);
    if (!baseByTitle.has(k)) baseByTitle.set(k, []);
    baseByTitle.get(k).push(i);
  });
  const candByTitle = new Map();
  candClauses.forEach((c, i) => {
    const k = normalizeTitle(c.title);
    if (!candByTitle.has(k)) candByTitle.set(k, []);
    candByTitle.get(k).push(i);
  });
  const pairs = [];
  const baseUsed = new Set();
  const candUsed = new Set();
  for (const [title, baseIdxs] of baseByTitle) {
    const candIdxs = candByTitle.get(title) || [];
    const n = Math.min(baseIdxs.length, candIdxs.length);
    for (let i = 0; i < n; i++) {
      pairs.push({ baseIdx: baseIdxs[i], candIdx: candIdxs[i] });
      baseUsed.add(baseIdxs[i]);
      candUsed.add(candIdxs[i]);
    }
  }
  const added = [];
  candClauses.forEach((_, i) => { if (!candUsed.has(i)) added.push(i); });
  const removed = [];
  baseClauses.forEach((_, i) => { if (!baseUsed.has(i)) removed.push(i); });
  return { pairs, added, removed };
}

export function detectMoves(pairs) {
  // Find the longest increasing subsequence (LIS) of candIdx values when pairs
  // are sorted by baseIdx. Pairs not in the LIS have "moved".
  const byBase = [...pairs].sort((a, b) => a.baseIdx - b.baseIdx);
  if (byBase.length <= 1) return new Set();
  const candSeq = byBase.map((p) => p.candIdx);
  const lisIndices = longestIncreasingSubsequenceIndices(candSeq);
  const inLis = new Set(lisIndices);
  const moved = new Set();
  for (let i = 0; i < byBase.length; i++) {
    if (!inLis.has(i)) moved.add(byBase[i].baseIdx);
  }
  return moved;
}

function longestIncreasingSubsequenceIndices(arr) {
  const n = arr.length;
  if (n === 0) return [];
  const tails = [];
  const tailsIdx = [];
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < arr[i]) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tailsIdx[lo - 1];
    tails[lo] = arr[i];
    tailsIdx[lo] = i;
  }
  const result = [];
  let k = tailsIdx[tailsIdx.length - 1];
  while (k !== -1) { result.push(k); k = prev[k]; }
  return result.reverse();
}

// ----------------------------------------------------------------------------
// negotiation.json reader (--from-negotiation)
// See COMPARE_SCHEMA.md §9 for the three-tier resolution.
// ----------------------------------------------------------------------------

// nda-review-cli statuses that mean "agreement is reached and stable" and
// therefore the latest round's text is the agreed base. See
// https://github.com/DrBaher/nda-review-cli/blob/main/docs/reference/state-file.md
const AGREED_TOP_LEVEL_STATUSES = new Set(["converged", "signed_off", "finalized"]);

export function readNegotiation(path, {
  readFile = readFileSync,
  exists = existsSync,
  requireSignoffs = false,
} = {}) {
  if (!exists(path)) {
    const e = new Error(`input not found: ${path}`); e.exit = EXIT.IO; throw e;
  }
  let raw;
  try { raw = readFile(path, "utf8"); }
  catch (err) { const e = new Error(`cannot read ${path}: ${err.message}`); e.exit = EXIT.IO; throw e; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) { const e = new Error(`malformed JSON in ${path}: ${err.message}`); e.exit = EXIT.IO; throw e; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rounds) || parsed.rounds.length === 0) {
    const e = new Error(`${path}: expected an object with a non-empty 'rounds' array`); e.exit = EXIT.IO; throw e;
  }

  // Optional safety check (--require-signoffs): both parties must have a
  // non-empty signoff string in the top-level signoffs object. Per nda-review-
  // cli's state-file.md, signoffs.a and signoffs.b are populated by the
  // `negotiate sign-off --as a/b` command after both parties review.
  if (requireSignoffs) {
    const so = parsed.signoffs;
    const aOk = so && typeof so.a === "string" && so.a.length > 0;
    const bOk = so && typeof so.b === "string" && so.b.length > 0;
    if (!aOk || !bOk) {
      const missing = [];
      if (!aOk) missing.push("a");
      if (!bOk) missing.push("b");
      const e = new Error(
        `--require-signoffs: ${path} is not signed off by both parties\n` +
        `       (missing signoffs.${missing.join(" and signoffs.")})`
      );
      e.exit = EXIT.SUBSTANTIVE;
      throw e;
    }
  }

  // Tier 1: top-level status — nda-review-cli's authoritative convergence signal.
  if (typeof parsed.status === "string" && AGREED_TOP_LEVEL_STATUSES.has(parsed.status)) {
    for (let i = parsed.rounds.length - 1; i >= 0; i--) {
      const r = parsed.rounds[i];
      if (typeof r === "object" && r !== null && typeof r.text === "string") return r.text;
    }
  }
  // Tier 2 + 3: per-round signals — minimum schema (agreed: true) then
  // historical de-facto fallback (clause_status all "agreed"), latest first.
  for (let i = parsed.rounds.length - 1; i >= 0; i--) {
    const r = parsed.rounds[i];
    if (typeof r !== "object" || r === null) continue;
    if (typeof r.text !== "string") continue;
    if (r.agreed === true) return r.text;
    if (r.clause_status && typeof r.clause_status === "object") {
      const values = Object.values(r.clause_status);
      if (values.length > 0 && values.every((v) => v === "agreed")) return r.text;
    }
  }
  const e = new Error(
    `--from-negotiation: no agreed round found in ${path}\n` +
    `       (expected top-level status: "converged" | "signed_off" | "finalized",\n` +
    `        or a round with agreed: true,\n` +
    `        or a round with clause_status all "agreed")`
  );
  e.exit = EXIT.SUBSTANTIVE;
  throw e;
}

// ----------------------------------------------------------------------------
// Core comparison
// ----------------------------------------------------------------------------

export function compareDocuments(base, candidate) {
  const baseDetect = detectClauses(base.text);
  const candDetect = detectClauses(candidate.text);
  const baseClauses = baseDetect.clauses;
  const candClauses = candDetect.clauses;

  const { pairs, added, removed } = alignClauses(baseClauses, candClauses);

  const pairClassifications = pairs.map((p) => ({
    ...p,
    class: classifyDiff(baseClauses[p.baseIdx].body, candClauses[p.candIdx].body),
  }));

  // Move detection runs over ALL pairs (LCS over the full title order); per
  // §8.3 the "moved" classification is then only emitted when the body is
  // also clean — for non-clean bodies, the body class wins and moved stays
  // silent.
  const moved = detectMoves(pairClassifications);

  const differences = [];
  for (const p of pairClassifications) {
    if (p.class === "clean") {
      if (moved.has(p.baseIdx)) {
        differences.push({
          class: "moved",
          clause_title: baseClauses[p.baseIdx].title,
          clause_index_base: p.baseIdx + 1,
          clause_index_candidate: p.candIdx + 1,
          base: baseClauses[p.baseIdx].body,
          candidate: candClauses[p.candIdx].body,
        });
      }
    } else {
      differences.push({
        class: p.class,
        clause_title: baseClauses[p.baseIdx].title,
        clause_index_base: p.baseIdx + 1,
        clause_index_candidate: p.candIdx + 1,
        base: baseClauses[p.baseIdx].body,
        candidate: candClauses[p.candIdx].body,
      });
    }
  }
  for (const i of added) {
    differences.push({
      class: "added",
      clause_title: candClauses[i].title,
      clause_index_base: null,
      clause_index_candidate: i + 1,
      base: null,
      candidate: candClauses[i].body,
    });
  }
  for (const i of removed) {
    differences.push({
      class: "removed",
      clause_title: baseClauses[i].title,
      clause_index_base: i + 1,
      clause_index_candidate: null,
      base: baseClauses[i].body,
      candidate: null,
    });
  }
  differences.sort((a, b) => {
    const aa = a.clause_index_base ?? Number.POSITIVE_INFINITY;
    const bb = b.clause_index_base ?? Number.POSITIVE_INFINITY;
    if (aa !== bb) return aa - bb;
    const ac = a.clause_index_candidate ?? Number.POSITIVE_INFINITY;
    const bc = b.clause_index_candidate ?? Number.POSITIVE_INFINITY;
    return ac - bc;
  });

  return { baseClauses, candClauses, baseDetect, candDetect, differences };
}

export function computeExitClass(differences, { strict = false, strictCosmetic = false } = {}) {
  const hasSubstantive = differences.some((d) => d.class === "substantive" || d.class === "added" || d.class === "removed");
  const hasTypographic = differences.some((d) => d.class === "typographic");
  const hasCosmetic = differences.some((d) => d.class === "cosmetic");
  const hasMoved = differences.some((d) => d.class === "moved");
  if (hasSubstantive) return { class: "substantive", code: EXIT.SUBSTANTIVE };
  if (strict && hasTypographic) return { class: "substantive", code: EXIT.SUBSTANTIVE };
  if (strictCosmetic && hasCosmetic) return { class: "substantive", code: EXIT.SUBSTANTIVE };
  if (hasTypographic) return { class: "typographic", code: EXIT.COSMETIC };
  if (hasCosmetic) return { class: "cosmetic", code: EXIT.COSMETIC };
  if (hasMoved) return { class: "moved", code: EXIT.MOVED };
  return { class: "clean", code: EXIT.OK };
}

// ----------------------------------------------------------------------------
// Report builders
// ----------------------------------------------------------------------------

export function buildReportJson({ base, candidate, baseClauses, candClauses, differences, exitClass, exitCode, warnings, suppressedByFilter = 0 }) {
  const counts = { cosmetic: 0, typographic: 0, substantive: 0, added: 0, removed: 0, moved: 0 };
  for (const d of differences) counts[d.class] = (counts[d.class] || 0) + 1;
  // Track-changes metadata flows through unchanged from readInput when the
  // input is .docx and contained <w:ins> / <w:del> elements. Always an
  // array — empty when the input has no TC or isn't .docx. v0.3.0 surfaces
  // as informational; future versions may use it for classification.
  const baseTc = Array.isArray(base.track_changes) ? base.track_changes : [];
  const candTc = Array.isArray(candidate.track_changes) ? candidate.track_changes : [];
  return {
    ok: exitCode === EXIT.OK,
    exit_class: exitClass,
    exit_code: exitCode,
    base: { path: base.path, format: base.format, lossiness: base.lossiness, clauses_total: baseClauses.length, track_changes: baseTc },
    candidate: { path: candidate.path, format: candidate.format, lossiness: candidate.lossiness, clauses_total: candClauses.length, track_changes: candTc },
    summary: {
      clauses_total: Math.max(baseClauses.length, candClauses.length),
      clauses_changed: counts.cosmetic + counts.typographic + counts.substantive,
      clauses_moved: counts.moved,
      clauses_added: counts.added,
      clauses_removed: counts.removed,
      differences: counts,
      suppressed_by_filter: suppressedByFilter,
    },
    differences,
    warnings,
  };
}

// SARIF v2.1.0 — https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html
// Each difference becomes one `result` with:
//   ruleId        compare-cli.<class>     (substantive, cosmetic, typographic, added, removed, moved)
//   level         error | warning | note  (substantive → error; cosmetic/typographic → warning; the rest → note)
//   message.text  "[<class>] <clause_title> — <short summary>"
//   locations     candidate file URI; substantive/cosmetic/typographic also reference the base file as a related location
// The CLI-level exit_class is encoded as a top-level invocation property and
// as a single "synthetic" result so CI systems can show one summary annotation.
const SARIF_LEVEL_BY_CLASS = {
  substantive: "error",
  cosmetic: "warning",
  typographic: "warning",
  added: "note",
  removed: "note",
  moved: "note",
};

const SARIF_RULES = [
  { id: "compare-cli.substantive", name: "SubstantiveDrift", shortDescription: { text: "Substantive content change between clauses — do not sign without review." } },
  { id: "compare-cli.cosmetic", name: "CosmeticDrift", shortDescription: { text: "Whitespace or Unicode-presentation difference only." } },
  { id: "compare-cli.typographic", name: "TypographicDrift", shortDescription: { text: "Case / number-format / Oxford-comma difference only." } },
  { id: "compare-cli.added", name: "ClauseAdded", shortDescription: { text: "Candidate has a clause not present in base." } },
  { id: "compare-cli.removed", name: "ClauseRemoved", shortDescription: { text: "Base has a clause not present in candidate." } },
  { id: "compare-cli.moved", name: "ClauseMoved", shortDescription: { text: "Clause moved to a different position; body identical." } },
];

// SARIF allows relative URIs; for absolute paths use the file:// prefix.
// Windows paths (e.g. C:\Users\... or C:/Users/...) become file:///C:/...
// with backslashes flipped to forward slashes per the file-URI scheme.
export function pathToFileUri(p) {
  if (p === "-" || p == null) return "stdin";
  if (p.startsWith("<")) return p;                       // demo synthetic paths like <demo:base>
  if (p.startsWith("/")) return `file://${p}`;           // POSIX absolute
  if (/^[A-Za-z]:[\\/]/.test(p)) {                       // Windows absolute
    return `file:///${p.replace(/\\/g, "/")}`;
  }
  return p;                                              // relative — pass through
}

export function buildReportSarif(report) {
  const results = [];
  for (const d of report.differences) {
    const level = SARIF_LEVEL_BY_CLASS[d.class] || "note";
    const summary = d.class === "moved"
      ? `moved from position ${d.clause_index_base} to ${d.clause_index_candidate}`
      : d.class === "added"
      ? `added in candidate`
      : d.class === "removed"
      ? `removed from base`
      : `body differs (base vs candidate)`;
    const r = {
      ruleId: `compare-cli.${d.class}`,
      level,
      message: { text: `[${d.class}] ${d.clause_title} — ${summary}` },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: pathToFileUri(report.candidate.path) },
        },
        message: { text: `clause ${d.clause_index_candidate ?? "(n/a)"} in candidate` },
      }],
    };
    if (d.clause_index_base != null) {
      r.relatedLocations = [{
        physicalLocation: { artifactLocation: { uri: pathToFileUri(report.base.path) } },
        message: { text: `clause ${d.clause_index_base} in base` },
      }];
    }
    results.push(r);
  }
  return {
    version: "2.1.0",
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    runs: [{
      tool: {
        driver: {
          name: "compare-cli",
          version: VERSION,
          informationUri: "https://github.com/DrBaher/compare-cli",
          rules: SARIF_RULES,
        },
      },
      invocations: [{
        executionSuccessful: true,
        exitCode: report.exit_code,
        properties: {
          exit_class: report.exit_class,
          suppressed_by_filter: report.summary.suppressed_by_filter || 0,
          track_changes_base: (report.base.track_changes || []).length,
          track_changes_candidate: (report.candidate.track_changes || []).length,
        },
      }],
      results,
      properties: {
        base_path: report.base.path,
        candidate_path: report.candidate.path,
        clauses_total_base: report.base.clauses_total,
        clauses_total_candidate: report.candidate.clauses_total,
      },
    }],
  };
}

// Word-level diff between two strings using Hunt–McIlroy LCS over whitespace-
// separated tokens. Returns ops as { op: "equal"|"removed"|"added", text }.
// Whitespace and punctuation collapse into the token boundary (each run of
// non-whitespace becomes one token). For human display in formatReportHuman.
export function wordDiff(a, b) {
  const ta = a.split(/(\s+)/).filter((t) => t.length > 0);
  const tb = b.split(/(\s+)/).filter((t) => t.length > 0);
  const m = ta.length, n = tb.length;
  // Edge cases
  if (m === 0 && n === 0) return [];
  if (m === 0) return [{ op: "added", text: tb.join("") }];
  if (n === 0) return [{ op: "removed", text: ta.join("") }];
  // LCS table
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (ta[i] === tb[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Walk back through the table emitting ops
  const ops = [];
  let i = 0, j = 0;
  const push = (op, text) => {
    if (text.length === 0) return;
    const last = ops[ops.length - 1];
    if (last && last.op === op) last.text += text;
    else ops.push({ op, text });
  };
  while (i < m && j < n) {
    if (ta[i] === tb[j]) { push("equal", ta[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("removed", ta[i]); i++; }
    else { push("added", tb[j]); j++; }
  }
  while (i < m) { push("removed", ta[i]); i++; }
  while (j < n) { push("added", tb[j]); j++; }
  return ops;
}

// Compute the "change density" of a word diff — the fraction of total
// characters that are part of an added or removed op. Used to decide whether
// to render intra-diff inline (low density = readable) or fall back to the
// two-line format (high density = unreadable spaghetti).
export function wordDiffChangeDensity(ops) {
  let changed = 0, total = 0;
  for (const o of ops) {
    total += o.text.length;
    if (o.op !== "equal") changed += o.text.length;
  }
  return total === 0 ? 0 : changed / total;
}

const INTRA_DIFF_DENSITY_THRESHOLD = 0.7;

// Render a word-diff ops list for human output. With color: removed = red
// strikethrough-ish (using paint), added = green. Without color: GitHub-style
// `[-removed-]` / `{+added+}` markers.
function renderWordDiff(ops, stream, env) {
  const useColor = colorEnabled(stream, env);
  const parts = [];
  for (const o of ops) {
    const t = sanitizeControl(o.text);
    if (o.op === "equal") parts.push(t);
    else if (o.op === "removed") parts.push(useColor ? paint(stream, "red", t, env) : `[-${t}-]`);
    else parts.push(useColor ? paint(stream, "green", t, env) : `{+${t}+}`);
  }
  return parts.join("");
}

const CLASS_COLOR = {
  cosmetic: "cyan",
  typographic: "yellow",
  substantive: "red",
  added: "green",
  removed: "magenta",
  moved: "blue",
};
const CLASS_LABEL = {
  cosmetic: "cosmetic",
  typographic: "typographic",
  substantive: "substantive",
  added: "added",
  removed: "removed",
  moved: "moved",
};

// Threshold: combined base+candidate longer than this falls back to the
// two-line format (intra-diff would be too long to read inline).
const INTRA_DIFF_MAX_COMBINED_LEN = 600;

export function formatReportHuman(report, { stream, env = process.env, intraDiff = true } = {}) {
  const lines = [];
  const c = (color, s) => paint(stream, color, s, env);
  const head = c("bold", `compare: ${report.base.path}  →  ${report.candidate.path}`);
  lines.push(head);
  lines.push(c("dim", `  base:      ${report.base.format} (${report.base.lossiness}), ${report.base.clauses_total} clauses`));
  lines.push(c("dim", `  candidate: ${report.candidate.format} (${report.candidate.lossiness}), ${report.candidate.clauses_total} clauses`));
  lines.push("");
  const counts = report.summary.differences;
  const total = counts.cosmetic + counts.typographic + counts.substantive + counts.added + counts.removed + counts.moved;
  if (total === 0) {
    lines.push(c("green", "✓ no drift — every clause matches"));
  } else {
    const parts = [];
    for (const k of ["substantive", "added", "removed", "typographic", "cosmetic", "moved"]) {
      if (counts[k] > 0) parts.push(c(CLASS_COLOR[k], `${counts[k]} ${CLASS_LABEL[k]}`));
    }
    lines.push(`summary: ${parts.join(", ")}`);
    if (report.summary.suppressed_by_filter > 0) {
      lines.push(c("dim", `         ${report.summary.suppressed_by_filter} difference(s) suppressed by --only-clauses / --ignore-clauses`));
    }
    lines.push("");
    for (const d of report.differences) {
      const tag = c(CLASS_COLOR[d.class] || "yellow", `[${d.class}]`);
      const idx = d.class === "added"
        ? `(candidate clause ${d.clause_index_candidate})`
        : d.class === "removed"
        ? `(base clause ${d.clause_index_base})`
        : `(clause ${d.clause_index_base}${d.clause_index_base !== d.clause_index_candidate ? ` → ${d.clause_index_candidate}` : ""})`;
      lines.push(`${tag} ${sanitizeControl(d.clause_title)} ${c("dim", idx)}`);
      if (d.class === "moved") {
        lines.push(c("dim", `       moved from position ${d.clause_index_base} to position ${d.clause_index_candidate}`));
      } else if (d.class === "added") {
        lines.push(c("dim", `       + ${truncate(d.candidate)}`));
      } else if (d.class === "removed") {
        lines.push(c("dim", `       - ${truncate(d.base)}`));
      } else {
        const baseText = d.base || "";
        const candText = d.candidate || "";
        const wantIntra = intraDiff && d.class === "substantive"
          && (baseText.length + candText.length) <= INTRA_DIFF_MAX_COMBINED_LEN;
        if (wantIntra) {
          const ops = wordDiff(baseText, candText);
          if (wordDiffChangeDensity(ops) <= INTRA_DIFF_DENSITY_THRESHOLD) {
            lines.push(`       ${renderWordDiff(ops, stream, env)}`);
            continue;
          }
        }
        lines.push(c("red", `       - ${truncate(baseText)}`));
        lines.push(c("green", `       + ${truncate(candText)}`));
      }
    }
  }
  // Track-changes summary — present on .docx with <w:ins>/<w:del> elements.
  // Surface counts + authors as a one-block addendum; the verdict and class
  // counts above are unchanged (TC is informational in v0.3.0).
  const baseTcCount = (report.base.track_changes || []).length;
  const candTcCount = (report.candidate.track_changes || []).length;
  if (baseTcCount > 0 || candTcCount > 0) {
    lines.push("");
    lines.push(c("dim", "track-changes (Word):"));
    const summary = (side, ops) => {
      if (ops.length === 0) return null;
      const ins = ops.filter((o) => o.op === "ins").length;
      const del = ops.filter((o) => o.op === "del").length;
      const authors = [...new Set(ops.map((o) => o.author).filter(Boolean))].map(sanitizeControl);
      const auth = authors.length > 0 ? ` (authors: ${authors.join(", ")})` : "";
      return `  ${side}:      ${ins} insertion(s), ${del} deletion(s)${auth}`;
    };
    const baseLine = summary("base    ", report.base.track_changes || []);
    const candLine = summary("candidate", report.candidate.track_changes || []);
    if (baseLine) lines.push(c("dim", baseLine));
    if (candLine) lines.push(c("dim", candLine));
  }
  if (report.warnings.length > 0) {
    lines.push("");
    for (const w of report.warnings) lines.push(c("yellow", `warning: ${w}`));
  }
  lines.push("");
  const verdictText = report.exit_class === "clean"
    ? "safe to sign (exit 0)"
    : report.exit_class === "substantive"
    ? "substantive drift — DO NOT sign without review (exit 2)"
    : report.exit_class === "moved"
    ? "clauses moved but content identical (exit 4)"
    : `${report.exit_class} drift only — informational (exit 3)`;
  const verdictColor = report.exit_code === EXIT.OK ? "green" : report.exit_code === EXIT.SUBSTANTIVE ? "red" : "yellow";
  lines.push(c(verdictColor, `verdict: ${verdictText}`));
  return lines.join("\n") + "\n";
}

// Strip C0 control characters (except \n and \t) from counterparty-controlled
// strings before printing to a TTY. Without this, raw ESC (0x1b) in docx
// track-change author names or clause titles/bodies could inject ANSI escape
// sequences / terminal control codes. JSON/SARIF modes are unaffected (they
// serialize the raw string), so this lives in the human formatter only.
function sanitizeControl(s) {
  if (s == null) return "";
  return String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

function truncate(s, n = 180) {
  if (s == null) return "";
  const flat = sanitizeControl(String(s)).replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : flat.slice(0, n - 1) + "…";
}

export function formatWhyBlock(report, opts) {
  const lines = [];
  lines.push(`why: input.base=${report.base.path} format=${report.base.format} lossiness=${report.base.lossiness} clauses=${report.base.clauses_total}`);
  lines.push(`why: input.candidate=${report.candidate.path} format=${report.candidate.format} lossiness=${report.candidate.lossiness} clauses=${report.candidate.clauses_total}`);
  lines.push(`why: detection.tier.base=${opts.baseTier} detection.tier.candidate=${opts.candTier}`);
  lines.push(`why: alignment.method=lcs.titles`);
  const d = report.summary.differences;
  lines.push(`why: classes.cosmetic=${d.cosmetic} typographic=${d.typographic} substantive=${d.substantive} added=${d.added} removed=${d.removed} moved=${d.moved}`);
  lines.push(`why: exit_class=${report.exit_class} exit_code=${report.exit_code}`);
  lines.push(`why: strict=${opts.strict} strict_cosmetic=${opts.strictCosmetic}`);
  // Clause filters (added in 0.2.1): surface only when set or when something
  // was actually suppressed, so the line is informative when present rather
  // than noise on every run.
  const only = opts.onlyClauses ? opts.onlyClauses.join("|") : "";
  const ignore = opts.ignoreClauses ? opts.ignoreClauses.join("|") : "";
  const suppressed = report.summary.suppressed_by_filter || 0;
  if (only || ignore || suppressed > 0) {
    lines.push(`why: filter.only_clauses=${only || "-"} filter.ignore_clauses=${ignore || "-"} filter.suppressed=${suppressed}`);
  }
  const baseTc = (report.base.track_changes || []).length;
  const candTc = (report.candidate.track_changes || []).length;
  if (baseTc > 0 || candTc > 0) {
    lines.push(`why: track_changes.base=${baseTc} track_changes.candidate=${candTc}`);
  }
  return lines.join("\n") + "\n";
}

// ----------------------------------------------------------------------------
// Demo fixtures
// ----------------------------------------------------------------------------

export const DEMO_BASE = `## 1. Purpose

This agreement governs the exchange of confidential information between
Acme Corporation and Globex Inc.

## 2. Term

The term of this agreement is two (2) years from the Effective Date.

## 3. Confidentiality Obligations

Each party agrees to hold the Confidential Information in strict confidence
and to not disclose it to any third party without prior written consent.

## 4. Notices

All notices shall be delivered to the addresses set forth on the cover page.
`;

export const DEMO_CANDIDATE = `## 1. Purpose

This agreement governs the exchange of confidential information between
Acme Corporation and Globex Inc.

## 2. Term

The term of this agreement is three (3) years from the Effective Date.

## 3. Confidentiality Obligations

Each party agrees to hold the Confidential Information in strict confidence
and to not disclose it to any third party without prior written consent.

## 4. Notices

All notices shall be delivered to the addresses set forth on the cover page.
`;

// ----------------------------------------------------------------------------
// Shell completion
// ----------------------------------------------------------------------------

export function completionScript(shell) {
  if (shell === "bash") {
    return `# compare-cli bash completion
_compare_cli_complete() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  opts="--help --version --demo --json --sarif --why --strict --strict-cosmetic --silent --check --from-negotiation --require-signoffs --only-clauses --ignore-clauses --no-intra-diff --output --completion --catalog"
  case "\$prev" in
    --completion) COMPREPLY=( $(compgen -W "bash zsh" -- "\$cur") ); return 0 ;;
    --from-negotiation|--output) COMPREPLY=( $(compgen -f -- "\$cur") ); return 0 ;;
  esac
  if [[ "\$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "\$opts" -- "\$cur") )
  else
    COMPREPLY=( $(compgen -f -- "\$cur") )
  fi
}
complete -F _compare_cli_complete compare
`;
  }
  if (shell === "zsh") {
    return `# compare-cli zsh completion
#compdef compare
_compare_cli() {
  local -a opts
  opts=(
    '--help[Show usage]'
    '--version[Print version]'
    '--demo[Run a zero-file 30-second first run]'
    '--json[Emit JSON report]'
    '--sarif[Emit SARIF v2.1.0 for CI annotations]'
    '--why[Print structured stderr explanation]'
    '--strict[Treat typographic drift as substantive]'
    '--strict-cosmetic[Treat cosmetic drift as substantive]'
    '--silent[Suppress stderr]'
    '-q[Suppress stderr]'
    '--check[Suppress all output; communicate via exit code only]'
    '--from-negotiation[Read base from negotiation.json]:negotiation.json:_files'
    '--require-signoffs[Require both parties signed off in negotiation.json]'
    '--only-clauses[Comma-separated clause patterns to include]:patterns:'
    '--ignore-clauses[Comma-separated clause patterns to exclude]:patterns:'
    '--no-intra-diff[Disable inline word-level diff]'
    '--output[Write report to PATH]:path:_files'
    '--completion[Emit shell completion]:shell:(bash zsh)'
    '*:file:_files'
  )
  _arguments -s \$opts
}
_compare_cli "\$@"
`;
  }
  throw new UsageError(`--completion: unknown shell '${shell}'`);
}

// ----------------------------------------------------------------------------
// Help / version
// ----------------------------------------------------------------------------

const HELP_TEXT = `compare-cli ${VERSION} — clause-aware drift detection between two contract versions.

USAGE
  compare BASE CANDIDATE [options]
  compare --from-negotiation NEG.json CANDIDATE [options]
  compare --demo [--json]

ARGS
  BASE        what was agreed (.docx | .pdf | .md | .txt | - for stdin)
  CANDIDATE   what is being put forward (same formats, or -)

OPTIONS
  --from-negotiation PATH   read base text from nda-review-cli's negotiation.json
  --require-signoffs        with --from-negotiation, require both parties to have signed off
  --only-clauses PATTERNS   comma-separated; only include matching clause titles in the report + exit code
  --ignore-clauses PATTERNS comma-separated; exclude matching clause titles from the report + exit code
  --strict                  treat typographic drift as substantive (exit 2)
  --strict-cosmetic         treat cosmetic drift as substantive (exit 2)
  --json                    emit structured JSON to stdout
  --sarif                   emit SARIF v2.1.0 to stdout (for code-scanning / CI annotations)
  --no-intra-diff           disable inline word-level diff inside substantive clauses (use two-line - / + format)
  --why                     print structured explanation to stderr
  --silent, -q              suppress stderr
  --check                   suppress all output; communicate via exit code only (implies --silent)
  --output, -o PATH         write report to PATH instead of stdout (ignored with --check)
  --completion bash|zsh     emit shell completion script
  --demo                    run a zero-file 30-second demo
  --catalog json            machine-readable command + flag inventory (for agents)
  --version, -V             print version
  --help, -h                show this help

EXIT CODES
  0   no drift, safe to sign
  1   I/O error
  2   substantive drift (or --strict/--strict-cosmetic tripped)
  3   cosmetic-only / typographic-only drift (informational)
  4   clause(s) moved but content identical

DOCS
  https://github.com/DrBaher/compare-cli  •  See COMPARE_SCHEMA.md for the locked contract.

Part of the contract-ops suite — https://cli.drbaher.com
`;

// ----------------------------------------------------------------------------
// main()
// ----------------------------------------------------------------------------

/**
 * Machine-readable command + flag inventory, emitted by `compare --catalog json`.
 * Mirrors the suite-wide discovery contract (every contract-ops CLI answers
 * `--catalog json`). compare is flag-based, so this is a flag inventory — note
 * the exit codes are drift severities, not the suite's usual error codes.
 */
export function getCatalog() {
  return {
    name: "compare-cli",
    bin: "compare",
    version: VERSION,
    description: "Clause-aware drift detection between two contract versions.",
    usage: [
      "compare <base> <candidate> [options]",
      "compare --from-negotiation negotiation.json <candidate> [options]",
      "compare --demo",
      "compare - <candidate>   (read base from stdin)",
    ],
    flags: [
      { name: "--json", type: "boolean", help: "Emit the structured verdict as JSON (stable across v1.x)." },
      { name: "--sarif", type: "boolean", help: "Emit SARIF 2.1.0 for code-scanning; mutually exclusive with --json." },
      { name: "--why", type: "boolean", help: "Explain the classification (inline word-diff for substantive changes)." },
      { name: "--check", type: "boolean", help: "Exit-code-only gate (implies --silent)." },
      { name: "--strict", type: "boolean", help: "Upgrade typographic drift to substantive (exit 2)." },
      { name: "--strict-cosmetic", type: "boolean", help: "Upgrade cosmetic-only drift to substantive (exit 2)." },
      { name: "--from-negotiation", arg: "FILE", help: "Read the agreed base text from nda-review-cli's negotiation.json." },
      { name: "--require-signoffs", type: "boolean", help: "With --from-negotiation, require both parties' sign-offs." },
      { name: "--only-clauses", arg: "PATTERNS", help: "Restrict comparison to matching clause titles." },
      { name: "--ignore-clauses", arg: "PATTERNS", help: "Exclude matching clause titles from comparison." },
      { name: "--no-intra-diff", type: "boolean", help: "Skip the inline word-diff within changed clauses." },
      { name: "--output", aliases: ["-o"], arg: "PATH", help: "Write the report to PATH (default: stdout)." },
      { name: "--silent", aliases: ["-q"], type: "boolean", help: "Suppress stderr output." },
      { name: "--completion", arg: "bash|zsh", help: "Emit a shell completion script." },
      { name: "--demo", type: "boolean", help: "Run the bundled drift demo (exits 2)." },
      { name: "--catalog", arg: "json", help: "Print this catalog and exit (agents call at startup)." },
      { name: "--help", aliases: ["-h"], type: "boolean", help: "Show usage and exit." },
      { name: "--version", aliases: ["-V"], type: "boolean", help: "Print version and exit." },
    ],
    inputs: "Two positionals (base, candidate); each accepts .docx / .pdf / .md / .txt and `-` for stdin. With --from-negotiation, one positional (the candidate).",
    discovery: { catalog: "compare --catalog json", json: "compare <base> <candidate> --json" },
    exitCodes: {
      "0": "clean — clauses match (safe to sign)",
      "1": "I/O error",
      "2": "substantive drift — do not sign without review",
      "3": "cosmetic / typographic drift only (informational)",
      "4": "clauses moved but content identical",
    },
    note: "Exit codes 2/3/4 are drift severities, not errors — they differ from the suite's common 0/2/3/4 meanings.",
  };
}

const COMPARE_FIRST_RUN_HINT = `compare — clause-aware drift gate between two contract versions.

Try this:
  compare --demo                       zero-config demo (exits 2 on the fixture)
  compare <base> <candidate>           human report
  compare <base> <candidate> --json    structured verdict for agents

Exit codes: 0 clean · 2 substantive drift · 3 cosmetic/typographic · 4 clauses moved.
Part of the contract-ops CLI suite: template-vault → draft → nda-review → compare → docx2pdf → sign.
Docs: https://cli.drbaher.com/tools/compare-cli/  ·  compare --help
`;

export async function main(argv, io = {}) {
  const out = io.out || process.stdout;
  const err = io.err || process.stderr;
  const env = io.env || process.env;
  const stdinReader = io.stdinReader;

  // Bare invocation (no args at all) → friendly first-run hint, not an error.
  if (argv.length === 0) { out.write(COMPARE_FIRST_RUN_HINT); return EXIT.OK; }

  let parsed;
  try { parsed = parseArgs(argv); }
  catch (e) {
    err.write(`error: ${e.message}\n`);
    return EXIT.IO;
  }
  const { opts } = parsed;

  if (opts.help) { out.write(HELP_TEXT); return EXIT.OK; }
  if (opts.version) { out.write(`compare-cli ${VERSION}\n`); return EXIT.OK; }
  if (opts.catalog) {
    if (opts.catalog !== "json") { err.write(`unknown --catalog format '${opts.catalog}'. Supported: json\n`); return EXIT.IO; }
    out.write(JSON.stringify(getCatalog(), null, 2) + "\n");
    return EXIT.OK;
  }
  if (opts.completion) {
    try { out.write(completionScript(opts.completion)); return EXIT.OK; }
    catch (e) { err.write(`error: ${e.message}\n`); return EXIT.IO; }
  }

  // --demo: synthesize base + candidate from bundled fixtures and compare.
  if (opts.demo) {
    return await runCompare({
      base: { path: "<demo:base>", text: DEMO_BASE, format: "text", lossiness: "none" },
      candidate: { path: "<demo:candidate>", text: DEMO_CANDIDATE, format: "text", lossiness: "none" },
      opts, out, err, env,
    });
  }

  // Resolve base + candidate
  let base, candidate;
  try {
    if (opts.fromNegotiation) {
      const text = readNegotiation(opts.fromNegotiation, { requireSignoffs: opts.requireSignoffs });
      base = { path: opts.fromNegotiation, text, format: "negotiation", lossiness: "none" };
    } else {
      base = await readInput(opts.base, { stdinReader });
    }
    candidate = await readInput(opts.candidate, { stdinReader });
  } catch (e) {
    if (!opts.silent) {
      if (opts.json) {
        out.write(JSON.stringify({ ok: false, error: e.message, exit_class: "error", exit_code: e.exit || EXIT.IO }, null, 2) + "\n");
      } else if (opts.sarif) {
        out.write(JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "compare-cli", version: VERSION } }, invocations: [{ executionSuccessful: false, exitCode: e.exit || EXIT.IO, exitCodeDescription: e.message }], results: [] }] }, null, 2) + "\n");
      } else {
        err.write(`error: ${e.message}\n`);
      }
    }
    return e.exit || EXIT.IO;
  }

  return await runCompare({ base, candidate, opts, out, err, env });
}

async function runCompare({ base, candidate, opts, out, err, env }) {
  const { baseClauses, candClauses, baseDetect, candDetect, differences: rawDifferences } = compareDocuments(base, candidate);

  // Apply --only-clauses / --ignore-clauses BEFORE classification so the
  // exit code only reflects what the user asked us to care about.
  const { kept: differences, suppressed_count: suppressedByFilter } = applyClauseFilters(rawDifferences, {
    onlyClauses: opts.onlyClauses,
    ignoreClauses: opts.ignoreClauses,
  });

  const exitInfo = computeExitClass(differences, { strict: opts.strict, strictCosmetic: opts.strictCosmetic });

  const warnings = [];
  if (base.format === "pdf") warnings.push("base was extracted from PDF; layout-sensitive differences may surface as false positives");
  if (candidate.format === "pdf") warnings.push("candidate was extracted from PDF; layout-sensitive differences may surface as false positives");

  const report = buildReportJson({
    base, candidate, baseClauses, candClauses, differences,
    exitClass: exitInfo.class, exitCode: exitInfo.code, warnings,
    suppressedByFilter,
  });

  // --why goes to stderr unless --silent
  if (opts.why && !opts.silent) {
    err.write(formatWhyBlock(report, {
      baseTier: baseDetect.tier,
      candTier: candDetect.tier,
      strict: opts.strict,
      strictCosmetic: opts.strictCosmetic,
      onlyClauses: opts.onlyClauses,
      ignoreClauses: opts.ignoreClauses,
    }));
  }
  // Non-json warnings also go to stderr (json/sarif modes embed them in the payload)
  if (!opts.json && !opts.sarif && !opts.silent) {
    for (const w of warnings) err.write(`warning: ${w}\n`);
  }

  const body = opts.sarif
    ? JSON.stringify(buildReportSarif(report), null, 2) + "\n"
    : opts.json
    ? JSON.stringify(report, null, 2) + "\n"
    : formatReportHuman(report, { stream: out, env, intraDiff: !opts.noIntraDiff });

  // --check suppresses stdout entirely (exit code is the result). --output is
  // also skipped under --check (the user said they only care about the code).
  if (opts.check) {
    return exitInfo.code;
  }

  if (opts.output && opts.output !== "-") {
    const { writeFileSync } = await import("node:fs");
    try { writeFileSync(opts.output, body, "utf8"); }
    catch (e) {
      const msg = `cannot write ${opts.output}: ${e.message}`;
      if (!opts.silent) {
        if (opts.json) {
          err.write(JSON.stringify({ ok: false, error: msg, exit_class: "error", exit_code: EXIT.IO }, null, 2) + "\n");
        } else if (opts.sarif) {
          err.write(JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "compare-cli", version: VERSION } }, invocations: [{ executionSuccessful: false, exitCode: EXIT.IO, exitCodeDescription: msg }], results: [] }] }, null, 2) + "\n");
        } else {
          err.write(`error: ${msg}\n`);
        }
      }
      return EXIT.IO;
    }
  } else {
    out.write(body);
  }
  return exitInfo.code;
}

// ----------------------------------------------------------------------------
// Entrypoint
// ----------------------------------------------------------------------------

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] || ""));
  } catch { return false; }
})();

if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`error: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(EXIT.IO);
  });
}
