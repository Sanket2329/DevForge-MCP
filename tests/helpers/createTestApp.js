"use strict";

/**
 * createTestApp.js
 *
 * Builds a minimal Express app suitable for integration smoke tests.
 * Does NOT require server.js directly (which calls refreshIndex() on load
 * and hits the real filesystem). Instead, it wires up the same routes using
 * the real mcp/transport module with an injected mock deps bundle.
 */

const express = require("express");
const cors = require("cors");
const { createMcpRouteHandler } = require("../../mcp/transport");

// ── Minimal mock deps ────────────────────────────────────────────────────────
const MEMORY_TYPES = ["decisions", "conventions", "knownIssues", "notes"];

const mockDeps = {
  getProject: () => "/tmp/test-project",
  WORKSPACE_ROOT: "/tmp",
  state: {
    getState: () => ({
      codebaseIndex: {},
      architectureInfo: null,
      latestContext: { buildError: null },
      projectMemory: { decisions: [], conventions: [], knownIssues: [], notes: [] },
      conversationHistory: [],
      recentSearches: [],
    }),
  },
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  MEMORY_TYPES,
  // lib stubs — return minimal safe values
  indexer: {},
  architecture: {},
  fsTools: {},
  codeIntel: {
    findSymbol: () => [],
    findClass: () => [],
    findMethod: () => [],
    findInterface: () => [],
    findReferences: () => [],
    findUnusedFiles: () => [],
    findDuplicateCode: () => [],
  },
  editing: {},
  gitTools: {
    gitStatus: async () => ({ success: true, output: "" }),
  },
  buildTools: {},
  reviewTools: {},
  cache: {},
  listProjects: () => [],
  selectProject: () => ({}),
  getCurrentProject: () => ({}),
  refreshIndex: () => {},
  semanticSearch: () => [],
  buildDependencyGraph: () => ({}),
  writeFileContent: () => ({}),
  writeMultipleFiles: () => [],
  addToHistory: () => {},
  getHistorySummary: () => "",
  addProjectNote: () => ({}),
  getProjectMemory: () => ({}),
  mergeIndexOnSuccess: (r) => r,
};

/**
 * Creates and returns a minimal Express app with:
 *   GET  /status     → 200 application/json (stub)
 *   GET  /dashboard  → 200 text/html (stub)
 *   POST /mcp        → real createMcpRouteHandler with mockDeps
 *
 * /sse and /messages are intentionally NOT registered (→ 404).
 */
function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/status", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/dashboard", (req, res) => {
    res.type("html").send("<html><body><h1>Dashboard</h1></body></html>");
  });

  app.post("/mcp", createMcpRouteHandler(mockDeps));

  return app;
}

module.exports = { createTestApp };
