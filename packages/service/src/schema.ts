import { ApiError } from "@gmode/core";
import { z, type ZodTypeAny } from "zod";

/** Validation issue shape from the Standard Schema v1 contract. */
export type StandardSchemaIssue = {
  message: string;
  path?: readonly (PropertyKey | { key: PropertyKey })[];
};

/** Successful Standard Schema validation result. */
export type StandardSchemaSuccess<Output> = {
  value: Output;
  issues?: never;
};

/** Failed Standard Schema validation result. */
export type StandardSchemaFailure = {
  issues: readonly StandardSchemaIssue[];
  value?: never;
};

/** Result returned by a Standard Schema validator. */
export type StandardSchemaResult<Output> =
  | StandardSchemaSuccess<Output>
  | StandardSchemaFailure;

/**
 * Minimal Standard Schema v1 validator shape accepted by GMode services.
 *
 * Use `withJsonSchema()` when you also want OpenAPI generation for a
 * non-Zod validator.
 */
export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: Input,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
};

/** Standard Schema validator with explicit JSON Schema metadata for OpenAPI. */
export type JsonSchemaBackedStandardSchema<Output = unknown> =
  StandardSchemaV1<unknown, Output> & {
    readonly "~gmode": {
      readonly jsonSchema: Record<string, unknown>;
    };
  };

/** Schema formats accepted by service route validation and OpenAPI generation. */
export type GModeSchema<Output = unknown> =
  | ZodTypeAny
  | StandardSchemaV1<unknown, Output>
  | JsonSchemaBackedStandardSchema<Output>;

/**
 * Attach JSON Schema metadata to a Standard Schema validator.
 *
 * GMode can validate any Standard Schema v1 validator, but OpenAPI generation
 * needs JSON Schema. Zod schemas do not need this wrapper.
 */
export function withJsonSchema<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  jsonSchema: Record<string, unknown>,
): JsonSchemaBackedStandardSchema<Output> {
  return {
    ...schema,
    "~gmode": { jsonSchema },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return `true` when a value implements Standard Schema v1. */
export function isStandardSchema(
  schema: unknown,
): schema is StandardSchemaV1<unknown, unknown> {
  if (!isRecord(schema)) return false;
  const standard = schema["~standard"];
  if (!isRecord(standard)) return false;
  return (
    standard["version"] === 1 &&
    typeof standard["vendor"] === "string" &&
    typeof standard["validate"] === "function"
  );
}

/** Return `true` when a Standard Schema validator has GMode JSON Schema metadata. */
export function isJsonSchemaBackedStandardSchema(
  schema: unknown,
): schema is JsonSchemaBackedStandardSchema {
  if (!isStandardSchema(schema)) return false;
  const record = schema as Record<string, unknown>;
  const gmode = record["~gmode"];
  return isRecord(gmode) && isRecord(gmode["jsonSchema"]);
}

function isZodSchema(schema: unknown): schema is ZodTypeAny {
  return (
    isRecord(schema) &&
    typeof schema["parse"] === "function" &&
    typeof schema["safeParse"] === "function"
  );
}

function issuePathToString(issue: StandardSchemaIssue): string {
  if (!issue.path || issue.path.length === 0) return "";
  return issue.path
    .map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment
        ? String(segment.key)
        : String(segment),
    )
    .join(".");
}

function standardSchemaValidationError(
  schema: StandardSchemaV1<unknown, unknown>,
  issues: readonly StandardSchemaIssue[],
): ApiError {
  return new ApiError({
    code: "VALIDATION_ERROR",
    message: "Request validation failed",
    status: 400,
    details: {
      vendor: schema["~standard"].vendor,
      issues: issues.map((issue) => ({
        path: issuePathToString(issue),
        message: issue.message,
      })),
    },
  });
}

/**
 * Validate an unknown value with a GMode schema.
 *
 * Throws a structured `ApiError` for Standard Schema validation failures and
 * lets Zod throw its native `ZodError`.
 */
export async function parseSchema(
  schema: GModeSchema,
  value: unknown,
): Promise<unknown> {
  if (isZodSchema(schema)) {
    return schema.parse(value);
  }
  if (isStandardSchema(schema)) {
    const result = await schema["~standard"].validate(value);
    if ("issues" in result) {
      throw standardSchemaValidationError(schema, result.issues);
    }
    return result.value;
  }
  throw new Error("Unsupported GMode schema");
}

/**
 * Convert a route schema into JSON Schema for OpenAPI.
 *
 * Zod schemas are converted automatically. Standard Schema validators must be
 * wrapped with `withJsonSchema()` or this function throws.
 */
export function schemaToJsonSchema(
  schema: GModeSchema,
): Record<string, unknown> {
  if (isZodSchema(schema)) {
    return z.toJSONSchema(schema, {
      target: "draft-7",
      unrepresentable: "any",
    }) as Record<string, unknown>;
  }
  if (isJsonSchemaBackedStandardSchema(schema)) {
    return schema["~gmode"].jsonSchema;
  }
  if (isStandardSchema(schema)) {
    throw new ApiError({
      code: "UNSUPPORTED_SCHEMA_OPENAPI",
      message: `Standard Schema validator "${schema["~standard"].vendor}" cannot emit OpenAPI without withJsonSchema()`,
      status: 500,
    });
  }
  throw new ApiError({
    code: "UNSUPPORTED_SCHEMA",
    message: "Unsupported GMode schema",
    status: 500,
  });
}
