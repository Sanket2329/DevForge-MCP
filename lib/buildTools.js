"use strict";
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

function fileExists(projectPath, name) {
  try { return fs.existsSync(path.join(projectPath, name)); } catch { return false; }
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function detectNodeCommand(projectPath) {
  const pkgPath = path.join(projectPath, "package.json");
  const pkg = readJsonSafe(pkgPath) || {};
  const scripts = pkg.scripts || {};

  const pm = fileExists(projectPath, "pnpm-lock.yaml") ? "pnpm"
    : fileExists(projectPath, "yarn.lock") ? "yarn"
    : "npm";

  if (scripts.build) return { tool: pm, command: `${pm} run build`, note: null };
  if (scripts.test) return { tool: pm, command: `${pm} run test`, note: "No 'build' script found — running 'test' instead" };
  return { tool: pm, command: `${pm} install`, note: "No build/test script found — running install to validate dependencies" };
}

function detectPythonCommand(projectPath) {
  if (fileExists(projectPath, "pyproject.toml")) {
    const content = fs.readFileSync(path.join(projectPath, "pyproject.toml"), "utf8");
    if (content.includes("[tool.poetry]")) return { tool: "poetry", command: "poetry build", note: null };
  }
  if (fileExists(projectPath, "setup.py")) return { tool: "python", command: "python setup.py build", note: null };
  return { tool: "python", command: "python -m compileall .", note: "No setup.py/poetry config found — running a syntax check instead of a real build" };
}

function detectBuildSystem(projectPath) {
  if (fileExists(projectPath, "go.mod")) return { tool: "go", command: "go build ./..." };
  if (fileExists(projectPath, "Cargo.toml")) return { tool: "cargo", command: "cargo build" };
  if (fileExists(projectPath, "pom.xml")) {
    return { tool: "maven", command: fileExists(projectPath, "mvnw") ? "./mvnw -q package" : "mvn -q package" };
  }
  if (fileExists(projectPath, "build.gradle") || fileExists(projectPath, "build.gradle.kts")) {
    return { tool: "gradle", command: fileExists(projectPath, "gradlew") ? "./gradlew build" : "gradle build" };
  }
  if (fs.readdirSync(projectPath).some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) {
    return { tool: "dotnet", command: "dotnet build" };
  }
  if (fileExists(projectPath, "package.json")) return detectNodeCommand(projectPath);
  if (fileExists(projectPath, "requirements.txt") || fileExists(projectPath, "pyproject.toml") || fileExists(projectPath, "Pipfile")) {
    return detectPythonCommand(projectPath);
  }
  return { tool: "unknown", command: null, note: "Could not detect a build system for this project" };
}

function runBuild(projectPath) {
  return new Promise((resolve) => {
    const system = detectBuildSystem(projectPath);
    if (!system.command) {
      resolve({ success: false, tool: system.tool, error: system.note || "No build command available" });
      return;
    }
    exec(system.command, { cwd: projectPath, timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = (stderr || "") + (stdout || "");
      const failed = !!error || /error\s+(CS\d+|TS\d+)/i.test(combined) || /BUILD FAILED|FAILURE/i.test(combined);
      resolve({
        success: !failed,
        tool: system.tool,
        command: system.command,
        note: system.note || null,
        output: combined.slice(-8000),
      });
    });
  });
}

module.exports = { detectBuildSystem, runBuild };
