import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import {
  createWebhookEvent,
  deliverWebhookMessage,
  enqueueWebhookDelivery,
  serializeWebhookEvent,
  signWebhookBody,
  verifyWebhookBody,
  type WebhookDeliveryMessage,
  type WebhookQueue,
  type WebhookQueueSendOptions,
} from "./webhooks";

type UserPayload = {
  userId: string;
};

type SentMessage<Payload> = {
  message: WebhookDeliveryMessage<Payload>;
  options?: WebhookQueueSendOptions;
};

function createQueue<Payload>(): WebhookQueue<Payload> & {
  sent: SentMessage<Payload>[];
} {
  const sent: SentMessage<Payload>[] = [];
  return {
    sent,
    async send(message, options) {
      sent.push(options ? { message, options } : { message });
    },
  };
}

describe("webhooks", () => {
  it("signs and verifies a webhook body", async () => {
    const event = createWebhookEvent<UserPayload>({
      id: "evt_123",
      type: "user.created",
      createdAt: "2026-05-21T10:00:00.000Z",
      data: { userId: "u_123" },
    });
    const body = serializeWebhookEvent(event);
    const headers = await signWebhookBody({
      id: event.id,
      body,
      secret: "whsec_live",
      timestamp: 1_779_360_000,
      keyId: "primary",
    });

    const verified = await verifyWebhookBody({
      body,
      headers: new Headers(headers),
      secrets: [{ keyId: "primary", secret: "whsec_live" }],
      now: 1_779_360_000,
    });

    expect(verified).toEqual({
      id: "evt_123",
      timestamp: 1_779_360_000,
      keyId: "primary",
    });
  });

  it("rejects tampered webhook bodies", async () => {
    const body = JSON.stringify({ ok: true });
    const headers = await signWebhookBody({
      id: "evt_123",
      body,
      secret: "whsec_live",
      timestamp: 1_779_360_000,
    });

    await expect(
      verifyWebhookBody({
        body: JSON.stringify({ ok: false }),
        headers: new Headers(headers),
        secrets: [{ secret: "whsec_live" }],
        now: 1_779_360_000,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_WEBHOOK_SIGNATURE",
      status: 401,
    });
  });

  it("rejects timestamps outside tolerance", async () => {
    const body = JSON.stringify({ ok: true });
    const headers = await signWebhookBody({
      id: "evt_123",
      body,
      secret: "whsec_live",
      timestamp: 1_779_360_000,
    });

    await expect(
      verifyWebhookBody({
        body,
        headers: new Headers(headers),
        secrets: [{ secret: "whsec_live" }],
        now: 1_779_361_000,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_WEBHOOK_SIGNATURE",
      status: 401,
    });
  });

  it("enqueues delivery messages for Queue retries", async () => {
    const queue = createQueue<UserPayload>();
    const event = createWebhookEvent<UserPayload>({
      id: "evt_123",
      type: "user.created",
      createdAt: "2026-05-21T10:00:00.000Z",
      data: { userId: "u_123" },
    });

    await enqueueWebhookDelivery({
      queue,
      event,
      url: "https://hooks.example.test/users",
      headers: { "x-source": "gmode" },
      delaySeconds: 10,
    });

    expect(queue.sent).toEqual([
      {
        message: {
          id: "evt_123",
          type: "user.created",
          url: "https://hooks.example.test/users",
          createdAt: "2026-05-21T10:00:00.000Z",
          data: { userId: "u_123" },
          headers: { "x-source": "gmode" },
        },
        options: {
          contentType: "json",
          delaySeconds: 10,
        },
      },
    ]);
  });

  it("delivers signed JSON and throws on non-2xx responses", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({ ok: true });
    };

    const response = await deliverWebhookMessage({
      message: {
        id: "evt_123",
        type: "user.created",
        url: "https://hooks.example.test/users",
        createdAt: "2026-05-21T10:00:00.000Z",
        data: { userId: "u_123" },
      },
      secret: "whsec_live",
      keyId: "primary",
      fetch: fetchImpl,
    });

    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.headers.get("x-gmode-webhook-id")).toBe("evt_123");
    expect(request.headers.get("x-gmode-webhook-key-id")).toBe("primary");
    const body = await request.text();
    await expect(
      verifyWebhookBody({
        body,
        headers: request.headers,
        secrets: [{ keyId: "primary", secret: "whsec_live" }],
      }),
    ).resolves.toMatchObject({ id: "evt_123", keyId: "primary" });

    const failingFetch: typeof fetch = async () =>
      new Response("no", { status: 500 });
    await expect(
      deliverWebhookMessage({
        message: {
          id: "evt_500",
          type: "user.failed",
          url: "https://hooks.example.test/users",
          createdAt: "2026-05-21T10:00:00.000Z",
          data: { userId: "u_500" },
        },
        secret: "whsec_live",
        fetch: failingFetch,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
