# Deployment & Connecting to ChatGPT

The MCP endpoint is always `https://<your-host>/mcp` — that contract stays the
same no matter which option below you use.

## Option A — Local + ngrok (recommended for this use case)

This is the right choice for a tool that reads/builds/git's a folder on **your**
machine — `dotnet`, `npm`, `git`, etc. all need to already be installed where
the server runs, and that's trivially true on your own laptop.

```bash
npm install
PROJECT_PATH="C:/Users/you/Desktop/YourProject" node server.js
ngrok http 3000
```
Copy the `https://xxxx.ngrok-free.app` URL ngrok prints.

## Option B — Cloudflare Tunnel (ngrok alternative, also local)

```bash
node server.js
cloudflared tunnel --url http://localhost:3000
```
Same idea as ngrok — a public HTTPS URL pointing at your local process.

## Option C — Render / Railway (always-on, hosted)

Use `render.yaml` or `railway.toml`. Caveat: `trigger_build` and `git_*` tools
need the matching toolchain present in that environment — the default Node
image only has `git`. Push your actual project source as part of the deploy
(or point `PROJECT_PATH` at a path within the container) and install whatever
SDKs your build needs (see the comments in `Dockerfile`).

## Option D — OpenAI Secure Tunnel

The OpenAI Secure Tunnel exposes your local `/mcp` endpoint to ChatGPT without a public URL.

1. Install the tunnel client:
   ```bash
   npm install -g @openai/mcp-remote
   ```
2. Start the tunnel:
   ```bash
   tunnel-client run --server https://<your-host>/mcp
   ```
   Or for local-only use:
   ```bash
   tunnel-client run --local-server http://localhost:3000/mcp
   ```
3. Verify all four health checks pass:
   ```bash
   tunnel-client doctor --server https://<your-host>/mcp
   ```
   Expected: connectivity ✅, POST /mcp reachability ✅, streaming ✅, tool listing ✅ (44 tools)

## Connecting in ChatGPT

As of mid-2026, ChatGPT calls this **Developer Mode** (Settings → Apps/Connectors
→ Advanced → enable **Developer mode**). Available on Plus/Pro/Business/Enterprise/Edu.

1. ChatGPT → **Settings → Connectors/Apps → Advanced → Developer mode** → on.
2. **Create connector** → paste `https://<your-ngrok-or-host>/mcp`.
3. Authentication: choose **No Authentication**.
   ChatGPT's connector UI only supports OAuth or "No Authentication" — it
   cannot send a custom header or API key to the MCP endpoint itself. That's
   why `MCP_API_KEY` in this server only guards the dashboard REST API
   (`/api/*`), not `/mcp`. Treat your ngrok URL as semi-private.
4. Confirm you trust the server → **Create**.
5. In a chat: open the tools/connector picker, enable this connector, and ask
   something like *"list my projects"* or *"review the architecture of the
   active project"* — ChatGPT will call `list_projects` / `review_architecture`.
6. Write actions (`write_file`, `patch_file`, `git_checkout`, `commit_changes`,
   etc.) will prompt you for confirmation before running — that's ChatGPT's
   own safety behavior, not something this server controls.
7. If you change the tool list later (e.g. after pulling this update), go back
   to **Settings → Connectors**, open this connector, and hit **Refresh**.

### Quick sanity check before connecting

```bash
curl https://<your-host>/status
```
Should return JSON with `"status": "Ready"` and your detected architecture.
