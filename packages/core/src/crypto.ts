import { ApiError } from "./errors";
import type { GatewayContext } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encode bytes as unpadded base64url. */
export function base64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8 encode a string as unpadded base64url. */
export function base64urlEncodeString(value: string): string {
  return base64urlEncode(encoder.encode(value));
}

/** Decode unpadded base64url into bytes. */
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

/** Decode unpadded base64url into a UTF-8 string. */
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

/** Sign arbitrary data with HMAC-SHA256 and return unpadded base64url. */
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

/** Verify an HMAC-SHA256 base64url signature for arbitrary data. */
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

/**
 * Encode private gateway context for a downstream Service Binding request.
 *
 * This is intentionally not a public auth token. It is used after the gateway
 * has selected a private Worker binding and is paired with
 * `decodeGatewayContext()` on the service side.
 *
 * Prefer `encodeSignedGatewayContext()` when a shared context secret is
 * configured; unsigned tokens rely entirely on Service Bindings staying
 * private.
 */
export function encodeGatewayContext(context: GatewayContext): string {
  return base64urlEncodeString(JSON.stringify(context));
}

/**
 * Encode and HMAC-SHA256 sign private gateway context.
 *
 * Format is `base64url(payload) + "." + base64url(hmacSha256(payload))`.
 * Services verify with `verifyGatewayContext()` using the same secret.
 */
export async function encodeSignedGatewayContext(
  context: GatewayContext,
  secret: string,
): Promise<string> {
  const payload = base64urlEncodeString(JSON.stringify(context));
  const signature = await hmacSign(secret, payload);
  return `${payload}.${signature}`;
}

/** Options for decoding private gateway context. */
export type DecodeGatewayContextOptions = {
  /** Expected downstream service audience. */
  audience: string;
  /** Expected issuer. Defaults to `gmode-gateway`. */
  issuer?: "gmode-gateway";
  /** Current unix timestamp override, useful for tests. */
  now?: number;
  /** Allowed clock skew in seconds. Defaults to `30`. */
  clockSkewSeconds?: number;
};

function invalidGatewayContext(message: string): ApiError {
  return new ApiError({
    code: "INVALID_GATEWAY_CONTEXT",
    message,
    status: 401,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  throw invalidGatewayContext(`Invalid gateway context ${key}`);
}

function parseGatewayUser(value: unknown): NonNullable<GatewayContext["user"]> {
  if (!isRecord(value)) {
    throw invalidGatewayContext("Invalid gateway context user");
  }
  const id = value["id"];
  if (typeof id !== "string") {
    throw invalidGatewayContext("Invalid gateway context user id");
  }
  const user: NonNullable<GatewayContext["user"]> = { id };
  const email = readOptionalString(value, "email");
  if (email !== undefined) user.email = email;
  const name = readOptionalString(value, "name");
  if (name !== undefined) user.name = name;
  const claims = value["claims"];
  if (claims !== undefined) {
    if (!isRecord(claims)) {
      throw invalidGatewayContext("Invalid gateway context user claims");
    }
    user.claims = claims;
  }
  return user;
}

function parseGatewayTenant(
  value: unknown,
): NonNullable<GatewayContext["tenant"]> {
  if (!isRecord(value)) {
    throw invalidGatewayContext("Invalid gateway context tenant");
  }
  const id = value["id"];
  if (typeof id !== "string") {
    throw invalidGatewayContext("Invalid gateway context tenant id");
  }
  const tenant: NonNullable<GatewayContext["tenant"]> = { id };
  const slug = readOptionalString(value, "slug");
  if (slug !== undefined) tenant.slug = slug;
  return tenant;
}

function parseGatewayContextValue(value: unknown): GatewayContext {
  if (!isRecord(value)) {
    throw invalidGatewayContext("Invalid gateway context payload");
  }

  const iss = value["iss"];
  const aud = value["aud"];
  const requestId = value["requestId"];
  const authenticated = value["authenticated"];
  const scopes = value["scopes"];
  const permissions = value["permissions"];
  const issuedAt = value["issuedAt"];
  const expiresAt = value["expiresAt"];

  if (iss !== "gmode-gateway") {
    throw invalidGatewayContext("Invalid gateway context issuer");
  }
  if (typeof aud !== "string") {
    throw invalidGatewayContext("Invalid gateway context audience");
  }
  if (typeof requestId !== "string") {
    throw invalidGatewayContext("Invalid gateway context request id");
  }
  if (typeof authenticated !== "boolean") {
    throw invalidGatewayContext("Invalid gateway context authentication state");
  }
  if (!isStringArray(scopes)) {
    throw invalidGatewayContext("Invalid gateway context scopes");
  }
  if (!isStringArray(permissions)) {
    throw invalidGatewayContext("Invalid gateway context permissions");
  }
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    throw invalidGatewayContext("Invalid gateway context issue time");
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw invalidGatewayContext("Invalid gateway context expiry");
  }

  const context: GatewayContext = {
    iss,
    aud,
    requestId,
    authenticated,
    scopes,
    permissions,
    issuedAt,
    expiresAt,
  };

  if (value["user"] !== undefined) {
    context.user = parseGatewayUser(value["user"]);
  }
  if (value["tenant"] !== undefined) {
    context.tenant = parseGatewayTenant(value["tenant"]);
  }
  if (value["flags"] !== undefined) {
    if (!isRecord(value["flags"])) {
      throw invalidGatewayContext("Invalid gateway context flags");
    }
    context.flags = value["flags"];
  }

  return context;
}

function decodePayloadSegment(payload: string): GatewayContext {
  try {
    const decoded = base64urlDecodeToString(payload);
    return parseGatewayContextValue(JSON.parse(decoded));
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT",
      message: "Invalid gateway context payload",
      status: 401,
    });
  }
}

