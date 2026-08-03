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

    // Strip mangled BOM variants first
    let clean = content;
    if (clean.startsWith("\u00c3\u00af\u00c2\u00bb\u00c2\u00bf")) clean = clean.slice(6);
    else if (clean.startsWith("\u00ef\u00bb\u00bf")) clean = clean.slice(3);
    else if (clean.startsWith("\ufeff")) clean = clean.slice(1);

    // Bug 2 fix: only preserve a BOM if the file already had one on disk.
    // Previously a BOM was unconditionally prepended to every write, mangling
    // files that were never BOM-encoded (most JS/TS/Python/Go/JSON files).
    let existingHasBom = false;
    try {
      const diskBuf = fs.readFileSync(full);
      existingHasBom = diskBuf.length >= 3
        && diskBuf[0] === 0xef && diskBuf[1] === 0xbb && diskBuf[2] === 0xbf;
    } catch {
      // New file — no BOM unless content was BOM-prefixed (already stripped above).
      existingHasBom = false;
    }

    const body = Buffer.from(clean, "utf8");
    if (existingHasBom) {
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      fs.writeFileSync(full, Buffer.concat([bom, body]));
    } else {
      fs.writeFileSync(full, body);
    }

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
