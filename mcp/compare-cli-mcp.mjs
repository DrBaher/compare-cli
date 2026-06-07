#!/usr/bin/env node
// compare-cli-mcp — Model Context Protocol server wrapping compare-cli.
// Spec: ../docs/mcp.md. Single-file by design, matching the parent CLI.
//
// Three tools: compare_files, compare_with_negotiation, compare_demo.
// Stdio transport only in v1.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  readInput,
  readNegotiation,
  compareDocuments,
  computeExitClass,
  buildReportJson,
  formatReportHuman,
  applyClauseFilters,
  extractDocxText,
  extractPdfText,
  EXIT,
  VERSION as COMPARE_CLI_VERSION,
} from "compare-cli";
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { Writable } from "node:stream";

export const MCP_VERSION = "0.1.3";

// ----------------------------------------------------------------------------
// Error class — carries a stable code for the MCP error envelope.
// ----------------------------------------------------------------------------

export class McpToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "McpToolError";
  }
}

// ----------------------------------------------------------------------------
// Input materialization
// ----------------------------------------------------------------------------

// Resolve a `{ path | content_base64 | content_text, format? }` side spec to
// the shape compareDocuments expects: { path, text, format, lossiness }.
// Inline content is decoded in-memory; binary inline (.docx/.pdf) runs through
// the same extractors the CLI uses, so behavior matches byte-for-byte.
export async function materializeSide(spec, sideName) {
  if (!spec || typeof spec !== "object") {
    throw new McpToolError("INVALID_ARGS", `${sideName}: expected object with one of path / content_base64 / content_text`);
  }
  const modes = ["path", "content_base64", "content_text"].filter((k) => spec[k] != null);
  if (modes.length === 0) {
    throw new McpToolError("INVALID_ARGS", `${sideName}: must provide exactly one of path, content_base64, content_text`);
  }
  if (modes.length > 1) {
    throw new McpToolError("INVALID_ARGS", `${sideName}: only one of [${modes.join(", ")}] may be set`);
  }
  const mode = modes[0];

  if (mode === "path") {
    const resolved = enforceBaseDir(spec.path);
    try {
      return await readInput(resolved);
    } catch (e) {
      throw mapReadError(e, resolved);
    }
  }

  if (mode === "content_text") {
    const fmt = spec.format || "txt";
    if (fmt !== "md" && fmt !== "txt") {
      throw new McpToolError("INVALID_ARGS", `${sideName}: content_text supports format=md|txt, got ${JSON.stringify(spec.format)}`);
    }
    return {
      path: `<inline:${sideName}>`,
      text: String(spec.content_text),
      format: fmt === "md" ? "markdown" : "text",
      lossiness: "none",
    };
  }

  // content_base64
  if (!spec.format || !["docx", "pdf", "md", "txt"].includes(spec.format)) {
    throw new McpToolError("INVALID_ARGS", `${sideName}: content_base64 requires format ∈ {docx, pdf, md, txt}`);
  }
  let buf;
  try {
    buf = Buffer.from(spec.content_base64, "base64");
  } catch (e) {
    throw new McpToolError("INVALID_ARGS", `${sideName}: content_base64 is not valid base64: ${e.message}`);
  }
  try {
    if (spec.format === "docx") {
      const text = await extractDocxText(buf);
      return { path: `<inline:${sideName}>`, text, format: "docx", lossiness: "extracted" };
    }
    if (spec.format === "pdf") {
      const text = await extractPdfText(buf);
      if (text.length === 0) {
        throw new McpToolError("PDF_NO_TEXT_LAYER", `extracted zero characters from inline ${sideName}; PDF may be a scanned image without an OCR layer`, { side: sideName });
      }
      return { path: `<inline:${sideName}>`, text, format: "pdf", lossiness: "extracted" };
    }
    // md / txt
    const text = buf.toString("utf8");
    return {
      path: `<inline:${sideName}>`,
      text,
      format: spec.format === "md" ? "markdown" : "text",
      lossiness: "none",
    };
  } catch (e) {
    if (e instanceof McpToolError) throw e;
    throw new McpToolError("INPUT_MALFORMED", `${sideName}: ${e.message}`, { side: sideName, format: spec.format });
  }
}