function validateGatewayContextClaims(
  parsed: GatewayContext,
  options: DecodeGatewayContextOptions,
): GatewayContext {
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

/**
 * Decode and validate an unsigned private gateway context token.
 *
 * Throws `ApiError` when the payload shape, issuer, audience, issued time, or
 * expiry is invalid. Signed tokens (containing a `.` signature segment) are
 * rejected; use `verifyGatewayContext()` to support both formats.
 */
export function decodeGatewayContext(
  token: string,
  options: DecodeGatewayContextOptions,
): GatewayContext {
  const parsed = decodePayloadSegment(token);
  return validateGatewayContextClaims(parsed, options);
}

/** Options for verifying private gateway context, signed or unsigned. */
export type VerifyGatewayContextOptions = DecodeGatewayContextOptions & {
  /**
   * Shared HMAC secret. When set, signed tokens are verified against it and
   * unsigned tokens are rejected unless `allowUnsigned` is `true`.
   */
  secret?: string;
  /** Accept unsigned tokens even when `secret` is configured. Defaults to `false`. */
  allowUnsigned?: boolean;
};

/**
 * Verify and decode private gateway context, supporting signed tokens.
 *
 * - Signed token (`payload.signature`) with `secret`: HMAC verified, then decoded.
 * - Signed token without `secret`: rejected — the service is missing its secret.
 * - Unsigned token with `secret`: rejected unless `allowUnsigned` is `true`.
 * - Unsigned token without `secret`: decoded like `decodeGatewayContext()`.
 */
export async function verifyGatewayContext(
  token: string,
  options: VerifyGatewayContextOptions,
): Promise<GatewayContext> {
  const dot = token.indexOf(".");
  if (dot === -1) {
    if (options.secret && options.allowUnsigned !== true) {
      throw new ApiError({
        code: "UNSIGNED_GATEWAY_CONTEXT",
        message:
          "Gateway context is unsigned but this service requires a signed context",
        status: 401,
      });
    }
    return decodeGatewayContext(token, options);
  }

  if (!options.secret) {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT",
      message:
        "Gateway context is signed but no context secret is configured on this service",
      status: 401,
    });
  }

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const valid = await hmacVerify(options.secret, payload, signature);
  if (!valid) {
    throw new ApiError({
      code: "INVALID_GATEWAY_CONTEXT_SIGNATURE",
      message: "Gateway context signature verification failed",
      status: 401,
    });
  }

  const parsed = decodePayloadSegment(payload);
  return validateGatewayContextClaims(parsed, options);
}
