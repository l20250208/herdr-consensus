import { spawnRunner, type Runner, type RunnerOptions, type SpawnResult } from "../spawn.js";
import {
  classifyErrorCode,
  HerdrError,
  type AgentInfo,
  type AgentStatus,
  type PromptInput,
  type PromptOutcome,
  type StartAgentInput,
  type WaitInput,
} from "./types.js";

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 600_000;
const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_GET_TIMEOUT_MS = 15_000;
const GRACE_MS = 5_000;
const DEFAULT_START_RETRY_DELAY_MS = 250;
const MAX_START_ATTEMPTS = 3;

export interface HerdrAgentAdapterOptions {
  /** Path to the `herdr` binary. Defaults to `HERDR_BIN_PATH` then `herdr`. */
  herdrBin?: string;
  /** Process runner; inject a fake in tests. Defaults to the real spawn runner. */
  run?: Runner;
  /** Extra environment passed to every herdr invocation (e.g. plugin context). */
  env?: Record<string, string | undefined>;
  /** Short delay between transient pane-shell readiness retries. */
  startRetryDelayMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStatus(value: unknown): AgentStatus {
  if (
    value === "idle" ||
    value === "working" ||
    value === "blocked" ||
    value === "done" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

interface AgentFields {
  agent?: unknown;
  name?: unknown;
  agent_status?: unknown;
  pane_id?: unknown;
  workspace_id?: unknown;
  tab_id?: unknown;
}

/** Accepts either `{agent: {...}}` (get/start) or the agent object directly. */
function unwrapAgent(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const candidate = (result as { agent?: unknown }).agent;
  if (isRecord(candidate)) return candidate;
  return result;
}

function agentFromResult(result: unknown): AgentInfo | null {
  const obj = unwrapAgent(result);
  if (!isRecord(obj)) return null;
  const raw = obj as AgentFields;
  if (typeof raw.agent !== "string") return null;
  return {
    name: typeof raw.name === "string" ? raw.name : raw.agent,
    status: normalizeStatus(raw.agent_status),
    paneId: typeof raw.pane_id === "string" ? raw.pane_id : null,
    workspaceId: typeof raw.workspace_id === "string" ? raw.workspace_id : null,
    tabId: typeof raw.tab_id === "string" ? raw.tab_id : null,
  };
}

function statusFromResult(result: unknown): AgentStatus {
  const agent = agentFromResult(result);
  if (agent !== null) return agent.status;
  if (isRecord(result)) {
    const status = (result as { agent_status?: unknown }).agent_status;
    if (typeof status === "string") return normalizeStatus(status);
  }
  return "unknown";
}

function agentsFromListResult(result: unknown): AgentInfo[] {
  if (!isRecord(result)) return [];
  const agents = (result as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return [];
  const list: AgentInfo[] = [];
  for (const item of agents) {
    const agent = agentFromResult(item);
    if (agent !== null) list.push(agent);
  }
  return list;
}

function extractPaneId(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const pane = (result as { pane?: unknown; root_pane?: unknown }).root_pane
    ?? (result as { pane?: unknown }).pane;
  if (!isRecord(pane)) return null;
  const paneId = (pane as { pane_id?: unknown }).pane_id;
  return typeof paneId === "string" ? paneId : null;
}

interface HerdrEnvelope {
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

function parseEnvelope(stdout: string): HerdrEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return parsed as HerdrEnvelope;
}

function firstLine(...texts: string[]): string {
  for (const text of texts) {
    const line = text.trim().split("\n")[0];
    if (line !== undefined && line !== "") return line;
  }
  return "";
}

export class HerdrAgentAdapter {
  private readonly herdrBin: string;
  private readonly run: Runner;
  private readonly env: Record<string, string | undefined>;
  private readonly startRetryDelayMs: number;

  constructor(options: HerdrAgentAdapterOptions = {}) {
    this.herdrBin = options.herdrBin ?? process.env.HERDR_BIN_PATH ?? "herdr";
    this.run = options.run ?? spawnRunner;
    this.env = options.env ?? {};
    this.startRetryDelayMs = options.startRetryDelayMs ?? DEFAULT_START_RETRY_DELAY_MS;
  }

  private runArgs(args: readonly string[], timeoutMs: number): Promise<SpawnResult> {
    const opts: RunnerOptions = { timeoutMs };
    if (Object.keys(this.env).length > 0) opts.env = this.env;
    return this.run([this.herdrBin, ...args], opts);
  }

  /** Runs a herdr command and returns its `result` payload, else throws HerdrError. */
  private async runHerdr(args: readonly string[], timeoutMs: number): Promise<unknown> {
    const result = await this.runArgs(args, timeoutMs);
    if (!result.ok) {
      if (result.timedOut === true) {
        throw new HerdrError("timeout", result.error, "timeout");
      }
      throw new HerdrError("spawn", `failed to run herdr: ${result.error}`);
    }

    const envelope = parseEnvelope(result.stdout) ?? parseEnvelope(result.stderr);
    if (envelope === null) {
      if (result.code !== 0) {
        throw new HerdrError(
          "protocol",
          `herdr exited ${result.code}: ${firstLine(result.stdout, result.stderr)}`,
        );
      }
      return null;
    }

    if (envelope.error !== undefined) {
      const code = typeof envelope.error.code === "string" ? envelope.error.code : null;
      const message = typeof envelope.error.message === "string" ? envelope.error.message : "herdr error";
      throw new HerdrError(classifyErrorCode(code), message, code);
    }

    return envelope.result ?? null;
  }

  async splitPane(input: { cwd: string; env?: Record<string, string> }): Promise<{ paneId: string }> {
    const args = ["tab", "create", "--no-focus", "--cwd", input.cwd, "--label", "Herdr Consensus"];
    for (const [key, value] of Object.entries(input.env ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      args.push("--env", `${key}=${value}`);
    }
    const result = await this.runHerdr(
      args,
      DEFAULT_GET_TIMEOUT_MS,
    );
    const paneId = extractPaneId(result);
    if (paneId === null) throw new HerdrError("protocol", "tab create returned no root pane id");
    return { paneId };
  }

  async listAgents(): Promise<AgentInfo[]> {
    const result = await this.runHerdr(["agent", "list"], DEFAULT_GET_TIMEOUT_MS);
    return agentsFromListResult(result);
  }

  async getAgent(target: string): Promise<AgentInfo> {
    const result = await this.runHerdr(["agent", "get", target], DEFAULT_GET_TIMEOUT_MS);
    const agent = agentFromResult(result);
    if (agent === null) throw new HerdrError("protocol", `agent get returned no agent info for ${target}`);
    return agent;
  }

  async startAgent(input: StartAgentInput): Promise<AgentInfo> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const args = [
        "agent",
        "start",
        input.name,
        "--kind",
        input.kind,
        "--pane",
        input.paneId,
        "--timeout",
        String(remainingMs),
      ];
      try {
        const result = await this.runHerdr(args, remainingMs + GRACE_MS);
        const agent = agentFromResult(result);
        if (agent === null) throw new HerdrError("protocol", "agent start returned no agent info");
        return agent;
      } catch (error) {
        const transientPaneReadiness = error instanceof HerdrError && error.message.includes("not an available shell");
        const hasRetryBudget = attempt < MAX_START_ATTEMPTS && Date.now() + this.startRetryDelayMs < deadline;
        if (!transientPaneReadiness || !hasRetryBudget) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, this.startRetryDelayMs));
      }
    }
    throw new HerdrError("timeout", `agent ${input.name} did not start before its timeout`, "timeout");
  }

  async wait(input: WaitInput): Promise<AgentStatus> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const args = ["agent", "wait", input.target, "--timeout", String(timeoutMs)];
    for (const status of input.until ?? []) args.push("--until", status);
    const result = await this.runHerdr(args, timeoutMs + GRACE_MS);
    return statusFromResult(result);
  }