// Apply the COMPARE_MCP_BASE_DIR lockdown: every path arg must resolve to a
// descendant of realpath(COMPARE_MCP_BASE_DIR). Symlinks collapsed first.
function enforceBaseDir(p) {
  const baseDir = process.env.COMPARE_MCP_BASE_DIR;
  if (!baseDir) return p;
  const resolved = isAbsolute(p) ? p : resolve(process.cwd(), p);
  let realBase, realPath;
  try {
    realBase = realpathSync(baseDir);
  } catch (e) {
    throw new McpToolError("PATH_OUTSIDE_BASE_DIR", `COMPARE_MCP_BASE_DIR=${baseDir} is not a readable directory: ${e.message}`, { base_dir: baseDir });
  }
  try {
    realPath = realpathSync(resolved);
  } catch {
    // File doesn't exist yet — check the parent directory still resolves inside base.
    const parent = resolve(resolved, "..");
    try {
      realPath = join(realpathSync(parent), resolved.slice(parent.length + 1));
    } catch {
      throw new McpToolError("INPUT_NOT_FOUND", `input not found: ${p}`, { path: p });
    }
  }
  if (realPath !== realBase && !realPath.startsWith(realBase + "/")) {
    throw new McpToolError("PATH_OUTSIDE_BASE_DIR", `path resolves outside COMPARE_MCP_BASE_DIR: ${p} → ${realPath} (base: ${realBase})`, { path: p, resolved: realPath, base_dir: realBase });
  }
  return realPath;
}

// Map a thrown error from readInput / readNegotiation to an McpToolError.
function mapReadError(e, path) {
  const msg = e && e.message ? e.message : String(e);
  // A raw ENOENT (e.g. from a direct readFileSync when COMPARE_MCP_BASE_DIR is
  // unset, so enforceBaseDir never ran a missing-file check) should map to
  // INPUT_NOT_FOUND, not the default INPUT_MALFORMED.
  if ((e && e.code === "ENOENT") || /input not found|cannot read|no such file/i.test(msg)) {
    return new McpToolError("INPUT_NOT_FOUND", msg, { path });
  }
  if (/malformed/i.test(msg)) {
    return new McpToolError("INPUT_MALFORMED", msg, { path });
  }
  if (/extracted zero characters/i.test(msg)) {
    return new McpToolError("PDF_NO_TEXT_LAYER", msg, { path });
  }
  return new McpToolError("INPUT_MALFORMED", msg, { path });
}

// ----------------------------------------------------------------------------
// Core comparison runner
// ----------------------------------------------------------------------------

// Runs the same pipeline that compare-cli's runCompare runs, returning the
// structured report. Throws McpToolError on I/O failures (mapped upstream).
export function runComparison({ base, candidate, strict = false, strict_cosmetic = false, only_clauses = null, ignore_clauses = null, negotiation_resolution = null }) {
  const { baseClauses, candClauses, baseDetect, candDetect, differences: rawDifferences } = compareDocuments(base, candidate);
  const { kept: differences, suppressed_count: suppressedByFilter } = applyClauseFilters(rawDifferences, {
    onlyClauses: only_clauses,
    ignoreClauses: ignore_clauses,
  });
  const exitInfo = computeExitClass(differences, { strict, strictCosmetic: strict_cosmetic });
  const warnings = [];
  if (base.format === "pdf") warnings.push("base was extracted from PDF; layout-sensitive differences may surface as false positives");
  if (candidate.format === "pdf") warnings.push("candidate was extracted from PDF; layout-sensitive differences may surface as false positives");

  const report = buildReportJson({
    base, candidate, baseClauses, candClauses, differences,
    exitClass: exitInfo.class, exitCode: exitInfo.code, warnings,
    suppressedByFilter,
  });

  // MCP-specific augmentation: surface where the agreed text came from when
  // running through compare_with_negotiation. See docs/mcp.md §6.
  if (negotiation_resolution) {
    report.base.negotiation_resolution = negotiation_resolution;
  }

  // detection-tier info is helpful to agents; expose alongside the per-side block.
  report.base.detection_tier = baseDetect.tier;
  report.candidate.detection_tier = candDetect.tier;

  return { report, baseDetect, candDetect };
}

// Build the MCP success envelope from a report (with optional human report).
function buildSuccessEnvelope(report, { includeHumanReport = false } = {}) {
  const jsonText = JSON.stringify(report, null, 2);
  const content = [{ type: "text", text: jsonText }];
  if (includeHumanReport) {
    const fakeStream = new Writable({ write(_c, _e, cb) { cb(); } });
    // No isTTY → renderer produces plain ANSI-stripped output (paint() falls back).
    const human = formatReportHuman(report, { stream: fakeStream, env: { NO_COLOR: "1" } });
    content.push({ type: "text", text: human });
  }
  return { content, structuredContent: report };
}

