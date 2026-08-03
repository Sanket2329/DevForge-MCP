"use strict";

// ── Module-local response helpers (NOT exported) ──────────────────────────────
function ok(value) { return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }; }
function text(value) { return { content: [{ type: "text", text: String(value) }] }; }

/**
 * resolveProject — returns the project path for this request.
 *
 * Priority order:
 *   1. args.project (explicit per-call override — enables true per-request isolation
 *      on the stateless HTTP transport without mutating any shared global)
 *   2. deps.getProject() — the process-level default / last selectProject() call
 *
 * This is the core fix for the global PROJECT isolation bug: callers can pass
 * `project` to any tool and every operation in that request is scoped to that
 * path.  Concurrent requests that omit `project` still share the module-level
 * default, which is intentional for single-user / single-project deployments.
 *
 * @param {object} deps
 * @param {object|null} args
 * @returns {string} resolved absolute project path
 */
function resolveProject(deps, args) {
  if (args?.project) {
    const path = require("path");
    const candidate = path.isAbsolute(args.project)
      ? args.project
      : path.join(deps.WORKSPACE_ROOT, args.project);
    return candidate;
  }
  return deps.getProject();
}

/**
 * dispatch — routes a tool call to its implementation.
 *
 * @param {string} name  — tool name from CallToolRequestSchema
 * @param {object} args  — tool arguments
 * @param {object} deps  — injected dependencies (getProject, WORKSPACE_ROOT, state,
 *   indexer, architecture, fsTools, codeIntel, editing, gitTools, buildTools,
 *   reviewTools, cache, logger, listProjects, selectProject, getCurrentProject,
 *   refreshIndex, semanticSearch, buildDependencyGraph, writeFileContent,
 *   writeMultipleFiles, addToHistory, getHistorySummary, addProjectNote,
 *   getProjectMemory, mergeIndexOnSuccess, MEMORY_TYPES)
 * @returns {Promise<{content: Array<{type: string, text: string}>}>}
 */
