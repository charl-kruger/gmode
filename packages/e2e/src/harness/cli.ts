import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { gmodeBin } from "./paths";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function assertExecutable(command: string): void {
  if (
    (command.includes("/") || command.startsWith(".")) &&
    !existsSync(command)
  ) {
    throw new Error(`Executable not found: ${command}`);
  }
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    try {
      assertExecutable(command);
    } catch (err) {
      reject(err);
      return;
    }
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function runGmode(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<CommandResult> {
  return runCommand(process.execPath, [gmodeBin(), ...args], cwd, {
    ...process.env,
    ...env,
  });
}
