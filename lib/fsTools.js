"use strict";
const fs = require("fs");
const path = require("path");
const { shouldIgnore } = require("./indexer");

function resolveInsideProject(projectPath, relativePath) {
  const full = path.join(projectPath, relativePath);
  const resolvedFull = path.resolve(full);
  const resolvedProject = path.resolve(projectPath);
  // require a separator after the project root so "ProjectEvil" can't pass for "Project"
  if (resolvedFull !== resolvedProject && !resolvedFull.startsWith(resolvedProject + path.sep)) {
    return null;
  }
  return full;
}

function readFileSafe(projectPath, relativePath) {
  const full = resolveInsideProject(projectPath, relativePath);
  if (!full) return { success: false, error: "Path outside project directory" };
  if (shouldIgnore(full)) return { success: false, error: "Access denied" };
  try {
    return { success: true, content: fs.readFileSync(full, "utf8"), fullPath: full };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function writeFileContent(projectPath, relativePath, content) {
  try {
    const full = resolveInsideProject(projectPath, relativePath);
    if (!full) return { success: false, error: "Path outside project directory" };
    if (shouldIgnore(full)) return { success: false, error: "Access denied" };

    fs.mkdirSync(path.dirname(full), { recursive: true });

    // Strip mangled BOM variants
    let clean = content;
    if (clean.startsWith("\u00c3\u00af\u00c2\u00bb\u00c2\u00bf")) clean = clean.slice(6);
    else if (clean.startsWith("\u00ef\u00bb\u00bf")) clean = clean.slice(3);
    else if (clean.startsWith("\ufeff")) clean = clean.slice(1);

    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from(clean, "utf8");
    fs.writeFileSync(full, Buffer.concat([bom, body]));

    return {
      success: true,
      indexEntry: {
        content: clean.slice(0, 25000),
        size: Buffer.byteLength(clean),
        ext: path.extname(relativePath).toLowerCase(),
        lastModified: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { resolveInsideProject, readFileSafe, writeFileContent };
