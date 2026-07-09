import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardState,
  HealthReport,
  InspectorEvent,
  LogEvent,
} from "./types";
import { healthFor } from "./health";

const MAX_ROWS = 500;

type Tab = "resources" | "requests" | "logs" | "graph";

export function App() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [requests, setRequests] = useState<InspectorEvent[]>([]);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [tab, setTab] = useState<Tab>("resources");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json() as Promise<DashboardState>)
      .then((s) => {
        setState(s);
        setHealth(s.health);
      })
      .catch(() => {});
    fetch("/api/requests")
      .then((r) => r.json() as Promise<InspectorEvent[]>)
      .then((list) => setRequests(list.slice(-MAX_ROWS)))
      .catch(() => {});
    fetch("/api/logs")
      .then((r) => r.json() as Promise<LogEvent[]>)
      .then((list) => setLogs(list.slice(-MAX_ROWS)))
      .catch(() => {});

    const source = new EventSource("/api/stream");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("request", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as InspectorEvent;
      setRequests((prev) => [...prev.slice(-MAX_ROWS + 1), data]);
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as LogEvent;
      setLogs((prev) => [...prev.slice(-MAX_ROWS + 1), data]);
    });
    source.addEventListener("health", (event) => {
      setHealth(JSON.parse((event as MessageEvent).data) as HealthReport);
    });
    return () => source.close();
  }, []);

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <span className="logo">▲</span>
          <span className="title">{state?.app ?? "gmode"}</span>
          <span className="subtitle">dev dashboard</span>
        </div>
        <div className="header-right">
          <span className={`pill ${health?.ok ? "ok" : "bad"}`}>
            {health?.ok ? "healthy" : health ? "unhealthy" : "waiting"}
          </span>
          <span className={`pill ${connected ? "ok" : "bad"}`}>
            {connected ? "live" : "disconnected"}
          </span>
          {state?.gatewayUrl && (
            <>
              <a href={state.gatewayUrl} target="_blank" rel="noreferrer">
                gateway
              </a>
              <a
                href={`${state.gatewayUrl}/docs`}
                target="_blank"
                rel="noreferrer"
              >
                swagger
              </a>
            </>
          )}
        </div>
      </header>

      <nav>
        {(["resources", "requests", "logs", "graph"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
            type="button"
          >
            {t}
            {t === "requests" && requests.length > 0 && (
              <span className="count">{requests.length}</span>
            )}
          </button>
        ))}
      </nav>

      <main>
        {tab === "resources" && <Resources state={state} health={health} />}
        {tab === "requests" && <Requests requests={requests} />}
        {tab === "logs" && <Logs logs={logs} state={state} />}
        {tab === "graph" && <Graph state={state} health={health} />}
      </main>
    </div>
  );
}

