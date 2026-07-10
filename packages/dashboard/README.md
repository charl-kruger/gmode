# @gmode/dashboard
Prebuilt local development dashboard UI served by `gmode dev` for GMode resources, requests, logs, and health.

## Install

```bash
npm i @gmode/dashboard
```

No runtime peer dependencies. Most projects get this package through `@gmode/cli`; it is built with Vite and served by the dev command.

## Quick example

```ts
import { buildDashboardImport } from "@gmode/cli";

type DashboardResource = {
  kind: "gateway" | "service" | "web";
  name: string;
  mount?: string;
  binding?: string;
  url?: string;
};

const importLine = buildDashboardImport("/workspace");
const state = {
  app: "acme",
  gatewayUrl: "http://127.0.0.1:8787",
  resources: [{ kind: "gateway", name: "gateway", url: "http://127.0.0.1:8787" }] satisfies DashboardResource[],
  health: null,
};
console.log(importLine, state.resources[0]?.name);
```

The dashboard shows resource health, gateway and Swagger links, service/web mounts and bindings, live request events, logs, and a graph tab. It reads `/api/state`, `/api/requests`, `/api/logs`, and `/api/stream` from the `gmode dev` dashboard server.

![GMode dashboard screenshot](https://github.com/charl-kruger/gmode/raw/main/.github/assets/dashboard-light.png)

## API

| Export | Purpose |
|---|---|
| `dist/index.html` | Prebuilt dashboard HTML served by `gmode dev`. |
| `dist/assets/*` | Prebuilt JavaScript and CSS assets. |
| `/api/state` | Dashboard state endpoint expected from the dev server. |
| `/api/requests` | Initial request event history endpoint. |
| `/api/logs` | Initial log history endpoint. |
| `/api/stream` | Server-sent event stream for requests, logs, and health updates. |

## Works with

[`@gmode/cli`](../cli) · [`create-gmode`](../create-gmode) · [`@gmode/gateway`](../gateway) · [`@gmode/service`](../service) · [`@gmode/web`](../web) · [GMode](https://github.com/charl-kruger/gmode) · [docs](../../docs)

## License

MIT
