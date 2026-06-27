"use strict";
const { execFile } = require("child_process");

const MAX_OUTPUT = 20000;

function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        resolve({ success: false, error: (stderr || error.message).slice(0, MAX_OUTPUT) });
        return;
      }
      resolve({ success: true, output: (stdout || stderr || "").slice(0, MAX_OUTPUT) });
    });
  });
}

// Branch/ref names: keep tight — letters, numbers, / _ . -
const SAFE_REF = /^[\w][\w./-]{0,99}$/;

function gitStatus(cwd) {
  return runGit(cwd, ["status", "--short", "--branch"]);
}

function gitDiff(cwd, file) {
  const args = ["diff"];
  if (file) {
    if (typeof file !== "string" || file.includes("..")) return Promise.resolve({ success: false, error: "Invalid file path" });
    args.push("--", file);
  }
  return runGit(cwd, args);
}

async function gitLog(cwd, limit = 20) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const result = await runGit(cwd, ["log", "-n", String(n), "--pretty=format:%h|%an|%ad|%s", "--date=short"]);
  if (!result.success) return result;
  const commits = result.output.split("\n").filter(Boolean).map((line) => {
    const [hash, author, date, ...msg] = line.split("|");
    return { hash, author, date, message: msg.join("|") };
  });
  return { success: true, commits };
}

function gitCheckout(cwd, branch) {
  if (!SAFE_REF.test(branch || "")) return Promise.resolve({ success: false, error: "Invalid branch name" });
  return runGit(cwd, ["checkout", branch]);
}

function createBranch(cwd, branch) {
  if (!SAFE_REF.test(branch || "")) return Promise.resolve({ success: false, error: "Invalid branch name" });
  return runGit(cwd, ["checkout", "-b", branch]);
}

async function commitChanges(cwd, message, addAll = true) {
  if (typeof message !== "string" || !message.trim()) {
    return { success: false, error: "Commit message required" };
  }
  if (addAll) {
    const addResult = await runGit(cwd, ["add", "-A"]);
    if (!addResult.success) return addResult;
  }
  return runGit(cwd, ["commit", "-m", message.slice(0, 500)]);
}

function showUntrackedFiles(cwd) {
  return runGit(cwd, ["ls-files", "--others", "--exclude-standard"]).then((r) =>
    r.success ? { success: true, files: r.output.split("\n").filter(Boolean) } : r
  );
}

module.exports = { gitStatus, gitDiff, gitLog, gitCheckout, createBranch, commitChanges, showUntrackedFiles };
