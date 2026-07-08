export type SequenceStep = {
  operationId: string;
  method?: string;
  endpoint?: string;
};

export type SequenceAction = "log" | "block";

export type SequenceRule = {
  name: string;
  description?: string;
  pattern: SequenceStep[];
  action?: SequenceAction;
  withinSeconds?: number;
};

export type SequencePolicy = {
  rules: SequenceRule[];
};

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
