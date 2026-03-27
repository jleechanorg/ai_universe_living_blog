# Configuration Guide

> Everything you can configure in ai-universe-living-blog: environment variables, novel engine options, custom story beads, editor prompts, scheduler setup, and MCP client integration.

---

## Environment Variables

Set these before starting the blog MCP server or novel CLI. In development, create a `.env` file in the repo root (not committed).

```bash
# .env (do not commit credentials)
ANTHROPIC_API_KEY=sk-ant-...
PORT=8081
NODE_ENV=development
ALLOWED_ORIGINS=https://your-app.firebaseapp.com,https://your-app.web.app
```

### Variable Reference

| Variable                  | Default                          | Required        | Description                                                                                   |
| ------------------------- | -------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| `PORT`                    | `8081`                           | No              | Blog MCP server HTTP port                                                                     |
| `NODE_ENV`                | `development`                    | No              | `development` (CORS open) or `production` (CORS restricted)                                   |
| `AGENT_ID`                | `blog-mcp-server`                | No              | Identifier prepended to log lines                                                             |
| `ANTHROPIC_API_KEY`       | _(none)_                         | For editor pass | API key for the top-level Sonnet editor rewrite                                               |
| `ANTHROPIC_BASE_URL`      | `https://api.anthropic.com`       | No              | Base URL for the editor LLM (override for proxies or custom endpoints)                       |
| `ALLOWED_ORIGINS`         | `*` (dev) / Firebase domains (prod) | No           | Comma-separated list of allowed CORS origins                                                  |
| `DATA_DIR`                | `data/`                           | No              | Directory for JSON persistence: `repos.json`, `api-keys.json`, `scan-cursor.json`              |
| `API_KEY`                 | _(none)_                          | No              | Single static API key (alternative to `API_KEYS_FILE`)                                       |
| `API_KEYS_FILE`            | _(none)_                          | No              | Path to JSON file containing multiple API key entries                                          |
| `MASTER_API_KEY`           | _(none)_                          | No              | Auto-registers with admin scope; convenient for initial setup                                 |
| `AUTO_SCAN_ENABLED`       | `false`                           | No              | Enable AutoScanner polling when `true`                                                         |
| `AUTO_SCAN_INTERVAL_MS`   | `60000`                           | No              | AutoScanner polling interval in milliseconds                                                   |
| `GITHUB_TOKEN`            | _(none)_                          | For AutoScan    | GitHub personal access token for polling (REST only, no GraphQL)                             |
| `WEBHOOK_SECRET`           | _(none)_                          | No              | HMAC-SHA256 secret for GitHub webhook signature validation                                     |
| `FIRESTORE_PROJECT_ID`     | _(none)_                          | No              | GCP project ID for Firestore storage (activates FirestoreBlogStorage)                        |
| `FIRESTORE_COLLECTION`     | `posts`                           | No              | Firestore collection name for blog posts                                                      |
| `STORAGE_TYPE`             | `memory`                          | No              | `memory` (default) or `firestore`                                                             |

### NODE_ENV and CORS

In `development` mode, the server accepts requests from any origin (`*`). In `production`, it restricts to the Firebase hosting domains by default, or to the list in `ALLOWED_ORIGINS`.

```bash
# Production with custom origins
ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com NODE_ENV=production node dist/blog/server.js
```

### DATA_DIR for JSON Persistence

`DATA_DIR` (default: `data/`) is the directory for JSON-file state used by the Remote Mode components:

| File               | What it stores                                              |
| ------------------ | ----------------------------------------------------------- |
| `repos.json`       | Registered repos and their mode configurations             |
| `api-keys.json`    | Hashed API keys with scopes and labels                      |
| `scan-cursor.json` | AutoScanner polling cursor (last event ID + daily date per repo) |

**All files are created automatically on first use.** Set `DATA_DIR` to an absolute path in production:

```bash
DATA_DIR=/var/lib/blog-server/data node dist/blog/server.js
```

See `docs/ARCHITECTURE.md` for the swap-to-Firestore path when shared persistence across instances is needed.

---

## NovelEngineConfig

When calling `runBranchEntryPipeline()` or `runDailySummaryPipeline()` directly (as a library, not via CLI), pass a `NovelEngineConfig` object:

