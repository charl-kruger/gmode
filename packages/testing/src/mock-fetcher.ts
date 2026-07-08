import type { FetcherLike } from "@gmode/core";

/** Handler used by `createMockFetcher()` for service-binding tests. */
export type MockFetcherHandler = (request: Request) => Promise<Response> | Response;

/** Mock Worker service binding that records every forwarded request. */
export type MockFetcher = FetcherLike & {
  readonly calls: Request[];
  reset(): void;
};

/** Create a mock `FetcherLike` binding for gateway forwarding tests. */
export function createMockFetcher(handler: MockFetcherHandler): MockFetcher {
  const calls: Request[] = [];
  return {
    calls,
    async fetch(request: Request) {
      calls.push(request);
      return handler(request);
    },
    reset() {
      calls.length = 0;
    },
  };
}

/** Mock Cloudflare native Rate Limiting binding. */
export type MockRateLimit = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
  readonly calls: { key: string }[];
  setNext(value: boolean): void;
  reset(): void;
};

/** Create a mock rate-limit binding whose next result can be toggled. */
export function createMockRateLimit(initial: boolean = true): MockRateLimit {
  const calls: { key: string }[] = [];
  let next = initial;
  return {
    calls,
    async limit(input) {
      calls.push(input);
      return { success: next };
    },
    setNext(value: boolean) {
      next = value;
    },
    reset() {
      calls.length = 0;
      next = initial;
    },
  };
}

/** Create a minimal `ExecutionContext` for unit tests. */
export function createExecutionContext(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {
      // no-op for tests
    },
    passThroughOnException() {
      // no-op for tests
    },
  } as ExecutionContext;
}
