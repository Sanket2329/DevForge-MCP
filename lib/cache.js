"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function cacheDir(workspaceRoot) {
  const dir = path.join(workspaceRoot, ".mcp-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function memoryDir(workspaceRoot) {
  const dir = path.join(workspaceRoot, ".mcp-memory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function keyFor(projectPath) {
  return crypto.createHash("sha1").update(path.resolve(projectPath)).digest("hex").slice(0, 16);
}

function saveIndexCache(workspaceRoot, projectPath, { codebaseIndex, architectureInfo }) {
  try {
    const file = path.join(cacheDir(workspaceRoot), `${keyFor(projectPath)}.json`);
    fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), codebaseIndex, architectureInfo }));
    return true;
  } catch { return false; }
}

function loadIndexCache(workspaceRoot, projectPath) {
  try {
    const file = path.join(cacheDir(workspaceRoot), `${keyFor(projectPath)}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
}

function saveMemory(workspaceRoot, projectPath, { projectMemory, conversationHistory }) {
  try {
    const file = path.join(memoryDir(workspaceRoot), `${keyFor(projectPath)}.json`);
    fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), projectMemory, conversationHistory }));
    return true;
  } catch { return false; }
}

function loadMemory(workspaceRoot, projectPath) {
  try {
    const file = path.join(memoryDir(workspaceRoot), `${keyFor(projectPath)}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
}

module.exports = { saveIndexCache, loadIndexCache, saveMemory, loadMemory };
