import type { GatewayServiceEntry } from "./types";

const INTERNAL_OPENAPI = "/__gmode/openapi.json";

/** Join a gateway mount with an internal gmode path (for web app workers). */
export function internalPathForEntry<Env>(
  entry: GatewayServiceEntry<Env>,
  suffix: string,
): string {
  if (entry.kind === "web") {
    const mount = entry.config.mount;
    const left = mount === "/" ? "" : mount.replace(/\/$/, "");
    return `${left}${suffix}`;
  }
  return suffix;
}

/** Paths to try when probing a service binding (web apps need extra fallbacks). */
export function bindingProbePaths<Env>(
  entry: GatewayServiceEntry<Env>,
  suffix: string,
): string[] {
  if (entry.kind !== "web") return [suffix];

  const paths = [internalPathForEntry(entry, suffix), suffix];
  if (suffix === INTERNAL_OPENAPI && entry.web?.apiMount) {
    const mount = entry.config.mount;
    const apiMount = entry.web.apiMount;
    const left = mount === "/" ? "" : mount.replace(/\/$/, "");
    const right = apiMount === "/" ? "" : apiMount;
    // Prefer the API-mount alias before the root internal path — Vite dev often
    // blocks `__gmode` probes on service bindings while API routes work.
    paths.splice(1, 0, `${left}${right}/openapi.json`);
  }
  return paths;
}

/** Fetch an internal path from a service binding, with web-app path fallbacks. */
export async function fetchBindingGet<Env>(
  entry: GatewayServiceEntry<Env>,
  env: Env,
  suffix: string,
): Promise<Response> {
  const binding = (env as Record<string, unknown>)[entry.config.binding];
  if (
    !binding ||
    typeof (binding as Record<string, unknown>)["fetch"] !== "function"
  ) {
    throw new Error(`Binding "${entry.config.binding}" is not configured`);
  }
  const paths = bindingProbePaths(entry, suffix);
  let last: Response | undefined;
  for (const path of paths) {
    const res = await (binding as { fetch: (r: Request) => Promise<Response> }).fetch(
      new Request(`https://internal.gmode${path}`, { method: "GET" }),
    );
    if (res.ok) return res;
    last = res;
  }
  // Web apps behind Vite may reject internal-path probes in local dev while the
  // mounted app itself is healthy — fall back to a root page fetch.
  if (entry.kind === "web" && suffix === "/__gmode/health") {
    const mount = entry.config.mount;
    const root =
      mount === "/" ? "/" : `${mount.replace(/\/$/, "")}/`;
    const res = await (binding as { fetch: (r: Request) => Promise<Response> }).fetch(
      new Request(`https://internal.gmode${root}`, { method: "GET" }),
    );
    if (res.ok) return res;
    last = res;
  }
  return last ?? new Response("unavailable", { status: 503 });
}
