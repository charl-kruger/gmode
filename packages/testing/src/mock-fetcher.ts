import type { FetcherLike } from "@gmode/core";

export type MockFetcherHandler = (request: Request) => Promise<Response> | Response;

export type MockFetcher = FetcherLike & {
  readonly calls: Request[];
  reset(): void;
};

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

export type MockRateLimit = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
  readonly calls: { key: string }[];
  setNext(value: boolean): void;
  reset(): void;
};

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
