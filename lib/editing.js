"use strict";
const { readFileSafe, writeFileContent } = require("./fsTools");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Brace-block extraction (C#, Java, JS/TS, Go, C-like) ─────────────────────
// Given the index of an opening "{", walk forward counting braces (ignoring
// braces inside string/char literals as a best effort) and return the index
// just past the matching closing "}".
function matchBraceEnd(content, openBraceIndex) {
  let depth = 0;
  let inString = null; // ' " ` or null
  for (let i = openBraceIndex; i < content.length; i++) {
    const c = content[i];
    const prev = content[i - 1];
    if (inString) {
      if (c === inString && prev !== "\\") inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inString = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1; // unbalanced — caller should treat as not found
}

// Finds "<signature line containing name>...{ ... }" and returns
// { start, end, signatureStart } char offsets, or null.
function findCurlyBlockByName(content, name, kindRegexSource) {
  const re = new RegExp(kindRegexSource.replace(/__NAME__/g, escapeRegex(name)), "gi");
  const match = re.exec(content);
  if (!match) return null;
  const braceIndex = content.indexOf("{", match.index);
  if (braceIndex === -1) return null;
  const end = matchBraceEnd(content, braceIndex);
  if (end === -1) return null;
  return { start: match.index, end, signatureStart: match.index };
}

// Python: indentation-based block. Finds "def NAME(" or "class NAME" and
// returns the line range of its body based on indentation.
function findIndentedBlock(content, name, keyword) {
  const lines = content.split("\n");
  const re = new RegExp(`^(\\s*)${keyword}\\s+${escapeRegex(name)}\\b`);
  let startLine = -1, indent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) { startLine = i; indent = m[1].length; break; }
  }
  if (startLine === -1) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const lineIndent = line.match(/^(\s*)/)[1].length;
    if (lineIndent <= indent) { endLine = i; break; }
  }
  return { startLine, endLine, lines };
}

const METHOD_PATTERNS = [
  `(?:public|private|protected|internal|static|async|export)?\\s*[\\w<>\\[\\],\\.\\s]*\\b__NAME__\\s*\\([^;{=]*\\)\\s*\\{`,
  `function\\s+__NAME__\\s*\\([^)]*\\)\\s*\\{`,
  `func\\s*(?:\\([^)]*\\)\\s*)?__NAME__\\s*\\([^)]*\\)[^\\{]*\\{`,
];
const CLASS_PATTERNS = [`(?:class|interface|struct)\\s+__NAME__\\b[^{]*\\{`];

function findFirstMatch(content, name, patterns) {
  for (const p of patterns) {
    const block = findCurlyBlockByName(content, name, p);
    if (block) return block;
  }
  return null;
}

// ── Tool implementations ─────────────────────────────────────────────────────

// Exact, unique substring replace — the safest possible edit (preserves 100%
// of surrounding formatting since nothing is reparsed).
function patchFile(projectPath, relPath, oldText, newText) {
  const read = readFileSafe(projectPath, relPath);
  if (!read.success) return read;

  const occurrences = read.content.split(oldText).length - 1;
  if (occurrences === 0) return { success: false, error: "oldText not found in file" };
  if (occurrences > 1) return { success: false, error: `oldText matches ${occurrences} times — make it more specific so the edit is unambiguous` };

  const updated = read.content.replace(oldText, newText);
  const write = writeFileContent(projectPath, relPath, updated);
  return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
}

function replaceMethod(projectPath, relPath, methodName, newCode) {
  const read = readFileSafe(projectPath, relPath);
  if (!read.success) return read;

  if (relPath.endsWith(".py")) {
    const block = findIndentedBlock(read.content, methodName, "def");
    if (!block) return { success: false, error: `Method '${methodName}' not found (Python indentation scan)` };
    const updatedLines = [...block.lines.slice(0, block.startLine), newCode, ...block.lines.slice(block.endLine)];
    const write = writeFileContent(projectPath, relPath, updatedLines.join("\n"));
    return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
  }

  const block = findFirstMatch(read.content, methodName, METHOD_PATTERNS);
  if (!block) return { success: false, error: `Method '${methodName}' not found (brace-matching scan)` };
  const updated = read.content.slice(0, block.start) + newCode + read.content.slice(block.end);
  const write = writeFileContent(projectPath, relPath, updated);
  return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
}

