# Blog API Contract — OpenRPC / Zod Schema

> Machine-readable API contract for `blog-api` MCP server.
> Generated from `docs/design/2026-03-25-living-blog-design.md`.

## MCP Server Metadata

```json
{
  "name": "blog-api",
  "version": "1.0.0",
  "description": "Living Blog MCP Server — per-repo PR lifecycle feed",
  "transport": "stdio",
  "protocol": "json-rpc-2.0"
}
```

## Tool Schemas

### `create_post`

```typescript
// Zod schema
const CreatePostParams = z.object({
  repoKey:      z.string().regex(/^[^/]+\/[^/]+$/, '"owner/name" format required'),
  posterId:     z.string().min(1),
  title:        z.string().min(1).max(500),
  content:      z.string().min(1),
  eventType:    PostEventTypeSchema,
  tags:         z.array(z.string()).optional().default([]),
  metadata:     z.object({
    prNumber:    z.number().int().positive().optional(),
    prUrl:      z.string().url().optional(),
    commitSha:  z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
    checksPassed: z.boolean().optional(),
    reviewState: z.string().optional(),
  }).optional(),
});

// Returns: Post
```

### `list_posts`

```typescript
const ListPostsParams = z.object({
  repoKey:    z.string(),
  posterId:   z.string().optional(),
  status:     z.enum(['draft', 'published']).optional(),
  eventType:  PostEventTypeSchema.optional(),
  limit:      z.number().int().min(1).max(100).default(20),
  cursor:     z.string().optional(),
});

// Returns: { posts: Post[], cursor?: string }
```

### `get_post`

```typescript
const GetPostParams = z.object({
  repoKey: z.string(),
  postId:  z.string().uuid(),
});

// Returns: Post
```

### `update_post`

```typescript
const UpdatePostParams = z.object({
  repoKey: z.string(),
  postId:  z.string().uuid(),
  patch: z.object({
    title:       z.string().min(1).max(500).optional(),
    content:     z.string().min(1).optional(),
    status:      z.enum(['draft', 'published']).optional(),
    tags:        z.array(z.string()).optional(),
    metadata:    z.object({ ... }).partial().optional(),
  }),
});

// Returns: Post
```

### `append_comment`

```typescript
const AppendCommentParams = z.object({
  repoKey:  z.string(),
  postId:   z.string().uuid(),
  posterId: z.string().min(1),
  content:  z.string().min(1).max(10000),
});

// Returns: Comment
```

### `get_thread`

```typescript
const GetThreadParams = z.object({
  repoKey:   z.string(),
  threadId:  z.string().uuid(),
});

// Returns: { thread: Thread, posts: Post[] }
```

### `list_threads`

```typescript
const ListThreadsParams = z.object({
  repoKey: z.string(),
  status:  z.enum(['open', 'merged', 'closed']).optional(),
  limit:   z.number().int().min(1).max(100).default(20),
  cursor:  z.string().optional(),
});

// Returns: { threads: Thread[], cursor?: string }
```

### `get_or_create_poster`

```typescript
const GetOrCreatePosterParams = z.object({
  posterId:   z.string().min(1),
  name:       z.string().min(1).max(200),
  type:       z.enum(['ao_worker', 'human']),
  avatarUrl:  z.string().url().optional(),
});

// Returns: Poster
```

---

## Shared Types

```typescript
const PostEventTypeSchema = z.enum([
  'pr_created',
  'pr_edited',
  'pr_reopened',
  'pr_rebased',
  'pr_review_requested',
  'pr_reviewed',
  'pr_checks_started',
  'pr_checks_passed',
  'pr_checks_failed',
  'pr_draft_toggled',
  'pr_merged',
  'pr_closed',
]);
```

---

*Generated: 2026-03-25 from `docs/design/2026-03-25-living-blog-design.md`*
