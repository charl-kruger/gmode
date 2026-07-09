/**
 * Types-only RPC contract for the Users API.
 *
 * Consumers (like billing-api) import from this file instead of the service
 * implementation, so the contract carries zero runtime dependencies and can
 * be published or copied without pulling in the Worker code.
 */
import type { RpcServiceClient } from "@gmode/rpc";

/** Method map exposed by the Users API RPC entrypoint. */
export type UsersApiRpcMethods = {
  getUserById: {
    input: { id: string };
    output: { id: string; email: string };
  };
};

/** Service binding type for callers: `type Env = { USERS_API: UsersApiRpc }`. */
export type UsersApiRpc = RpcServiceClient<UsersApiRpcMethods>;
