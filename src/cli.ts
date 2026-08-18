import pc from "picocolors";
import { pathToFileURL } from "node:url";
import { spawnRunner, type Runner } from "./spawn.js";
import { runDoctor } from "./env.js";
import { formatDoctorReport } from "./commands/doctor.js";
import { formatRunList, formatRunStatus } from "./commands/status.js";
import { formatResume } from "./commands/resume.js";
import { readFileSync, realpathSync } from "node:fs";
import { runDir as buildRunDir, stateRoot } from "./state/paths.js";
import { generateRunId } from "./state/run.js";
import { RunStore } from "./state/store.js";
import { HerdrAgentAdapter } from "./herdr/adapter.js";
import {
  ReviewCollector,
  type CollectedReview,
  type ReviewAgentGateway,
} from "./reports/collector.js";
import { importReports } from "./reports/import.js";
import { saveRawReports } from "./reports/storage.js";

export const PLUGIN_VERSION = "0.1.0";

export interface CliDeps {
  run: Runner;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** State directory override, used by tests to isolate run storage. */
  stateDir?: string;
  /** Review gateway override, used by tests to avoid launching real agents. */
  gateway?: ReviewAgentGateway;
}

export interface ParsedArgv {
  command: string | null;
  json: boolean;
  help: boolean;
  version: boolean;
  args: string[];
}

const PLANNED_STAGES: Record<string, string> = {
  validate: "stage 6 (P2 validation)",
  arbitrate: "stage 7 (third-AI arbitration)",
  decide: "stage 8 (decision wizard)",
  lock: "stage 9 (locked fix plan)",
  apply: "stage 10 (worktree fix)",
  report: "stage 11 (unified report)",
};

const USAGE = `herdr-consensus — multi-agent review consensus and human adjudication layer for Herdr

Usage:
  herdr-consensus <command> [options]
  herdr-consensus --help
  herdr-consensus --version

Commands:
  doctor       Check Herdr, Node.js, Git and agent availability
  start        Start a new consensus review
  import       Import two existing reports
  status       Show run status
  resume       Resume a run
  validate     Run P2 validation                     (not implemented)
  arbitrate    Run third-AI arbitration              (not implemented)
  decide       Open the decision wizard               (not implemented)
  lock         Lock the fix plan                     (not implemented)
  apply        Apply the locked fix plan             (not implemented)
  report       Export the unified report             (not implemented)

Options:
  --json        Emit machine-readable JSON
  -h, --help    Show this help
  -V, --version Show version
`;

export function parseArgv(argv: readonly string[]): ParsedArgv {
  let command: string | null = null;
  let json = false;
  let help = false;
  let version = false;
  const args: string[] = [];
  for (const token of argv) {
    if (token === "--json") json = true;
    else if (token === "-h" || token === "--help") help = true;
    else if (token === "-V" || token === "--version") version = true;
    else if (command === null && !token.startsWith("-")) command = token;
    else args.push(token);
  }
  return { command, json, help, version, args };
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseArgv(argv);
  if (parsed.help) {
    deps.stdout(USAGE);
    return 0;
  }
  if (parsed.version) {
    deps.stdout(`${PLUGIN_VERSION}\n`);
    return 0;
  }
  if (parsed.command === null) {
    deps.stderr(USAGE);
    return 2;
  }

  if (parsed.command === "doctor") {
    const report = await runDoctor(deps.run);
    if (parsed.json) {
      deps.stdout(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      deps.stdout(formatDoctorReport(report));
    }
    return report.ok ? 0 : 1;
  }

  if (parsed.command === "status") {
    return runStatusCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "resume") {
    return runResumeCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "start") {
    return runStartCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "import") {
    return runImportCommand(parsed.args, parsed.json, deps);
  }

  const planned = PLANNED_STAGES[parsed.command];
  if (planned !== undefined) {
    deps.stderr(`${pc.yellow(`"${parsed.command}" is not implemented yet`)} (${planned}).\n`);
    return 2;
  }

  deps.stderr(`${pc.red(`unknown command: ${parsed.command}`)}\n`);
  deps.stderr(USAGE);
  return 2;
}

function makeStore(deps: CliDeps): RunStore {
  return new RunStore(deps.stateDir ?? stateRoot());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runStatusCommand(
  args: readonly string[],
  json: boolean,
  deps: CliDeps,
): Promise<number> {
  const store = makeStore(deps);
  const runId = args[0];
  if (runId === undefined) {
    const runs = await store.listRuns();
    deps.stdout(json ? `${JSON.stringify(runs, null, 2)}\n` : formatRunList(runs));
    return 0;
  }
  try {
    const run = await store.findRunById(runId);
    if (run === null) {
      deps.stderr(`no run found with id ${runId}\n`);
      return 1;
    }
    deps.stdout(json ? `${JSON.stringify(run, null, 2)}\n` : formatRunStatus(run));
    return 0;
  } catch (error) {
    deps.stderr(`failed to load run ${runId}: ${errorMessage(error)}\n`);
    return 1;
  }
}

async function runResumeCommand(
  args: readonly string[],
  json: boolean,
  deps: CliDeps,
): Promise<number> {
  const store = makeStore(deps);
  const runId = args[0];
  if (runId === undefined) {
    const runs = await store.listRuns();
    deps.stderr("resume requires a run id\n");
    deps.stderr(formatRunList(runs));
    return 2;
  }
  try {
    const run = await store.findRunById(runId);
    if (run === null) {
      deps.stderr(`no run found with id ${runId}\n`);
      return 1;
    }
    deps.stdout(json ? `${JSON.stringify(run, null, 2)}\n` : formatResume(run));
    return 0;
  } catch (error) {
    deps.stderr(`failed to load run ${runId}: ${errorMessage(error)}\n`);
    return 1;
  }
}

function parseAgentFlags(args: readonly string[]): { agentA: string | null; agentB: string | null } {
  let agentA: string | null = null;
  let agentB: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "--agent-a") {
      const next = args[i + 1];
      if (next !== undefined) {
        agentA = next;
        i++;
      }
    } else if (token === "--agent-b") {
      const next = args[i + 1];
      if (next !== undefined) {
        agentB = next;
        i++;
      }
    }
  }
  return { agentA, agentB };
}

