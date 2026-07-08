import { ApiError } from "./errors";
import type { GatewayContext } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlEncodeString(value: string): string {
  return base64urlEncode(encoder.encode(value));
}

export function base64urlDecodeToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const full = pad === 0 ? padded : padded + "=".repeat(4 - pad);
  const binary = atob(full);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

export function base64urlDecodeToString(value: string): string {
  return decoder.decode(base64urlDecodeToBytes(value));
}

async function importHmacKey(
  secret: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function hmacSign(
  secret: string,
  data: string,
): Promise<string> {
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(encoder.encode(data)),
  );
  return base64urlEncode(signature);
}

export async function hmacVerify(
  secret: string,
  data: string,
  signature: string,
): Promise<boolean> {
  const key = await importHmacKey(secret, ["verify"]);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64urlDecodeToBytes(signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(encoder.encode(data)),
  );
}

export async function signGatewayContext(
  context: GatewayContext,
  secret: string,
): Promise<string> {
  const payload = base64urlEncodeString(JSON.stringify(context));
  const signature = await hmacSign(secret, payload);
  return `${payload}.${signature}`;
}

export type VerifyGatewayContextOptions = {
  audience: string;
  issuer?: "gmode-gateway";
  now?: number;
  clockSkewSeconds?: number;
};

export async function verifyGatewayContext(
  token: string,
  secret: string,
  options: VerifyGatewayContextOptions,
): Promise<GatewayContext> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT",
      message: "Invalid gateway context token",
      status: 401,
    });
  }
  const [payloadEncoded, signature] = parts as [string, string];

  const valid = await hmacVerify(secret, payloadEncoded, signature);
  if (!valid) {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT",
      message: "Invalid gateway context signature",
      status: 401,
    });
  }

  let parsed: GatewayContext;
  try {
    const decoded = base64urlDecodeToString(payloadEncoded);
    parsed = JSON.parse(decoded) as GatewayContext;
  } catch {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT",
      message: "Invalid gateway context payload",
      status: 401,
    });
  }

  const expectedIssuer = options.issuer ?? "gmode-gateway";
  if (parsed.iss !== expectedIssuer) {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT",
      message: "Invalid gateway context issuer",
      status: 401,
    });
  }

  if (parsed.aud !== options.audience) {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT_AUDIENCE",
      message: "Invalid gateway context audience",
      status: 401,
    });
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 30;

  if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < now - skew) {
    throw new ApiError({
      code: "EXPIRED_GATEWAY_CONTEXT",
      message: "Gateway context expired",
      status: 401,
    });
  }

  if (
    typeof parsed.issuedAt === "number" &&
    parsed.issuedAt > now + skew
  ) {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT",
      message: "Gateway context issued in the future",
      status: 401,
    });
  }

  return parsed;
}
