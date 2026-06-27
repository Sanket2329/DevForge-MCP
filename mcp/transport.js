"use strict";

const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createMcpServer } = require("./server");

/**
 * Returns an Express request handler for POST /mcp.
 * deps is the dependency bundle assembled in server.js.
 *
 * Stateless: sessionIdGenerator is undefined so no Mcp-Session-Id header is emitted.
 * A new StreamableHTTPServerTransport and new MCP Server are created per request.
 *
 * @param {object} deps — injected dependencies from server.js
 * @returns {Function}  — async Express middleware (req, res) => void
 */
function createMcpRouteHandler(deps) {
  return async function mcpHandler(req, res) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createMcpServer(deps);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
   } catch (err) {
  console.log("\n========== MCP ERROR ==========");
  console.error(err);
  console.error(err.stack);
  console.log("================================\n");

  deps.logger.error("[mcp] unhandled error:", err);

  if (!res.headersSent) {
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
      },
      id: null,
    });
  }
      }
  };

}

module.exports = { createMcpRouteHandler };
