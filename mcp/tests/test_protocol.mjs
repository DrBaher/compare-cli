// Conformance + snapshot tests for compare-cli-mcp.
//
// Two layers:
// 1. Direct dispatchMcp tests (fast, exercises the handler / mapping logic).
// 2. tools/list snapshot vs a checked-in golden (catches schema drift).
//
// A future iteration may add a full stdio-spawned conformance test using
// @modelcontextprotocol/sdk's client transport. For v0.1.0 the SDK plumbing
// is exercised in the smoke step (mcp/README.md shows the manual recipe);
// the wire-shape stability the design promises is enforced by the golden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dispatchMcp,
  TOOLS,
  MCP_VERSION,
  materializeSide,
  McpToolError,
} from "../compare-cli-mcp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(__dirname, "fixtures", "tools-list.json");

// ---------------------------------------------------------------------------
// Tool catalog & snapshot
// ---------------------------------------------------------------------------

test("MCP_VERSION is set", () => {
  assert.match(MCP_VERSION, /^\d+\.\d+\.\d+/);
});

test("exactly three tools exposed (compare_files, compare_with_negotiation, compare_demo)", () => {
  assert.equal(TOOLS.length, 3);
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, ["compare_demo", "compare_files", "compare_with_negotiation"]);
});

test("every tool declares an outputSchema (lets generic agent loops validate)", () => {
  for (const t of TOOLS) {
    assert.ok(t.outputSchema, `tool ${t.name} missing outputSchema`);
  }
});

test("tools/list golden snapshot — schema drift fails loudly", () => {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
  // Compare structurally — JSON.stringify with stable key order via the
  // golden's own iteration so we don't fail on harmless key reordering.
  const actual = JSON.parse(JSON.stringify(TOOLS));
  assert.deepEqual(actual, golden,
    "tools/list snapshot drift. If this change is intentional, " +
    "bump the compare-cli-mcp minor version per docs/mcp.md §8.2 and " +
    "regenerate the golden with: node -e 'import(\"../compare-cli-mcp.mjs\").then(m => process.stdout.write(JSON.stringify(JSON.parse(JSON.stringify(m.TOOLS)), null, 2)))' > tests/fixtures/tools-list.json");
});

// ---------------------------------------------------------------------------
// compare_demo
// ---------------------------------------------------------------------------

test("compare_demo: succeeds and returns exit_class=substantive", async () => {
  const r = await dispatchMcp("compare_demo", {});
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.exit_class, "substantive");
  assert.equal(r.structuredContent.exit_code, 2);
  assert.ok(r.structuredContent.differences.length >= 1);
  // content[0] is a text JSON serialization mirror — older clients use it
  assert.ok(r.content[0]);
  assert.equal(r.content[0].type, "text");
  const echoed = JSON.parse(r.content[0].text);
  assert.equal(echoed.exit_class, "substantive");
});

// ---------------------------------------------------------------------------
// compare_files: inline content_text → clean
// ---------------------------------------------------------------------------

test("compare_files: two equivalent inline text inputs → exit_class=clean", async () => {
  const r = await dispatchMcp("compare_files", {
    base: { content_text: "## A\n\nbody.\n" },
    candidate: { content_text: "## A\n\nbody.\n" },
  });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.exit_class, "clean");
  assert.equal(r.structuredContent.differences.length, 0);
});

test("compare_files: inline content_text with substantive change", async () => {
  const r = await dispatchMcp("compare_files", {
    base: { content_text: "## A\n\noriginal body.\n" },
    candidate: { content_text: "## A\n\nchanged body.\n" },
  });
  assert.equal(r.structuredContent.exit_class, "substantive");
  assert.equal(r.structuredContent.differences[0].class, "substantive");
});

test("compare_files: include_human_report adds a second content block", async () => {
  const r = await dispatchMcp("compare_files", {
    base: { content_text: "## A\n\nbody.\n" },
    candidate: { content_text: "## A\n\nbody changed.\n" },
    include_human_report: true,
  });
  assert.equal(r.content.length, 2);
  assert.equal(r.content[1].type, "text");
  assert.match(r.content[1].text, /\[substantive\]/);
  assert.match(r.content[1].text, /verdict:/);
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

test("compare_files: nonexistent path → MCP error code INPUT_NOT_FOUND", async () => {
  const r = await dispatchMcp("compare_files", {
    base: { path: "/no/such/path.md" },
    candidate: { content_text: "x" },
  });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.code, "INPUT_NOT_FOUND");
});

test("compare_files: missing required side → INVALID_ARGS", async () => {
  const r = await dispatchMcp("compare_files", { base: {}, candidate: { content_text: "x" } });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.code, "INVALID_ARGS");
  assert.match(r.content[0].text, /must provide exactly one of/);
});

test("compare_files: both path and content_text → INVALID_ARGS", async () => {
  const r = await dispatchMcp("compare_files", {
    base: { path: "/x", content_text: "y" },
    candidate: { content_text: "x" },
  });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.code, "INVALID_ARGS");
  assert.match(r.content[0].text, /only one of/);
});

