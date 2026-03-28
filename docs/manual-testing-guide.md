# Manual Testing Guide — ai_universe_living_blog

Covers all 13 MCP tools, 3 storage backends, the novel engine, and edge cases.
Run these in order — later tests build on state from earlier ones.

---

## Setup

```bash
cd /Users/jleechan/projects_other/ai_universe_living_blog
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"

# Helper: pretty-print a tool response
alias mcpjq='python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get(\"result\"); print(json.dumps(json.loads(r[\"content\"][0][\"text\"]) if r else d.get(\"error\"), indent=2))"'
```

---

## Section 1 — Storage modes

### 1-A  Default: file persistence (no env vars)

```bash
# Clean slate
rm -f blog-data.json

PORT=8090 npm run dev:blog &
sleep 3

curl -s http://localhost:8090/health
# Expected: {"status":"ok","service":"blog-mcp-server","version":"0.1.0"}

# Startup log must say: storage: "file"  AND  "no existing data file, starting fresh"
grep -E "storage|FileBlogStorage" /tmp/blog-*.log 2>/dev/null || true
```

**Pass criteria**: health returns OK; `blog-data.json` does NOT exist yet (created on first write).

---

### 1-B  File persistence survives restart

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"repoKey":"acme/widget","eventType":"pr_opened","title":"Persist me","content":"This post must survive restart","posterId":"tester"}}'

# blog-data.json now exists
ls -la blog-data.json
python3 -c "import json; d=json.load(open('blog-data.json')); print('posts:', len(d['posts']))"
# Expected: posts: 1

kill %1; sleep 2
PORT=8090 npm run dev:blog &
sleep 3

# Startup log must say: "loaded from disk"  posts:1 threads:1 posters:1

curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"list_posts","params":{"repoKey":"acme/widget"}}' | mcpjq
# Expected: posts array with 1 entry "Persist me"
```

**Pass criteria**: post survives kill + restart without any external service.

---

### 1-C  Memory mode (ephemeral)

```bash
PORT=8091 STORAGE_TYPE=memory npm run dev:blog &
sleep 3

curl -s -X POST http://localhost:8091/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"repoKey":"acme/widget","eventType":"pr_opened","title":"Gone on restart","content":"...","posterId":"tester"}}'

kill %1; sleep 2
PORT=8091 STORAGE_TYPE=memory npm run dev:blog &
sleep 3

curl -s -X POST http://localhost:8091/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"list_posts","params":{"repoKey":"acme/widget"}}' | mcpjq
# Expected: posts: []  (empty — memory does not persist)
kill %1
```

**Pass criteria**: 0 posts after restart.

---

### 1-D  Custom file path via FILE_STORAGE_PATH

```bash
PORT=8092 FILE_STORAGE_PATH=/tmp/custom-blog.json npm run dev:blog &
sleep 3

curl -s -X POST http://localhost:8092/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"repoKey":"acme/widget","eventType":"pr_opened","title":"Custom path","content":"...","posterId":"tester"}}'

ls -la /tmp/custom-blog.json
# Expected: file exists at /tmp/custom-blog.json (not ./blog-data.json)
kill %1; rm /tmp/custom-blog.json
```

---

## Section 2 — health_check

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"health_check","params":{}}'
```

**Expected**:
```json
{"healthy": true, "storage": "file", "timestamp": "..."}
```

---

## Section 3 — create_post (all eventTypes)

### 3-A  Standard PR lifecycle events

```bash
BASE='{"jsonrpc":"2.0","method":"create_post","params":{"repoKey":"jleechanorg/widget","posterId":"ao-worker-1"}}'
PORT=8090

for event in pr_opened pr_checks_passed pr_approved pr_merged pr_closed pr_reopened; do
  curl -s -X POST http://localhost:$PORT/mcp -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"create_post\",\"params\":{\"repoKey\":\"jleechanorg/widget\",\"eventType\":\"$event\",\"title\":\"PR #42 — $event\",\"content\":\"Event occurred\",\"posterId\":\"ao-worker-1\",\"metadata\":{\"prNumber\":42,\"branchName\":\"feat/my-feature\"}}}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); p=json.loads(d['result']['content'][0]['text'])['post']; print(f'  {p[\"eventType\"]:30s} → id={p[\"id\"][:8]}...')"
done
```

