# Webhooks

GMode provides small primitives for signed webhook delivery. The helpers are
deliberately thin: Cloudflare Queues handle retries, your queue consumer owns
the delivery policy, and receivers verify HMAC headers before processing.

## Create And Enqueue

```ts
import {
  createWebhookEvent,
  enqueueWebhookDelivery,
  type WebhookQueue,
} from "@gmode/core";

type Env = {
  WEBHOOK_QUEUE: WebhookQueue<{ userId: string }>;
};

const event = createWebhookEvent({
  id: "evt_123",
  type: "user.created",
  data: { userId: "u_123" },
});

await enqueueWebhookDelivery({
  queue: env.WEBHOOK_QUEUE,
  event,
  url: "https://example.com/webhooks/users",
  headers: { "x-source": "gmode" },
});
```

The queued message contains the event id, type, creation timestamp, target URL,
data, and optional extra headers.

## Deliver From A Queue Consumer

```ts
import {
  deliverWebhookMessage,
  type WebhookDeliveryMessage,
} from "@gmode/core";

type Payload = { userId: string };

export default {
  async queue(batch: MessageBatch<WebhookDeliveryMessage<Payload>>, env: Env) {
    for (const message of batch.messages) {
      await deliverWebhookMessage({
        message: message.body,
        secret: env.WEBHOOK_SIGNING_SECRET,
        keyId: "primary",
      });
      message.ack();
    }
  },
};
```

`deliverWebhookMessage` sends a JSON `POST`. It throws on non-2xx responses, so
the Queue consumer can let Cloudflare retry by not acknowledging the message.

## Signature Headers

Delivered webhooks include:

- `x-gmode-webhook-id`
- `x-gmode-webhook-timestamp`
- `x-gmode-webhook-signature`
- `x-gmode-webhook-key-id` when configured

The signature base string is:

```text
<timestamp>.<webhook-id>.<raw-body>
```

The signature value is versioned as `v1=<base64url-hmac-sha256>`.

## Verify On The Receiver

```ts
import { verifyWebhookBody } from "@gmode/core";

const body = await request.text();

await verifyWebhookBody({
  body,
  headers: request.headers,
  secrets: [{ keyId: "primary", secret: env.WEBHOOK_SIGNING_SECRET }],
});

const event = JSON.parse(body) as {
  id: string;
  type: string;
  createdAt: string;
  data: unknown;
};
```

Verification fails with `ApiError` status `401` when required headers are
missing, the signature version is unsupported, the key id is unknown, the
timestamp is outside tolerance, or the HMAC does not match.

## Key Rotation

Senders can set a `keyId` while delivering. Receivers should configure all
currently accepted keys explicitly:

```ts
await verifyWebhookBody({
  body,
  headers: request.headers,
  secrets: [
    { keyId: "primary", secret: env.WEBHOOK_SIGNING_SECRET },
    { keyId: "previous", secret: env.OLD_WEBHOOK_SIGNING_SECRET },
  ],
});
```

When `x-gmode-webhook-key-id` is present, verification requires a matching
configured key id. Unknown key ids fail.
