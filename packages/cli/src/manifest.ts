import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseJsonc } from "./jsonc";

/** Supported web app frameworks for `gmode new web`. */
export type WebFramework = "tanstack-start" | "vite-react" | "custom";

/** A private API service Worker declared in gmode.jsonc. */
export type ManifestService = {
  /** Stable service name used for bindings, docs, and telemetry. */
  name: string;
  /** Path to the service Worker directory, relative to the manifest. */
  path: string;
  /** Public gateway mount, for example `/users`. */
  mount: string;
  /** Whether the gateway requires auth before forwarding. */
  auth?: boolean;
  /** Scopes required before forwarding. */
  scopes?: string[];
  /** Gateway context audience. Defaults to the service name. */
  audience?: string;
  /** Include in gateway OpenAPI aggregation. Defaults to `true`. */
  openapi?: boolean;
};

/** A full web application Worker (TanStack Start, Vite SPA, ...) in gmode.jsonc. */
export type ManifestWebApp = {
  /** Stable app name used for bindings and telemetry. */
  name: string;
  /** Path to the app directory, relative to the manifest. */
  path: string;
  /** Public gateway mount, for example `/app`. */
  mount: string;
  /** Framework used for scaffolding and dev orchestration. */
  framework?: WebFramework;
  /** Fixed local dev port for the app's Vite server. Assigned when omitted. */
  devPort?: number;
  /** Embedded API surface exposed by the app via `withGmode()`. */
  api?: {
    /** API mount inside the app, relative to the app mount. Defaults to `/api`. */
    mount?: string;
    /** Include the app's API routes in gateway OpenAPI aggregation. Defaults to `true`. */
    openapi?: boolean;
  };
};

/** Parsed gmode.jsonc application manifest. */
export type GmodeManifest = {
  $schema?: string;
  /** Application name; used as the Worker name prefix. */
  name: string;
  /** Gateway Worker location and local dev port. */
  gateway: { path: string; port?: number };
  services?: ManifestService[];
  webApps?: ManifestWebApp[];
};

export const MANIFEST_FILENAME = "gmode.jsonc";

/** A manifest entry resolved with worker name, binding name, and absolute path. */
export type ResolvedEntry = {
  kind: "service" | "web";
  name: string;
  /** Absolute path to the Worker directory. */
  dir: string;
  /** Worker name from the entry's wrangler.jsonc (or convention if missing). */
  workerName: string;
  /** Gateway env binding name. */
  binding: string;
  mount: string;
  service?: ManifestService;
  webApp?: ManifestWebApp;
};

export type ResolvedManifest = {
  manifest: GmodeManifest;
  /** Absolute path to the directory containing gmode.jsonc. */
  rootDir: string;
  /** Absolute path to the manifest file. */
  manifestPath: string;
  /** Absolute path to the gateway Worker directory. */
  gatewayDir: string;
  entries: ResolvedEntry[];
};

/** Convert a service/app name to its gateway env binding name. */
export function toBindingName(name: string, kind: "service" | "web"): string {
  const base = name
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replace(/^_+|_+$/g, "");
  const suffix = kind === "service" ? "_API" : "_APP";
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

/** Conventional Worker name for an entry: `<app>-<entry>`. */
export function toWorkerName(appName: string, entryName: string): string {
  const slug = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${slug(appName)}-${slug(entryName)}`;
}

/** Dev-mode env var carrying the local Vite URL for a web app. */
export function toDevUrlVar(binding: string): string {
  return `${binding}_DEV_URL`;
}

function fail(message: string): never {
  throw new Error(message);
}

function validateMountValue(mount: string, owner: string): void {
  if (!mount.startsWith("/")) {
    fail(`${owner}: mount must start with "/" (got "${mount}")`);
  }
  if (mount.length > 1 && mount.endsWith("/")) {
    fail(`${owner}: mount must not end with "/" (got "${mount}")`);
  }
}

function readWorkerName(dir: string): string | undefined {
  for (const file of ["wrangler.jsonc", "wrangler.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      const config = parseJsonc<{ name?: string }>(readFileSync(path, "utf8"));
      if (typeof config.name === "string" && config.name) return config.name;
    } catch (err) {
      fail(
        `Could not parse ${path}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return undefined;
}

/** Locate gmode.jsonc starting from `startDir`, walking up parent directories. */
export function findManifestPath(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, MANIFEST_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Parse and validate a gmode.jsonc manifest into resolved absolute entries. */
export function loadManifest(manifestPath: string): ResolvedManifest {
  const rootDir = resolve(manifestPath, "..");
  let manifest: GmodeManifest;
  try {
    manifest = parseJsonc<GmodeManifest>(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    fail(
      `Could not parse ${manifestPath}: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    fail(`${MANIFEST_FILENAME}: "name" is required`);
  }
  if (!manifest.gateway?.path) {
    fail(`${MANIFEST_FILENAME}: "gateway.path" is required`);
  }

  const gatewayDir = resolve(rootDir, manifest.gateway.path);
  if (!existsSync(gatewayDir)) {
    fail(`Gateway directory does not exist: ${gatewayDir}`);
  }

  const entries: ResolvedEntry[] = [];
  const seenNames = new Set<string>();
  const seenMounts = new Map<string, string>();

  const addEntry = (
    kind: "service" | "web",
    name: string,
    path: string,
    mount: string,
    service?: ManifestService,
    webApp?: ManifestWebApp,
  ) => {
    const owner = `${kind} "${name}"`;
    if (!name) fail(`${MANIFEST_FILENAME}: every ${kind} needs a "name"`);
    if (seenNames.has(name)) {
      fail(`${MANIFEST_FILENAME}: duplicate entry name "${name}"`);
    }
    seenNames.add(name);
    validateMountValue(mount, owner);
    const collidesWith = seenMounts.get(mount);
    if (collidesWith) {
      fail(
        `${MANIFEST_FILENAME}: mount "${mount}" is used by both "${collidesWith}" and "${name}"`,
      );
    }
    seenMounts.set(mount, name);

    const dir = resolve(rootDir, path);
    if (!existsSync(dir)) {
      fail(`${owner}: directory does not exist: ${dir}`);
    }
    const workerName =
      readWorkerName(dir) ?? toWorkerName(manifest.name, name);
    const entry: ResolvedEntry = {
      kind,
      name,
      dir,
      workerName,
      binding: toBindingName(name, kind),
      mount,
    };
    if (service) entry.service = service;
    if (webApp) entry.webApp = webApp;
    entries.push(entry);
  };

  for (const service of manifest.services ?? []) {
    addEntry("service", service.name, service.path, service.mount, service);
  }
  for (const webApp of manifest.webApps ?? []) {
    addEntry("web", webApp.name, webApp.path, webApp.mount, undefined, webApp);
  }

  return {
    manifest,
    rootDir,
    manifestPath,
    gatewayDir,
    entries,
  };
}
