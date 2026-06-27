"use strict";

function getToolDefinitions(MEMORY_TYPES) {
  const RO = { readOnlyHint: true };

  return [
    // ── Phase 1: Project manager ──────────────────────────────────────────
    { name: "list_projects", description: "List every project under the configured workspace root. Use this when the user wants to know what repos are available or switch projects.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "select_project", description: "Switch the active project by name (relative to the workspace root) or absolute path. Re-indexes and reattaches the file watcher — no restart needed. Use this when the user says 'work on <other project>' or 'switch to <repo>'.", inputSchema: { type: "object", properties: { project: { type: "string", description: "Project name or absolute path" } }, required: ["project"] } },
    { name: "get_current_project", description: "Return the active project's name, path, indexed file count, detected architecture, and last scan time.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "refresh_index", description: "Re-scan the active project and rebuild the file index + architecture profile. Use this after large external changes (e.g. a git pull).", inputSchema: { type: "object", properties: {} }, annotations: RO },

    // ── Baseline: indexing / reading ──────────────────────────────────────
    { name: "get_project_files", description: "List indexed files with metadata (path, size, extension, last modified).", inputSchema: { type: "object", properties: { ext_filter: { type: "string", description: "Optional: filter by extension e.g. '.cs' or '.py'" } } }, annotations: RO },
    { name: "get_file_content", description: "Read a single source file by relative path.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, annotations: RO },
    { name: "get_full_codebase", description: "Use this when the user asks a coding question about the project, BEFORE answering. Returns the entire indexed codebase plus architecture summary so suggestions respect existing conventions.", inputSchema: { type: "object", properties: { ext_filter: { type: "string", description: "Optional: restrict to a file extension" } } }, annotations: RO },
    { name: "get_architecture", description: "Returns the detected architecture profile: language, framework, primary pattern, patterns in use, tech stack, conventions, namespace, layer map. Call alongside get_full_codebase.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "search_codebase", description: "Full-text search across indexed files. Use this to find relevant classes/functions/usages before generating code.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Search terms" }, max_results: { type: "number" } }, required: ["query"] }, annotations: RO },
    { name: "get_dependency_graph", description: "Map of every file → its imports/usings and namespace. Use before modifying or creating files to understand coupling.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "get_context", description: "Current build state: last error, last changed file, index stats, architecture summary.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "write_file", description: "Create or overwrite one file. Always call get_full_codebase + get_architecture first so the code matches the project's conventions.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
    { name: "write_multiple_files", description: "Write several files in one operation — ideal for refactors spanning multiple layers/files at once.", inputSchema: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }, required: ["files"] } },
    { name: "trigger_build", description: "Auto-detects the right build tool (dotnet/npm/pnpm/yarn/python/maven/gradle/go/cargo) for the active project and runs it. Returns pass/fail and full output.", inputSchema: { type: "object", properties: {} } },
    { name: "add_conversation_turn", description: "Store a user/assistant turn in rolling conversation memory.", inputSchema: { type: "object", properties: { role: { type: "string", enum: ["user", "assistant"] }, content: { type: "string" } }, required: ["role", "content"] } },
    { name: "get_conversation_history", description: "Retrieve the last 10 conversation turns for context continuity.", inputSchema: { type: "object", properties: {} }, annotations: RO },

    // ── Phase 4: Code intelligence ──────────────────────────────────────────
    { name: "find_symbol", description: "Find every occurrence of an identifier (variable, function, class — any symbol) across the codebase.", inputSchema: { type: "object", properties: { name: { type: "string" }, ext_filter: { type: "string" } }, required: ["name"] }, annotations: RO },
    { name: "find_class", description: "Find where a class/struct/interface/type is declared.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, annotations: RO },
    { name: "find_method", description: "Find where a function/method is declared (C#, Java, JS/TS, Python, Go signatures supported).", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, annotations: RO },
    { name: "find_interface", description: "Find where an interface/type-interface is declared.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, annotations: RO },
    { name: "find_references", description: "Find every place a symbol is referenced (broader than find_symbol — used for 'what calls this' questions).", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] }, annotations: RO },
    { name: "find_unused_files", description: "Heuristically flag files that no other file appears to reference — candidates for deletion. Always verify before deleting.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "find_duplicate_code", description: "Detect blocks of near-identical code repeated across files — candidates for extraction into a shared function.", inputSchema: { type: "object", properties: {} }, annotations: RO },

    // ── Phase 5: Safe file editing ───────────────────────────────────────────
    { name: "patch_file", description: "Surgically replace one exact, unique snippet of text in a file. The safest edit — preserves all surrounding formatting. Fails loudly if the snippet isn't unique.", inputSchema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
    { name: "replace_method", description: "Replace an entire method/function body by name, keeping the rest of the file untouched.", inputSchema: { type: "object", properties: { path: { type: "string" }, method_name: { type: "string" }, new_code: { type: "string" } }, required: ["path", "method_name", "new_code"] } },
    { name: "insert_method", description: "Insert a new method into an existing class (start or end of its body).", inputSchema: { type: "object", properties: { path: { type: "string" }, class_name: { type: "string" }, method_code: { type: "string" }, position: { type: "string", enum: ["start", "end"] } }, required: ["path", "class_name", "method_code"] } },
    { name: "insert_class", description: "Append a new class/type to a file (inside the last namespace block for C#, end-of-file otherwise).", inputSchema: { type: "object", properties: { path: { type: "string" }, class_code: { type: "string" } }, required: ["path", "class_code"] } },
    { name: "rename_symbol", description: "Rename a symbol everywhere it's used across the indexed codebase (word-boundary match) and write every changed file back to disk.", inputSchema: { type: "object", properties: { old_name: { type: "string" }, new_name: { type: "string" }, ext_filter: { type: "string" } }, required: ["old_name", "new_name"] } },
    { name: "delete_method", description: "Remove a method/function (and its immediately preceding doc-comment/decorator/attribute lines) from a file.", inputSchema: { type: "object", properties: { path: { type: "string" }, method_name: { type: "string" } }, required: ["path", "method_name"] } },

    // ── Phase 6: Git ─────────────────────────────────────────────────────────
    { name: "git_status", description: "Short git status + current branch for the active project.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "git_diff", description: "Git diff for the working tree, optionally scoped to one file.", inputSchema: { type: "object", properties: { file: { type: "string" } } }, annotations: RO },
    { name: "git_log", description: "Recent commit history.", inputSchema: { type: "object", properties: { limit: { type: "number" } } }, annotations: RO },
    { name: "show_untracked_files", description: "List files git sees as untracked.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "git_checkout", description: "Checkout an existing branch.", inputSchema: { type: "object", properties: { branch: { type: "string" } }, required: ["branch"] } },
    { name: "create_branch", description: "Create and checkout a new branch.", inputSchema: { type: "object", properties: { branch: { type: "string" } }, required: ["branch"] } },
    { name: "commit_changes", description: "Stage and commit changes with a message.", inputSchema: { type: "object", properties: { message: { type: "string" }, add_all: { type: "boolean" } }, required: ["message"] } },

    // ── Phase 8: Project memory ──────────────────────────────────────────────
    { name: "add_project_note", description: "Record a durable project-level note (an architecture decision, a coding convention, a known issue, or a free-form note) that persists across conversations, not just this chat.", inputSchema: { type: "object", properties: { type: { type: "string", enum: MEMORY_TYPES }, content: { type: "string" } }, required: ["type", "content"] } },
    { name: "get_project_memory", description: "Retrieve all stored project-level notes: decisions, conventions, known issues, notes.", inputSchema: { type: "object", properties: {} }, annotations: RO },

    // ── Phase 9: Code review ─────────────────────────────────────────────────
    { name: "review_file", description: "Heuristic review of one file: long methods, TODOs, magic numbers, deep nesting.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, annotations: RO },
    { name: "review_project", description: "Project-wide stats: file counts by extension, largest files, total TODO/FIXME count.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "find_code_smells", description: "Aggregate code-smell scan across the whole project (long methods, duplication, deep nesting, TODOs), ranked by severity.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "review_architecture", description: "Architecture-aware suggestions based on the detected stack (e.g. missing tests, missing DI, missing validation).", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "suggest_refactoring", description: "Consolidated, prioritized refactoring suggestions combining code smells + architecture review.", inputSchema: { type: "object", properties: {} }, annotations: RO },
    { name: "explain_build_error", description: "Parse a raw compiler/build error into structured {file, line, code, message} entries (C#, TS, Java, Go, Python) so it's easy to explain in plain language. Defaults to the last build error if none is provided.", inputSchema: { type: "object", properties: { error_text: { type: "string" } } }, annotations: RO },
  ];
}

module.exports = { getToolDefinitions };
