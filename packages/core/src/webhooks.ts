import { ApiError } from "./errors";
import { hmacSign, hmacVerify } from "./crypto";

const WEBHOOK_SIGNATURE_VERSION = "v1";
const DEFAULT_TOLERANCE_SECONDS = 300;

export type WebhookEvent<Payload> = {
  id: string;
  type: string;
  createdAt: string;
  data: Payload;
};

export type CreateWebhookEventInput<Payload> = {
  id: string;
  type: string;
  data: Payload;
  createdAt?: string;
};

export type WebhookSignatureHeaders = {
  "x-gmode-webhook-id": string;
  "x-gmode-webhook-timestamp": string;
  "x-gmode-webhook-signature": string;
  "x-gmode-webhook-key-id"?: string;
};

export type SignWebhookBodyInput = {
  id: string;
  body: string;
  secret: string;
  timestamp?: number;
  keyId?: string;
};

export type WebhookSecret =
  | {
      keyId: string;
      secret: string;
    }
  | {
      secret: string;
      keyId?: never;
    };

export type VerifyWebhookBodyInput = {
  body: string;
  headers: Headers;
  secrets: WebhookSecret[];
  now?: number;
  toleranceSeconds?: number;
};

export type VerifiedWebhookSignature = {
  id: string;
  timestamp: number;
  keyId?: string;
};

export type WebhookQueueSendOptions = {
  contentType?: string;
  delaySeconds?: number;
};

export type WebhookQueue<Payload> = {
  send(
    message: WebhookDeliveryMessage<Payload>,
    options?: WebhookQueueSendOptions,
  ): Promise<void>;
};

export type WebhookDeliveryMessage<Payload> = {
  id: string;
  type: string;
  url: string;
  createdAt: string;
  data: Payload;
  headers?: Record<string, string>;
};

export type EnqueueWebhookDeliveryInput<Payload> = {
  queue: WebhookQueue<Payload>;
  event: WebhookEvent<Payload>;
  url: string;
  headers?: Record<string, string>;
  delaySeconds?: number;
};

export type DeliverWebhookMessageInput<Payload> = {
  message: WebhookDeliveryMessage<Payload>;
  secret: string;
  keyId?: string;
  fetch?: typeof fetch;
};

export function createWebhookEvent<Payload>(
  input: CreateWebhookEventInput<Payload>,
): WebhookEvent<Payload> {
  return {
    id: input.id,
    type: input.type,
    createdAt: input.createdAt ?? new Date().toISOString(),
    data: input.data,
  };
}

export function serializeWebhookEvent<Payload>(
  event: WebhookEvent<Payload>,
): string {
  return JSON.stringify(event);
}

export async function signWebhookBody(
  input: SignWebhookBodyInput,
): Promise<WebhookSignatureHeaders> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signed = webhookSignatureBase(input.id, timestamp, input.body);
  const signature = await hmacSign(input.secret, signed);
  const headers: WebhookSignatureHeaders = {
    "x-gmode-webhook-id": input.id,
    "x-gmode-webhook-timestamp": String(timestamp),
    "x-gmode-webhook-signature": `${WEBHOOK_SIGNATURE_VERSION}=${signature}`,
  };
  if (input.keyId) {
    headers["x-gmode-webhook-key-id"] = input.keyId;
  }
  return headers;
}

export async function verifyWebhookBody(
  input: VerifyWebhookBodyInput,
): Promise<VerifiedWebhookSignature> {
  const id = requireHeader(input.headers, "x-gmode-webhook-id");
  const rawTimestamp = requireHeader(
    input.headers,
    "x-gmode-webhook-timestamp",
  );
  const rawSignature = requireHeader(
    input.headers,
    "x-gmode-webhook-signature",
  );
  const keyId = input.headers.get("x-gmode-webhook-key-id") ?? undefined;
  const timestamp = Number(rawTimestamp);
  if (!Number.isInteger(timestamp)) {
    throw invalidSignature("Invalid webhook timestamp");
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) {
    throw invalidSignature("Webhook timestamp outside tolerance");
  }

  const signature = parseVersionedSignature(rawSignature);
  const signed = webhookSignatureBase(id, timestamp, input.body);
  const secrets = selectSecrets(input.secrets, keyId);
  for (const secret of secrets) {
    if (await hmacVerify(secret.secret, signed, signature)) {
      return keyId
        ? { id, timestamp, keyId }
        : { id, timestamp };
    }
  }

  throw invalidSignature("Invalid webhook signature");
}

export async function enqueueWebhookDelivery<Payload>(
  input: EnqueueWebhookDeliveryInput<Payload>,
): Promise<void> {
  const message: WebhookDeliveryMessage<Payload> = {
    id: input.event.id,
    type: input.event.type,
    url: input.url,
    createdAt: input.event.createdAt,
    data: input.event.data,
  };
  if (input.headers) {
    message.headers = input.headers;
  }
  const options: WebhookQueueSendOptions = {
    contentType: "json",
  };
  if (input.delaySeconds !== undefined) {
    options.delaySeconds = input.delaySeconds;
  }
  await input.queue.send(message, options);
}

export async function deliverWebhookMessage<Payload>(
  input: DeliverWebhookMessageInput<Payload>,
): Promise<Response> {
  const event: WebhookEvent<Payload> = {
    id: input.message.id,
    type: input.message.type,
    createdAt: input.message.createdAt,
    data: input.message.data,
  };
  const body = serializeWebhookEvent(event);
  const signatureHeaders = await signWebhookBody({
    id: event.id,
    body,
    secret: input.secret,
    ...(input.keyId ? { keyId: input.keyId } : {}),
  });
  const headers = new Headers(input.message.headers);
  headers.set("content-type", "application/json");
  for (const [key, value] of Object.entries(signatureHeaders)) {
    headers.set(key, value);
  }

  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(input.message.url, {
    method: "POST",
    headers,
    body,
  });
  if (!response.ok) {
    throw new ApiError({
      code: "WEBHOOK_DELIVERY_FAILED",
      message: `Webhook delivery failed with status ${response.status}`,
      status: 502,
      details: {
        webhookId: input.message.id,
        status: response.status,
      },
    });
  }
  return response;
}

function webhookSignatureBase(
  id: string,
  timestamp: number,
  body: string,
): string {
  return `${timestamp}.${id}.${body}`;
}

function requireHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value) {
    throw invalidSignature(`Missing ${name}`);
  }
  return value;
}

function parseVersionedSignature(value: string): string {
  const [version, signature] = value.split("=", 2);
  if (version !== WEBHOOK_SIGNATURE_VERSION || !signature) {
    throw invalidSignature("Unsupported webhook signature version");
  }
  return signature;
}

function selectSecrets(
  secrets: WebhookSecret[],
  keyId: string | undefined,
): WebhookSecret[] {
  if (secrets.length === 0) {
    throw new Error("At least one webhook secret is required");
  }
  if (!keyId) {
    return secrets.filter((secret) => secret.keyId === undefined);
  }
  const secret = secrets.find((candidate) => candidate.keyId === keyId);
  if (!secret) {
    throw invalidSignature("Unknown webhook key id");
  }
  return [secret];
}

function invalidSignature(message: string): ApiError {
  return new ApiError({
    code: "INVALID_WEBHOOK_SIGNATURE",
    message,
    status: 401,
  });
}
