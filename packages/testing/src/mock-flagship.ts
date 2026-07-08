import type {
  FlagshipBinding,
  FlagshipDetails,
  FlagshipEvaluationContext,
} from "@gmode/core";

export type MockFlagshipInitial = {
  booleans?: Record<string, boolean>;
  strings?: Record<string, string>;
  numbers?: Record<string, number>;
  objects?: Record<string, unknown>;
  errors?: Record<string, FlagshipDetails<unknown>["errorCode"]>;
};

export type MockFlagshipCall = {
  method: string;
  key: string;
  defaultValue?: unknown;
  context?: FlagshipEvaluationContext | undefined;
};

export type MockFlagship = FlagshipBinding & {
  readonly calls: MockFlagshipCall[];
  setBoolean(key: string, value: boolean): void;
  setString(key: string, value: string): void;
  setNumber(key: string, value: number): void;
  setObject<T>(key: string, value: T): void;
  setError(
    key: string,
    code: FlagshipDetails<unknown>["errorCode"],
  ): void;
  clear(key: string): void;
  reset(): void;
};

export function createMockFlagship(
  initial: MockFlagshipInitial = {},
): MockFlagship {
  const booleans = new Map(Object.entries(initial.booleans ?? {}));
  const strings = new Map(Object.entries(initial.strings ?? {}));
  const numbers = new Map(Object.entries(initial.numbers ?? {}));
  const objects = new Map<string, unknown>(
    Object.entries(initial.objects ?? {}),
  );
  const errors = new Map<string, FlagshipDetails<unknown>["errorCode"]>(
    Object.entries(initial.errors ?? {}),
  );

  const initialSnapshot: MockFlagshipInitial = {
    booleans: { ...(initial.booleans ?? {}) },
    strings: { ...(initial.strings ?? {}) },
    numbers: { ...(initial.numbers ?? {}) },
    objects: { ...(initial.objects ?? {}) },
    errors: { ...(initial.errors ?? {}) },
  };

  const calls: MockFlagshipCall[] = [];

  function record(call: MockFlagshipCall): void {
    calls.push(call);
  }

  function detailsFor<T>(
    key: string,
    storedValue: T | undefined,
    defaultValue: T,
  ): FlagshipDetails<T> {
    const errorCode = errors.get(key);
    if (errorCode) {
      return { flagKey: key, value: defaultValue, errorCode };
    }
    if (storedValue === undefined) {
      return { flagKey: key, value: defaultValue, reason: "DEFAULT" };
    }
    return {
      flagKey: key,
      value: storedValue,
      reason: "TARGETING_MATCH",
    };
  }

  function valueFor<T>(key: string, storedValue: T | undefined, defaultValue: T): T {
    return detailsFor(key, storedValue, defaultValue).value;
  }

  return {
    calls,
    setBoolean(key, value) {
      booleans.set(key, value);
    },
    setString(key, value) {
      strings.set(key, value);
    },
    setNumber(key, value) {
      numbers.set(key, value);
    },
    setObject<T>(key: string, value: T) {
      objects.set(key, value);
    },
    setError(key, code) {
      errors.set(key, code);
    },
    clear(key) {
      booleans.delete(key);
      strings.delete(key);
      numbers.delete(key);
      objects.delete(key);
      errors.delete(key);
    },
    reset() {
      calls.length = 0;
      booleans.clear();
      strings.clear();
      numbers.clear();
      objects.clear();
      errors.clear();
      for (const [k, v] of Object.entries(initialSnapshot.booleans ?? {})) {
        booleans.set(k, v);
      }
      for (const [k, v] of Object.entries(initialSnapshot.strings ?? {})) {
        strings.set(k, v);
      }
      for (const [k, v] of Object.entries(initialSnapshot.numbers ?? {})) {
        numbers.set(k, v);
      }
      for (const [k, v] of Object.entries(initialSnapshot.objects ?? {})) {
        objects.set(k, v);
      }
      for (const [k, v] of Object.entries(initialSnapshot.errors ?? {})) {
        errors.set(k, v);
      }
    },

    async get(key, defaultValue, context) {
      record({ method: "get", key, defaultValue, context });
      if (booleans.has(key)) return booleans.get(key);
      if (strings.has(key)) return strings.get(key);
      if (numbers.has(key)) return numbers.get(key);
      if (objects.has(key)) return objects.get(key);
      return defaultValue;
    },

    async getBooleanValue(key, defaultValue, context) {
      record({ method: "getBooleanValue", key, defaultValue, context });
      return valueFor(key, booleans.get(key), defaultValue);
    },
    async getStringValue(key, defaultValue, context) {
      record({ method: "getStringValue", key, defaultValue, context });
      return valueFor(key, strings.get(key), defaultValue);
    },
    async getNumberValue(key, defaultValue, context) {
      record({ method: "getNumberValue", key, defaultValue, context });
      return valueFor(key, numbers.get(key), defaultValue);
    },
    async getObjectValue<T extends object>(
      key: string,
      defaultValue: T,
      context?: FlagshipEvaluationContext,
    ): Promise<T> {
      record({ method: "getObjectValue", key, defaultValue, context });
      return valueFor(key, objects.get(key) as T | undefined, defaultValue);
    },

    async getBooleanDetails(key, defaultValue, context) {
      record({ method: "getBooleanDetails", key, defaultValue, context });
      return detailsFor(key, booleans.get(key), defaultValue);
    },
    async getStringDetails(key, defaultValue, context) {
      record({ method: "getStringDetails", key, defaultValue, context });
      return detailsFor(key, strings.get(key), defaultValue);
    },
    async getNumberDetails(key, defaultValue, context) {
      record({ method: "getNumberDetails", key, defaultValue, context });
      return detailsFor(key, numbers.get(key), defaultValue);
    },
    async getObjectDetails<T extends object>(
      key: string,
      defaultValue: T,
      context?: FlagshipEvaluationContext,
    ): Promise<FlagshipDetails<T>> {
      record({ method: "getObjectDetails", key, defaultValue, context });
      return detailsFor(key, objects.get(key) as T | undefined, defaultValue);
    },
  };
}
