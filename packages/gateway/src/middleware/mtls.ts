import { ApiError } from "@gmode/core";
import type { GatewayMiddleware } from "../types";

/** Cloudflare `request.cf.tlsClientAuth` fields used by the mTLS middleware. */
export type MtlsCertInfo = {
  certVerified: string;
  certPresented: string;
  certFingerprintSHA1?: string;
  certFingerprintSHA256?: string;
  certSubjectDN?: string;
  certIssuerDN?: string;
  certSerial?: string;
  certNotBefore?: string;
  certNotAfter?: string;
  certRevoked?: string;
};

/** Options for validating Cloudflare-provided client certificate metadata. */
export type MtlsOptions<Env> = {
  /** Whether a missing client certificate fails the request. Defaults to `true`. */
  required?: boolean;
  /** Return `true` when the presented certificate should be accepted. */
  accept?: (cert: MtlsCertInfo) => boolean;
  /** Hook invoked after a certificate is accepted and added to request state. */
  onAccepted?: (
    cert: MtlsCertInfo,
    ctx: import("../types").GatewayRequestContext<Env>,
  ) => void | Promise<void>;
};

function readCertFromRequest(request: Request): MtlsCertInfo | undefined {
  const cf = (request as Request & { cf?: unknown }).cf as
    | { tlsClientAuth?: MtlsCertInfo }
    | undefined;
  if (!cf || typeof cf.tlsClientAuth !== "object" || !cf.tlsClientAuth) {
    return undefined;
  }
  return cf.tlsClientAuth;
}

/**
 * Require and validate Cloudflare mTLS client certificate metadata.
 *
 * Cloudflare must be configured to request client certificates for this to
 * work; the middleware reads `request.cf.tlsClientAuth`.
 */
export function mtls<Env>(
  options: MtlsOptions<Env> = {},
): GatewayMiddleware<Env> {
  const required = options.required ?? true;
  const accept =
    options.accept ?? ((cert) => cert.certVerified === "SUCCESS");

  return async (context, next) => {
    const cert = readCertFromRequest(context.request);
    if (!cert) {
      if (required) {
        throw new ApiError({
          code: "MTLS_REQUIRED",
          message: "Client certificate required",
          status: 401,
        });
      }
      return next();
    }

    if (!accept(cert)) {
      throw new ApiError({
        code: "MTLS_INVALID",
        message: "Client certificate not accepted",
        status: 403,
        details: {
          certVerified: cert.certVerified,
          certPresented: cert.certPresented,
        },
      });
    }

    context.state.set("gmode.mtls", cert);
    context.auth = {
      ...context.auth,
      raw: {
        ...((context.auth.raw as Record<string, unknown> | undefined) ?? {}),
        mtls: cert,
      },
    };

    if (options.onAccepted) await options.onAccepted(cert, context);

    return next();
  };
}