function formatCollectSummary(runId: string, result: CollectedReview): string {
  const lines = [`Started review ${pc.cyan(runId)}`];
  for (const outcome of result.outcomes) {
    const mark =
      outcome.kind === "collected"
        ? pc.green(outcome.kind)
        : outcome.kind === "blocked" || outcome.kind === "invalid"
          ? pc.yellow(outcome.kind)
          : pc.red(outcome.kind);
    const detail = outcome.detail !== null ? ` — ${outcome.detail}` : "";
    lines.push(`  ${outcome.slot}: ${mark}${detail}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function runStartCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const { agentA, agentB } = parseAgentFlags(args);
  if (agentA === null || agentB === null) {
    deps.stderr("start requires --agent-a <kind> and --agent-b <kind>\n");
    return 2;
  }
  if (agentA === agentB) {
    deps.stderr("start requires two different agents\n");
    return 2;
  }

  const root = deps.stateDir ?? stateRoot();
  const store = new RunStore(root);
  const projectPath = realpathSync(process.cwd());
  const runId = generateRunId();
  await store.createRun({ runId, projectPath });
  await store.transition(runId, "reviewing");

  const gateway = deps.gateway ?? new HerdrAgentAdapter({ run: deps.run });
  const collector = new ReviewCollector(gateway);
  const result = await collector.collect({
    projectPath,
    cwd: process.cwd(),
    sources: [
      { slot: "a", kind: agentA, name: "reviewer-a" },
      { slot: "b", kind: agentB, name: "reviewer-b" },
    ],
  });

  const run = await store.findRunById(runId);
  if (run !== null) {
    await saveRawReports(buildRunDir(root, run.projectHash, run.runId), result.artifacts);
  }

  if (json) {
    deps.stdout(
      `${JSON.stringify({ runId, contractVersion: result.contractVersion, outcomes: result.outcomes }, null, 2)}\n`,
    );
  } else {
    deps.stdout(formatCollectSummary(runId, result));
  }

  return result.outcomes.every((outcome) => outcome.kind === "collected") ? 0 : 1;
}

async function runImportCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const { agentA, agentB } = parseAgentFlags(args);
  if (agentA === null || agentB === null) {
    deps.stderr("import requires --agent-a <file> and --agent-b <file>\n");
    return 2;
  }

  let contentA: string;
  let contentB: string;
  try {
    contentA = readFileSync(agentA, "utf8");
    contentB = readFileSync(agentB, "utf8");
  } catch (error) {
    deps.stderr(`failed to read report: ${errorMessage(error)}\n`);
    return 1;
  }

  const root = deps.stateDir ?? stateRoot();
  const store = new RunStore(root);
  const projectPath = realpathSync(process.cwd());
  const runId = generateRunId();
  await store.createRun({ runId, projectPath });
  await store.transition(runId, "reviewing");

  const artifacts = importReports({ a: contentA, b: contentB });
  const run = await store.findRunById(runId);
  if (run !== null) {
    await saveRawReports(buildRunDir(root, run.projectHash, run.runId), artifacts);
  }

  if (json) {
    deps.stdout(
      `${JSON.stringify({ runId, artifacts: { a: artifacts.a.sha256, b: artifacts.b.sha256 } }, null, 2)}\n`,
    );
  } else {
    deps.stdout(`Imported review ${pc.cyan(runId)} (2 reports)\n`);
  }
  return 0;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  const deps: CliDeps = {
    run: spawnRunner,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
  void main(process.argv.slice(2), deps).then((code) => {
    process.exitCode = code;
  });
}
