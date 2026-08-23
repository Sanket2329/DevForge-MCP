"use strict";
const { readFileSafe, writeFileContent } = require("./fsTools");

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Tokenizer: strip comments and string literals ─────────────────────────────
// Returns a "safe" copy of the source where every character inside a string
// literal or comment is replaced with a space.  Byte positions are preserved
// so offsets into the original string remain valid.
//
// Handles:
//   • Single-line comments  // …
//   • Block comments        /* … */
//   • Double-quoted strings "…" (with \" escapes)
//   • Single-quoted strings '…' (with \' escapes)
//   • Template literals     `…` (with \` escapes)
//
// Intentionally does NOT mask # comments: # is valid in CSS hex colors
// (#fff), C# preprocessor directives (#region, #if), and markdown headings.
// Python files don't use braces so the brace-counter is unaffected, and
// renameSymbol's word-boundary matching doesn't need # masked.
//
// Limitations (acceptable for the use-cases here):
//   • Does not handle raw string literals (R"…" in C++) or heredocs.
function maskCommentsAndStrings(src) {
  const out = src.split(""); // mutable char array preserving positions
  let i = 0;
  while (i < src.length) {
    // Block comment
    if (src[i] === "/" && src[i + 1] === "*") {
      out[i] = out[i + 1] = " ";
      i += 2;
      while (i < src.length) {
        if (src[i] === "*" && src[i + 1] === "/") {
          out[i] = out[i + 1] = " ";
          i += 2;
          break;
        }
        out[i++] = " ";
      }
      continue;
    }
    // Single-line comment
    if (src[i] === "/" && src[i + 1] === "/") {
      out[i] = out[i + 1] = " ";
      i += 2;
      while (i < src.length && src[i] !== "\n") { out[i++] = " "; }
      continue;
    }
    // String literals: " ' `
    if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const delim = src[i];
      out[i++] = " ";
      while (i < src.length) {
        if (src[i] === "\\" && i + 1 < src.length) {
          out[i] = out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (src[i] === delim) { out[i++] = " "; break; }
        out[i++] = " ";
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

// ── Brace-block extraction (C#, Java, JS/TS, Go, C-like) ─────────────────────
// Bug 3 fix: uses maskCommentsAndStrings so brace counting is never tricked by
// braces inside string literals or comments.
function matchBraceEnd(content, openBraceIndex) {
  const safe = maskCommentsAndStrings(content);
  let depth = 0;
  for (let i = openBraceIndex; i < safe.length; i++) {
    if (safe[i] === "{") depth++;
    else if (safe[i] === "}") {
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

// METHOD_PATTERNS — ordered from most-specific to least-specific.
//
// Every pattern that can appear with leading modifiers (export, export default,
// async, static, etc.) must include an optional modifier prefix so that
// block.start anchors BEFORE those keywords.  If it doesn't, replaceMethod /
// deleteMethod leave a stale "export default" (or similar) in the file before
// the newly inserted code — producing duplicated modifiers.
//
// Pattern [0]: typed declarations — C# / Java / TS / JS class methods.
//   The modifier alternation already starts the match, so block.start is correct.
// Pattern [1]: plain `function` declarations — JS/TS module-level functions.
//   Fixed: now optionally captures `export default`, `export`, `async`, `static`
//   before `function` so the entire original declaration is in [block.start, block.end).
// Pattern [2]: Go methods — no JS modifiers, unaffected.
// Pattern [3]: arrow / const assignments.
//   Fixed: now optionally captures `export` before `const|let|var` for the same reason.
const METHOD_PATTERNS = [
  // Plain function declaration — MUST come before the typed pattern (pattern [1])
  // because the typed pattern's type-slot can partially match inside the word
  // "function" (e.g. "unction") once its leading modifier group has consumed
  // "export". Putting function declarations first ensures they are claimed by
  // this unambiguous pattern and never intercepted mid-word by pattern [1].
  // Optionally preceded by export default / export / async / static.
  `(?:(?:export\\s+default\\s+|export\\s+|async\\s+|static\\s+)*)function\\s+__NAME__\\s*\\([^)]*\\)\\s*\\{`,
  // Arrow / const assignment — also before the typed pattern for the same reason.
  // Optionally preceded by export / export default.
  `(?:export\\s+default\\s+|export\\s+)?(?:const|let|var)\\s+__NAME__\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|\\w+)\\s*=>\\s*\\{`,
  // C# / Java / TypeScript / JS: visibility + type + name + params + optional throws/where.
  // Runs after function/arrow patterns so it never intercepts them.
  `(?:(?:public|private|protected|internal|static|async|export|override|virtual|abstract|readonly)\\s+)*[\\w<>\\[\\],\\.]+\\s+__NAME__\\s*\\([^;{}\\n]*\\)(?:[^;{\\n]*)\\s*\\{`,
  // Go method
  `func\\s*(?:\\([^)]*\\)\\s*)?__NAME__\\s*\\([^)]*\\)[^\\{\\n]*\\{`,
];
const CLASS_PATTERNS = [`(?:class|interface|struct)\\s+__NAME__\\b[^{]*\\{`];

// Bug 1 fix: search the masked source so patterns cannot match names that only
// appear inside comments or string literals, but use the original content for
// the brace-end walk (matchBraceEnd already masks internally).
function findFirstMatch(content, name, patterns) {
  const safe = maskCommentsAndStrings(content);
  for (const p of patterns) {
    const re = new RegExp(p.replace(/__NAME__/g, escapeRegex(name)), "gi");
    const match = re.exec(safe);
    if (!match) continue;
    const braceIndex = content.indexOf("{", match.index);
    if (braceIndex === -1) continue;
    const end = matchBraceEnd(content, braceIndex);
    if (end === -1) continue;
    return { start: match.index, end, signatureStart: match.index };
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

// Renames a symbol across every indexed file containing it.
//
// Bug 4 fixes:
//   • Replacements are applied only to positions that are NOT inside a string
//     literal or comment (uses maskCommentsAndStrings to identify safe regions).
//   • scope: 'file' limits the rename to a single file (relPath must be provided).
//     scope: 'project' (default) renames across all indexed files — callers
//     should confirm with the user before using project scope.
//
// Returns per-file change counts; caller persists indexEntry updates into the
// active project's codebaseIndex.
function renameSymbol(projectPath, codebaseIndex, oldName, newName, { ext_filter, scope = "project", relPath: singleFile } = {}) {
  if (scope === "file" && !singleFile) {
    return { success: false, error: "scope 'file' requires relPath to be specified" };
  }

  const wordRe = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g");
  const changedFiles = [];

  const entries = scope === "file"
    ? (codebaseIndex[singleFile] ? [[singleFile, codebaseIndex[singleFile]]] : [])
    : Object.entries(codebaseIndex);

  for (const [rp, file] of entries) {
    if (ext_filter && file.ext !== ext_filter) continue;

    const read = readFileSafe(projectPath, rp);
    if (!read.success) continue;

    const original = read.content;
    const safe = maskCommentsAndStrings(original);

    // Build replacement by walking matches only in safe (non-comment, non-string)
    // regions, applying them to the original source.
    let result = "";
    let lastIndex = 0;
    let occurrences = 0;
    wordRe.lastIndex = 0;
    let m;
    while ((m = wordRe.exec(safe)) !== null) {
      // safe[m.index] is a space if it was inside a comment/string — skip it
      if (safe[m.index] === " " || safe[m.index] !== original[m.index]) continue;
      result += original.slice(lastIndex, m.index) + newName;
      lastIndex = m.index + m[0].length;
      occurrences++;
    }
    if (occurrences === 0) continue;
    result += original.slice(lastIndex);

    const write = writeFileContent(projectPath, rp, result);
    if (write.success) changedFiles.push({ path: rp, occurrences, indexEntry: write.indexEntry });
  }

  return {
    success: true,
    filesChanged: changedFiles.length,
    totalOccurrences: changedFiles.reduce((s, f) => s + f.occurrences, 0),
    changedFiles,
  };
}

module.exports = { patchFile, replaceMethod, deleteMethod, insertMethod, insertClass, renameSymbol, matchBraceEnd, maskCommentsAndStrings };
