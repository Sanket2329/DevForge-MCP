# 🚀 DevForge-MCP

<p align="center">
  <strong>A Production-Ready Model Context Protocol (MCP) Server for AI-Assisted Software Development</strong>
</p>

<p align="center">
Empower AI assistants like ChatGPT and Claude with intelligent code understanding, multi-project workspaces, semantic search, Git integration, architecture analysis, and safe code editing.
</p>

<p align="center">

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-20+-green)
![MCP](https://img.shields.io/badge/MCP-SDK%201.29-orange)
![Platform](https://img.shields.io/badge/Platform-Node.js-success)
![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)

</p>

---

# ✨ Overview

DevForge-MCP is a **production-ready Model Context Protocol (MCP) server** that enables AI coding assistants to intelligently understand, analyze, review, edit, and navigate software projects.

Unlike a traditional file server, DevForge-MCP builds an intelligent representation of your codebase, detects project architecture, manages multiple workspaces, integrates with Git, performs semantic code search, and exposes **44 developer tools** through the latest **Streamable HTTP MCP transport**.

It is designed to work with modern AI assistants that support MCP, providing them with rich contextual understanding of your projects.

---

# ✨ Key Features

## 🧠 AI Code Intelligence

* Architecture detection
* Semantic code search
* Symbol lookup
* Dependency graph generation
* Context-aware navigation
* Duplicate code detection

## 📁 Workspace Management

* Multi-project support
* Project switching
* Automatic indexing
* Persistent project memory
* Incremental cache rebuilding
  
## 📸 Dashboard

![Dashboard](https://github.com/Sanket2329/DevForge-MCP/blob/main/dashboard%202.png)


## ✏ Safe Code Editing

* Patch files
* Replace methods
* Insert methods/classes
* Rename symbols
* Delete methods
* Multi-file editing

## 🌿 Git Integration

* Git status
* Commit changes
* Branch management
* Checkout branches
* Git history
* Diff inspection

## 🔍 Code Review

* Code smell detection
* Architecture review
* Refactoring suggestions
* Build error explanation
* Project review

## ⚡ Modern MCP

* Streamable HTTP
* JSON-RPC 2.0
* Stateless transport
* OpenAI Secure Tunnel compatible
* Latest MCP SDK

---

# 🏗 Architecture

```text
                        AI Assistant
                     (ChatGPT / Claude)
                               │
                               ▼
                 Model Context Protocol (MCP)
                               │
                     Streamable HTTP Transport
                               │
                               ▼
                       DevForge-MCP Server
                               │
      ┌───────────────┬───────────────┬───────────────┐
      │               │               │
      ▼               ▼               ▼
 Code Intelligence    Git Engine    Workspace Manager
      │               │               │
      └───────────────┼───────────────┘
                      ▼
               Local Project Files
```

---

# 🚀 Core Capabilities

* Intelligent codebase indexing
* Multi-project workspaces
* Architecture detection
* Semantic code search
* Safe editing operations
* Git automation
* Build automation
* Code review
* Security inspection
* Project memory
* Dashboard
* Status API

---

# 📦 Technology Stack

* Node.js
* Express.js
* JavaScript
* Model Context Protocol SDK (v1.29+)
* Streamable HTTP
* Docker
* Railway
* Render

---

# 📂 Project Structure

```text
DevForge-MCP
│
├── lib/
│   ├── architecture.js
│   ├── buildTools.js
│   ├── cache.js
│   ├── codeIntel.js
│   ├── editing.js
│   ├── fsTools.js
│   ├── gitTools.js
│   ├── indexer.js
│   ├── logger.js
│   ├── reviewTools.js
│   ├── security.js
│   └── state.js
│
├── mcp/
│   ├── handlers.js
│   ├── server.js
│   ├── tools.js
│   └── transport.js
│
├── public/
│
├── tests/
│
├── server.js
├── package.json
├── Dockerfile
├── README.md
```

---

# 🚀 Getting Started

## Clone Repository

```bash
git clone https://github.com/Sanket2329/DevForge-MCP.git

cd DevForge-MCP
```

---

## Install Dependencies

```bash
npm install
```

---

## Start Server

```bash
npm start
```

---

Server Endpoints

| Endpoint     | Description   |
| ------------ | ------------- |
| `/mcp`       | MCP Endpoint  |
| `/dashboard` | Web Dashboard |
| `/status`    | Server Status |

---

# ⚙ Environment Variables

| Variable       | Default          | Purpose                       |
| -------------- | ---------------- | ----------------------------- |
| PROJECT_PATH   | Sample project   | Initial project to index      |
| WORKSPACE_ROOT | Parent directory | Workspace containing projects |
| PORT           | 3000             | HTTP server port              |
| MCP_API_KEY    | unset            | Protects REST API endpoints   |
| LOG_LEVEL      | info             | Logging level                 |

---

# 🧰 Developer Tool Inventory

## Workspace

* list_projects
* select_project
* get_current_project
* refresh_index

## Code Navigation

* get_project_files
* get_file_content
* get_full_codebase
* search_codebase
* get_architecture
* get_dependency_graph
* get_context

## Safe Editing

* write_file
* write_multiple_files
* patch_file
* replace_method
* insert_method
* insert_class
* rename_symbol
* delete_method

## Code Intelligence

* find_symbol
* find_class
* find_method
* find_interface
* find_references
* find_unused_files
* find_duplicate_code

## Git

* git_status
* git_diff
* git_log
* git_checkout
* create_branch
* commit_changes
* show_untracked_files

## Review

* review_file
* review_project
* find_code_smells
* review_architecture
* suggest_refactoring
* explain_build_error

## Memory

* add_conversation_turn
* get_conversation_history
* add_project_note
* get_project_memory

---

# 🧪 Testing

The project has been validated with:

✅ SDK Import Tests

✅ Streamable HTTP Transport

✅ JSON-RPC Request Handling

✅ MCP Tool Registration

✅ Tool Discovery (44 Tools)

✅ Integration Tests

✅ OpenAI Secure Tunnel

✅ Workspace Switching

✅ Codebase Indexing

---

# 🔄 Streamable HTTP Migration

DevForge-MCP has been migrated from the legacy Server-Sent Events (SSE) transport to the latest **Streamable HTTP** transport.

Migration Highlights

* Removed legacy SSE transport
* Stateless request handling
* JSON-RPC 2.0 compliance
* Modern MCP SDK compatibility
* OpenAI Secure Tunnel support
* Improved scalability

---

# 🌐 Deployment

DevForge-MCP supports deployment using:

* Docker
* Railway
* Render

Deployment configuration files included:

* Dockerfile
* railway.toml
* render.yaml

For deployment instructions, see:

```text
DEPLOYMENT.md
```

---

# 🔌 Connecting AI Assistants

## MCP Endpoint

```
https://your-domain.com/mcp
```

Compatible with:

* ChatGPT (Developer Mode)
* Claude Desktop
* MCP-compatible clients

Authentication:

```
No Authentication
```

unless configured otherwise.

---

# ⚠ Known Limitations

* Architecture detection is heuristic-based.
* Code review is pattern-based rather than compiler-backed.
* Duplicate code detection uses hash comparison instead of semantic analysis.
* Editing operations rely on syntax heuristics for different languages.

---

# 📈 Roadmap

* Vector Search
* Embedding Support
* RAG Integration
* Plugin System
* Authentication
* GitHub Actions CI/CD
* Performance Metrics
* Language Server Protocol Integration

---

# 🤝 Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Submit a Pull Request.

---

# 📄 License

This project is licensed under the **MIT License**.

---

# 👨‍💻 Author

**Sanket Shakya**

* GitHub: https://github.com/Sanket2329

---

# ⭐ Support

If you find DevForge-MCP useful, consider giving the repository a **⭐ Star** on GitHub.

It helps others discover the project and supports future development.