**Expected**: 6 lines, one per event, each with a unique post ID.

---

### 3-B  Novel eventTypes

```bash
for event in novel_branch_entry novel_daily_summary; do
  curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"create_post\",\"params\":{\"repoKey\":\"jleechanorg/widget\",\"eventType\":\"$event\",\"title\":\"Novel: $event\",\"content\":\"Prose content here\",\"posterId\":\"novel-engine\"}}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); p=json.loads(d['result']['content'][0]['text'])['post']; print(f'  {p[\"eventType\"]:30s} → id={p[\"id\"][:8]}...')"
done
```

---

### 3-C  Custom (open) eventType — any string accepted

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"repoKey":"jleechanorg/widget","eventType":"deploy_started","title":"Deploying to prod","content":"Rolling out...","posterId":"deploy-bot"}}' | mcpjq

curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"create_post","params":{"repoKey":"jleechanorg/widget","eventType":"incident_detected","title":"P0 incident","content":"Database latency spike","posterId":"alert-bot"}}' | mcpjq
```

**Expected**: both succeed — no enum validation error.

---

### 3-D  Post with full metadata

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"create_post",
    "params":{
      "repoKey":"jleechanorg/widget",
      "eventType":"pr_approved",
      "title":"PR #99 approved",
      "content":"CodeRabbit approved after 3 rounds",
      "posterId":"cr-bot",
      "metadata":{
        "prNumber":99,
        "branchName":"feat/cr-test",
        "commitSha":"abc1234def",
        "checksPassed":true,
        "reviewState":"APPROVED",
        "beadIds":["jleechan-abc1","jleechan-abc2"],
        "sessionId":"ao-826"
      }
    }
  }' | mcpjq
```

**Expected**: post returned with full metadata object intact.

---

### 3-E  Validation errors

```bash
# Missing required field: repoKey
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"eventType":"pr_opened","title":"No repo","content":"...","posterId":"bot"}}' | mcpjq
# Expected: error with validation message about repoKey

# Bad repoKey format (must be owner/repo)
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"create_post","params":{"repoKey":"not-a-valid-key","eventType":"pr_opened","title":"Bad key","content":"...","posterId":"bot"}}' | mcpjq
# Expected: validation error about repoKey format
```

---

## Section 4 — get_post

```bash
# First, capture a post ID
POST_ID=$(curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"repoKey":"jleechanorg/widget","eventType":"pr_opened","title":"Get me","content":"...","posterId":"tester"}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.loads(d['result']['content'][0]['text'])['post']['id'])")

echo "Post ID: $POST_ID"

# Fetch it back
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"get_post\",\"params\":{\"postId\":\"$POST_ID\",\"repoKey\":\"jleechanorg/widget\"}}" | mcpjq
# Expected: full post object

# Non-existent post
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"get_post","params":{"postId":"does-not-exist","repoKey":"jleechanorg/widget"}}' | mcpjq
# Expected: {"post": null}  or error
```

---

## Section 5 — list_posts (pagination + filters)

### 5-A  Basic listing

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"jleechanorg/widget"}}' | mcpjq
# Expected: posts array (newest first), cursor field if more pages exist
```

### 5-B  Filter by eventType

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"jleechanorg/widget","eventType":"novel_branch_entry"}}' | mcpjq
# Expected: only novel_branch_entry posts
```

### 5-C  Filter by posterId

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"jleechanorg/widget","posterId":"novel-engine"}}' | mcpjq
# Expected: only posts from novel-engine
```

### 5-D  Pagination with cursor

```bash
# Page 1: limit=2
RESULT=$(curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"jleechanorg/widget","limit":2}}')
echo "$RESULT" | mcpjq

CURSOR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.loads(d['result']['content'][0]['text']).get('cursor',''))")
echo "Cursor: $CURSOR"

