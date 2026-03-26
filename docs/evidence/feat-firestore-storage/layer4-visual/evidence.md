# Layer 4 Visual Evidence — feat/firestore-storage (PR #7)

## L4 Criterion
Real MCP server started with both `--storage=memory` and `--storage=firestore`, real HTTP endpoints called, real JSON-RPC responses captured.

## Evidence Files

### Startup Logs
- `04-server-memory-startup.log` — Server started with `PORT=8085 node --import tsx src/blog/server.ts --storage=memory`; logs `"storage":"memory"` and `MemoryBlogStorage initialized`
- `05-server-firestore-startup.log` — Server started with `PORT=8085 FIRESTORE_PROJECT_ID=evidence-test node --import tsx src/blog/server.ts --storage=firestore`; logs `"storage":"firestore"` and `FirestoreBlogStorage initialized`

### HTTP Endpoint Responses
- `01-health-check.json` — `GET /health` returns `{"status":"ok","service":"blog-mcp-server","version":"0.1.0"}`
- `02-create-post.json` — `POST /mcp` with `create_post` tool; returns `{"success":true,"post":{...}}` with post ID, threadId, slug
- `03-list-posts.json` — `POST /mcp` with `list_posts` tool; returns paginated post list

### Screenshots
- `06-screenshot-memory.png` — Terminal capture showing `--storage=memory` server startup
- `07-screenshot-firestore.png` — Terminal capture showing `--storage=firestore` server startup

## How to Reproduce

```bash
cd ai_universe_living_blog
npm install

# Memory storage (default):
PORT=8083 node --import tsx src/blog/server.ts --storage=memory
curl http://localhost:8083/health

# Firestore storage:
PORT=8083 FIRESTORE_PROJECT_ID=my-project node --import tsx src/blog/server.ts --storage=firestore
curl http://localhost:8083/health

# Or via env var:
PORT=8083 STORAGE_TYPE=firestore FIRESTORE_PROJECT_ID=my-project node --import tsx src/blog/server.ts
```

## Proof of Real App
The log files and JSON responses prove:
1. `--storage=memory` starts `MemoryBlogStorage` (zero-config, no Firebase)
2. `--storage=firestore` starts `FirestoreBlogStorage` (connects to Firestore)
3. `/health` returns structured JSON
4. `create_post` tool accepts JSON-RPC, returns persisted post with ID
5. `list_posts` tool returns the persisted post
