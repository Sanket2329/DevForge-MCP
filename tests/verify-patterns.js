"use strict";
/**
 * Verifies METHOD_PATTERNS reorder doesn't break C#/Java typed declarations
 * and correctly handles all JS/TS function shapes.
 */
const { replaceMethod, deleteMethod } = require("../lib/editing");
const fs = require("fs");
const os = require("os");
const path = require("path");

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    console.log(`  ✗  ${label}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeProject(filename, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  fs.writeFileSync(path.join(dir, filename), source);
  return { dir, rel: filename };
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── JS/TS cases ───────────────────────────────────────────────────────────────

console.log("\nJS/TS function declarations:");

test("export default function — no duplicate modifier", () => {
  const { dir, rel } = makeProject("a.js", [
    '"use strict";',
    "",
    "export default function isRawNetworkError(err) {",
    "  return err && err.isNetwork;",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "isRawNetworkError",
    "export default function isRawNetworkError(err) {\n  return err != null;\n}"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  const count = (after.match(/export default/g) || []).length;
  assert(count === 1, `expected 1 'export default', got ${count}\n${after}`);
});

test("export default function with TS return-type annotation (ky real case)", () => {
  const { dir, rel } = makeProject("ky.ts", [
    "export default function isRawNetworkError(error: unknown): error is TypeError {",
    "  return error instanceof TypeError && error.message === 'Failed to fetch';",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "isRawNetworkError",
    "export default function isRawNetworkError(error: unknown): error is TypeError {\n  return error instanceof TypeError;\n}"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  const count = (after.match(/export default/g) || []).length;
  assert(count === 1, `expected 1 'export default', got ${count}\n${after}`);
  assert(after.includes("error instanceof TypeError;"), "replacement not applied\n" + after);
});

test("async TS function with return type", () => {
  const { dir, rel } = makeProject("fetch.ts", [
    "export async function fetchUser(id: string): Promise<User> {",
    "  return api.get(id);",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "fetchUser",
    "export async function fetchUser(id: string): Promise<User> {\n  return api.getById(id);\n}"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("getById"), "replacement not applied\n" + after);
  const count = (after.match(/export async function fetchUser/g) || []).length;
  assert(count === 1, `expected 1 declaration, got ${count}\n${after}`);
});

test("export function — no duplicate export", () => {
  const { dir, rel } = makeProject("b.js", [
    "export function helper(x) {",
    "  return x + 1;",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "helper",
    "export function helper(x) {\n  return x * 2;\n}"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  const count = (after.match(/export function/g) || []).length;
  assert(count === 1, `expected 1 'export function', got ${count}\n${after}`);
});

test("plain function declaration", () => {
  const { dir, rel } = makeProject("c.js", [
    "function greet(name) {",
    "  return 'hi ' + name;",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "greet",
    "function greet(name) {\n  return 'hello ' + name;\n}"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("hello"), "replacement not applied\n" + after);
  const count = (after.match(/function greet/g) || []).length;
  assert(count === 1, `expected 1 'function greet', got ${count}\n${after}`);
});

test("async export function", () => {
  const { dir, rel } = makeProject("d.js", [
    "export async function fetchData(url) {",
    "  return fetch(url);",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "fetchData",
    "export async function fetchData(url) {\n  return fetch(url + '?v=2');\n}"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("v=2"), "replacement not applied\n" + after);
  const count = (after.match(/export async function fetchData/g) || []).length;
  assert(count === 1, `expected 1 declaration, got ${count}\n${after}`);
});

test("arrow function: export const foo = () => {}", () => {
  const { dir, rel } = makeProject("e.js", [
    "export const transform = (x) => {",
    "  return x;",
    "};",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "transform",
    "export const transform = (x) => {\n  return x * 2;\n};"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("x * 2"), "replacement not applied\n" + after);
  const count = (after.match(/export const transform/g) || []).length;
  assert(count === 1, `expected 1 declaration, got ${count}\n${after}`);
});

// ── C# typed declaration cases ────────────────────────────────────────────────

console.log("\nC# / Java typed declarations:");

test("public static int Foo() — typed declaration matches correctly", () => {
  const { dir, rel } = makeProject("Foo.cs", [
    "public class MyClass {",
    "    public static int Compute(int x) {",
    "        return x * 2;",
    "    }",
    "",
    "    public void Other() {",
    "        return;",
    "    }",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "Compute",
    "    public static int Compute(int x) {\n        return x * 3;\n    }"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("x * 3"), "replacement not applied\n" + after);
  assert(after.includes("public void Other"), "Other() was incorrectly removed\n" + after);
  const count = (after.match(/public static int Compute/g) || []).length;
  assert(count === 1, `expected 1 declaration, got ${count}\n${after}`);
});

test("private async Task<bool> IsValid() — typed async method", () => {
  const { dir, rel } = makeProject("Service.cs", [
    "public class Service {",
    "    private async Task<bool> IsValid(string input) {",
    "        return input != null;",
    "    }",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "IsValid",
    "    private async Task<bool> IsValid(string input) {\n        return !string.IsNullOrEmpty(input);\n    }"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("IsNullOrEmpty"), "replacement not applied\n" + after);
  const count = (after.match(/private async Task<bool> IsValid/g) || []).length;
  assert(count === 1, `expected 1 declaration, got ${count}\n${after}`);
});

test("Java: public List<String> getItems() — generic return type", () => {
  const { dir, rel } = makeProject("Repo.java", [
    "public class Repo {",
    "    public List<String> getItems() {",
    "        return new ArrayList<>();",
    "    }",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "getItems",
    "    public List<String> getItems() {\n        return Collections.emptyList();\n    }"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("emptyList"), "replacement not applied\n" + after);
  const count = (after.match(/public List<String> getItems/g) || []).length;
  assert(count === 1, `expected 1 declaration, got ${count}\n${after}`);
});

test("deleteMethod on C# typed method leaves rest intact", () => {
  const { dir, rel } = makeProject("Del.cs", [
    "public class Del {",
    "    public int Add(int a, int b) {",
    "        return a + b;",
    "    }",
    "",
    "    public int Sub(int a, int b) {",
    "        return a - b;",
    "    }",
    "}",
  ].join("\n"));
  const r = deleteMethod(dir, rel, "Add");
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "deleteMethod failed: " + r.error);
  assert(!after.includes("public int Add"), "Add() was not removed\n" + after);
  assert(after.includes("public int Sub"), "Sub() was incorrectly removed\n" + after);
});

// ── Mixed file: JS file that has both a function and a method-like pattern ───

console.log("\nEdge cases:");

test("file with multiple functions — only target replaced", () => {
  const { dir, rel } = makeProject("multi.js", [
    "function alpha() { return 1; }",
    "function beta() { return 2; }",
    "function gamma() { return 3; }",
  ].join("\n"));
  const r = replaceMethod(dir, rel, "beta", "function beta() { return 99; }");
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("return 99"), "beta not replaced\n" + after);
  assert(after.includes("function alpha"), "alpha incorrectly removed\n" + after);
  assert(after.includes("function gamma"), "gamma incorrectly removed\n" + after);
});

test("name appears in comment before real declaration — picks real declaration", () => {
  const { dir, rel } = makeProject("comment.js", [
    "// computeTotal is used to sum items",
    "function computeTotal(items) {",
    "  return items.reduce((a, b) => a + b, 0);",
    "}",
  ].join("\n"));
  const r = replaceMethod(dir, rel,
    "computeTotal",
    "function computeTotal(items) {\n  return items.length > 0 ? items.reduce((a,b)=>a+b,0) : 0;\n}"
  );
  const after = read(dir, rel); cleanup(dir);
  assert(r.success, "replaceMethod failed: " + r.error);
  assert(after.includes("length > 0"), "replacement not applied\n" + after);
  assert(after.includes("// computeTotal is used"), "comment was incorrectly removed\n" + after);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
