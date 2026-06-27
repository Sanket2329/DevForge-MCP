"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { getToolDefinitions } = require("./tools");
const { dispatch } = require("./handlers");

/**
 * Redacts sensitive argument keys and truncates long values for safe debug logging.
 * @param {object|null|undefined} args
 * @returns {object}
 */
function sanitizeArgs(args) {
  const SENSITIVE = /secret|key|token|password/i;
  const MAX_LEN = 200;
  const result = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (SENSITIVE.test(k)) {
      result[k] = "[REDACTED]";
    } else {
      const s = String(v);
      result[k] = s.length > MAX_LEN ? s.slice(0, MAX_LEN) + "\u2026" : s;
    }
  }
  return result;
}

/**
 * Constructs a configured @modelcontextprotocol/sdk Server instance.
 * @param {object} deps — dependency bundle from server.js
 * @returns {Server}
 */
function createMcpServer(deps) {
  const server = new Server(
    { name: "LeadSense MCP Enhanced", version: "13.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(deps.MEMORY_TYPES),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    deps.logger.debug("[tool] " + name, sanitizeArgs(args));
    return dispatch(name, args, deps);
  });

  return server;
}

module.exports = { createMcpServer };