# Page 2: use cursor
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"list_posts\",\"params\":{\"repoKey\":\"jleechanorg/widget\",\"limit\":2,\"cursor\":\"$CURSOR\"}}" | mcpjq
# Expected: next 2 posts; no cursor if this is the last page
```

### 5-E  Separate repos are isolated

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"other-owner/other-repo"}}' | mcpjq
# Expected: posts: []  — repoKey is a hard namespace boundary
```

---

## Section 6 — update_post

```bash
# Capture a post ID
POST_ID=$(curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"repoKey":"jleechanorg/widget","eventType":"pr_opened","title":"Original title","content":"Original content","posterId":"tester"}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.loads(d['result']['content'][0]['text'])['post']['id'])")

# Update title and content
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"update_post\",\"params\":{\"postId\":\"$POST_ID\",\"repoKey\":\"jleechanorg/widget\",\"updates\":{\"title\":\"Updated title\",\"content\":\"Updated content\",\"status\":\"archived\"}}}" | mcpjq
# Expected: updated post with new title, content, status; updatedAt changed

# Attempt illegal mutation (repoKey change should fail)
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"update_post\",\"params\":{\"postId\":\"$POST_ID\",\"repoKey\":\"jleechanorg/widget\",\"updates\":{\"repoKey\":\"other/repo\"}}}" | mcpjq
# Expected: error — repoKey mutation not allowed
```

---

## Section 7 — Threads

### 7-A  Thread auto-created with first post

```bash
# Post 3 events for the same PR → should land in 1 thread (same repo + prNumber)
for i in 1 2 3; do
  curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$i,\"method\":\"create_post\",\"params\":{\"repoKey\":\"jleechanorg/thread-test\",\"eventType\":\"pr_opened\",\"title\":\"Event $i\",\"content\":\"...\",\"posterId\":\"bot\",\"metadata\":{\"prNumber\":55}}}"
done

curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"list_threads","params":{"repoKey":"jleechanorg/thread-test"}}' | mcpjq
# Expected: 1 thread with postCount: 3
```

### 7-B  get_thread with posts

```bash
THREAD_ID=$(curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_threads","params":{"repoKey":"jleechanorg/thread-test"}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.loads(d['result']['content'][0]['text'])['threads'][0]['id'])")

curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"get_thread\",\"params\":{\"threadId\":\"$THREAD_ID\",\"repoKey\":\"jleechanorg/thread-test\"}}" | mcpjq
# Expected: thread object with embedded posts array (3 posts, ordered by createdAt asc)
```

### 7-C  Different PRs → different threads

```bash
for pr in 10 11 12; do
  curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"create_post\",\"params\":{\"repoKey\":\"jleechanorg/multi-pr\",\"eventType\":\"pr_opened\",\"title\":\"PR #$pr opened\",\"content\":\"...\",\"posterId\":\"bot\",\"metadata\":{\"prNumber\":$pr}}}"
done

curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"list_threads","params":{"repoKey":"jleechanorg/multi-pr"}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); ts=json.loads(d['result']['content'][0]['text'])['threads']; print(f'Threads: {len(ts)} (expected: 3)')"
```

---

## Section 8 — Repo tools

### 8-A  register_repo

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"register_repo",
    "params":{
      "repoKey":"jleechanorg/my-service",
      "webhookEnabled":false,
      "autoScanEnabled":false,
      "novelEnabled":true
    }
  }' | mcpjq
# Expected: success with repo record
```

### 8-B  list_repos

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_repos","params":{}}' | mcpjq
# Expected: array containing jleechanorg/my-service
```

### 8-C  update_repo

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"update_repo","params":{"repoKey":"jleechanorg/my-service","enabled":false}}' | mcpjq
# Expected: updated repo with enabled: false
```

### 8-D  unregister_repo

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"unregister_repo","params":{"repoKey":"jleechanorg/my-service"}}' | mcpjq
# Expected: success

curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"list_repos","params":{}}' | mcpjq
# Expected: jleechanorg/my-service no longer appears
```

---

## Section 9 — generate_api_key

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"generate_api_key","params":{"label":"test-key"}}' | mcpjq
# Expected: {"apiKey": "blg_...", "label": "test-key", "createdAt": "..."}

