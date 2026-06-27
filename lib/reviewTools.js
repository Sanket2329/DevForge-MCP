"use strict";
const { matchBraceEnd } = require("./editing");
const { findDuplicateCode } = require("./codeIntel");

const GENERIC_FUNCTION_SIGNATURE = /(?:function\s+\w+\s*\([^)]*\)|(?:public|private|protected|internal|static|async|export)+[\s\w<>\[\],.]*\b\w+\s*\([^;{=]*\)|const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*\{/g;

function scanFunctionsCurly(content) {
  const fns = [];
  let match;
  const re = new RegExp(GENERIC_FUNCTION_SIGNATURE.source, "g");
  while ((match = re.exec(content)) !== null) {
    const braceIndex = content.indexOf("{", match.index);
    const end = matchBraceEnd(content, braceIndex);
    if (end === -1) continue;
    const lineCount = content.slice(match.index, end).split("\n").length;
    const nameMatch = match[0].match(/\b(\w+)\s*\(/);
    fns.push({ name: nameMatch ? nameMatch[1] : "(anonymous)", lineCount, charStart: match.index });
    re.lastIndex = end;
  }
  return fns;
}

function scanFunctionsPython(content) {
  const lines = content.split("\n");
  const fns = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)def\s+(\w+)\s*\(/);
    if (!m) continue;
    const indent = m[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      if ((lines[j].match(/^(\s*)/)[1].length) <= indent) { end = j; break; }
    }
    fns.push({ name: m[2], lineCount: end - i });
  }
  return fns;
}

function reviewFile(relPath, content, ext) {
  const lines = content.split("\n");
  const todoCount = (content.match(/\b(TODO|FIXME|HACK)\b/g) || []).length;
  const magicNumberMatches = content.match(/(?<![\w.])\b(?!0\b|1\b)\d{2,}\b/g) || [];
  const fns = ext === ".py" ? scanFunctionsPython(content) : scanFunctionsCurly(content);
  const longMethods = fns.filter((f) => f.lineCount > 50).sort((a, b) => b.lineCount - a.lineCount);

  // crude nesting depth: max leading-indent "levels" (4 spaces or 1 tab = one level)
  let maxNesting = 0;
  for (const line of lines) {
    const m = line.match(/^(\t| {1,})*/);
    const level = (line.match(/^[\t ]*/)[0].match(/\t| {4}/g) || []).length;
    maxNesting = Math.max(maxNesting, level);
  }

  const issues = [];
  if (todoCount > 0) issues.push(`${todoCount} TODO/FIXME comment(s)`);
  if (magicNumberMatches.length > 5) issues.push(`${magicNumberMatches.length} possible magic numbers`);
  longMethods.forEach((f) => issues.push(`Long method '${f.name}' (${f.lineCount} lines) — consider splitting`));
  if (maxNesting > 5) issues.push(`Deep nesting detected (≈${maxNesting} levels) — consider extracting helper functions`);

  return { path: relPath, lines: lines.length, todoCount, longMethods, maxNesting, issues };
}

function reviewProject(index) {
  const files = Object.entries(index);
  const byExt = {};
  let totalSize = 0;
  let todoTotal = 0;

  const largest = [...files].sort((a, b) => b[1].size - a[1].size).slice(0, 10)
    .map(([p, f]) => ({ path: p, sizeKB: (f.size / 1024).toFixed(1) }));

  for (const [relPath, file] of files) {
    byExt[file.ext] = (byExt[file.ext] || 0) + 1;
    totalSize += file.size;
    todoTotal += (file.content.match(/\b(TODO|FIXME|HACK)\b/g) || []).length;
  }

  return {
    fileCount: files.length,
    totalSizeKB: (totalSize / 1024).toFixed(1),
    byExtension: byExt,
    largestFiles: largest,
    totalTodoCount: todoTotal,
  };
}

function findCodeSmells(index) {
  const perFile = Object.entries(index)
    .map(([relPath, file]) => reviewFile(relPath, file.content, file.ext))
    .filter((r) => r.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length);

  const duplicates = findDuplicateCode(index);

  return { filesWithIssues: perFile.slice(0, 30), duplicateBlocks: duplicates.slice(0, 10) };
}

function reviewArchitecture(architectureInfo) {
  if (!architectureInfo) return { suggestions: ["No architecture profile yet — run refresh_index first"] };
  const { patterns = [], techStack = [], language } = architectureInfo;
  const suggestions = [];

  const hasTests = techStack.includes("Unit Testing");
  if (!hasTests) suggestions.push("No test framework detected — consider adding unit tests (xUnit/NUnit, Jest, pytest, or JUnit depending on stack)");

  if (language === "C#") {
    if (!patterns.includes("Dependency Injection")) suggestions.push("No DI container usage detected — consider registering services via IServiceCollection");
    if (patterns.includes("CQRS") && !patterns.includes("FluentValidation")) suggestions.push("CQRS without FluentValidation — consider validating commands/queries explicitly");
    if (!patterns.includes("Entity Framework Core") && !patterns.includes("Repository Pattern")) suggestions.push("No clear data-access pattern detected — confirm how persistence is structured");
  }
  if (language === "JavaScript/TypeScript") {
    if (!techStack.includes("Docker") && !patterns.includes("Middleware pipeline")) suggestions.push("Consider adding centralized error-handling middleware if not already present");
  }
  if (language === "Python" && !patterns.includes("Pydantic Models") && !patterns.includes("SQLAlchemy ORM")) {
    suggestions.push("No schema/ORM layer detected — confirm how request/response shapes and persistence are validated");
  }

  if (!suggestions.length) suggestions.push("No obvious architectural gaps detected from static analysis — looks consistent with common practice for this stack");
  return { primary: architectureInfo.primary, suggestions };
}

function suggestRefactoring(index, architectureInfo) {
  const smells = findCodeSmells(index);
  const archReview = reviewArchitecture(architectureInfo);
  const priorities = [];

  smells.filesWithIssues.slice(0, 5).forEach((f) => priorities.push(`${f.path}: ${f.issues[0]}`));
  if (smells.duplicateBlocks.length) priorities.push(`Duplicate code found in ${smells.duplicateBlocks.length} block(s) — candidate for extraction into a shared function`);
  archReview.suggestions.forEach((s) => priorities.push(s));

  return { topPriorities: priorities.slice(0, 10) };
}

// ── Build error parsing (Phase 9) ────────────────────────────────────────────

const ERROR_PATTERNS = [
  { lang: "C#", re: /(.+\.cs)\((\d+),(\d+)\):\s*error\s+(CS\d+):\s*(.+)/g },
  { lang: "TypeScript", re: /(.+\.ts)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/g },
  { lang: "Go", re: /(.+\.go):(\d+):(\d+):\s*(.+)/g },
  { lang: "Java", re: /\[ERROR\]\s*(.+\.java):\[(\d+),(\d+)\]\s*(.+)/g },
  { lang: "Python", re: /File "(.+)", line (\d+)[\s\S]*?\n(\w+Error: .+)/g },
];

function explainBuildError(rawError) {
  if (!rawError) return { findings: [], raw: "" };
  const findings = [];
  for (const { lang, re } of ERROR_PATTERNS) {
    let match;
    const r = new RegExp(re.source, re.flags);
    while ((match = r.exec(rawError)) !== null) {
      if (lang === "Python") {
        findings.push({ language: lang, file: match[1], line: Number(match[2]), message: match[3] });
      } else if (lang === "Go") {
        findings.push({ language: lang, file: match[1], line: Number(match[2]), column: Number(match[3]), message: match[4] });
      } else {
        findings.push({ language: lang, file: match[1], line: Number(match[2]), column: Number(match[3]), code: match[4], message: match[5] });
      }
    }
  }
  return { findings, raw: rawError.slice(0, 4000) };
}

module.exports = { reviewFile, reviewProject, findCodeSmells, reviewArchitecture, suggestRefactoring, explainBuildError };
