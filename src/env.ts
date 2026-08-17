import { parseSemver, satisfiesMinimum, type SemVer } from "./version.js";
import type { Runner, SpawnResult } from "./spawn.js";

export interface BinaryReport {
  found: boolean;
  version: string | null;
  error: string | null;
}

export interface NodeReport extends BinaryReport {
  minimum: string;
  meetsMinimum: boolean;
}

export interface AgentReport {
  name: string;
  status: string;
  paneId: string | null;
  workspaceId: string | null;
}

export interface AgentsReport {
  detected: boolean;
  error: string | null;
  list: AgentReport[];
}

export interface DoctorReport {
  ok: boolean;
  node: NodeReport;
  git: BinaryReport;
  herdr: BinaryReport;
  agents: AgentsReport;
  issues: string[];
  warnings: string[];
}

const NODE_MINIMUM: SemVer = { major: 20, minor: 0, patch: 0 };

function formatSemver(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

async function probeVersion(run: Runner, argv: readonly string[]): Promise<BinaryReport> {
  const result: SpawnResult = await run(argv);
  if (!result.ok) return { found: false, version: null, error: result.error };
  if (result.code !== 0) return { found: false, version: null, error: `exited with code ${result.code}` };
  const version = result.stdout.trim();
  if (version === "") return { found: true, version: null, error: "no version output" };
  return { found: true, version, error: null };
}

async function probeNode(run: Runner): Promise<NodeReport> {
  const base = await probeVersion(run, ["node", "--version"]);
  const parsed = base.version === null ? null : parseSemver(base.version);
  const meetsMinimum = parsed !== null && satisfiesMinimum(parsed, NODE_MINIMUM);
  return { ...base, minimum: formatSemver(NODE_MINIMUM), meetsMinimum };
}

interface HerdrAgentEntry {
  agent?: unknown;
  agent_status?: unknown;
  pane_id?: unknown;
  workspace_id?: unknown;
}

function extractAgents(value: unknown): AgentReport[] | null {
  if (typeof value !== "object" || value === null) return null;
  const result = (value as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return null;
  const agents = (result as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return null;

  const list: AgentReport[] = [];
  for (const item of agents) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as HerdrAgentEntry;
    if (typeof raw.agent !== "string") continue;
    list.push({
      name: raw.agent,
      status: typeof raw.agent_status === "string" ? raw.agent_status : "unknown",
      paneId: typeof raw.pane_id === "string" ? raw.pane_id : null,
      workspaceId: typeof raw.workspace_id === "string" ? raw.workspace_id : null,
    });
  }
  return list;
}

function parseAgentList(stdout: string): AgentsReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return { detected: false, error: "could not parse `herdr agent list` output as JSON", list: [] };
  }
  const agents = extractAgents(parsed);
  if (agents === null) {
    return { detected: false, error: "unexpected `herdr agent list` response shape", list: [] };
  }
  return { detected: true, error: null, list: agents };
}

async function probeAgents(run: Runner, herdrFound: boolean): Promise<AgentsReport> {
  if (!herdrFound) {
    return { detected: false, error: "Herdr is missing, so agents cannot be enumerated", list: [] };
  }
  const result = await run(["herdr", "agent", "list"]);
  if (!result.ok) return { detected: false, error: result.error, list: [] };
  if (result.code !== 0) {
    return { detected: false, error: `\`herdr agent list\` exited with code ${result.code}`, list: [] };
  }
  return parseAgentList(result.stdout);
}

/**
 * Runs the `doctor` environment preflight. Detects Node.js, Git, Herdr and the
 * agents Herdr currently reports. Missing or outdated requirements become
 * `issues` (flipping `ok` to false); agent enumeration problems are soft
 * `warnings` because a review can still start with no agents running yet.
 */
export async function runDoctor(run: Runner): Promise<DoctorReport> {
  const [node, git, herdr] = await Promise.all([
    probeNode(run),
    probeVersion(run, ["git", "--version"]),
    probeVersion(run, ["herdr", "--version"]),
  ]);
  const agents = await probeAgents(run, herdr.found);

  const issues: string[] = [];
  if (!node.found) {
    issues.push("Node.js is not available");
  } else if (!node.meetsMinimum) {
    issues.push(`Node.js ${node.version ?? "unknown"} is older than the required ${node.minimum}`);
  }
  if (!git.found) issues.push("Git is not available");
  if (!herdr.found) issues.push("Herdr is not available");

  const warnings: string[] = [];
  if (herdr.found && !agents.detected) {
    warnings.push(`could not enumerate agents: ${agents.error ?? "unknown reason"}`);
  } else if (agents.detected && agents.list.length === 0) {
    warnings.push("Herdr reports no running agents");
  }

  return { ok: issues.length === 0, node, git, herdr, agents, issues, warnings };
}
