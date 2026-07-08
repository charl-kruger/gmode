import {
  base64urlEncodeString,
  hmacSign,
  signGatewayContext,
  type GatewayContext,
} from "@gmode/core";

export type TestJwtClaims = Record<string, unknown> & {
  sub?: string;
  exp?: number;
  iat?: number;
  scope?: string;
  scopes?: string[];
  permissions?: string[];
};

export async function createTestJwt(
  claims: TestJwtClaims,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullClaims: TestJwtClaims = {
    iat: now,
    exp: now + 3600,
    ...claims,
  };

  const headerB64 = base64urlEncodeString(JSON.stringify(header));
  const payloadB64 = base64urlEncodeString(JSON.stringify(fullClaims));
  const signature = await hmacSign(secret, `${headerB64}.${payloadB64}`);
  return `${headerB64}.${payloadB64}.${signature}`;
}

export async function createTestGatewayContext(
  context: Partial<GatewayContext> & { aud: string; requestId: string },
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: GatewayContext = {
    iss: "gmode-gateway",
    authenticated: false,
    scopes: [],
    permissions: [],
    issuedAt: now,
    expiresAt: now + 60,
    ...context,
  };
  return signGatewayContext(full, secret);
}

export { base64urlEncodeString } from "@gmode/core";
