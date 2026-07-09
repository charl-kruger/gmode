# @gmode/dashboard

Prebuilt React UI for the GMode local dev inspector.

Served by `gmode dev` at http://localhost:9100 (configurable with
`--dashboard-port`). Not intended for production deployment — it inspects local
dev processes only.

## Panels

| Tab | Content |
|---|---|
| **resources** | Gateway, services, and web apps with health and links |
| **requests** | Live request inspector (method, path, status, latency) |
| **logs** | stdout/stderr from wrangler and Vite processes |
| **graph** | Service binding topology |

## API (dev server)

The CLI collector exposes:

- `GET /api/state` — workspace resources and health snapshot
- `GET /api/requests` — recent gateway requests
- `GET /api/logs` — process log buffer
- `GET /api/stream` — SSE stream for requests, logs, and health

## Build

```bash
pnpm --filter @gmode/dashboard build
```

Output lands in `dist/` and is served statically by the dev collector.
