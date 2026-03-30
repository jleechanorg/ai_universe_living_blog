# Blog MCP Server — Grafana Dashboard

## Quick Start

### 1. Import the dashboard

Via the Grafana UI: **Dashboards → New → Import** → upload `blog-mcp-dashboard.json`.

The dashboard includes a top-level `__inputs` declaration for the Prometheus datasource. Grafana will prompt you to select or create a Prometheus datasource during import and automatically substitute `${DS_PROMETHEUS}` throughout all panels.

### 2. Configure the Prometheus datasource

The dashboard uses Grafana's standard `__inputs` datasource variable pattern (`${DS_PROMETHEUS}`). After importing, Grafana will have already mapped the datasource — no additional variable configuration is needed.

### 3. Scrape target

Add this to your Prometheus `scrape_configs`:

```yaml
scrape_configs:
  - job_name: blog-mcp-server
    static_configs:
      - targets: ["localhost:8888"]
    metrics_path: /metrics
```

> **Note:** The default `PORT` is `8888`. If your server runs on a different port, update the target accordingly. See `docs/CONFIGURATION.md` for all environment variables.

---

## Panels

| # | Panel | Metric | Description |
|---|-------|--------|-------------|
| 1 | **Posts Created** | `rate(blog_posts_created_total[5m])` | Rate of posts created via the `create_post` MCP tool per second. Shows total counts summed in the legend. |
| 2 | **HTTP Request Rate (by method)** | `sum by (method) (rate(blog_requests_total[5m]))` | Rate of all MCP tool calls broken down by JSON-RPC method name (`create_post`, `list_posts`, etc.). Use this to see which tools are most active. |
| 3 | **Error Rate** | `sum(rate(blog_requests_total{status="error"}[5m])) / sum(rate(blog_requests_total[5m]))` | Fraction of MCP tool calls that returned an error response. Should be near 0 in healthy operation. |
| 4 | **Posts Deleted** | `rate(blog_posts_deleted_total[5m])` | Rate of posts deleted via the `delete_post` MCP tool. Spikes here may indicate intentional cleanup or automation. |
| 5 | **Requests by Status** | `sum by (status) (rate(blog_requests_total[5m]))` | Breakdown of tool call outcomes: `ok` (successful) vs `error` (threw an exception or returned an error response). |

---

## Available Metrics

The server exposes the following Prometheus metrics at `GET /metrics`:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `blog_posts_created_total` | Counter | — | Total `create_post` tool invocations |
| `blog_posts_deleted_total` | Counter | — | Total `delete_post` tool invocations |
| `blog_requests_total` | Counter | `method`, `status` | All MCP tool calls (`status`: `ok` or `error`) |

---

## Missing Metrics (Not Yet Instrumented)

The following were considered but are **not currently emitted** by the server:

| Desired Panel | Reason |
|---------------|--------|
| HTTP Request Latency (p99) | No latency histogram is collected. The server is single-threaded Node.js — adding `prom-client` with a `http_request_duration_seconds` histogram would be a natural follow-up (see `src/blog/server.ts`). |
| Active Workers / Sessions | No session gauge is maintained. The server is stateless per request; active connections are not tracked. |

---

## Alerts (Recommended)

Once the datasource is connected, consider adding these Grafana alert rules:

- **Error Rate > 5%** for 5 minutes → `blog_requests_total{status="error"}` > 0.05 × total requests
- **Zero request rate for > 30 min** → indicates the server may be unreachable or the scraper is down

---

## Local Development

```bash
# Start the blog MCP server (serves /metrics at localhost:8081/metrics)
npm run dev:blog

# In another terminal, verify metrics are being emitted
curl http://localhost:8081/metrics
```
