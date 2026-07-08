/** RPC envelope received by a mock service-binding method. */
export type MockRpcEnvelope<In = unknown> = {
  input: In;
  context?: string;
};

/** RPC result returned by a mock service-binding method. */
export type MockRpcResult<Out> =
  | { ok: true; data: Out }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        status: number;
        details?: unknown;
      };
    };

/** Method implementation map used to build a mock RPC binding. */
export type MockRpcImpl = Record<
  string,
  (envelope: MockRpcEnvelope<unknown>) => Promise<MockRpcResult<unknown>>
>;

/** Recorded RPC binding call. */
export type MockRpcCall = {
  method: string;
  envelope: MockRpcEnvelope<unknown>;
};

/** Mock RPC binding that records method calls. */
export type MockRpcBinding<Impl extends MockRpcImpl> = Impl & {
  readonly calls: MockRpcCall[];
  reset(): void;
};

/** Create a mock service-binding RPC object from method implementations. */
export function createMockRpcBinding<Impl extends MockRpcImpl>(
  impl: Impl,
): MockRpcBinding<Impl> {
  const calls: MockRpcCall[] = [];
  const wrapped: Record<string, unknown> = {
    calls,
    reset() {
      calls.length = 0;
    },
  };
  for (const [name, fn] of Object.entries(impl)) {
    wrapped[name] = async (envelope: MockRpcEnvelope<unknown>) => {
      calls.push({ method: name, envelope });
      return fn(envelope);
    };
  }
  return wrapped as MockRpcBinding<Impl>;
}
