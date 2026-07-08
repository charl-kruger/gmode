import { WorkerEntrypoint } from "cloudflare:workers";
import type { RpcService } from "./service";
import type { RpcEnvelope, RpcMethodSpec } from "./types";

/** Optional HTTP handler shape that can share a WorkerEntrypoint with RPC. */
export type HttpEntrypoint<Env> = {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response>;
};

/** Options for `defineEntrypoint()`. */
export type DefineEntrypointOptions<Env> = {
  /** Optional HTTP service to expose through `fetch()` on the same Worker. */
  http?: HttpEntrypoint<Env>;
};

/**
 * Convert a GMode RPC service into a Cloudflare `WorkerEntrypoint` class.
 *
 * Use this as the Worker default export when the Worker exposes service-binding
 * RPC methods. Pass `{ http: service }` to expose normal HTTP routes from the
 * same Worker.
 */
export function defineEntrypoint<
  Env,
  Methods extends Record<string, RpcMethodSpec>,
>(
  service: RpcService<Env, Methods>,
  options: DefineEntrypointOptions<Env> = {},
): new (
  ctx: ExecutionContext,
  env: Env,
) => WorkerEntrypoint<Env> {
  class GModeEntrypoint extends WorkerEntrypoint<Env> {
    override async fetch(request: Request): Promise<Response> {
      if (options.http) {
        return options.http.fetch(
          request,
          this.env,
          this.ctx as ExecutionContext,
        );
      }
      return new Response(
        JSON.stringify({
          error: {
            code: "NOT_IMPLEMENTED",
            message: "This RPC entrypoint does not expose HTTP routes",
            status: 501,
          },
        }),
        {
          status: 501,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
  }

  for (const name of service.methodNames) {
    Object.defineProperty(GModeEntrypoint.prototype, name, {
      value: async function (
        this: GModeEntrypoint,
        envelope: RpcEnvelope<unknown>,
      ) {
        return service.invoke(
          name,
          envelope,
          this.env as Env,
          this.ctx as ExecutionContext,
        );
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  return GModeEntrypoint as unknown as new (
    ctx: ExecutionContext,
    env: Env,
  ) => WorkerEntrypoint<Env>;
}
