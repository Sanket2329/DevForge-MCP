"use strict";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function log(level, ...args) {
  if (LEVELS[level] > currentLevel) return;
  const prefix = `[${ts()}] [${level.toUpperCase()}]`;
  (level === "error" ? console.error : console.log)(prefix, ...args);
}

module.exports = {
  error: (...a) => log("error", ...a),
  warn: (...a) => log("warn", ...a),
  info: (...a) => log("info", ...a),
  debug: (...a) => log("debug", ...a),
};
