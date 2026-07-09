import { existsSync } from "node:fs";
import { type ChildProcess, spawn } from "node:child_process";

export type ManagedProcess = {
  name: string;
  child: ChildProcess;
  logs: string[];
  stop: () => Promise<void>;
};

export function spawnManaged(input: {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}): ManagedProcess {
  if (
    (input.command.includes("/") || input.command.startsWith(".")) &&
    !existsSync(input.command)
  ) {
    throw new Error(`Executable not found: ${input.command}`);
  }
  const logs: string[] = [];
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: { ...process.env, FORCE_COLOR: "0", ...input.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const append = (chunk: Buffer) => {
    logs.push(chunk.toString("utf8"));
    if (logs.length > 200) logs.shift();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  return {
    name: input.name,
    child,
    logs,
    stop: () => stopChild(child, input.name),
  };
}

async function stopChild(child: ChildProcess, name: string): Promise<void> {
  if (child.exitCode !== null || child.killed) return;

  await new Promise<void>((resolve) => {
    const pid = child.pid;
    const timer = setTimeout(() => {
      if (pid) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      resolve();
    }, 8000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    if (pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else {
      child.kill("SIGTERM");
    }
  }).catch(() => {
    // Best-effort shutdown.
    void name;
  });
}

export async function stopAll(processes: ManagedProcess[]): Promise<void> {
  await Promise.all(processes.map((p) => p.stop()));
}
