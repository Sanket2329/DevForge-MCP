# LeadSense MCP Enhanced

A generic, multi-project, multi-language AI development MCP server. Indexes a
codebase, detects its architecture, and exposes 40+ tools (read, search,
safe-edit, git, build, review, memory) over MCP (Streamable HTTP, `POST /mcp`) — connectable from ChatGPT
or Claude.

See **DEPLOYMENT.md** for running it and connecting it to ChatGPT.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PROJECT_PATH` | (hardcoded sample path) | The project to index on boot |
| `WORKSPACE_ROOT` | parent of `PROJECT_PATH` | Folder containing sibling projects for `list_projects`/`select_project` |
| `PORT` | `3000` | HTTP port |
| `MCP_API_KEY` | unset | If set, protects `/api/*` (the dashboard's REST API) — **not** `/mcp`, see DEPLOYMENT.md |
| `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |

## Layout

```
server.js          Express + MCP wiring, all tool handlers
lib/state.js        per-project in-memory state (index, arch, memory)
lib/indexer.js       codebase walker (incremental rebuilds)
lib/architecture.js  multi-language architecture/stack detection
lib/fsTools.js        safe read/write (path-traversal guard, BOM)
lib/codeIntel.js     find_symbol/class/method/.../duplicate_code
lib/editing.js        patch/insert/replace/delete/rename
lib/gitTools.js       git status/diff/log/checkout/branch/commit
lib/buildTools.js     auto-detect + run the right build command
lib/reviewTools.js    code smells, architecture review, build-error parsing
lib/cache.js           index + memory persistence to .mcp-cache / .mcp-memory
lib/logger.js           leveled logging
lib/security.js         optional API key + rate limiting
public/dashboard.html   local project dashboard (served at /dashboard)
```

## Tool inventory (by phase)

1. **Workspace**: `list_projects`, `select_project`, `get_current_project`, `refresh_index`
2. **Read/search** *(baseline)*: `get_project_files`, `get_file_content`, `get_full_codebase`, `get_architecture`, `search_codebase`, `get_dependency_graph`, `get_context`
3. **Write** *(baseline)*: `write_file`, `write_multiple_files`, `trigger_build`
4. **Memory** *(baseline + Phase 8)*: `add_conversation_turn`, `get_conversation_history`, `add_project_note`, `get_project_memory`
5. **Code intelligence**: `find_symbol`, `find_class`, `find_method`, `find_interface`, `find_references`, `find_unused_files`, `find_duplicate_code`
6. **Safe editing**: `patch_file`, `replace_method`, `insert_method`, `insert_class`, `rename_symbol`, `delete_method`
7. **Git**: `git_status`, `git_diff`, `git_log`, `git_checkout`, `create_branch`, `commit_changes`, `show_untracked_files`
8. **Review**: `review_file`, `review_project`, `find_code_smells`, `review_architecture`, `suggest_refactoring`, `explain_build_error`

## Known limitations (heuristic, by design — kept dependency-free)

- Architecture/pattern detection and code review are pattern/regex-based, not
  a real compiler/AST. Treat suggestions as a starting point, not ground truth.
- `find_duplicate_code` is line-hash clone detection, not semantic diffing.
- `replace_method`/`insert_method`/`delete_method` use brace-counting
  (curly languages) or indentation (Python) — works for normal code, can be
  thrown off by unusual formatting or methods named identically in nested scopes.
- Single build/git toolchain runs on the host process — fine for local/dev use;
  for hosted deployments, the container needs the matching SDKs installed.

## Connecting to ChatGPT / OpenAI Secure Tunnel

The MCP endpoint is available at:

```
https://<your-host>/mcp
```

### ChatGPT Connector

1. Open **ChatGPT → Settings → Connectors / Apps → Advanced** and turn **Developer mode** on.
2. Click **Create connector** and paste `https://<your-host>/mcp` as the server URL.
3. Set **Authentication** to **No Authentication**.
4. Click **Confirm and Create**.

### OpenAI Secure Tunnel

1. Install the tunnel client:
   ```bash
   npm install -g @openai/mcp-remote
   ```
   (or `tunnel-client` if that package name is used in your environment)

2. Start the tunnel:
   ```bash
   tunnel-client run --server https://<your-host>/mcp
   ```

3. Verify the connection — all four checks must show **PASS**:
   ```bash
   tunnel-client doctor --server https://<your-host>/mcp
   ```
