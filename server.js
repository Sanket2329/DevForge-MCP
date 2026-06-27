"use strict";
try { require("dotenv").config(); } catch { /* dotenv not installed — env vars must be set manually, that's fine too */ }

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const indexer = require("./lib/indexer");
const architecture = require("./lib/architecture");
const state = require("./lib/state");
const fsTools = require("./lib/fsTools");
const codeIntel = require("./lib/codeIntel");
const editing = require("./lib/editing");
const gitTools = require("./lib/gitTools");
const buildTools = require("./lib/buildTools");
const reviewTools = require("./lib/reviewTools");
const cache = require("./lib/cache");
const logger = require("./lib/logger");
const security = require("./lib/security");

let createMcpRouteHandler;
let mcpAvailable = false;
try {
  ({ createMcpRouteHandler } = require("./mcp/transport"));
  mcpAvailable = true;
} catch (err) {
  logger.error("[mcp] Failed to load mcp/transport:", err.message);
}

// ── Config (Phase 12: centralized) ───────────────────────────────────────────
const DEFAULT_PROJECT_PATH = process.env.PROJECT_PATH || "C:/Users/sanket.shakya/Desktop/Amantya LeadSense";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.dirname(DEFAULT_PROJECT_PATH);
const PORT = process.env.PORT || 3000;

let PROJECT = DEFAULT_PROJECT_PATH; // mutable: switched via select_project (Phase 1)

// ── Indexing ──────────────────────────────────────────────────────────────────

function refreshIndex() {
  const st = state.getState(PROJECT);
  logger.info("Building codebase index for", PROJECT);

  const previous = Object.keys(st.codebaseIndex).length
    ? st.codebaseIndex
    : (cache.loadIndexCache(WORKSPACE_ROOT, PROJECT)?.codebaseIndex || {});

  st.codebaseIndex = indexer.buildCodebaseIndex(PROJECT, previous);
  st.latestContext.indexSize = Object.keys(st.codebaseIndex).length;
  st.latestContext.lastScan = new Date().toISOString();
  st.latestContext.status = "Ready";
  st.architectureInfo = architecture.detectArchitecture(st.codebaseIndex);
  st.latestContext.architecture = st.architectureInfo;

  cache.saveIndexCache(WORKSPACE_ROOT, PROJECT, { codebaseIndex: st.codebaseIndex, architectureInfo: st.architectureInfo });
  logger.info(`Indexed ${st.latestContext.indexSize} files | Architecture: ${st.architectureInfo.primary}`);
}

// ── Project Manager (Phase 1 + 2) ────────────────────────────────────────────

function listProjects() {
  try {
    return fs.readdirSync(WORKSPACE_ROOT)
      .filter((name) => {
        if (indexer.IGNORE.includes(name)) return false;
        try { return fs.statSync(path.join(WORKSPACE_ROOT, name)).isDirectory(); }
        catch { return false; }
      })
      .map((name) => {
        const full = path.join(WORKSPACE_ROOT, name);
        return {
          name,
          path: full,
          active: path.resolve(full) === path.resolve(PROJECT),
          loaded: state.hasState(full),
        };
      });
  } catch (error) {
    return { error: `Cannot read WORKSPACE_ROOT (${WORKSPACE_ROOT}): ${error.message}` };
  }
}

function selectProject(target) {
  if (!target) return { success: false, error: "Provide a project name or absolute path" };

  const candidate = path.isAbsolute(target) ? target : path.join(WORKSPACE_ROOT, target);
  let stat;
  try { stat = fs.statSync(candidate); }
  catch { return { success: false, error: `Project not found: ${candidate}` }; }
  if (!stat.isDirectory()) return { success: false, error: "Project path is not a directory" };

  PROJECT = candidate;
  const st = state.getState(PROJECT); // Phase 2: independent state per project, kept alive across switches

  // Warm-start from disk cache the first time this project is touched this run
  if (Object.keys(st.codebaseIndex).length === 0) {
    const indexCache = cache.loadIndexCache(WORKSPACE_ROOT, PROJECT);
    if (indexCache) {
      st.codebaseIndex = indexCache.codebaseIndex || {};
      st.architectureInfo = indexCache.architectureInfo || null;
    }
    const memCache = cache.loadMemory(WORKSPACE_ROOT, PROJECT);
    if (memCache) {
      st.projectMemory = memCache.projectMemory || st.projectMemory;
      st.conversationHistory = memCache.conversationHistory || st.conversationHistory;
    }
  }

  refreshIndex();        // catch up on anything changed since the cache was written
  attachWatcher(PROJECT);

  return { success: true, project: getCurrentProject() };
}

