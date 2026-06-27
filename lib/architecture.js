"use strict";
const path = require("path");

function findFile(index, matcher) {
  const entry = Object.entries(index).find(([p]) => matcher(p.replace(/\\/g, "/")));
  return entry ? entry[1] : null;
}

function has(allContent, ...terms) {
  return terms.every((t) => allContent.toLowerCase().includes(t.toLowerCase()));
}

function hasAny(allContent, ...terms) {
  return terms.some((t) => allContent.toLowerCase().includes(t.toLowerCase()));
}

// ── Package-manager detection (Phase 3) ──────────────────────────────────────

function detectNodePackageManager(allPaths) {
  if (allPaths.some((p) => p.endsWith("pnpm-lock.yaml"))) return "pnpm";
  if (allPaths.some((p) => p.endsWith("yarn.lock"))) return "yarn";
  if (allPaths.some((p) => p.endsWith("package-lock.json"))) return "npm";
  return "npm";
}

// ── Per-language profiles ────────────────────────────────────────────────────
// Each profile, if its "detect" matches, contributes language/framework/projectType/
// packageManager and a language-specific pattern list.

function buildProfiles(index, allPaths, allContent, folderSet) {
  const packageJsonFile = findFile(index, (p) => p.endsWith("package.json"));
  const pkg = (() => {
    try { return packageJsonFile ? JSON.parse(packageJsonFile.content) : null; }
    catch { return null; }
  })();
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};

  return [
    {
      name: ".NET",
      detect: () => allPaths.some((p) => p.endsWith(".csproj") || p.endsWith(".sln")),
      language: "C#",
      packageManager: "NuGet",
      framework: () => {
        if (has(allContent, "Microsoft.AspNetCore")) return "ASP.NET Core";
        if (has(allContent, "Microsoft.NETCore.App")) return ".NET";
        return ".NET";
      },
      projectType: () => (has(allContent, "Microsoft.AspNetCore") ? "Web API / MVC" : "Library / Service"),
    },
    {
      name: "Node/Express",
      detect: () => !!pkg && !!deps.express,
      language: "JavaScript/TypeScript",
      packageManager: () => detectNodePackageManager(allPaths),
      framework: "Express",
      projectType: "REST API service",
    },
    {
      name: "Next.js",
      detect: () => !!pkg && !!deps.next,
      language: "JavaScript/TypeScript",
      packageManager: () => detectNodePackageManager(allPaths),
      framework: "Next.js",
      projectType: () => (folderSet.has("app") ? "Next.js (App Router)" : "Next.js (Pages Router)"),
    },
    {
      name: "React",
      detect: () => !!pkg && !!deps.react && !deps.next,
      language: "JavaScript/TypeScript",
      packageManager: () => detectNodePackageManager(allPaths),
      framework: "React",
      projectType: "Front-end SPA",
    },
    {
      name: "Node (generic)",
      detect: () => !!pkg,
      language: "JavaScript/TypeScript",
      packageManager: () => detectNodePackageManager(allPaths),
      framework: "Node.js",
      projectType: "Node application",
    },
    {
      name: "Django",
      detect: () => has(allContent, "django"),
      language: "Python",
      packageManager: () => (allPaths.some((p) => p.endsWith("pyproject.toml")) ? "poetry/pip" : "pip"),
      framework: "Django",
      projectType: "Web application",
    },
    {
      name: "FastAPI",
      detect: () => hasAny(allContent, "fastapi", "from fastapi"),
      language: "Python",
      packageManager: () => (allPaths.some((p) => p.endsWith("pyproject.toml")) ? "poetry/pip" : "pip"),
      framework: "FastAPI",
      projectType: "REST API service",
    },
    {
      name: "Flask",
      detect: () => hasAny(allContent, "from flask", "flask(__name__)"),
      language: "Python",
      packageManager: () => (allPaths.some((p) => p.endsWith("pyproject.toml")) ? "poetry/pip" : "pip"),
      framework: "Flask",
      projectType: "REST API service",
    },
    {
      name: "Python (generic)",
      detect: () => allPaths.some((p) => p.endsWith(".py")),
      language: "Python",
      packageManager: () => (allPaths.some((p) => p.endsWith("pyproject.toml")) ? "poetry/pip" : "pip"),
      framework: "—",
      projectType: "Python application",
    },
    {
      name: "Spring Boot",
      detect: () => hasAny(allContent, "org.springframework.boot", "@springbootapplication"),
      language: "Java",
      packageManager: () => (allPaths.some((p) => p.endsWith("pom.xml")) ? "Maven" : "Gradle"),
      framework: "Spring Boot",
      projectType: "Web API service",
    },
    {
      name: "Java (generic)",
      detect: () => allPaths.some((p) => p.endsWith(".java")),
      language: "Java",
      packageManager: () => (allPaths.some((p) => p.endsWith("pom.xml")) ? "Maven" : "Gradle"),
      framework: "—",
      projectType: "Java application",
    },
    {
      name: "Go",
      detect: () => allPaths.some((p) => p.endsWith("go.mod") || p.endsWith(".go")),
      language: "Go",
      packageManager: "Go Modules",
      framework: () => {
        if (hasAny(allContent, "gin-gonic", "github.com/gin")) return "Gin";
        if (hasAny(allContent, "labstack/echo")) return "Echo";
        if (hasAny(allContent, "gofiber/fiber")) return "Fiber";
        return "net/http";
      },
      projectType: "Go application",
    },
  ];
}

