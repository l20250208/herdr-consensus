import { spawn, type ChildProcess, type SpawnOptions as NodeSpawnOptions } from "node:child_process";

export type SpawnResult =
  | { ok: true; code: number; stdout: string; stderr: string }
  | { ok: false; error: string; timedOut?: boolean };

export interface RunnerOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

/**
 * A process runner used to invoke external commands as argv arrays. The
 * production implementation is `spawnRunner`; tests inject a fake to keep
 * environment checks deterministic.
 */
export type Runner = (argv: readonly string[], options?: RunnerOptions) => Promise<SpawnResult>;

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Runs a command via `child_process.spawn` without a shell, so no shell
 * interpolation occurs. Captures stdout/stderr (capped), applies a timeout,
 * and distinguishes "could not spawn" (binary missing) from a non-zero exit.
 */
export function spawnRunner(argv: readonly string[], options: RunnerOptions = {}): Promise<SpawnResult> {
  const command = argv[0];
  if (command === undefined) {
    return Promise.resolve({ ok: false, error: "empty command" });
  }
  const args = argv.slice(1);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const spawnOptions: NodeSpawnOptions = { shell: false, stdio: ["ignore", "pipe", "pipe"] };
    if (options.cwd !== undefined) {
      spawnOptions.cwd = options.cwd;
    }
    if (options.env !== undefined) {
      spawnOptions.env = { ...process.env, ...options.env };
    }

    let child: ChildProcess;
    try {
      child = spawn(command, args, spawnOptions);
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result: SpawnResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({ ok: false, error: `timed out after ${timeoutMs}ms`, timedOut: true });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      settle({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({ ok: true, code: code ?? -1, stdout, stderr });
    });
  });
}