function deleteMethod(projectPath, relPath, methodName) {
  const read = readFileSafe(projectPath, relPath);
  if (!read.success) return read;

  if (relPath.endsWith(".py")) {
    const block = findIndentedBlock(read.content, methodName, "def");
    if (!block) return { success: false, error: `Method '${methodName}' not found` };
    const updatedLines = [...block.lines.slice(0, block.startLine), ...block.lines.slice(block.endLine)];
    const write = writeFileContent(projectPath, relPath, updatedLines.join("\n"));
    return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
  }

  const block = findFirstMatch(read.content, methodName, METHOD_PATTERNS);
  if (!block) return { success: false, error: `Method '${methodName}' not found` };

  // Also drop immediately preceding decorator/attribute/doc-comment lines
  let cutStart = block.start;
  const before = read.content.slice(0, cutStart);
  const trimmedLines = before.split("\n");
  let i = trimmedLines.length - 1;
  while (i >= 0 && /^\s*(\/\/|\/\*|\*|#|\[|@)/.test(trimmedLines[i]) ) i--;
  cutStart = trimmedLines.slice(0, i + 1).join("\n").length + (i + 1 < trimmedLines.length ? 1 : 0);

  const updated = read.content.slice(0, cutStart) + read.content.slice(block.end);
  const write = writeFileContent(projectPath, relPath, updated);
  return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
}

function insertMethod(projectPath, relPath, className, methodCode, position = "end") {
  const read = readFileSafe(projectPath, relPath);
  if (!read.success) return read;

  if (relPath.endsWith(".py")) {
    const block = findIndentedBlock(read.content, className, "class");
    if (!block) return { success: false, error: `Class '${className}' not found` };
    const indentMatch = block.lines[block.startLine + 1]?.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "    ";
    const indented = methodCode.split("\n").map((l) => (l.trim() ? indent + l : l)).join("\n");
    const insertAt = position === "start" ? block.startLine + 1 : block.endLine;
    const updatedLines = [...block.lines.slice(0, insertAt), indented, ...block.lines.slice(insertAt)];
    const write = writeFileContent(projectPath, relPath, updatedLines.join("\n"));
    return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
  }

  const block = findFirstMatch(read.content, className, CLASS_PATTERNS);
  if (!block) return { success: false, error: `Class '${className}' not found` };

  const insertAt = position === "start" ? block.start + read.content.slice(block.start, block.end).indexOf("{") + 1 : block.end - 1;
  const updated = read.content.slice(0, insertAt) + "\n" + methodCode + "\n" + read.content.slice(insertAt);
  const write = writeFileContent(projectPath, relPath, updated);
  return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
}

// Appends a new class/type to the end of the file (inside the last namespace
// block for C#, otherwise at end-of-file).
function insertClass(projectPath, relPath, classCode) {
  const read = readFileSafe(projectPath, relPath);
  if (!read.success) return read;

  if (relPath.endsWith(".cs")) {
    const nsMatch = [...read.content.matchAll(/namespace\s+[\w.]+\s*\{/g)].pop();
    if (nsMatch) {
      const braceIndex = read.content.indexOf("{", nsMatch.index);
      const end = matchBraceEnd(read.content, braceIndex);
      if (end !== -1) {
        const insertAt = end - 1;
        const updated = read.content.slice(0, insertAt) + "\n" + classCode + "\n" + read.content.slice(insertAt);
        const write = writeFileContent(projectPath, relPath, updated);
        return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
      }
    }
  }

  const updated = read.content.replace(/\s*$/, "") + "\n\n" + classCode + "\n";
  const write = writeFileContent(projectPath, relPath, updated);
  return write.success ? { success: true, path: relPath, indexEntry: write.indexEntry } : write;
}

// Renames a symbol across every indexed file containing it (word-boundary,
// case-sensitive). Returns per-file change counts; caller persists indexEntry
// updates into the active project's codebaseIndex.
function renameSymbol(projectPath, codebaseIndex, oldName, newName, { ext_filter } = {}) {
  const re = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g");
  const changedFiles = [];

  for (const [relPath, file] of Object.entries(codebaseIndex)) {
    if (ext_filter && file.ext !== ext_filter) continue;

    const read = readFileSafe(projectPath, relPath);
    if (!read.success) continue;
    const occurrences = (read.content.match(re) || []).length;
    if (occurrences === 0) continue;

    const updated = read.content.replace(re, newName);
    const write = writeFileContent(projectPath, relPath, updated);
    if (write.success) changedFiles.push({ path: relPath, occurrences, indexEntry: write.indexEntry });
  }

  return {
    success: true,
    filesChanged: changedFiles.length,
    totalOccurrences: changedFiles.reduce((s, f) => s + f.occurrences, 0),
    changedFiles,
  };
}

module.exports = { patchFile, replaceMethod, deleteMethod, insertMethod, insertClass, renameSymbol, matchBraceEnd };
