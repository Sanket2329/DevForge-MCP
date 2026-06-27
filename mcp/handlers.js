"use strict";

// ── Module-local response helpers (NOT exported) ──────────────────────────────
function ok(value) { return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }; }
function text(value) { return { content: [{ type: "text", text: String(value) }] }; }

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
    // Convenience accessor — mirrors `const st = () => state.getState(PROJECT);`
    const st = () => deps.state.getState(deps.getProject());

    // ── Phase 1 ──────────────────────────────────────────────────────────
    if (name === "list_projects") return ok(deps.listProjects());
    if (name === "select_project") return ok(deps.selectProject(args?.project));
    if (name === "get_current_project") return ok(deps.getCurrentProject());
    if (name === "refresh_index") { deps.refreshIndex(); return ok(deps.getCurrentProject()); }

    // ── Baseline ─────────────────────────────────────────────────────────
    if (name === "get_project_files") {
      const ext = args?.ext_filter?.toLowerCase();
      const files = Object.entries(st().codebaseIndex)
        .filter(([p]) => !ext || p.endsWith(ext))
        .map(([p, f]) => ({ path: p, ext: f.ext, sizeKB: (f.size / 1024).toFixed(1), lastModified: f.lastModified }));
      return ok(files);
    }
    if (name === "get_file_content") {
      const file = st().codebaseIndex[args?.path];
      return text(file ? file.content : "File not found in index");
    }
    if (name === "get_full_codebase") {
      const ext = args?.ext_filter?.toLowerCase();
      const idx = st().codebaseIndex;
      const dump = Object.entries(idx)
        .filter(([p]) => !ext || p.endsWith(ext))
        .map(([p, f]) => `\n${"=".repeat(80)}\nFILE: ${p}\n${"=".repeat(80)}\n${f.content}`)
        .join("\n");
      const arch = st().architectureInfo;
      const archSummary = arch ? `\n\nARCHITECTURE:\n${arch.summary}\nPatterns: ${arch.patterns.join(", ")}\nTech Stack: ${arch.techStack.join(", ")}` : "";
      return text(archSummary + "\n\n" + dump);
    }
    if (name === "get_architecture") return ok(st().architectureInfo);
    if (name === "search_codebase") return ok(deps.semanticSearch(args?.query, args?.max_results || 10));
    if (name === "get_dependency_graph") return ok(deps.buildDependencyGraph());
    if (name === "get_context") return ok(st().latestContext);
    if (name === "write_file") return ok(deps.writeFileContent(args?.path, args?.content));
    if (name === "write_multiple_files") return ok(deps.writeMultipleFiles(args?.files || []));
    if (name === "trigger_build") {
      const result = await deps.buildTools.runBuild(deps.getProject());
      st().latestContext.buildError = result.success ? null : (result.output || result.error);
      return ok(result);
    }
    if (name === "add_conversation_turn") { deps.addToHistory(args?.role, args?.content); return text("Stored."); }
    if (name === "get_conversation_history") return text(deps.getHistorySummary());

    // ── Phase 4: Code intelligence ───────────────────────────────────────
    if (name === "find_symbol") return ok(deps.codeIntel.findSymbol(st().codebaseIndex, args?.name, { ext_filter: args?.ext_filter }));
    if (name === "find_class") return ok(deps.codeIntel.findClass(st().codebaseIndex, args?.name));
    if (name === "find_method") return ok(deps.codeIntel.findMethod(st().codebaseIndex, args?.name));
    if (name === "find_interface") return ok(deps.codeIntel.findInterface(st().codebaseIndex, args?.name));
    if (name === "find_references") return ok(deps.codeIntel.findReferences(st().codebaseIndex, args?.symbol));
    if (name === "find_unused_files") return ok(deps.codeIntel.findUnusedFiles(st().codebaseIndex));
    if (name === "find_duplicate_code") return ok(deps.codeIntel.findDuplicateCode(st().codebaseIndex));

    // ── Phase 5: Safe editing ────────────────────────────────────────────
    if (name === "patch_file") return ok(deps.mergeIndexOnSuccess(deps.editing.patchFile(deps.getProject(), args?.path, args?.old_text, args?.new_text), args?.path));
    if (name === "replace_method") return ok(deps.mergeIndexOnSuccess(deps.editing.replaceMethod(deps.getProject(), args?.path, args?.method_name, args?.new_code), args?.path));
    if (name === "delete_method") return ok(deps.mergeIndexOnSuccess(deps.editing.deleteMethod(deps.getProject(), args?.path, args?.method_name), args?.path));
    if (name === "insert_method") return ok(deps.mergeIndexOnSuccess(deps.editing.insertMethod(deps.getProject(), args?.path, args?.class_name, args?.method_code, args?.position || "end"), args?.path));
    if (name === "insert_class") return ok(deps.mergeIndexOnSuccess(deps.editing.insertClass(deps.getProject(), args?.path, args?.class_code), args?.path));
    if (name === "rename_symbol") {
      const result = deps.editing.renameSymbol(deps.getProject(), st().codebaseIndex, args?.old_name, args?.new_name, { ext_filter: args?.ext_filter });
      result.changedFiles.forEach((f) => { st().codebaseIndex[f.path] = f.indexEntry; });
      return ok({ success: true, filesChanged: result.filesChanged, totalOccurrences: result.totalOccurrences, files: result.changedFiles.map((f) => ({ path: f.path, occurrences: f.occurrences })) });
    }

    // ── Phase 6: Git ─────────────────────────────────────────────────────
    if (name === "git_status") return ok(await deps.gitTools.gitStatus(deps.getProject()));
    if (name === "git_diff") return ok(await deps.gitTools.gitDiff(deps.getProject(), args?.file));
    if (name === "git_log") return ok(await deps.gitTools.gitLog(deps.getProject(), args?.limit));
    if (name === "show_untracked_files") return ok(await deps.gitTools.showUntrackedFiles(deps.getProject()));
    if (name === "git_checkout") return ok(await deps.gitTools.gitCheckout(deps.getProject(), args?.branch));
    if (name === "create_branch") return ok(await deps.gitTools.createBranch(deps.getProject(), args?.branch));
    if (name === "commit_changes") return ok(await deps.gitTools.commitChanges(deps.getProject(), args?.message, args?.add_all !== false));

    // ── Phase 8: Project memory ──────────────────────────────────────────
    if (name === "add_project_note") return ok(deps.addProjectNote(args?.type, args?.content));
    if (name === "get_project_memory") return ok(deps.getProjectMemory());

    // ── Phase 9: Code review ─────────────────────────────────────────────
    if (name === "review_file") {
      const file = st().codebaseIndex[args?.path];
      if (!file) return text("File not found in index");
      return ok(deps.reviewTools.reviewFile(args.path, file.content, file.ext));
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