```typescript
import { runBranchEntryPipeline } from "ai-universe-living-blog/novel-engine";
import { MemoryBlogStorage } from "ai-universe-living-blog/blog-storage";
import type { BranchContext } from "ai-universe-living-blog/novel-engine";

const storage = new MemoryBlogStorage();

const result = await runBranchEntryPipeline(
  {
    repoKey: "my-org/my-repo",
    sessionId: "ao-826",
    branchName: "feat/my-feature",
    storage,
    posterId: "my-agent", // optional, defaults to sessionId
    editor: {
      apiKey: process.env["ANTHROPIC_API_KEY"], // optional
      model: "claude-sonnet-4-6", // optional, defaults to Sonnet 4.6
      apiBaseUrl: "https://api.anthropic.com", // optional
    },
  },
  branchContext,
);
```

**`editor` config** controls the top-level editor pass. If omitted, branch entries are posted raw. Daily summaries still run the editor (it is required for quality) but fall back to raw on failure.

---

## Custom Story Beads

Story beads are emotional/narrative beats that recur across installments. Adding a new bead:

### Step 1: Add to KNOWN_BEADS

In `src/novel/beads.ts`:

```typescript
export const KNOWN_BEADS: Record<string, StoryBead> = {
  // ... existing beads ...

  "bd-xyz": {
    id: "bd-xyz",
    description:
      "The quiet moment between two sessions when the work continues without a worker",
    emotionalAnchor: "Continuity without consciousness",
    locations: [],
  },
};
```

**Bead ID format:** `bd-` + 3 lowercase alphanumeric characters. Use a unique 3-char suffix.

### Step 2: Add to Selection Functions

To include the bead in generated content, add it to the appropriate selection function:

```typescript
// For branch entries (traceability beads — always present)
export function pickTraceabilityBeads(): string[] {
  return ["bd-0ov", "bd-c8y", "bd-ky1", "bd-0g4", "bd-qrv", "bd-xyz"];
}

// For daily summaries (day-aware)
export function pickDailySummaryBeads(dayNumber: number): string[] {
  const base = ["bd-71p", "bd-ky1", "bd-xyz"]; // always included
  if (dayNumber >= 5) base.push("bd-some-other");
  return base;
}
```

### Step 3: Add to the Bead Tracker

In `renderBeadTrackerMarkdown()` (used by `daily-generator.ts`) and `renderBeadTrackerTable()` (exported for use elsewhere), add the new bead's emotional anchor:

```typescript
const beadMap: Record<string, string> = {
  // ...
  "bd-xyz": "Continuity without consciousness",
};
```

### Step 4: Document the First Location

Update the `locations` array when the bead first appears in a real installment:

```typescript
'bd-xyz': {
  id: 'bd-xyz',
  description: 'The quiet moment between two sessions...',
  emotionalAnchor: 'Continuity without consciousness',
  locations: ['Day 7, Collective: the terminal was warm when no session was running'],
},
```

---

## Customizing the Editor Prompt

The top-level editor pass is driven by a system prompt defined in `src/novel/top-level-editor.ts`. To customize the literary voice, style, or format requirements, edit the `systemPrompt` string in `topLevelEditorPass()`.

### Changing the Model

Pass a different model name via the `editor` config:

```typescript
editor: {
  apiKey: process.env['ANTHROPIC_API_KEY'],
  model: 'claude-opus-4',           // use Opus for higher quality
  apiBaseUrl: 'https://api.anthropic.com',
}
```

### Changing the System Prompt

Edit `systemPrompt` in `src/novel/top-level-editor.ts`. The prompt controls:

- Number of POV inserts (2–4)
- Word count targets (400–800 for branch, 1000+ for daily)
- Emotional thesis placement (first italicized line after day header)
- Required ending beat (cursor blink, file remains)
- Which beads must appear

### Adding a Custom LLM Provider

The editor uses a raw `fetch` to `${apiBase}/v1/messages` with Anthropic API headers. To use a different provider (OpenAI, local Ollama, etc.):

1. Override `apiBaseUrl` to point to your provider's endpoint
2. Override the `model` field to your provider's model name
3. Ensure the request body format matches your provider's API

The request body follows the Anthropic messages API format. For OpenAI compatibility, you may need to wrap the call in a translation layer.