function resolveValue(v) {
  return typeof v === "function" ? v() : v;
}

// ── .NET pattern detection (kept from the original implementation) ──────────

function detectDotNetPatterns(allContent, folderSet) {
  const has2 = (...terms) => terms.every((t) => allContent.toLowerCase().includes(t.toLowerCase()));
  const hasFolder = (...names) => names.every((n) => folderSet.has(n.toLowerCase()));
  const patterns = [];

  if (hasFolder("domain", "application", "infrastructure") || hasFolder("core", "infrastructure")) patterns.push("Clean Architecture");
  if (has2("ICommand", "IQuery", "ICommandHandler", "IQueryHandler") || has2("MediatR") || hasFolder("commands", "queries", "handlers")) patterns.push("CQRS");
  if (has2("IMediator") || has2("using MediatR")) patterns.push("MediatR");
  if (has2("IRepository") || has2("IGenericRepository") || hasFolder("repositories")) patterns.push("Repository Pattern");
  if (has2("IUnitOfWork") || has2("UnitOfWork")) patterns.push("Unit of Work");
  if (hasFolder("controllers", "views", "models") || has2(": Controller") || has2(": ControllerBase")) patterns.push("MVC");
  if (hasFolder("pages") || has2(": PageModel")) patterns.push("Razor Pages");
  if (has2("app.MapGet") || has2("app.MapPost") || has2("WebApplication.CreateBuilder")) patterns.push("Minimal API");
  if (has2("DbContext") || has2("DbSet<") || has2("using Microsoft.EntityFrameworkCore")) patterns.push("Entity Framework Core");
  if (has2("IServiceCollection") || has2("AddScoped") || has2("AddTransient") || has2("AddSingleton")) patterns.push("Dependency Injection");
  if (has2("IMapper") || has2("CreateMap<") || has2("using AutoMapper")) patterns.push("AutoMapper");
  if (has2("AbstractValidator") || has2("using FluentValidation")) patterns.push("FluentValidation");
  if (has2("HasKey(") || has2("HasMany(") || has2("HasOne(")) patterns.push("EF Fluent Configuration");

  return patterns;
}

function detectGenericPatterns(allContent, folderSet, language) {
  const patterns = [];
  const hasFolder = (...names) => names.every((n) => folderSet.has(n.toLowerCase()));

  if (language === "JavaScript/TypeScript") {
    if (hasFolder("routes") || hasFolder("controllers")) patterns.push("MVC-style routing");
    if (hasFolder("middleware")) patterns.push("Middleware pipeline");
    if (hasFolder("components") && hasFolder("hooks")) patterns.push("Component + Hooks architecture");
    if (has(allContent, "prisma") || has(allContent, "sequelize") || has(allContent, "typeorm")) patterns.push("ORM");
    if (has(allContent, "zod") || has(allContent, "joi") || has(allContent, "yup")) patterns.push("Schema Validation");
  }
  if (language === "Python") {
    if (has(allContent, "sqlalchemy")) patterns.push("SQLAlchemy ORM");
    if (has(allContent, "pydantic")) patterns.push("Pydantic Models");
    if (hasFolder("blueprints")) patterns.push("Flask Blueprints");
  }
  if (language === "Java") {
    if (has(allContent, "@restcontroller")) patterns.push("REST Controllers");
    if (has(allContent, "@service")) patterns.push("Service Layer");
    if (has(allContent, "@repository")) patterns.push("Repository Pattern");
    if (has(allContent, "@autowired")) patterns.push("Dependency Injection");
  }
  if (language === "Go") {
    if (hasFolder("handlers")) patterns.push("Handler-based routing");
    if (hasFolder("internal")) patterns.push("Internal package isolation");
  }
  return patterns;
}

