import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";

/** One gateway request observed by the dev inspector middleware. */
export type InspectorEvent = {
  ts: number;
  requestId: string;
  method: string;
  path: string;
  matchedService?: string;
  status: number;
  durationMs: number;
  authenticated?: boolean;
  subject?: string;
  scopes?: string[];
  error?: string;
};

/** One line of process output from an orchestrated resource. */
export type LogEvent = {
  ts: number;
  resource: string;
  stream: "stdout" | "stderr";
  line: string;
};

/** A resource (gateway/service/web app) shown on the dashboard. */
export type DashboardResource = {
  kind: "gateway" | "service" | "web";
  name: string;
  mount?: string;
  binding?: string;
  workerName?: string;
  url?: string;
  devUrl?: string;
};

export type CollectorOptions = {
  port: number;
  appName: string;
  gatewayUrl: string;
  resources: DashboardResource[];
};

export type Collector = {
  url: string;
  /** URL the gateway posts inspector events to. */
  eventsUrl: string;
  pushLog: (event: LogEvent) => void;
  setHealth: (health: unknown) => void;
  close: () => void;
};

const RING_SIZE = 5000;

class Ring<T> {
  private items: T[] = [];
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > RING_SIZE) {
      this.items.splice(0, this.items.length - RING_SIZE);
    }
  }
  list(): readonly T[] {
    return this.items;
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function dashboardDistDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@gmode/dashboard/package.json");
    const dist = join(dirname(pkgPath), "dist");
    return existsSync(dist) ? dist : null;
  } catch {
    return null;
  }
}

const FALLBACK_HTML = `<!doctype html>
<html><head><title>gmode dev</title></head>
<body style="font-family: system-ui; padding: 3rem">
<h1>gmode dev dashboard</h1>
<p>The <code>@gmode/dashboard</code> package is not installed, so the full UI
is unavailable. Raw data endpoints:</p>
<ul>
<li><a href="/api/state">/api/state</a> — resources & health</li>
<li><a href="/api/requests">/api/requests</a> — recent gateway requests</li>
<li><a href="/api/logs">/api/logs</a> — recent process logs</li>
</ul>
</body></html>`;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

/** Start the local dev collector + dashboard HTTP server. */
export function startCollector(options: CollectorOptions): Promise<Collector> {
  const requests = new Ring<InspectorEvent>();
  const logs = new Ring<LogEvent>();
  let health: unknown = null;
  const sseClients = new Set<ServerResponse>();
  const distDir = dashboardDistDir();

  const broadcast = (type: string, data: unknown) => {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (req.method === "POST" && path === "/events") {
        const body = await readBody(req);
        try {
          const event = JSON.parse(body) as InspectorEvent;
          requests.push(event);
          broadcast("request", event);
        } catch {
          // Ignore malformed events; the inspector is fire-and-forget.
        }
        sendJson(res, { ok: true });
        return;
      }

      if (path === "/api/state") {
        sendJson(res, {
          app: options.appName,
          gatewayUrl: options.gatewayUrl,
          resources: options.resources,
          health,
        });
        return;
      }

      if (path === "/api/requests") {
        sendJson(res, requests.list());
        return;
      }

      if (path === "/api/logs") {
        const resource = url.searchParams.get("resource");
        const list = resource
          ? logs.list().filter((l) => l.resource === resource)
          : logs.list();
        sendJson(res, list.slice(-1000));
        return;
      }

      if (path === "/api/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "*",
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        req.on("close", () => {
          sseClients.delete(res);
        });
        return;
      }

      // Static dashboard assets.
      if (req.method === "GET") {
        if (distDir) {
          const rel = path === "/" ? "/index.html" : path;
          const filePath = normalize(join(distDir, rel));
          if (filePath.startsWith(distDir) && existsSync(filePath)) {
            res.writeHead(200, {
              "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
            });
            res.end(readFileSync(filePath));
            return;
          }
          // SPA fallback.
          const indexPath = join(distDir, "index.html");
          if (existsSync(indexPath)) {
            res.writeHead(200, { "content-type": MIME[".html"]! });
            res.end(readFileSync(indexPath));
            return;
          }
        }
        res.writeHead(200, { "content-type": MIME[".html"]! });
        res.end(FALLBACK_HTML);
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (err) {
      sendJson(
        res,
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${options.port}`;
      resolvePromise({
        url,
        eventsUrl: `${url}/events`,
        pushLog: (event) => {
          logs.push(event);
          broadcast("log", event);
        },
        setHealth: (value) => {
          health = value;
          broadcast("health", value);
        },
        close: () => {
          for (const client of sseClients) client.end();
          server.close();
        },
      });
    });
  });
}
