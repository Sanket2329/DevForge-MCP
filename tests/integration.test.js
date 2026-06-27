"use strict";

/**
 * integration.test.js
 *
 * Integration smoke tests for the Express HTTP layer.
 * Uses supertest to exercise the app in-process without starting a real server.
 * Avoids requiring server.js directly (which calls refreshIndex() on load).
 *
 * Validates: Requirements 3.2, 3.3, 4.2, 5.2, 6.1, 6.2
 */

const request = require("supertest");
const { createTestApp } = require("./helpers/createTestApp");

let app;

beforeAll(() => {
  app = createTestApp();
});

// ── /status ──────────────────────────────────────────────────────────────────

describe("GET /status", () => {
  test("responds 200 with application/json", async () => {
    const res = await request(app).get("/status");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ── /dashboard ───────────────────────────────────────────────────────────────

describe("GET /dashboard", () => {
  test("responds 200 with text/html", async () => {
    const res = await request(app).get("/dashboard");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });
});

// ── POST /mcp ─────────────────────────────────────────────────────────────────

/**
 * Parse a JSON-RPC result from an SSE response body.
 * The MCP StreamableHTTPServerTransport always responds with
 * Content-Type: text/event-stream.  Each SSE frame looks like:
 *   event: message\ndata: <json>\n\n
 * We extract the first `data:` line and parse it.
 */
function parseSseBody(text) {
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      return JSON.parse(line.slice("data:".length).trim());
    }
  }
  return null;
}

describe("POST /mcp", () => {
  // The MCP StreamableHTTP transport requires Accept to list both
  // application/json and text/event-stream (MCP spec §4.2).
  const MCP_ACCEPT = "application/json, text/event-stream";

  test("tools/list returns 200 with a tools array of length 44", async () => {
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", MCP_ACCEPT)
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });

    expect(res.status).toBe(200);
    // Transport returns text/event-stream; parse the SSE frame to get the JSON-RPC body.
    const body = parseSseBody(res.text);
    expect(body).not.toBeNull();
    expect(body).toHaveProperty("result");
    expect(body.result).toHaveProperty("tools");
    expect(Array.isArray(body.result.tools)).toBe(true);
    expect(body.result.tools).toHaveLength(44);
  });

  test("non-JSON body (invalid JSON) returns 400", async () => {
    // Send correct Content-Type and Accept, but a body that is not valid JSON.
    // Express parses the body as undefined (strict mode), so the transport
    // receives an empty/invalid message and responds 400.
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", MCP_ACCEPT)
      .send("not-json");

    expect(res.status).toBe(400);
  });
});

// ── Routes that should NOT exist ─────────────────────────────────────────────

describe("GET /sse", () => {
  test("returns 404 (route not registered)", async () => {
    const res = await request(app).get("/sse");
    expect(res.status).toBe(404);
  });
});

describe("POST /messages", () => {
  test("returns 404 (route not registered)", async () => {
    const res = await request(app).post("/messages");
    expect(res.status).toBe(404);
  });
});
