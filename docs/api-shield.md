# API Shield

Cloudflare API Shield runs before your Worker. GMode is designed to map
cleanly onto Shield's Schema Validation, JWT validation, mTLS, Sequence
Analytics, and endpoint discovery.

## Shield-Compatible OpenAPI

The gateway serves OpenAPI 3.1 at `/openapi.json`. Add `?profile=shield`
for a Shield-compatible OpenAPI 3.0.3 variant:

```bash
curl https://api.example.com/openapi.json?profile=shield > shield-spec.json
```

The downconverter:

- Sets `openapi: "3.0.3"`.
- Collapses `anyOf` in parameters to the first variant.
- Strips `uniqueItems` and `prefixItems`.
- Converts nullable union types to `nullable: true`.
- Returns `x-gmode-shield-warnings` with the number of alterations.

## Sequence Analytics Session ID

Mount `sessionHeader()` to emit `cf-session-id` from user or tenant identity.
Pass a secret to HMAC-hash the value before it reaches Cloudflare dashboards.

```ts
gateway.use(
  sessionHeader({ secret: (env) => env.INTERNAL_SIGNING_SECRET }),
);
```

## CLI Commands

```bash
gmode shield:bootstrap --from https://api.example.com/openapi.json --out shield.openapi.json --json
gmode shield:bootstrap --from https://api.example.com/openapi.json --upload --name gmode:prod
gmode shield:push-schema --from https://api.example.com/openapi.json
gmode shield:sync-schema-actions --from https://api.example.com/openapi.json --file shield-actions.json --dry-run
gmode shield:diff-discovered --from https://api.example.com/openapi.json
gmode shield:sync-sequences --file sequences.json
```

Configure the CLI through env vars or `gmode.config.json`:

```jsonc
{
  "cloudflare": {
    "apiToken": "${CLOUDFLARE_API_TOKEN}",
    "zoneId": "${CLOUDFLARE_ZONE_ID}"
  },
  "gateway": {
    "baseUrl": "https://api.example.com",
    "specPath": "/openapi.json"
  },
  "shield": {
    "sequences": "./sequences.json",
    "schemaActions": [
      { "target": "GET /users/{id}", "action": "log" },
      { "target": "createInvoice", "action": "block" }
    ]
  }
}
```

## Declaring Sequences

```ts
import { defineSequences } from "@gmode/core";

export default defineSequences([
  {
    name: "login_then_create_invoice",
    description: "An invoice POST must be preceded by a successful login.",
    pattern: [
      { operationId: "loginUser" },
      { operationId: "createInvoice" },
    ],
    action: "block",
    withinSeconds: 600,
  },
]);
```

The DSL enforces Shield limits: at least 2 steps, at most 9 steps per rule,
and unique names. If Cloudflare's sequence-rules API returns 404, use
`--out` and import the JSON in the dashboard.

## API Discovery

Shield discovers endpoints from traffic. Keep `operationId` stable in your
GMode routes so discovery results align with your declared spec. Use
`shield:diff-discovered` to find drift.

Use `shield:bootstrap` when onboarding a live zone:

```bash
gmode shield:bootstrap \
  --from https://api.example.com/openapi.json \
  --out shield.openapi.json \
  --json
```

The command:

- Loads the gateway Shield profile OpenAPI document.
- Reads Cloudflare API Shield discovered operations.
- Produces a pruned upload document containing only public paths observed in
  live traffic.
- Reports discovered endpoints missing from the GMode spec.
- Reports spec endpoints that Shield has not observed yet.
- Can upload the pruned schema directly with `--upload`.

Recommended live-zone flow:

1. Deploy the gateway and private services.
2. Send representative smoke traffic through the public gateway.
3. Run `shield:bootstrap --out shield.openapi.json --json`.
4. Inspect `onlyInDiscovery` and fix any missing GMode routes or docs.
5. Upload with `shield:bootstrap --upload --name gmode:<env>` once the diff
   is understood.

For local verification and the retained example app, see
[TESTING.md](../TESTING.md).

## Per-Endpoint Schema Actions

Use per-endpoint actions to roll out Schema Validation safely. Start in
`log`, inspect Cloudflare events, then move selected endpoints to `block`.

Action values are:

- `none` - do not apply schema validation mitigation.
- `log` - log schema validation failures without blocking traffic.
- `block` - block requests that fail schema validation.

You can declare actions in route code:

```ts
service.post("/invoices", {
  operationId: "createInvoice",
  shieldAction: "log",
  body: InvoiceCreate,
  responses: {
    201: Invoice,
  },
  handler: createInvoice,
});
```

The service OpenAPI operation includes `x-gmode-shield-action`, and the CLI
can read those extensions:

```bash
gmode shield:sync-schema-actions \
  --from https://api.example.com/openapi.json \
  --dry-run
```

You can also use an explicit action file:

```json
{
  "actions": [
    { "target": "GET /users/{id}", "action": "log" },
    { "target": "createInvoice", "action": "block" }
  ]
}
```

```bash
gmode shield:sync-schema-actions \
  --from https://api.example.com/openapi.json \
  --file shield-actions.json \
  --json
```

Targets can be either `METHOD /path/{param}` or an OpenAPI `operationId`.
Every target must exist in the public OpenAPI document, and the matching
endpoint must already be present in Cloudflare API Shield discovery. Missing
targets fail the command instead of being skipped.