// Build the MCP error envelope from an McpToolError. Per the design doc §5.1,
// errors carry a stable `code` and a structured detail object.
function buildErrorEnvelope(err) {
  return {
    isError: true,
    content: [{ type: "text", text: `${err.code}: ${err.message}` }],
    structuredContent: { code: err.code, ...err.details },
  };
}

// Normalize an only_clauses / ignore_clauses argument to a frozen string[] or
// null. A bare (non-array) value used to reach .map and crash to INTERNAL_ERROR;
// reject it as INVALID_ARGS instead so the agent gets an actionable code.
function normalizeClauseFilter(value, name) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw new McpToolError("INVALID_ARGS", `${name}: expected an array of strings`);
  }
  return Object.freeze(value.map(String));
}

// ----------------------------------------------------------------------------
// Tool handlers
// ----------------------------------------------------------------------------

export async function handleCompareFiles(args) {
  const base = await materializeSide(args.base, "base");
  const candidate = await materializeSide(args.candidate, "candidate");
  const { report } = runComparison({
    base, candidate,
    strict: args.strict,
    strict_cosmetic: args.strict_cosmetic,
    only_clauses: normalizeClauseFilter(args.only_clauses, "only_clauses"),
    ignore_clauses: normalizeClauseFilter(args.ignore_clauses, "ignore_clauses"),
  });
  return buildSuccessEnvelope(report, { includeHumanReport: !!args.include_human_report });
}

export async function handleCompareWithNegotiation(args) {
  // Negotiation can come from path or content_json (parsed JSON object).
  const negSpec = args.negotiation;
  if (!negSpec || typeof negSpec !== "object") {
    throw new McpToolError("INVALID_ARGS", "negotiation: expected object with path or content_json");
  }
  const negModes = ["path", "content_json"].filter((k) => negSpec[k] != null);
  if (negModes.length !== 1) {
    throw new McpToolError("INVALID_ARGS", `negotiation: must provide exactly one of path, content_json (got ${negModes.length})`);
  }

  let baseText, negotiationResolution;
  if (negModes[0] === "path") {
    const negPath = enforceBaseDir(negSpec.path);
    try {
      const { text, resolution } = readNegotiationWithResolution(negPath, { requireSignoffs: !!args.require_signoffs });
      baseText = text;
      negotiationResolution = resolution;
    } catch (e) {
      if (/no agreed round/i.test(e.message)) {
        throw new McpToolError("NO_AGREED_ROUND", e.message, { path: negPath });
      }
      if (/not signed off/i.test(e.message)) {
        throw new McpToolError("NOT_SIGNED_OFF", e.message, { path: negPath });
      }
      throw mapReadError(e, negPath);
    }
  } else {
    // content_json — inline parsed object. We round-trip it through a temp file
    // so readNegotiation can do its canonical parse/validation; the temp dir is
    // always removed in finally (it must not outlive this call).
    const tmpdirPath = mkdtempSync(join(tmpdir(), "compare-cli-mcp-"));
    const negPath = join(tmpdirPath, "negotiation.json");
    try {
      writeFileSync(negPath, JSON.stringify(negSpec.content_json), "utf8");
      const { text, resolution } = readNegotiationWithResolution(negPath, { requireSignoffs: !!args.require_signoffs });
      baseText = text;
      negotiationResolution = resolution;
    } catch (e) {
      if (/no agreed round/i.test(e.message)) {
        throw new McpToolError("NO_AGREED_ROUND", e.message, { source: "content_json" });
      }
      if (/not signed off/i.test(e.message)) {
        throw new McpToolError("NOT_SIGNED_OFF", e.message, { source: "content_json" });
      }
      throw mapReadError(e, "<content_json>");
    } finally {
      rmSync(tmpdirPath, { recursive: true, force: true });
    }
  }

  const base = { path: negModes[0] === "path" ? negSpec.path : "<inline:negotiation>", text: baseText, format: "negotiation", lossiness: "none" };
  const candidate = await materializeSide(args.candidate, "candidate");
  const { report } = runComparison({
    base, candidate,
    strict: args.strict,
    strict_cosmetic: args.strict_cosmetic,
    only_clauses: normalizeClauseFilter(args.only_clauses, "only_clauses"),
    ignore_clauses: normalizeClauseFilter(args.ignore_clauses, "ignore_clauses"),
    negotiation_resolution: negotiationResolution,
  });
  return buildSuccessEnvelope(report, { includeHumanReport: !!args.include_human_report });
}

