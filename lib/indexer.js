"use strict";
const fs = require("fs");
const path = require("path");

const IGNORE = [
  ".git", ".vs", "bin", "obj", "node_modules", ".idea", ".vscode",
  "dist", "build", "target", "__pycache__", ".venv", "venv", ".next",
  ".mcp-cache", ".mcp-memory",
];

// Broadened in Phase 3 to cover non-.NET stacks (Node, Python, Java, Go, etc).
const CODE_EXTENSIONS = new Set([
  ".cs", ".csproj", ".sln", ".json", ".xml", ".config",
  ".razor", ".cshtml", ".html", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss",
  ".txt", ".md", ".yml", ".yaml", ".env", ".sql",
  ".py", ".java", ".kt", ".go", ".rs", ".rb", ".php",
  ".gradle", ".toml", ".mod", ".gitignore",
]);

function shouldIgnore(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return IGNORE.some((folder) => {
    const target = `/${folder.toLowerCase()}`;
    return normalized.includes(target + "/") || normalized.endsWith(target);
  });
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// previousIndex (optional): if a file's mtime matches the cached entry, reuse
// the cached content instead of re-reading it from disk (incremental indexing).
function buildCodebaseIndex(rootDir, previousIndex = {}, index = {}, dir = rootDir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const full = path.join(dir, file);
      if (shouldIgnore(full)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          buildCodebaseIndex(rootDir, previousIndex, index, full);
        } else if (isCodeFile(full)) {
          const relative = path.relative(rootDir, full);
          const cached = previousIndex[relative];
          const mtime = stat.mtime.toISOString();

          if (cached && cached.lastModified === mtime && cached.size === stat.size) {
            index[relative] = cached; // unchanged since last scan — skip the read
            continue;
          }

          const raw = fs.readFileSync(full, "utf8");
          index[relative] = {
            content: raw.slice(0, 25000),
            size: stat.size,
            ext: path.extname(full).toLowerCase(),
            lastModified: mtime,
          };
        }
      } catch {}
    }
  } catch {}
  return index;
}

module.exports = { IGNORE, CODE_EXTENSIONS, shouldIgnore, isCodeFile, buildCodebaseIndex };
