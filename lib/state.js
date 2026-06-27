"use strict";
const path = require("path");

// One state bucket per project path. Switching projects (Phase 1) no longer
// wipes prior context — each project keeps its own index/architecture/memory
// alive for the life of the process (Phase 2: Workspace Support).
const states = new Map();

function emptyState() {
  return {
    codebaseIndex: {},
    architectureInfo: null,
    conversationHistory: [],     // rolling chat memory (Phase 8 keeps this separate from projectMemory)
    projectMemory: {             // durable notes that persist across conversations (Phase 8)
      decisions: [],
      conventions: [],
      knownIssues: [],
      notes: [],
    },
    recentSearches: [],          // last N search_codebase queries, for the dashboard (Phase 10)
    latestContext: {
      status: "Initializing",
      lastScan: null,
      changedFile: null,
      changedCode: null,
      buildError: null,
      indexSize: 0,
      architecture: null,
    },
    watcher: null,
  };
}

function keyFor(projectPath) {
  return path.resolve(projectPath);
}

function getState(projectPath) {
  const key = keyFor(projectPath);
  if (!states.has(key)) states.set(key, emptyState());
  return states.get(key);
}

function hasState(projectPath) {
  return states.has(keyFor(projectPath));
}

function dropState(projectPath) {
  states.delete(keyFor(projectPath));
}

function listLoadedProjects() {
  return [...states.keys()];
}

module.exports = { getState, hasState, dropState, listLoadedProjects };