// Wrapper around readNegotiation that also tells us which signal produced the
// agreed text, so the MCP layer can surface negotiation_resolution.
function readNegotiationWithResolution(path, opts) {
  // The canonical read is the source of truth for BOTH the agreed text and any
  // user-facing error (missing file, malformed JSON, no agreed round). It runs
  // first so the engine's raw ENOENT / SyntaxError never leaks: readNegotiation
  // produces the canonical messages ("input not found", "malformed JSON in …")
  // that mapReadError keys off, keeping the error envelope stable.
  const text = readNegotiation(path, opts);
  // Derive the resolution label by replaying readNegotiation's *exact* tier
  // selection against the same parsed object, then matching the round whose
  // text it returned. This keeps negotiation_resolution honest: agents are
  // told to trust it for base provenance (docs/mcp.md §6), so it must never
  // disagree with the tier readNegotiation actually used (e.g. status agreed
  // but the only text lives in a per-round-agreed round). Best-effort: any
  // mismatch / parse hiccup degrades to "unknown" rather than throwing.
  let resolution = "unknown";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const rounds = Array.isArray(parsed.rounds) ? parsed.rounds : [];
    const AGREED = ["converged", "signed_off", "finalized"];
    // Tier 1: top-level status — returns the latest round that has text.
    if (typeof parsed.status === "string" && AGREED.includes(parsed.status)) {
      for (let i = rounds.length - 1; i >= 0; i--) {
        const r = rounds[i];
        if (r && typeof r === "object" && typeof r.text === "string") { resolution = "status"; break; }
      }
    }
    // Tier 2 + 3: per-round signals, latest-first, only on rounds with text.
    if (resolution === "unknown") {
      for (let i = rounds.length - 1; i >= 0; i--) {
        const r = rounds[i];
        if (!r || typeof r !== "object" || typeof r.text !== "string") continue;
        if (r.agreed === true) { resolution = "per_round_agreed"; break; }
        if (r.clause_status && typeof r.clause_status === "object") {
          const values = Object.values(r.clause_status);
          if (values.length > 0 && values.every((v) => v === "agreed")) { resolution = "clause_status"; break; }
        }
      }
    }
  } catch {
    resolution = "unknown";
  }
  return { text, resolution };
}

export async function handleCompareDemo() {
  // The CLI's --demo path constructs two synthetic inputs and runs the same
  // pipeline. We do the same here, importing the demo fixtures via main()'s
  // path is overkill — easier to just call materializeSide with content_text.
  // But since the fixtures live inside compare-cli's source, we instead drive
  // a known synthetic example here. The behavior contract (exit_class:
  // "substantive") matches the CLI's demo by construction.
  const base = {
    path: "<demo:base>",
    text: "## 1. Purpose\n\nMutual evaluation of a potential transaction.\n\n## 2. Term\n\nThe term of this agreement is two (2) years from the Effective Date.\n\n## 3. Notices\n\nNotices shall be in writing.\n\n## 4. Governing Law\n\nThis agreement is governed by Delaware law.\n",
    format: "text",
    lossiness: "none",
  };
  const candidate = {
    path: "<demo:candidate>",
    text: "## 1. Purpose\n\nMutual evaluation of a potential transaction.\n\n## 2. Term\n\nThe term of this agreement is three (3) years from the Effective Date.\n\n## 3. Notices\n\nNotices shall be in writing.\n\n## 4. Governing Law\n\nThis agreement is governed by Delaware law.\n",
    format: "text",
    lossiness: "none",
  };
  const { report } = runComparison({ base, candidate });
  return buildSuccessEnvelope(report);
}

// ----------------------------------------------------------------------------
// Tool catalog (the schemas backing tools/list)
// ----------------------------------------------------------------------------

const SIDE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  oneOf: [
    { required: ["path"] },
    { required: ["content_base64"] },
    { required: ["content_text"] },
  ],
  properties: {
    path: { type: "string", description: "Server reads this path with the process's privileges. Operators running this server for an unattended agent should restrict the working directory via COMPARE_MCP_BASE_DIR or run the server under a least-privileged user." },
    content_base64: { type: "string", description: "Base64-encoded bytes. Required for .docx / .pdf inline." },
    content_text: { type: "string", description: "UTF-8 text. Convenience channel for md/txt inputs." },
    format: { type: "string", enum: ["docx", "pdf", "md", "txt"], description: "Required with content_base64. With content_text, optional (default 'txt')." },
  },
});

const REPORT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  description: "compare-cli --json report shape (stable across v1.x). See AGENTS.md and COMPARE_SCHEMA.md §10.",
  properties: {
    ok: { type: "boolean" },
    exit_class: { type: "string", enum: ["clean", "cosmetic", "typographic", "substantive", "moved"] },
    exit_code: { type: "integer" },
    base: { type: "object" },
    candidate: { type: "object" },
    summary: { type: "object" },
    differences: { type: "array" },
    warnings: { type: "array" },
  },
  required: ["ok", "exit_class", "exit_code", "base", "candidate", "summary", "differences", "warnings"],
});

