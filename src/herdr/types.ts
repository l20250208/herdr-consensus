export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentInfo {
  name: string;
  status: AgentStatus;
  paneId: string | null;
  workspaceId: string | null;
  tabId: string | null;
}

export type AgentErrorKind =
  | "timeout"
  | "stalled"
  | "exited"
  | "spawn"
  | "protocol"
  | "unknown";

export class HerdrError extends Error {
  constructor(
    readonly kind: AgentErrorKind,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

/** Maps herdr CLI error codes to a small set of classified kinds. */
export function classifyErrorCode(code: string | null): AgentErrorKind {
  switch (code) {
    case "timeout":
      return "timeout";
    case "agent_prompt_stalled":
      return "stalled";
    case "agent_not_found":
      return "exited";
    default:
      return "unknown";
  }
}

export type PromptOutcome =
  | { kind: "done"; status: AgentStatus; output: string }
  | { kind: "blocked"; output: string }
  | { kind: "exited"; message: string }
  | { kind: "timed_out"; output: string; message: string }
  | { kind: "stalled"; output: string; message: string };

export interface StartAgentInput {
  name: string;
  kind: string;
  paneId: string;
  timeoutMs?: number;
}

export interface PromptInput {
  target: string;
  text: string;
  until?: AgentStatus[];
  timeoutMs?: number;
}

export interface WaitInput {
  target: string;
  until?: AgentStatus[];
  timeoutMs?: number;
}