function Resources({
  state,
  health,
}: {
  state: DashboardState | null;
  health: HealthReport | null;
}) {
  if (!state) return <p className="empty">Waiting for gmode dev…</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Resource</th>
          <th>Kind</th>
          <th>Mount</th>
          <th>Binding</th>
          <th>Health</th>
          <th>Links</th>
        </tr>
      </thead>
      <tbody>
        {state.resources.map((r) => {
          const status =
            r.kind === "gateway"
              ? health
                ? health.ok
                  ? { label: "healthy", className: "ok" }
                  : { label: "unhealthy", className: "bad" }
                : { label: "—", className: "" }
              : healthFor(health, r.name);
          return (
            <tr key={r.name}>
              <td>
                <strong>{r.name}</strong>
                {r.workerName && <div className="dim">{r.workerName}</div>}
              </td>
              <td>
                <span className={`kind kind-${r.kind}`}>{r.kind}</span>
              </td>
              <td className="mono">{r.mount ?? "/"}</td>
              <td className="mono">{r.binding ?? "—"}</td>
              <td>
                <span className={`pill ${status.className}`}>
                  {status.label}
                </span>
              </td>
              <td>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    open
                  </a>
                )}{" "}
                {r.devUrl && (
                  <a href={r.devUrl} target="_blank" rel="noreferrer">
                    vite
                  </a>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Requests({ requests }: { requests: InspectorEvent[] }) {
  const [selected, setSelected] = useState<InspectorEvent | null>(null);
  const rows = useMemo(() => [...requests].reverse(), [requests]);
  if (rows.length === 0) {
    return (
      <p className="empty">
        No requests yet. Hit the gateway and they will stream in live.
      </p>
    );
  }
  return (
    <div className="split">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Method</th>
            <th>Path</th>
            <th>Service</th>
            <th>Status</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.requestId}-${r.ts}`}
              className={selected?.requestId === r.requestId ? "selected" : ""}
              onClick={() => setSelected(r)}
            >
              <td className="dim">{new Date(r.ts).toLocaleTimeString()}</td>
              <td className="mono">{r.method}</td>
              <td className="mono">{r.path}</td>
              <td>{r.matchedService ?? "—"}</td>
              <td>
                <span
                  className={`pill ${r.status < 400 ? "ok" : r.status < 500 ? "warn" : "bad"}`}
                >
                  {r.status}
                </span>
              </td>
              <td className="dim">{r.durationMs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <aside>
          <h3>Request detail</h3>
          <pre>{JSON.stringify(selected, null, 2)}</pre>
          <button type="button" onClick={() => setSelected(null)}>
            close
          </button>
        </aside>
      )}
    </div>
  );
}

function Logs({
  logs,
  state,
}: {
  logs: LogEvent[];
  state: DashboardState | null;
}) {
  const [filter, setFilter] = useState<string>("all");
  const endRef = useRef<HTMLDivElement>(null);
  const resourceNames = useMemo(() => {
    const names = new Set(logs.map((l) => l.resource));
    for (const r of state?.resources ?? []) names.add(r.name);
    return ["all", ...Array.from(names).sort()];
  }, [logs, state]);
  const visible = useMemo(
    () => (filter === "all" ? logs : logs.filter((l) => l.resource === filter)),
    [logs, filter],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [visible.length]);

  return (
    <div>
      <div className="toolbar">
        {resourceNames.map((name) => (
          <button
            key={name}
            type="button"
            className={filter === name ? "active" : ""}
            onClick={() => setFilter(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="logs">
        {visible.length === 0 && <p className="empty">No log output yet.</p>}
        {visible.map((l, i) => (
          <div
            key={`${l.ts}-${i}`}
            className={`log-line ${l.stream === "stderr" ? "stderr" : ""}`}
          >
            <span className="log-resource">[{l.resource}]</span> {l.line}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Graph({
  state,
  health,
}: {
  state: DashboardState | null;
  health: HealthReport | null;
}) {
  if (!state) return <p className="empty">Waiting for gmode dev…</p>;
  const children = state.resources.filter((r) => r.kind !== "gateway");
  const height = Math.max(children.length * 72 + 40, 160);
  const midY = height / 2;
  return (
    <svg
      viewBox={`0 0 720 ${height}`}
      className="graph"
      role="img"
      aria-label="Service graph"
    >
      <g>
        <rect
          x={20}
          y={midY - 28}
          width={170}
          height={56}
          rx={10}
          className={`node gateway ${health?.ok ? "healthy" : "unhealthy"}`}
        />
        <text x={105} y={midY - 4} textAnchor="middle" className="node-title">
          gateway
        </text>
        <text x={105} y={midY + 14} textAnchor="middle" className="node-sub">
          {state.app}
        </text>
      </g>
      {children.map((r, i) => {
        const y = 40 + i * 72;
        const status = healthFor(health, r.name);
        return (
          <g key={r.name}>
            <path
              d={`M 190 ${midY} C 300 ${midY}, 320 ${y + 28}, 430 ${y + 28}`}
              className="edge"
            />
            <rect
              x={430}
              y={y}
              width={240}
              height={56}
              rx={10}
              className={`node ${r.kind} ${
                status.className === "ok"
                  ? "healthy"
                  : status.className === "bad"
                    ? "unhealthy"
                    : ""
              }`}
            />
            <text x={550} y={y + 24} textAnchor="middle" className="node-title">
              {r.name}
              {r.kind === "web" ? " (web)" : ""}
            </text>
            <text x={550} y={y + 42} textAnchor="middle" className="node-sub">
              {r.mount} → {r.binding}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