  async prompt(input: PromptInput): Promise<PromptOutcome> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
    const args = ["agent", "prompt", input.target, input.text, "--wait", "--timeout", String(timeoutMs)];
    for (const status of input.until ?? []) args.push("--until", status);

    let output = "";
    const readOutput = async (): Promise<void> => {
      try {
        output = await this.read(input.target, { lines: 4000 });
      } catch {
        // Reading is best-effort context for the outcome.
      }
    };

    try {
      const result = await this.runHerdr(args, timeoutMs + GRACE_MS);
      const status = statusFromResult(result);
      await readOutput();
      if (status === "blocked") return { kind: "blocked", output };
      return { kind: "done", status, output };
    } catch (error) {
      if (error instanceof HerdrError) {
        switch (error.kind) {
          case "timeout":
            await readOutput();
            return { kind: "timed_out", output, message: error.message };
          case "stalled":
            await readOutput();
            return { kind: "stalled", output, message: error.message };
          case "exited":
            return { kind: "exited", message: error.message };
          default:
            throw error;
        }
      }
      throw error;
    }
  }

  async read(target: string, options: { lines?: number } = {}): Promise<string> {
    const args = ["agent", "read", target, "--source", "recent-unwrapped", "--format", "text"];
    if (options.lines !== undefined) args.push("--lines", String(options.lines));
    const result = await this.runArgs(args, DEFAULT_GET_TIMEOUT_MS);
    if (!result.ok) throw new HerdrError("spawn", `failed to run herdr read: ${result.error}`);
    if (result.code !== 0) {
      throw new HerdrError(
        "protocol",
        `herdr read exited ${result.code}: ${firstLine(result.stdout, result.stderr)}`,
      );
    }
    return result.stdout;
  }
}