export const TOOLS = Object.freeze([
  {
    name: "compare_files",
    description: "Compare two contract documents and return clause-aware drift classification. Returns the same structured report as `compare --json`. Substantive drift returns a successful response with exit_class='substantive'; it is NOT an MCP error.",
    inputSchema: {
      type: "object",
      properties: {
        base: SIDE_INPUT_SCHEMA,
        candidate: SIDE_INPUT_SCHEMA,
        strict: { type: "boolean", default: false, description: "Upgrade typographic drift to substantive." },
        strict_cosmetic: { type: "boolean", default: false, description: "Upgrade cosmetic drift to substantive." },
        only_clauses: { type: "array", items: { type: "string" }, description: "Case-insensitive substring patterns matched against normalized clause titles; keep only matches." },
        ignore_clauses: { type: "array", items: { type: "string" }, description: "Same semantics as only_clauses but exclusion. Composes with only_clauses (ignore runs after)." },
        include_human_report: { type: "boolean", default: false, description: "Also return the human-readable report as a second text content block." },
      },
      required: ["base", "candidate"],
    },
    outputSchema: REPORT_OUTPUT_SCHEMA,
  },
  {
    name: "compare_with_negotiation",
    description: "Compare a candidate document against the agreed text in an nda-review-cli negotiation.json. Three-tier resolution (status: converged|signed_off|finalized → per-round agreed: true → per-round clause_status all 'agreed'). Returns the structured report with `base.negotiation_resolution` indicating which signal produced the agreed text. NO_AGREED_ROUND surfaces as an MCP error (a precondition failure, not drift).",
    inputSchema: {
      type: "object",
      properties: {
        negotiation: {
          type: "object",
          oneOf: [{ required: ["path"] }, { required: ["content_json"] }],
          properties: {
            path: { type: "string", description: "Path to negotiation.json. Same security note as compare_files.base.path." },
            content_json: { type: "object", description: "Inline negotiation object (already parsed)." },
          },
        },
        candidate: SIDE_INPUT_SCHEMA,
        strict: { type: "boolean", default: false },
        strict_cosmetic: { type: "boolean", default: false },
        require_signoffs: { type: "boolean", default: false, description: "Agents invoking this tool in unattended pipelines (no human reviewer downstream) should pass require_signoffs: true. Treats a negotiation lacking per-clause signoff metadata as a precondition failure rather than as substantive drift." },
        only_clauses: { type: "array", items: { type: "string" } },
        ignore_clauses: { type: "array", items: { type: "string" } },
        include_human_report: { type: "boolean", default: false },
      },
      required: ["negotiation", "candidate"],
    },
    outputSchema: REPORT_OUTPUT_SCHEMA,
  },
  {
    name: "compare_demo",
    description: "Run a zero-argument synthetic comparison against bundled fixtures. Deterministically returns exit_class='substantive' (the fixtures contain a Term-clause change). Use to confirm the server is wired up end-to-end without constructing a fixture.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: REPORT_OUTPUT_SCHEMA,
  },
]);

// ----------------------------------------------------------------------------
// Dispatch
// ----------------------------------------------------------------------------

export async function dispatchMcp(toolName, args) {
  try {
    switch (toolName) {
      case "compare_files": return await handleCompareFiles(args || {});
      case "compare_with_negotiation": return await handleCompareWithNegotiation(args || {});
      case "compare_demo": return await handleCompareDemo();
      default: throw new McpToolError("INVALID_ARGS", `unknown tool: ${toolName}`, { tool: toolName });
    }
  } catch (e) {
    if (e instanceof McpToolError) return buildErrorEnvelope(e);
    // Unexpected — surface as a generic error envelope so the agent isn't blind.
    return buildErrorEnvelope(new McpToolError("INTERNAL_ERROR", e.message || String(e)));
  }
}

// ----------------------------------------------------------------------------
// Server (stdio transport)
// ----------------------------------------------------------------------------

export async function serveMcpStdio() {
  const server = new Server(
    { name: "compare-cli-mcp", version: MCP_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    return await dispatchMcp(name, args);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ----------------------------------------------------------------------------
// Entry
// ----------------------------------------------------------------------------

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // Don't log to stdout — stdio transport claims it.
  serveMcpStdio().catch((e) => {
    process.stderr.write(`compare-cli-mcp: fatal: ${e.message || e}\n`);
    process.exit(1);
  });
}