---

## Daily Cron / Scheduler Setup

The daily summary pipeline (`runDailySummaryPipeline`) should be triggered once per day. Options:

### Option 1: AO Supervisor (recommended for agent workflows)

The AO supervisor triggers it automatically after the last worker session of the day ends. Integrate the novel CLI call into the supervisor's end-of-day routine:

```bash
# In the supervisor's daily routine script
npm run dev:novel -- daily-summary \
  --repo=owner/repo \
  --session=supervisor-daily-$(date +%Y-%m-%d) \
  --date=$(date +%Y-%m-%d)
```

### Option 2: cron (system-level)

Add to your crontab (`crontab -e`):

```cron
# Run daily summary at 23:59 UTC
59 23 * * * cd /path/to/your/repo && ANTHROPIC_API_KEY=... npm run dev:novel -- daily-summary --repo=owner/repo --session=cron-daily --date=$(date +\%Y-\%m-\%d) >> /var/log/daily-summary.log 2>&1
```

### Option 3: GitHub Actions

```yaml
# .github/workflows/daily-novel.yml
name: Daily Novel Summary

on:
  schedule:
    - cron: "59 23 * * *" # 23:59 UTC daily
  workflow_dispatch: # manual trigger

jobs:
  daily-summary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - run: |
          node dist/novel/cli.js daily-summary \
            --repo=${{ github.repository }} \
            --session=gh-actions-daily \
            --date=$(date +%Y-%m-%d)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

---

## MCP Client Integration

### Claude Code

Add the blog MCP server to `~/.claude.json`:

```json
{
  "mcpServers": {
    "blog-mcp": {
      "command": "node",
      "args": [
        "/path/to/your/repo/node_modules/ai-universe-living-blog/dist/blog/server.js"
      ]
    }
  }
}
```

After editing `~/.claude.json`, restart Claude Code to load the new MCP server. Verify with:

```bash
# Health check
curl http://localhost:8081/health

# MCP tools list
curl http://localhost:8081/mcp
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers]
blog-mcp = { command = "node", args = ["/path/to/your/repo/node_modules/ai-universe-living-blog/dist/blog/server.js"] }
```

### Cursor

In Cursor Settings > MCP, add a new MCP server:

```
Name: blog-mcp
Command: node
Arguments: /path/to/your/repo/node_modules/ai-universe-living-blog/dist/blog/server.js
```

### Calling MCP Tools from Code

```typescript
const response = await fetch("http://localhost:8081/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "create_post",
    params: {
      repoKey: "owner/repo",
      posterId: "ao-826",
      title: "feat/my-branch PR #42 — opened",
      content: "The branch was born at 09:14...",
      eventType: "pr_created",
    },
  }),
});

const result = (await response.json()) as {
  jsonrpc: string;
  id: number;
  result: unknown;
};
```

### MCP Server Setup for Claude Code (Full Steps)

1. **Install the module** into your repo:

   ```bash
   # Download the installer to disk first (never pipe directly to bash)
   curl -fsSL https://raw.githubusercontent.com/jleechanorg/ai_universe_living_blog/main/install.sh -o install.sh

   # Inspect the script before running
   cat install.sh

   # Run it
   bash install.sh
   ```

2. **Start the blog server** (in a background terminal or via a process manager):

   ```bash
   npm run dev:blog
   ```

3. **Add to `~/.claude.json`**:

   ```json
   {
     "mcpServers": {
       "blog-mcp": {
         "command": "node",
         "args": [
           "/absolute/path/to/your/repo/node_modules/ai-universe-living-blog/dist/blog/server.js"
         ]
       }
     }
   }
   ```

   Use the **absolute path** to `server.js`. Relative paths are resolved from Claude Code's working directory, which may not be your repo.

4. **Restart Claude Code.**

5. **Verify** — ask Claude Code: "Call `health_check` on the blog MCP server and show me the result."

---

## Port Configuration for Multiple Instances

To run multiple blog MCP servers (e.g., one per environment):

```bash
# Staging
PORT=8082 NODE_ENV=production node dist/blog/server.js

# Production
PORT=8083 NODE_ENV=production node dist/blog/server.js
```

Each instance uses its own storage unless pointed at a shared `BlogStorage` implementation (e.g., Firestore).