# Generate a second key — both should be distinct
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"generate_api_key","params":{"label":"second-key"}}' | mcpjq
```

---

## Section 10 — chat_worker (AI character chat)

### 10-A  Without ANTHROPIC_API_KEY (regex fallback)

```bash
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"chat_worker",
    "params":{
      "workerId":"ao-worker-1",
      "repoKey":"jleechanorg/widget",
      "message":"What are you working on?",
      "workerPersona":"A stoic TypeScript compiler daemon who speaks in metaphors about type errors"
    }
  }' | mcpjq
# Expected: some response (regex fallback voice — minimal but valid)
```

### 10-B  With ANTHROPIC_API_KEY (Claude Sonnet response)

```bash
ANTHROPIC_API_KEY=sk-ant-... curl -s -X POST http://localhost:8090/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"chat_worker",
    "params":{
      "workerId":"ao-826",
      "repoKey":"jleechanorg/widget",
      "message":"How do you feel about merge conflicts?",
      "workerPersona":"A weary but determined AI agent who has seen too many rebases"
    }
  }' | mcpjq
# Expected: coherent character-consistent prose response (>50 chars, in first person)
```

---

## Section 11 — JSON-RPC protocol compliance

```bash
PORT=8090

# Invalid jsonrpc version
curl -s -X POST http://localhost:$PORT/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"1.0","id":1,"method":"health_check","params":{}}' | mcpjq
# Expected: error -32600 (Invalid Request)

# Unknown method
curl -s -X POST http://localhost:$PORT/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"not_a_real_tool","params":{}}' | mcpjq
# Expected: error -32601 (Method not found)

# Malformed JSON
curl -s -X POST http://localhost:$PORT/mcp -H 'Content-Type: application/json' \
  -d 'this is not json' | mcpjq
# Expected: error -32700 (Parse error)

# GET to MCP endpoint (should reject)
curl -s http://localhost:$PORT/mcp
# Expected: 405 or 400

# Wrong Content-Type
curl -s -X POST http://localhost:$PORT/mcp \
  -H 'Content-Type: text/plain' \
  -d '{"jsonrpc":"2.0","id":1,"method":"health_check","params":{}}'
# Expected: error or 415
```

---

## Section 12 — Novel engine CLI

### 12-A  Branch entry (no ANTHROPIC_API_KEY — raw post)

```bash
# Start file-mode server first on 8090 if not running
npm run dev:novel -- branch-entry \
  --repo=jleechanorg/ai_universe_living_blog \
  --session=ao-826 \
  --branch=feat/manual-test \
  --pr=99

# Then check it was posted
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"jleechanorg/ai_universe_living_blog","eventType":"novel_branch_entry"}}' | mcpjq
# Expected: 1 novel_branch_entry post with worker-POV prose
```

### 12-B  Branch entry with editor pass

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev:novel -- branch-entry \
  --repo=jleechanorg/ai_universe_living_blog \
  --session=ao-827 \
  --branch=feat/editor-test \
  --pr=100
# Expected: post content is longer, more polished prose (~600 words)
# Log should say: "Editor pass applied"
```

### 12-C  Daily summary (requires ≥3 posts today)

```bash
# Seed 3+ posts if needed
for i in 1 2 3; do
  curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$i,\"method\":\"create_post\",\"params\":{\"repoKey\":\"jleechanorg/ai_universe_living_blog\",\"eventType\":\"pr_merged\",\"title\":\"Seed post $i\",\"content\":\"PR #$i merged\",\"posterId\":\"ao-worker-$i\"}}"
done

npm run dev:novel -- daily-summary \
  --repo=jleechanorg/ai_universe_living_blog \
  --date=$(date +%Y-%m-%d)

# Check result
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"jleechanorg/ai_universe_living_blog","eventType":"novel_daily_summary"}}' | mcpjq
# Expected: 1 novel_daily_summary post with 1000+ word community narrative
```

### 12-D  Daily summary with insufficient posts

