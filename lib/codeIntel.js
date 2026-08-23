"use strict";

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAt(content, charIndex) {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function snippetAround(content, charIndex, radius = 80) {
  const start = Math.max(0, charIndex - radius);
  const end = Math.min(content.length, charIndex + radius);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

// Per-language regex fragments for declaring a class/method/interface by name.
function classRegex(name) {
  const n = escapeRegex(name);
  return new RegExp(
    `(class|interface|struct|type)\\s+${n}\\b|class\\s+${n}\\b|def\\s+${n}\\s*\\(|type\\s+${n}\\s+(struct|interface)\\b`,
    "gi"
  );
}

// Bug 12 fix: tighten the parameter clause to [^;{}\n]* (no newlines or braces)
// so the pattern cannot bleed across comment lines into the method body, matching
// the same fix applied to METHOD_PATTERNS in editing.js.
// Also mirrors the export/export-default prefix fix: without it, findMethod
// would miss `export default function foo` and `export const foo = () =>`.
function methodRegex(name) {
  const n = escapeRegex(name);
  const modifiers = `(?:public|private|protected|internal|static|async|export|override|virtual|abstract)`;
  // function/arrow alternatives come FIRST so the typed-declaration alternative
  // (which can partially match inside the word "function") never intercepts them.
  return new RegExp(
    `(?:(?:export\\s+default\\s+|export\\s+|async\\s+|static\\s+)*)function\\s+${n}\\s*\\(` +
    `|(?:export\\s+default\\s+|export\\s+)?(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>` +
    `|(?:${modifiers}\\s+)*[\\w<>\\[\\],\\.]+\\s+${n}\\s*\\([^;{}\\n]*\\)(?:[^;{\\n]*)\\s*\\{` +
    `|def\\s+${n}\\s*\\(` +
    `|func\\s*(?:\\([^)]*\\)\\s*)?${n}\\s*\\(`,
    "gi"
  );
}

function interfaceRegex(name) {
  const n = escapeRegex(name);
  return new RegExp(`interface\\s+${n}\\b|type\\s+${n}\\s+interface\\b`, "gi");
}

/**
 * searchIndex — search the codebase index for a regex pattern.
 *
 * Bug 8 fix: if projectPath and fsTools are supplied, each file is read fresh
 * from disk rather than using the 25 KB-capped cache entry.  Falls back to the
 * cached slice when the disk read fails (deleted/moved file, permission error).
 *
 * @param {object} index        — codebaseIndex map
 * @param {RegExp} regex        — pattern to search
 * @param {object} [opts]
 * @param {string} [opts.ext_filter]
 * @param {number} [opts.maxResults=50]
 * @param {string} [opts.projectPath]  — if set, enables full-content disk reads
 * @param {object} [opts.fsTools]      — lib/fsTools module (needs readFileSafe)
 */
function searchIndex(index, regex, { ext_filter, maxResults = 50, projectPath, fsTools } = {}) {
  const results = [];
  for (const [relPath, file] of Object.entries(index)) {
    if (ext_filter && file.ext !== ext_filter) continue;

    // Prefer a fresh disk read so we never miss symbols past the 25 KB cache cut.
    let content = file.content;
    if (projectPath && fsTools) {
      const read = fsTools.readFileSafe(projectPath, relPath);
      if (read.success) content = read.content;
    }

    let match;
    const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    while ((match = re.exec(content)) !== null) {
      results.push({
        path: relPath,
        line: lineNumberAt(content, match.index),
        match: match[0].trim().slice(0, 160),
        preview: snippetAround(content, match.index),
      });
      if (results.length >= maxResults) return results;
      if (match[0].length === 0) re.lastIndex++; // avoid infinite loop on zero-width matches
    }
  }
  return results;
}

// ── Public tools ──────────────────────────────────────────────────────────────

function findSymbol(index, name, opts = {}) {
  const n = escapeRegex(name);
  const re = new RegExp(`\\b${n}\\b`, "gi");
  return searchIndex(index, re, opts);
}

function findClass(index, name, opts = {}) {
  return searchIndex(index, classRegex(name), opts);
}

function findMethod(index, name, opts = {}) {
  return searchIndex(index, methodRegex(name), opts);
}

function findInterface(index, name, opts = {}) {
  return searchIndex(index, interfaceRegex(name), opts);
}

function findReferences(index, symbol, opts = {}) {
  return findSymbol(index, symbol, { ...opts, maxResults: opts.maxResults || 200 });
}

// Heuristic: a file is "unused" if no other file's content mentions its
// basename (without extension) anywhere — as an import path, using statement,
// require(), or simple text reference. Known entry points are whitelisted.
const ENTRY_POINT_NAMES = new Set([
  "program", "startup", "index", "main", "app", "server", "wsgi", "asgi",
  "manage", "application",
]);

const MANIFEST_FILENAMES = new Set([
  "package.json", "package-lock.json", "tsconfig.json", "jsconfig.json",
  "requirements.txt", "pyproject.toml", "pipfile", "setup.py",
  "go.mod", "go.sum", "cargo.toml", "cargo.lock", "pom.xml",
  "build.gradle", "build.gradle.kts", "gemfile", "composer.json",
  ".gitignore", ".env", "readme.md", "license", "dockerfile",
]);

function findUnusedFiles(index) {
  const entries = Object.entries(index);
  const unused = [];

  for (const [relPath, file] of entries) {
    const fileName = relPath.replace(/\\/g, "/").split("/").pop();
    if (MANIFEST_FILENAMES.has(fileName.toLowerCase())) continue;
    if (fileName.toLowerCase().endsWith(".csproj") || fileName.toLowerCase().endsWith(".sln")) continue;

    const base = fileName.replace(/\.[^.]+$/, "");
    if (ENTRY_POINT_NAMES.has(base.toLowerCase())) continue;
    if (/test|spec/i.test(base)) continue; // tests are usually invoked by a runner, not imported

    const needle = base.toLowerCase();
    const referenced = entries.some(([otherPath, otherFile]) => {
      if (otherPath === relPath) return false;
      return otherFile.content.toLowerCase().includes(needle);
    });

    if (!referenced) unused.push({ path: relPath, ext: file.ext, sizeKB: (file.size / 1024).toFixed(1) });
  }
  return unused;
}

// Lightweight clone detection: hash overlapping windows of normalized lines
// and group files that share an identical window. Good enough to flag
// copy-pasted blocks; not a real AST-based clone detector.
function findDuplicateCode(index, { windowSize = 6, minLines = 6 } = {}) {
  const buckets = new Map(); // normalizedChunk -> [{path, startLine}]

  for (const [relPath, file] of Object.entries(index)) {
    const lines = file.content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    for (let i = 0; i + windowSize <= lines.length; i++) {
      const chunk = lines.slice(i, i + windowSize).join("\n");
      if (chunk.length < 40) continue; // skip trivial windows (braces, blank-ish lines)
      if (!buckets.has(chunk)) buckets.set(chunk, []);
      buckets.get(chunk).push({ path: relPath, startLine: i + 1 });
    }
  }

  const duplicates = [];
  for (const [chunk, locations] of buckets.entries()) {
    const distinctFiles = new Set(locations.map((l) => l.path));
    if (distinctFiles.size > 1 || locations.length > distinctFiles.size) {
      duplicates.push({
        linesShared: minLines,
        preview: chunk.slice(0, 200),
        occurrences: locations,
      });
    }
  }

  return duplicates
    .sort((a, b) => b.occurrences.length - a.occurrences.length)
    .slice(0, 25);
}

module.exports = {
  findSymbol, findClass, findMethod, findInterface,
  findReferences, findUnusedFiles, findDuplicateCode,
  lineNumberAt,
};
