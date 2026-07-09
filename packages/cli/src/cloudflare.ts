
import type { ShieldSchemaAction } from "@gmode/core";

const BASE = "https://api.cloudflare.com/client/v4";

export type CloudflareClient = {
  uploadUserSchema(input: {
    name: string;
    kind?: "openapi_v3";
    enabled?: boolean;
    body: string;
  }): Promise<{ id: string; name: string }>;
  listUserSchemas(): Promise<
    Array<{
      schema_id: string;
      name: string;
      kind: string;
      created_at: string;
    }>
  >;
  listDiscoveredOperations(): Promise<
    Array<{
      operation_id: string;
      method: string;
      host: string;
      endpoint: string;
      last_updated: string;
    }>
  >;
  putSequenceRule(input: {
    name: string;
    rule: unknown;
  }): Promise<unknown>;
  setOperationSchemaValidation(input: {
    operationId: string;
    action: ShieldSchemaAction;
  }): Promise<{ mitigation_action: ShieldSchemaAction }>;
};

export type CloudflareApiError = {
  errors: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
  success: false;
};

export type CloudflareApiSuccess<T> = {
  result: T;
  result_info?: unknown;
  success: true;
  errors: never[];
  messages: never[];
};

export type CloudflareApiResponse<T> =
  | CloudflareApiSuccess<T>
  | CloudflareApiError;

export class CloudflareError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "CloudflareError";
    this.status = status;
    this.body = body;
  }
}

export function createCloudflareClient(input: {
  apiToken: string;
  zoneId: string;
  fetchImpl?: typeof fetch;
}): CloudflareClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = `${BASE}/zones/${input.zoneId}/api_gateway`;

  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${input.apiToken}`);
    if (
      init.body &&
      !headers.has("content-type") &&
      typeof init.body === "string"
    ) {
      headers.set("content-type", "application/json");
    }
    const res = await fetchImpl(`${base}${path}`, { ...init, headers });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === "object" && "errors" in parsed
          ? ((parsed as CloudflareApiError).errors ?? [])
              .map((e) => `${e.code}: ${e.message}`)
              .join("; ")
          : `HTTP ${res.status}`;
      throw new CloudflareError(res.status, parsed, msg);
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "success" in parsed &&
      (parsed as { success: boolean }).success === false
    ) {
      const err = parsed as CloudflareApiError;
      throw new CloudflareError(
        res.status,
        parsed,
        err.errors.map((e) => `${e.code}: ${e.message}`).join("; "),
      );
    }
    return (parsed as CloudflareApiSuccess<T>).result;
  }

  return {
    async uploadUserSchema({ name, kind = "openapi_v3", enabled, body }) {
      const form = new FormData();
      form.set("name", name);
      form.set("kind", kind);
      if (enabled !== undefined) {
        form.set("validation_enabled", String(enabled));
      }
      form.set(
        "file",
        new Blob([body], { type: "application/json" }),
        `${name}.json`,
      );
      return request<{ id: string; name: string }>("/user_schemas", {
        method: "POST",
        body: form,
      });
    },

    async listUserSchemas() {
      return request<
        Array<{
          schema_id: string;
          name: string;
          kind: string;
          created_at: string;
        }>
      >("/user_schemas");
    },

    async listDiscoveredOperations() {
      return request<
        Array<{
          operation_id: string;
          method: string;
          host: string;
          endpoint: string;
          last_updated: string;
        }>
      >("/discovery/operations");
    },

    async putSequenceRule(input) {
      return request("/sequence_rules", {
        method: "POST",
        body: JSON.stringify(input.rule),
      });
    },

    async setOperationSchemaValidation(input) {
      return request<{ mitigation_action: ShieldSchemaAction }>(
        `/operations/${encodeURIComponent(input.operationId)}/schema_validation`,
        {
          method: "PUT",
          body: JSON.stringify({
            mitigation_action: input.action,
          }),
        },
      );
    },
  };
}