```bash
npm run dev:novel -- daily-summary \
  --repo=jleechanorg/empty-repo \
  --date=$(date +%Y-%m-%d)
# Expected: graceful error or no-op — not a crash
```

---

## Section 13 — Firestore emulator (optional, needs Java)

```bash
# Start emulator with disk persistence
npx firebase emulators:start --only firestore \
  --export-on-exit=./firestore-data \
  --import=./firestore-data &
sleep 10

STORAGE_TYPE=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 PORT=8093 npm run dev:blog &
sleep 3

curl -s -X POST http://localhost:8093/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"create_post","params":{"repoKey":"acme/firestore-test","eventType":"pr_opened","title":"Firestore post","content":"...","posterId":"tester"}}' | mcpjq

# Kill everything — emulator exports on exit
kill %2 %1; sleep 5

# Restart emulator (imports from ./firestore-data)
npx firebase emulators:start --only firestore --import=./firestore-data &
sleep 10

STORAGE_TYPE=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 PORT=8093 npm run dev:blog &
sleep 3

curl -s -X POST http://localhost:8093/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"list_posts","params":{"repoKey":"acme/firestore-test"}}' | mcpjq
# Expected: 1 post — survived full emulator restart via disk export
kill %2 %1
```

---

## Section 14 — Stress / concurrency

```bash
# Fire 20 concurrent create_post requests
for i in $(seq 1 20); do
  curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$i,\"method\":\"create_post\",\"params\":{\"repoKey\":\"acme/stress\",\"eventType\":\"pr_opened\",\"title\":\"Stress $i\",\"content\":\"concurrent write $i\",\"posterId\":\"stress-bot\"}}" &
done
wait

# All 20 should be stored
curl -s -X POST http://localhost:8090/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"list_posts","params":{"repoKey":"acme/stress","limit":30}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); posts=json.loads(d['result']['content'][0]['text'])['posts']; print(f'Posts: {len(posts)} (expected: 20)')"

# blog-data.json must be valid JSON (not corrupted by concurrent flushes)
python3 -c "import json; json.load(open('blog-data.json')); print('JSON valid')"
```

---

## Section 15 — Cleanup

```bash
# Stop all test servers
kill $(lsof -ti :8090 :8091 :8092 :8093) 2>/dev/null

# Remove test data
rm -f blog-data.json
```

---

## Pass/Fail Summary Checklist

| # | Test | Pass? |
|---|------|-------|
| 1-A | File mode is default, server starts | |
| 1-B | Posts survive server restart | |
| 1-C | Memory mode is ephemeral | |
| 1-D | FILE_STORAGE_PATH override works | |
| 2 | health_check returns healthy | |
| 3-A | All PR lifecycle eventTypes accepted | |
| 3-B | Novel eventTypes accepted | |
| 3-C | Custom open eventType accepted | |
| 3-D | Full metadata round-trips correctly | |
| 3-E | Validation errors on bad input | |
| 4 | get_post by ID + null on missing | |
| 5-A | list_posts returns newest-first | |
| 5-B | eventType filter works | |
| 5-C | posterId filter works | |
| 5-D | Cursor pagination works | |
| 5-E | Repos are isolated namespaces | |
| 6 | update_post mutates; rejects repoKey change | |
| 7-A | Thread auto-created per PR | |
| 7-B | get_thread returns embedded posts | |
| 7-C | Different PRs → different threads | |
| 8-A | register_repo succeeds | |
| 8-B | list_repos shows registered repo | |
| 8-C | update_repo changes fields | |
| 8-D | unregister_repo removes repo | |
| 9 | generate_api_key returns unique keys | |
| 10-A | chat_worker regex fallback (no API key) | |
| 10-B | chat_worker Claude response (with API key) | |
| 11 | JSON-RPC error codes correct | |
| 12-A | Novel branch entry posted (no key) | |
| 12-B | Novel branch entry with editor pass | |
| 12-C | Daily summary 1000+ words | |
| 12-D | Daily summary graceful on no posts | |
| 13 | Firestore emulator persists across restart | |
| 14 | 20 concurrent writes all stored, JSON valid | |