function inferTechStack(allContent) {
  const stack = [];
  if (allContent.includes("Microsoft.AspNetCore")) stack.push("ASP.NET Core");
  if (allContent.includes("EntityFrameworkCore")) stack.push("Entity Framework Core");
  if (allContent.includes("using MediatR")) stack.push("MediatR");
  if (allContent.includes("using AutoMapper")) stack.push("AutoMapper");
  if (allContent.includes("FluentValidation")) stack.push("FluentValidation");
  if (allContent.includes("Serilog")) stack.push("Serilog");
  if (allContent.includes("Swagger") || allContent.includes("NSwag")) stack.push("Swagger/OpenAPI");
  if (allContent.includes("SignalR")) stack.push("SignalR");
  if (/jwt|jwtbearer/i.test(allContent)) stack.push("JWT Auth");
  if (allContent.includes("IdentityServer")) stack.push("IdentityServer");
  if (allContent.includes("Hangfire")) stack.push("Hangfire");
  if (/xunit|nunit|jest|pytest|junit/i.test(allContent)) stack.push("Unit Testing");
  if (/docker/i.test(allContent)) stack.push("Docker");
  if (/redis/i.test(allContent)) stack.push("Redis");
  if (/graphql/i.test(allContent)) stack.push("GraphQL");
  return stack;
}

function buildArchitectureSummary(primary, language, framework, patterns, conventions, namespaces) {
  const ns = namespaces.length ? `Root namespace: ${namespaces[0]}. ` : "";
  const conv = Object.entries(conventions).map(([k, v]) => `${k}: ${v}`).join(", ");
  return `${language} project using ${framework}. Primary architecture: ${primary}. Patterns in use: ${patterns.join(", ") || "none detected"}. ${ns}${conv ? "Conventions: " + conv + "." : ""}`;
}

function detectArchitecture(index) {
  const allPaths = Object.keys(index);
  const allContent = Object.values(index).map((f) => f.content).join("\n");
  const folders = allPaths.map((p) => p.replace(/\\/g, "/").split("/")).flat().map((s) => s.toLowerCase());
  const folderSet = new Set(folders);

  const profiles = buildProfiles(index, allPaths, allContent, folderSet);
  const matched = profiles.find((p) => {
    try { return p.detect(); } catch { return false; }
  }) || { name: "Unknown", language: "Unknown", framework: "—", projectType: "Unknown", packageManager: "—" };

  const language = resolveValue(matched.language);
  const framework = resolveValue(matched.framework);
  const projectType = resolveValue(matched.projectType);
  const packageManager = resolveValue(matched.packageManager);

  const patterns = language === "C#"
    ? detectDotNetPatterns(allContent, folderSet)
    : detectGenericPatterns(allContent, folderSet, language);

  // Naming conventions / namespace (kept generic across languages)
  const namespaces = [];
  const csprojContent = Object.entries(index).find(([k]) => k.endsWith(".csproj"))?.[1]?.content || "";
  const nsMatch = csprojContent.match(/<RootNamespace>(.*?)<\/RootNamespace>/) || allContent.match(/^namespace\s+([\w.]+)/m);
  if (nsMatch) namespaces.push(nsMatch[1]);
  const goModMatch = allContent.match(/^module\s+([\w./-]+)/m);
  if (language === "Go" && goModMatch) namespaces.push(goModMatch[1]);

  const conventions = {};
  if (has(allContent, "Dto") || has(allContent, "DTO")) conventions.dtoSuffix = "Dto";
  if (has(allContent, "ViewModel")) conventions.vmSuffix = "ViewModel";
  if (has(allContent, "Request") && has(allContent, "Response")) conventions.apiConvention = "Request/Response objects";
  if (has(allContent, "IService") || has(allContent, "Service")) conventions.serviceSuffix = "Service";

  let primary = matched.name;
  if (patterns.includes("Clean Architecture")) primary = "Clean Architecture";
  else if (patterns.includes("CQRS")) primary = "CQRS";
  else if (language === "C#" && patterns.includes("MVC")) primary = "ASP.NET MVC";
  else if (language === "C#" && patterns.includes("Razor Pages")) primary = "Razor Pages";
  else if (language === "C#" && patterns.includes("Minimal API")) primary = "Minimal API";

  const layerMap = {};
  allPaths.forEach((p) => {
    const parts = p.replace(/\\/g, "/").split("/");
    const layer = parts[0];
    if (!layerMap[layer]) layerMap[layer] = [];
    layerMap[layer].push(parts.slice(1).join("/"));
  });

  return {
    primary,
    language,
    framework,
    projectType,
    packageManager,
    patterns,
    namespaces,
    conventions,
    layerMap,
    techStack: inferTechStack(allContent),
    summary: buildArchitectureSummary(primary, language, framework, patterns, conventions, namespaces),
  };
}

module.exports = { detectArchitecture };
