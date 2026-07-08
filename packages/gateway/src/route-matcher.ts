import type { GatewayServiceEntry } from "./types";

export type RouteMatch<Env> = {
  service: GatewayServiceEntry<Env>;
  rewrittenPath: string;
};

function normalizeMount(mount: string): string {
  if (mount === "/" || mount === "") return "/";
  return mount.endsWith("/") ? mount.slice(0, -1) : mount;
}

export function validateMount(mount: string): void {
  if (!mount.startsWith("/")) {
    throw new Error(`Service mount must start with "/" (got: ${mount})`);
  }
  if (mount.length > 1 && mount.endsWith("/")) {
    throw new Error(
      `Service mount must not end with "/" unless it is "/" (got: ${mount})`,
    );
  }
}

export function matchService<Env>(
  pathname: string,
  services: GatewayServiceEntry<Env>[],
): RouteMatch<Env> | null {
  const sorted = [...services].sort(
    (a, b) => b.config.mount.length - a.config.mount.length,
  );

  for (const service of sorted) {
    const mount = normalizeMount(service.config.mount);

    if (mount === "/") {
      const rewritten =
        service.config.stripPrefix === false ? pathname : pathname;
      return { service, rewrittenPath: rewritten };
    }

    if (pathname === mount || pathname.startsWith(`${mount}/`)) {
      const stripPrefix = service.config.stripPrefix !== false;
      let rewrittenPath: string;
      if (stripPrefix) {
        const remainder = pathname.slice(mount.length);
        rewrittenPath = remainder === "" ? "/" : remainder;
      } else {
        rewrittenPath = pathname;
      }
      return { service, rewrittenPath };
    }
  }

  return null;
}

export function buildInternalUrl(
  originalUrl: URL,
  rewrittenPath: string,
): URL {
  const url = new URL(originalUrl.toString());
  url.pathname = rewrittenPath;
  return url;
}
