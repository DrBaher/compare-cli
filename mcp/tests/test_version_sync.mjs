// The exported MCP_VERSION must match mcp/package.json. It drifted to 0.1.0
// once while the package shipped 0.1.1, making the MCP serverInfo under-report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MCP_VERSION } from "../compare-cli-mcp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));

test("MCP_VERSION matches mcp/package.json version", () => {
  assert.equal(MCP_VERSION, pkg.version);
});

test("server.json + mcpName match mcp/package.json (MCP Registry stays in sync)", () => {
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].version, pkg.version);
  assert.equal(server.name, pkg.mcpName);
});
