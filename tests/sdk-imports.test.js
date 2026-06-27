"use strict";

/**
 * Task 1.2 — Confirm SDK import paths resolve correctly
 * Validates: Requirements 1.3, 1.4
 *
 * Each assertion verifies that the named SDK module path does NOT throw a
 * MODULE_NOT_FOUND (or any other) error when required.  If the SDK layout
 * ever changes these entry-points these tests will catch it immediately.
 */

describe("MCP SDK import paths", () => {
  test("@modelcontextprotocol/sdk/server/index.js resolves without error", () => {
    expect(() => require("@modelcontextprotocol/sdk/server/index.js")).not.toThrow();
  });

  test("@modelcontextprotocol/sdk/types.js resolves without error", () => {
    expect(() => require("@modelcontextprotocol/sdk/types.js")).not.toThrow();
  });

  test("@modelcontextprotocol/sdk/server/streamableHttp.js resolves without error", () => {
    expect(() => require("@modelcontextprotocol/sdk/server/streamableHttp.js")).not.toThrow();
  });

  test("Server class is exported from server/index.js", () => {
    const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
    expect(typeof Server).toBe("function");
  });

  test("ListToolsRequestSchema and CallToolRequestSchema are exported from types.js", () => {
    const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
    expect(ListToolsRequestSchema).toBeDefined();
    expect(CallToolRequestSchema).toBeDefined();
  });

  test("StreamableHTTPServerTransport is exported from server/streamableHttp.js", () => {
    const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
    expect(typeof StreamableHTTPServerTransport).toBe("function");
  });
});
