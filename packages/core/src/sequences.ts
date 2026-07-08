/** One operation in an API Shield sequence rule. */
export type SequenceStep = {
  operationId: string;
  method?: string;
  endpoint?: string;
};

/** Action API Shield should take when a sequence is matched. */
export type SequenceAction = "log" | "block";

/** API Shield sequence rule definition. */
export type SequenceRule = {
  name: string;
  description?: string;
  pattern: SequenceStep[];
  action?: SequenceAction;
  withinSeconds?: number;
};

/** Validated set of API Shield sequence rules. */
export type SequencePolicy = {
  rules: SequenceRule[];
};

/**
 * Validate and define API Shield sequence rules.
 *
 * Throws when names are missing/duplicated, patterns have fewer than two
 * steps, or rules exceed Cloudflare's nine-step sequence limit.
 */
export function defineSequences(rules: SequenceRule[]): SequencePolicy {
  const names = new Set<string>();
  for (const rule of rules) {
    if (!rule.name || typeof rule.name !== "string") {
      throw new Error("Sequence rule is missing a string 'name'");
    }
    if (names.has(rule.name)) {
      throw new Error(`Duplicate sequence rule name: ${rule.name}`);
    }
    names.add(rule.name);
    if (!Array.isArray(rule.pattern) || rule.pattern.length < 2) {
      throw new Error(
        `Sequence rule "${rule.name}" must have at least 2 steps`,
      );
    }
    if (rule.pattern.length > 9) {
      throw new Error(
        `Sequence rule "${rule.name}" exceeds the 9-step Shield limit`,
      );
    }
    for (const step of rule.pattern) {
      if (!step.operationId) {
        throw new Error(
          `Sequence rule "${rule.name}" has a step missing operationId`,
        );
      }
    }
  }
  return { rules };
}
