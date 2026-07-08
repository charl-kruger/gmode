import { ApiError } from "@gmode/core";
import type { GatewayMiddleware } from "../types";

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

export type MtlsOptions<Env> = {
  required?: boolean;
  accept?: (cert: MtlsCertInfo) => boolean;
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