function getCurrentProject() {
  const st = state.getState(PROJECT);
  return {
    name: path.basename(PROJECT),
    path: PROJECT,
    indexSize: st.latestContext.indexSize,
    architecture: st.architectureInfo?.primary || null,
    lastScan: st.latestContext.lastScan,
  };
}

// ── Semantic Search (Phase 1 baseline, extended with recentSearches for the dashboard) ──

function semanticSearch(query, maxResults = 10) {
  const st = state.getState(PROJECT);
  const terms = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];

  for (const [relPath, file] of Object.entries(st.codebaseIndex)) {
    const haystack = (relPath + " " + file.content).toLowerCase();
    let score = 0;
    for (const term of terms) {
      const matches = (haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      score += matches;
      if (relPath.toLowerCase().includes(term)) score += 10;
    }
    if (score > 0) scored.push({ path: relPath, score, preview: file.content.slice(0, 300) });
  }

  st.recentSearches.push(query);
  if (st.recentSearches.length > 30) st.recentSearches.shift();

  return scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// ── Dependency Graph (Phase 3: extended past C#-only) ────────────────────────

function buildDependencyGraph() {
  const st = state.getState(PROJECT);
  const graph = {};
  for (const [relPath, file] of Object.entries(st.codebaseIndex)) {
    if (file.ext === ".cs") {
      const imports = [...file.content.matchAll(/^using\s+([\w.]+);/gm)].map((m) => m[1]);
      const ns = (file.content.match(/^namespace\s+([\w.]+)/m) || [])[1] || "unknown";
      graph[relPath] = { namespace: ns, imports };
    } else if ([".js", ".jsx", ".ts", ".tsx"].includes(file.ext)) {
      const imports = [...file.content.matchAll(/(?:import[^'"]*from\s+|require\()\s*['"]([^'"]+)['"]\)?/g)].map((m) => m[1]);
      graph[relPath] = { imports };
    } else if (file.ext === ".py") {
      const imports = [...file.content.matchAll(/^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)].map((m) => m[1] || m[2]);
      graph[relPath] = { imports };
    } else if (file.ext === ".go") {
      const block = file.content.match(/import\s*\(([^)]*)\)/);
      const imports = block ? block[1].split("\n").map((l) => l.trim().replace(/"/g, "")).filter(Boolean) : [];
      graph[relPath] = { imports };
    }
  }
  return graph;
}

// ── File Write (Phase 1 baseline, now shared via lib/fsTools) ───────────────

function writeFileContent(relativePath, content) {
  const st = state.getState(PROJECT);
  const result = fsTools.writeFileContent(PROJECT, relativePath, content);
  if (result.success) {
    st.codebaseIndex[relativePath] = result.indexEntry;
    logger.info("Written:", relativePath);
    return { success: true };
  }
  logger.error("Write error:", result.error);
  return result;
}

function writeMultipleFiles(files) {
  return files.map(({ path: relPath, content }) => ({ path: relPath, ...writeFileContent(relPath, content) }));
}

// ── Conversation Memory (Phase 1 baseline) + Project Memory (Phase 8) ───────

function addToHistory(role, content) {
  const st = state.getState(PROJECT);
  st.conversationHistory.push({ role, content, timestamp: new Date().toISOString() });
  if (st.conversationHistory.length > 40) st.conversationHistory.shift();
}

function getHistorySummary() {
  const st = state.getState(PROJECT);
  return st.conversationHistory.slice(-10)
    .map((h) => `[${h.role.toUpperCase()} @ ${h.timestamp}]: ${String(h.content).slice(0, 200)}`)
    .join("\n");
}

const MEMORY_TYPES = ["decisions", "conventions", "knownIssues", "notes"];

function addProjectNote(type, content) {
  if (!MEMORY_TYPES.includes(type)) return { success: false, error: `type must be one of: ${MEMORY_TYPES.join(", ")}` };
  if (!content) return { success: false, error: "content is required" };
  const st = state.getState(PROJECT);
  st.projectMemory[type].push({ content, timestamp: new Date().toISOString() });
  cache.saveMemory(WORKSPACE_ROOT, PROJECT, { projectMemory: st.projectMemory, conversationHistory: st.conversationHistory });
  return { success: true, projectMemory: st.projectMemory };
}

function getProjectMemory() {
  return state.getState(PROJECT).projectMemory;
}

// ── File Watcher (Phase 1 baseline, now multi-language build via Phase 7) ───

let activeWatcher = null;
let saveDebounce = null;

function attachWatcher(projectPath) {
  if (activeWatcher) activeWatcher.close();

  activeWatcher = chokidar.watch(projectPath, {
    ignored: (file) => indexer.shouldIgnore(file),
    persistent: true,
  });

  activeWatcher.on("change", (file) => {
    try {
      if (!indexer.isCodeFile(file)) return;
      const st = state.getState(projectPath);
      const relative = path.relative(projectPath, file);
      const content = fs.readFileSync(file, "utf8");

      st.latestContext.changedFile = relative;
      st.latestContext.changedCode = content.slice(0, 5000);
      st.codebaseIndex[relative] = {
        content: content.slice(0, 25000),
        size: fs.statSync(file).size,
        ext: path.extname(file).toLowerCase(),
        lastModified: new Date().toISOString(),
      };

      buildTools.runBuild(projectPath).then((result) => {
        st.latestContext.buildError = result.success ? null : (result.output || result.error || null);
      });

      clearTimeout(saveDebounce);
      saveDebounce = setTimeout(() => {
        cache.saveIndexCache(WORKSPACE_ROOT, projectPath, { codebaseIndex: st.codebaseIndex, architectureInfo: st.architectureInfo });
      }, 3000);

      logger.info("Changed:", relative);
    } catch {}
  });
}

// ── Graceful persistence on shutdown (Phase 12) ──────────────────────────────

function persistAllProjects() {
  for (const projectPath of state.listLoadedProjects()) {
    const st = state.getState(projectPath);
    cache.saveIndexCache(WORKSPACE_ROOT, projectPath, { codebaseIndex: st.codebaseIndex, architectureInfo: st.architectureInfo });
    cache.saveMemory(WORKSPACE_ROOT, projectPath, { projectMemory: st.projectMemory, conversationHistory: st.conversationHistory });
  }
}
process.on("SIGINT", () => { persistAllProjects(); process.exit(0); });
process.on("SIGTERM", () => { persistAllProjects(); process.exit(0); });

function mergeIndexOnSuccess(result, relPath) {
  if (result.success && result.indexEntry) {
    state.getState(PROJECT).codebaseIndex[relPath] = result.indexEntry;
  }
  return result;
}

// ── Dependency bundle for mcp/ modules ───────────────────────────────────────

const deps = {
  getProject: () => PROJECT,
  WORKSPACE_ROOT,
  state,
  indexer,
  architecture,
  fsTools,
  codeIntel,
  editing,
  gitTools,
  buildTools,
  reviewTools,
  cache,
  logger,
  listProjects,
  selectProject,
  getCurrentProject,
  refreshIndex,
  semanticSearch,
  buildDependencyGraph,
  writeFileContent,
  writeMultipleFiles,
  addToHistory,
  getHistorySummary,
  addProjectNote,
  getProjectMemory,
  mergeIndexOnSuccess,
  MEMORY_TYPES,
};

// ── Express App ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/status", (req, res) => {
  const st = state.getState(PROJECT);
  res.json({
    status: st.latestContext.status,
    project: path.basename(PROJECT),
    projectPath: PROJECT,
    workspaceRoot: WORKSPACE_ROOT,
    loadedProjects: state.listLoadedProjects().length,
    indexedFiles: st.latestContext.indexSize,
    architecture: st.architectureInfo?.primary || "detecting...",
    language: st.architectureInfo?.language || null,
    patterns: st.architectureInfo?.patterns || [],
    techStack: st.architectureInfo?.techStack || [],
    lastScan: st.latestContext.lastScan,
    buildError: !!st.latestContext.buildError,
  });
});

// ── Phase 10: Dashboard ───────────────────────────────────────────────────────

app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));

app.get("/api/dashboard", security.apiKeyMiddleware, async (req, res) => {
  const st = state.getState(PROJECT);
  const gitResult = await gitTools.gitStatus(PROJECT);
  let branch = null, changedFiles = null, gitError = null;
  if (gitResult.success) {
    const lines = gitResult.output.split("\n").filter(Boolean);
    const branchLine = lines.find((l) => l.startsWith("##"));
    branch = branchLine ? branchLine.replace("## ", "").split("...")[0] : "(no branch)";
    changedFiles = lines.filter((l) => !l.startsWith("##")).length;
  } else {
    gitError = gitResult.error;
  }

  res.json({
    project: getCurrentProject(),
    architecture: st.architectureInfo,
    build: { tool: buildTools.detectBuildSystem(PROJECT).tool, error: st.latestContext.buildError },
    git: { branch, changedFiles, error: gitError },
    recentSearches: st.recentSearches,
    conversationHistory: st.conversationHistory,
    allProjects: listProjects(),
  });
});

app.get("/api/projects", security.apiKeyMiddleware, (req, res) => res.json(listProjects()));
app.post("/api/select-project", security.apiKeyMiddleware, (req, res) => res.json(selectProject(req.body?.project)));

// ── MCP endpoint (v13: stateless StreamableHTTP; intentionally NOT API-key gated —
// ChatGPT's connector UI can only do OAuth or "No Authentication", it cannot
// send a custom header/API key here. See DEPLOYMENT.md.) ─────────────────────

const mcpRateLimit = security.rateLimiter({ windowMs: 60000, max: 300 });

app.post("/mcp", mcpRateLimit, (req, res) => {
  if (!mcpAvailable) {
    return res.status(503).json({ error: "MCP unavailable" });
  }
  return createMcpRouteHandler(deps)(req, res);
});

// Phase 12: catch anything unhandled instead of crashing the process
app.use((err, req, res, next) => {
  logger.error("Unhandled Express error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

try {
  refreshIndex();
} catch (err) {
  logger.warn("Initial index failed:", err.message);
  state.getState(PROJECT).latestContext.status = "IndexError";
}
attachWatcher(PROJECT);

app.listen(PORT, () => {
  const st = state.getState(PROJECT);
  logger.info(`\n🚀 LeadSense MCP Enhanced — Ready`);
  logger.info(`   Project       : ${path.basename(PROJECT)} (${PROJECT})`);
  logger.info(`   Workspace root: ${WORKSPACE_ROOT}`);
  logger.info(`   MCP           : http://localhost:${PORT}/mcp`);
  logger.info(`   Status        : http://localhost:${PORT}/status`);
  logger.info(`   Dashboard     : http://localhost:${PORT}/dashboard`);
  logger.info(`   Files         : ${st.latestContext.indexSize} indexed`);
  logger.info(`   Arch          : ${st.architectureInfo?.primary || "detecting..."}`);
  logger.info(`   Auth          : ${process.env.MCP_API_KEY ? "API key set (dashboard only)" : "disabled (local/dev default)"}\n`);
});