async function dispatch(name, args, deps) {
  try {
    // Per-request project resolution — does NOT mutate the module-level default.
    // This is the fix for Bug 6: concurrent requests can no longer cross-contaminate
    // each other's active project.
    const project = resolveProject(deps, args);

    // Convenience accessor scoped to this request's project
    const st = () => deps.state.getState(project);

    // ── Phase 1 ──────────────────────────────────────────────────────────
    if (name === "list_projects") return ok(deps.listProjects());
    // select_project mutates the process-level default intentionally — it is
    // the explicit "switch active project" operation.
    if (name === "select_project") return ok(deps.selectProject(args?.project));
    if (name === "get_current_project") return ok(deps.getCurrentProjectFor(project));
    if (name === "refresh_index") { deps.refreshIndexFor(project); return ok(deps.getCurrentProjectFor(project)); }

    // ── Baseline ─────────────────────────────────────────────────────────
    if (name === "get_project_files") {
      const ext = args?.ext_filter?.toLowerCase();
      const files = Object.entries(st().codebaseIndex)
        .filter(([p]) => !ext || p.endsWith(ext))
        .map(([p, f]) => ({ path: p, ext: f.ext, sizeKB: (f.size / 1024).toFixed(1), lastModified: f.lastModified }));
      return ok(files);
    }
    if (name === "get_file_content") {
      // Bug 5 fix: read directly from disk so callers always get the full file,
      // bypassing the 25 KB index cache.
      const read = deps.fsTools.readFileSafe(project, args?.path);
      if (!read.success) return text("File not found or unreadable: " + (read.error || args?.path));
      return ok({
        path: args.path,
        content: read.content,
        truncated: false, // full disk read — never truncated here
        sizeBytes: Buffer.byteLength(read.content),
      });
    }
    if (name === "get_full_codebase") {
      // Bug 5 fix: read every file fresh from disk so nothing is silently clipped.
      // Include a per-file truncated flag when a file exceeds 25 KB so the caller
      // knows which entries may be partial.
      const ext = args?.ext_filter?.toLowerCase();
      const idx = st().codebaseIndex;
      const parts = [];
      let truncatedFiles = 0;
      for (const [p, f] of Object.entries(idx)) {
        if (ext && !p.endsWith(ext)) continue;
        const read = deps.fsTools.readFileSafe(project, p);
        const content = read.success ? read.content : f.content; // fall back to cached slice on error
        const wasTruncated = read.success && content.length !== f.content.length && f.content.length >= 25000;
        if (wasTruncated) truncatedFiles++;
        parts.push(`\n${"=".repeat(80)}\nFILE: ${p}${wasTruncated ? " [NOTE: previously truncated in cache; full content shown]" : ""}\n${"=".repeat(80)}\n${content}`);
      }
      const arch = st().architectureInfo;
      const archSummary = arch ? `\n\nARCHITECTURE:\n${arch.summary}\nPatterns: ${arch.patterns.join(", ")}\nTech Stack: ${arch.techStack.join(", ")}` : "";
      const header = truncatedFiles > 0 ? `[INFO: ${truncatedFiles} file(s) were previously truncated in the cache and are now shown in full]\n` : "";
      return text(header + archSummary + "\n\n" + parts.join("\n"));
    }
    if (name === "get_architecture") return ok(st().architectureInfo);
    if (name === "search_codebase") return ok(deps.semanticSearch(args?.query, args?.max_results || 10, project));
    if (name === "get_dependency_graph") return ok(deps.buildDependencyGraph(project));
    if (name === "get_context") return ok(st().latestContext);
    if (name === "write_file") return ok(deps.writeFileContentFor(project, args?.path, args?.content));
    if (name === "write_multiple_files") return ok(deps.writeMultipleFilesFor(project, args?.files || []));
    if (name === "trigger_build") {
      const result = await deps.buildTools.runBuild(project);
      st().latestContext.buildError = result.success ? null : (result.output || result.error);
      return ok(result);
    }
    if (name === "add_conversation_turn") { deps.addToHistoryFor(project, args?.role, args?.content); return text("Stored."); }
    if (name === "get_conversation_history") return text(deps.getHistorySummaryFor(project));

    // ── Phase 4: Code intelligence ───────────────────────────────────────
    // Pass projectPath + fsTools so searchIndex reads fresh from disk (Bug 8 fix).
    const intelOpts = { projectPath: project, fsTools: deps.fsTools };
    if (name === "find_symbol") return ok(deps.codeIntel.findSymbol(st().codebaseIndex, args?.name, { ext_filter: args?.ext_filter, ...intelOpts }));
    if (name === "find_class") return ok(deps.codeIntel.findClass(st().codebaseIndex, args?.name, intelOpts));
    if (name === "find_method") return ok(deps.codeIntel.findMethod(st().codebaseIndex, args?.name, intelOpts));
    if (name === "find_interface") return ok(deps.codeIntel.findInterface(st().codebaseIndex, args?.name, intelOpts));
    if (name === "find_references") return ok(deps.codeIntel.findReferences(st().codebaseIndex, args?.symbol, intelOpts));
    if (name === "find_unused_files") return ok(deps.codeIntel.findUnusedFiles(st().codebaseIndex));
    if (name === "find_duplicate_code") return ok(deps.codeIntel.findDuplicateCode(st().codebaseIndex));

    // ── Phase 5: Safe editing ────────────────────────────────────────────
    if (name === "patch_file") return ok(deps.mergeIndexOnSuccess(deps.editing.patchFile(project, args?.path, args?.old_text, args?.new_text), project, args?.path));
    if (name === "replace_method") return ok(deps.mergeIndexOnSuccess(deps.editing.replaceMethod(project, args?.path, args?.method_name, args?.new_code), project, args?.path));
    if (name === "delete_method") return ok(deps.mergeIndexOnSuccess(deps.editing.deleteMethod(project, args?.path, args?.method_name), project, args?.path));
    if (name === "insert_method") return ok(deps.mergeIndexOnSuccess(deps.editing.insertMethod(project, args?.path, args?.class_name, args?.method_code, args?.position || "end"), project, args?.path));
    if (name === "insert_class") return ok(deps.mergeIndexOnSuccess(deps.editing.insertClass(project, args?.path, args?.class_code), project, args?.path));
    if (name === "rename_symbol") {
      const result = deps.editing.renameSymbol(project, st().codebaseIndex, args?.old_name, args?.new_name, {
        ext_filter: args?.ext_filter,
        scope: args?.scope || "project",
        relPath: args?.rel_path,
      });
      if (!result.success) return ok(result);
      result.changedFiles.forEach((f) => { st().codebaseIndex[f.path] = f.indexEntry; });
      return ok({ success: true, filesChanged: result.filesChanged, totalOccurrences: result.totalOccurrences, files: result.changedFiles.map((f) => ({ path: f.path, occurrences: f.occurrences })) });
    }

    // ── Phase 6: Git ─────────────────────────────────────────────────────
    if (name === "git_status") return ok(await deps.gitTools.gitStatus(project));
    if (name === "git_diff") return ok(await deps.gitTools.gitDiff(project, args?.file));
    if (name === "git_log") return ok(await deps.gitTools.gitLog(project, args?.limit));
    if (name === "show_untracked_files") return ok(await deps.gitTools.showUntrackedFiles(project));
    if (name === "git_checkout") return ok(await deps.gitTools.gitCheckout(project, args?.branch));
    if (name === "create_branch") return ok(await deps.gitTools.createBranch(project, args?.branch));
    if (name === "commit_changes") return ok(await deps.gitTools.commitChanges(project, args?.message, args?.add_all !== false));

    // ── Phase 8: Project memory ──────────────────────────────────────────
    if (name === "add_project_note") return ok(deps.addProjectNoteFor(project, args?.type, args?.content));
    if (name === "get_project_memory") return ok(deps.getProjectMemoryFor(project));

    // ── Phase 9: Code review ─────────────────────────────────────────────
    if (name === "review_file") {
      // Bug 5 fix: read from disk, not the 25KB-capped cache entry.
      const read = deps.fsTools.readFileSafe(project, args?.path);
      if (!read.success) return text("File not found in index");
      const ext = require("path").extname(args.path).toLowerCase();
      return ok(deps.reviewTools.reviewFile(args.path, read.content, ext));
    }
    if (name === "review_project") return ok(deps.reviewTools.reviewProject(st().codebaseIndex));
    if (name === "find_code_smells") return ok(deps.reviewTools.findCodeSmells(st().codebaseIndex));
    if (name === "review_architecture") return ok(deps.reviewTools.reviewArchitecture(st().architectureInfo));
    if (name === "suggest_refactoring") return ok(deps.reviewTools.suggestRefactoring(st().codebaseIndex, st().architectureInfo));
    if (name === "explain_build_error") return ok(deps.reviewTools.explainBuildError(args?.error_text || st().latestContext.buildError));

    // ── Default ───────────────────────────────────────────────────────────
    return text("Unknown tool: " + name);
  } catch (error) {
    return text("Tool error: " + error.message);
  }
}

module.exports = { dispatch };
