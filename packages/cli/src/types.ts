import type { ShieldSchemaAction } from "@gmode/core";

export type CliShieldSchemaActionRule = {
  target: string;
  action: ShieldSchemaAction;
};

export type CliConfig = {
  cloudflare: {
    apiToken: string;
    zoneId: string;
    accountId?: string;
  };
  gateway?: {
    baseUrl?: string;
    specPath?: string;
  };
  shield?: {
    specFile?: string;
    sequences?: string;
    schemaActions?: CliShieldSchemaActionRule[];
  };
};

export type CliEnv = {
  cwd: string;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  exit: (code: number) => never;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
};

export type CommandRunner = (
  args: string[],
  cli: CliEnv,
) => Promise<number>;