test("unknown tool → INVALID_ARGS", async () => {
  const r = await dispatchMcp("compare_made_up", {});
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.code, "INVALID_ARGS");
});

// ---------------------------------------------------------------------------
// compare_with_negotiation
// ---------------------------------------------------------------------------

test("compare_with_negotiation: agreed round + matching candidate → clean", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-cli-mcp-test-"));
  const negPath = join(dir, "neg.json");
  writeFileSync(negPath, JSON.stringify({
    rounds: [{ round: 1, text: "## A\n\nbody.\n", agreed: true }],
  }));
  const r = await dispatchMcp("compare_with_negotiation", {
    negotiation: { path: negPath },
    candidate: { content_text: "## A\n\nbody.\n" },
  });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.exit_class, "clean");
  // Resolution surfaced for agent auditability
  assert.equal(r.structuredContent.base.negotiation_resolution, "per_round_agreed");
});

test("compare_with_negotiation: status:converged → negotiation_resolution=status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-cli-mcp-test-"));
  const negPath = join(dir, "neg.json");
  writeFileSync(negPath, JSON.stringify({
    rounds: [{ round: 1, text: "## A\n\nbody.\n" }],
    status: "converged",
  }));
  const r = await dispatchMcp("compare_with_negotiation", {
    negotiation: { path: negPath },
    candidate: { content_text: "## A\n\nbody.\n" },
  });
  assert.equal(r.structuredContent.base.negotiation_resolution, "status");
});

test("compare_with_negotiation: no agreed round → NO_AGREED_ROUND (MCP error)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-cli-mcp-test-"));
  const negPath = join(dir, "neg.json");
  writeFileSync(negPath, JSON.stringify({
    rounds: [{ round: 1, text: "x", agreed: false }],
  }));
  const r = await dispatchMcp("compare_with_negotiation", {
    negotiation: { path: negPath },
    candidate: { content_text: "x" },
  });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.code, "NO_AGREED_ROUND");
});

test("compare_with_negotiation: content_json inline negotiation works", async () => {
  const r = await dispatchMcp("compare_with_negotiation", {
    negotiation: {
      content_json: { rounds: [{ round: 1, text: "## A\n\nbody.\n", agreed: true }] },
    },
    candidate: { content_text: "## A\n\nbody.\n" },
  });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.exit_class, "clean");
});

test("compare_with_negotiation: require_signoffs without signoffs → NOT_SIGNED_OFF", async () => {
  const r = await dispatchMcp("compare_with_negotiation", {
    negotiation: {
      content_json: { rounds: [{ round: 1, text: "x", agreed: true }] },
    },
    candidate: { content_text: "x" },
    require_signoffs: true,
  });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.code, "NOT_SIGNED_OFF");
});

// ---------------------------------------------------------------------------
// COMPARE_MCP_BASE_DIR lockdown
// ---------------------------------------------------------------------------

test("COMPARE_MCP_BASE_DIR: path outside base → PATH_OUTSIDE_BASE_DIR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-cli-mcp-test-"));
  const inside = join(dir, "ok.md");
  writeFileSync(inside, "## A\n\nbody.\n");
  // /etc/hostname is outside dir for sure
  process.env.COMPARE_MCP_BASE_DIR = dir;
  try {
    const r = await dispatchMcp("compare_files", {
      base: { path: inside },
      candidate: { path: "/etc/hostname" },
    });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent.code, "PATH_OUTSIDE_BASE_DIR");
  } finally {
    delete process.env.COMPARE_MCP_BASE_DIR;
  }
});

test("COMPARE_MCP_BASE_DIR: path inside base → allowed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compare-cli-mcp-test-"));
  const a = join(dir, "a.md");
  const b = join(dir, "b.md");
  writeFileSync(a, "## A\n\nfoo.\n");
  writeFileSync(b, "## A\n\nfoo.\n");
  process.env.COMPARE_MCP_BASE_DIR = dir;
  try {
    const r = await dispatchMcp("compare_files", { base: { path: a }, candidate: { path: b } });
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.exit_class, "clean");
  } finally {
    delete process.env.COMPARE_MCP_BASE_DIR;
  }
});

// ---------------------------------------------------------------------------
// materializeSide helper
// ---------------------------------------------------------------------------

test("materializeSide: content_base64 with md format decodes", async () => {
  const text = "## A\n\nbody.\n";
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const r = await materializeSide({ content_base64: b64, format: "md" }, "base");
  assert.equal(r.text, text);
  assert.equal(r.format, "markdown");
});

test("materializeSide: content_base64 missing format → INVALID_ARGS", async () => {
  await assert.rejects(
    () => materializeSide({ content_base64: "aGVsbG8=" }, "base"),
    (e) => e instanceof McpToolError && e.code === "INVALID_ARGS",
  );
});

test("materializeSide: content_text with bad format → INVALID_ARGS", async () => {
  await assert.rejects(
    () => materializeSide({ content_text: "x", format: "docx" }, "base"),
    (e) => e instanceof McpToolError && e.code === "INVALID_ARGS",
  );
});
