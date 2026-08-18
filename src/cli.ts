import pc from "picocolors";
import { fileURLToPath } from "node:url";
import { spawnRunner, type Runner } from "./spawn.js";
import { runDoctor } from "./env.js";
import { formatDoctorReport } from "./commands/doctor.js";
import { formatRunList, formatRunStatus } from "./commands/status.js";
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import type { ConsensusItem } from "./consensus/types.js";
import { detectValidationCommand, planP2Validations } from "./validation/planner.js";
import { checkValidationCommandSafety } from "./validation/safety.js";
import { executeValidation } from "./validation/runner.js";
import type { NormalizedFinding } from "./consensus/types.js";
import { buildArbitrationPrompt } from "./arbitration/prompt.js";
import { buildArbitrationRepairPrompt, parseArbitrationAdvice } from "./arbitration/parser.js";
import { assessIndependence } from "./arbitration/provenance.js";
import type { ArbitrationRunMetadata } from "./arbitration/types.js";
import type { UserDecisionValue, UserDecision } from "./decisions/types.js";
import { evidenceSnapshotSha256 } from "./decisions/snapshot.js";
import { loadDecisions, saveDecisions, upsertDecision } from "./decisions/store.js";
import { generateLockedFixPlan, renderFixPlanMarkdown } from "./fix-plan/generate.js";
import { saveFixPlanVersion } from "./fix-plan/store.js";
import { verifyLockedFixPlanIntegrity } from "./fix-plan/verify.js";
import { ensureCleanGitWorktree, createFixWorktree } from "./apply/git.js";
import { buildImplementationPrompt } from "./apply/prompt.js";
import { listChangedPaths, readHeadCommit, runTargetedChecks, verifyAllowedPaths } from "./apply/verify.js";
import { computeWorkspaceSnapshotSha256 } from "./apply/snapshot.js";
import type { ValidationRecord } from "./validation/types.js";
import { buildUnifiedReport, collectGitDiffSummary, renderUnifiedReportMarkdown, runRegression } from "./reporting/generate.js";
import { processReview } from "./workflow/process-review.js";
import { requireArtifacts, requireRunStage } from "./workflow/guards.js";
import { resumeRun } from "./workflow/resume.js";
import { defaultPromptAdapter, type PromptAdapter } from "./ui/prompts.js";
import { runDecisionWizard } from "./ui/decision-wizard.js";
import { loadRawReports } from "./reports/storage.js";
import { writeJsonAtomic } from "./state/json.js";
import {
  ArbitrationAdviceArtifactSchema,
  ArbitrationMetadataArtifactSchema,
  ConsensusArtifactSchema,
  decodeArtifact,
  LockedFixPlanSchema,
  NormalizedFindingsArtifactSchema,
  PathPolicyArtifactSchema,
  RegressionArtifactSchema,
  TargetedChecksArtifactSchema,
  ValidationRecordsArtifactSchema,
} from "./workflow/artifacts.js";

export const PLUGIN_VERSION = "0.1.0";

export interface CliDeps {
  run: Runner;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** State directory override, used by tests to isolate run storage. */
  stateDir?: string;
  /** Review gateway override, used by tests to avoid launching real agents. */
  gateway?: ReviewAgentGateway;
  /** Interactive prompt override, used by Herdr actions and tests. */
  prompts?: PromptAdapter;
  /** Explicit interaction capability; defaults to stdin/stdout TTY detection. */
  interactive?: boolean;
}

export interface ParsedArgv {
  command: string | null;
  json: boolean;
  help: boolean;
  version: boolean;
  args: string[];
}

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
  validate     Plan or run approved P2 validation
  arbitrate    Run third-AI arbitration advice
  decide       Record or list user decisions
  lock         Lock the fix plan
  apply        Apply the locked fix plan in a git worktree (requires --approve-regression)
  report       Export the unified report

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

async function dispatchMain(argv: readonly string[], deps: CliDeps): Promise<number> {
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

  if (parsed.command === "validate") {
    return runValidateCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "arbitrate") {
    return runArbitrateCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "decide") {
    return runDecideCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "lock") {
    return runLockCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "apply") {
    return runApplyCommand(parsed.args, parsed.json, deps);
  }

  if (parsed.command === "report") {
    return runReportCommand(parsed.args, parsed.json, deps);
  }

  deps.stderr(`${pc.red(`unknown command: ${parsed.command}`)}\n`);
  deps.stderr(USAGE);
  return 2;
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    return await dispatchMain(argv, deps);
  } catch (error) {
    deps.stderr(`${errorMessage(error)}\n`);
    return 1;
  }
}

function makeStore(deps: CliDeps): RunStore {
  return new RunStore(deps.stateDir ?? stateRoot());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInteractive(deps: CliDeps): boolean {
  return deps.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
}

function prompts(deps: CliDeps): PromptAdapter {
  return deps.prompts ?? defaultPromptAdapter;
}

async function selectRunId(
  deps: CliDeps,
  store: RunStore,
  message: string,
  predicate: (stage: import("./state/run.js").RunStage) => boolean,
): Promise<string | null> {
  const runs = (await store.listRuns())
    .filter((run) => predicate(run.stage))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (runs.length === 0) return null;
  return prompts(deps).select(
    message,
    runs.map((run) => ({
      name: `${run.runId} — ${run.stage} — ${run.projectPath}`,
      value: run.runId,
    })),
  );
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
  let runId = args[0];
  if (runId === undefined && isInteractive(deps)) {
    runId = await selectRunId(deps, store, "Select a run to resume", (stage) => stage !== "reported") ?? undefined;
  }
  if (runId === undefined) {
    const runs = await store.listRuns();
    deps.stderr("resume requires a run id\n");
    deps.stderr(formatRunList(runs));
    return 2;
  }
  try {
    const result = await resumeRun(runId, deps.stateDir ?? stateRoot(), store);
    if (json) deps.stdout(`${JSON.stringify({ runId, ...result }, null, 2)}\n`);
    else {
      deps.stdout(`${pc.bold("Resumed")} run ${pc.cyan(runId)} at stage ${pc.cyan(result.stage)}.\n`);
      if (result.nextCommand !== null) deps.stdout(`Next: herdr-consensus ${result.nextCommand}\n`);
    }
    return 0;
  } catch (error) {
    deps.stderr(`failed to resume run ${runId}: ${errorMessage(error)}\n`);
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
  let { agentA, agentB } = parseAgentFlags(args);
  if ((agentA === null || agentB === null) && isInteractive(deps)) {
    agentA ??= await prompts(deps).input("Agent A kind");
    agentB ??= await prompts(deps).input("Agent B kind");
  }
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
  const created = await store.createRun({ runId, projectPath });
  await store.transition(runId, "reviewing");

  const gateway = deps.gateway ?? new HerdrAgentAdapter({ run: deps.run });
  const collector = new ReviewCollector(gateway);
  const agentNamePrefix = `hc${runId.slice(-8)}`;
  const result = await collector.collect({
    projectPath,
    cwd: process.cwd(),
    artifactDir: join(buildRunDir(root, created.projectHash, runId), "agent-output"),
    sources: [
      { slot: "a", kind: agentA, name: `${agentNamePrefix}-a` },
      { slot: "b", kind: agentB, name: `${agentNamePrefix}-b` },
    ],
  });

  const run = await store.findRunById(runId);
  if (run !== null) {
    await saveRawReports(buildRunDir(root, run.projectHash, run.runId), result.artifacts);
  }

  let processedItemCount: number | null = null;
  const artifactA = result.artifacts.a;
  const artifactB = result.artifacts.b;
  if (
    run !== null &&
    artifactA !== null &&
    artifactB !== null &&
    result.outcomes.every((outcome) => outcome.kind === "collected")
  ) {
    try {
      const processed = await processReview(
        {
          run,
          runDir: buildRunDir(root, run.projectHash, run.runId),
          artifacts: { a: artifactA, b: artifactB },
        },
        store,
      );
      processedItemCount = processed.items.length;
    } catch (error) {
      deps.stderr(`failed to process review ${runId}: ${errorMessage(error)}\n`);
      return 1;
    }
  }

  if (json) {
    deps.stdout(
      `${JSON.stringify({ runId, stage: processedItemCount === null ? "reviewing" : "consensus", contractVersion: result.contractVersion, outcomes: result.outcomes, itemCount: processedItemCount }, null, 2)}\n`,
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

  let artifacts: ReturnType<typeof importReports>;
  try {
    artifacts = importReports({ a: contentA, b: contentB });
  } catch (error) {
    deps.stderr(`failed to import report: ${errorMessage(error)}\n`);
    return 1;
  }
  const run = await store.findRunById(runId);
  if (run !== null) {
    await saveRawReports(buildRunDir(root, run.projectHash, run.runId), artifacts);
  }

  if (run === null) {
    deps.stderr(`failed to reload run ${runId}\n`);
    return 1;
  }
  let itemCount: number;
  try {
    const processed = await processReview(
      {
        run,
        runDir: buildRunDir(root, run.projectHash, run.runId),
        artifacts,
      },
      store,
    );
    itemCount = processed.items.length;
  } catch (error) {
    deps.stderr(`${errorMessage(error)}\n`);
    return 1;
  }

  if (json) {
    deps.stdout(
      `${JSON.stringify({ runId, stage: "consensus", itemCount, artifacts: { a: artifacts.a.sha256, b: artifacts.b.sha256 } }, null, 2)}\n`,
    );
  } else {
    deps.stdout(`Imported review ${pc.cyan(runId)} (2 reports)\n`);
  }
  return 0;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function flagValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

async function readJsonOrDefault<T>(path: string, fallback: T, decode?: (value: unknown) => T): Promise<T> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return decode === undefined ? value as T : decode(value);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") return fallback;
    throw new Error(`failed to read JSON artifact ${path}: ${errorMessage(error)}`);
  }
}

async function checkWorkflowPreconditions(
  deps: CliDeps,
  input: {
    command: string;
    run: Awaited<ReturnType<RunStore["findRunById"]>> & {};
    stages: readonly import("./state/run.js").RunStage[];
    artifacts?: readonly string[];
  },
): Promise<boolean> {
  try {
    requireRunStage(input.run, input.stages, input.command);
    if (input.artifacts !== undefined) await requireArtifacts(input.artifacts, input.command);
    return true;
  } catch (error) {
    deps.stderr(`${errorMessage(error)}\n`);
    return false;
  }
}

async function runValidateCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const runId = args.find((arg) => !arg.startsWith("-"));
  const approved = hasFlag(args, "--approve");
  if (runId === undefined) {
    deps.stderr("validate requires a run id\n");
    return 2;
  }

  const root = deps.stateDir ?? stateRoot();
  const store = new RunStore(root);
  const run = await store.findRunById(runId);
  if (run === null) {
    deps.stderr(`no run found with id ${runId}\n`);
    return 1;
  }
  const dir = buildRunDir(root, run.projectHash, run.runId);
  if (!(await checkWorkflowPreconditions(deps, {
    command: "validate",
    run,
    stages: ["consensus", "arbitrating", "deciding"],
    artifacts: [join(dir, "consensus.json")],
  }))) return 1;
  let items: ConsensusItem[];
  try {
    const raw = await readFile(join(dir, "consensus.json"), "utf8");
    items = decodeArtifact(ConsensusArtifactSchema, JSON.parse(raw) as unknown, "consensus.json").items;
  } catch (error) {
    deps.stderr(`failed to read consensus.json: ${errorMessage(error)}\n`);
    return 1;
  }

  const plans = await planP2Validations({ projectPath: run.projectPath, items });
  if (!approved) {
    const payload = { runId, approved: false, plans };
    if (json) deps.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      deps.stdout(`Validation plan for ${pc.cyan(runId)} (${plans.length} command${plans.length === 1 ? "" : "s"})\n`);
      for (const plan of plans) deps.stdout(`  ${plan.itemId}: ${plan.argv.join(" ")} (cwd ${plan.cwd})\n`);
      deps.stdout("Re-run with --approve to execute these commands.\n");
    }
    return 0;
  }

  const recordsPath = join(dir, "validations", "records.json");
  const priorRecords = await readJsonOrDefault(recordsPath, [] as ValidationRecord[], (value) => decodeArtifact(ValidationRecordsArtifactSchema, value, "validation records"));
  const records: ValidationRecord[] = [];
  for (const plan of plans) {
    const safety = checkValidationCommandSafety(plan.argv);
    if (!safety.safe) {
      deps.stderr(`blocked validation for ${plan.itemId}: ${safety.reasons.join("; ")}\n`);
      continue;
    }
    records.push(await executeValidation({ plan, run: deps.run, outputDir: join(dir, "validations"), approvedByUser: true }));
  }
  await writeJsonAtomic(recordsPath, [...priorRecords, ...records]);
  const updatedItems = items.map((item) => {
    const record = records.find((candidate) => candidate.itemId === item.itemId);
    return record === undefined ? item : { ...item, status: record.conclusion };
  });
  await writeJsonAtomic(join(dir, "consensus.json"), { items: updatedItems });
  if (run.stage === "consensus") await store.transition(runId, "validating", { validationCount: records.length });
  if (json) deps.stdout(`${JSON.stringify({ runId, records }, null, 2)}\n`);
  else deps.stdout(`Recorded ${records.length} validation result(s) for ${pc.cyan(runId)}\n`);
  return 0;
}

function isDecisionValue(value: string | null): value is UserDecisionValue {
  return value === "approved_fix" || value === "deferred" || value === "rejected" || value === "validate_more";
}

async function loadRunContext(dir: string): Promise<{
  items: ConsensusItem[];
  findings: NormalizedFinding[];
  validations: unknown[];
  arbitration: unknown[];
}> {
  const consensus = await readJsonOrDefault(join(dir, "consensus.json"), null, (value) => decodeArtifact(ConsensusArtifactSchema, value, "consensus.json"));
  if (consensus === null) throw new Error("missing consensus.json artifact");
  return {
    items: consensus.items,
    findings: await readJsonOrDefault(join(dir, "normalized", "findings.json"), [] as NormalizedFinding[], (value) => decodeArtifact(NormalizedFindingsArtifactSchema, value, "normalized findings")),
    validations: await readJsonOrDefault(join(dir, "validations", "records.json"), [] as ValidationRecord[], (value) => decodeArtifact(ValidationRecordsArtifactSchema, value, "validation records")),
    arbitration: await readJsonOrDefault(join(dir, "arbitration", "advice.json"), [] as unknown[], (value) => decodeArtifact(ArbitrationAdviceArtifactSchema, value, "arbitration advice")),
  };
}

async function runArbitrateCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const agent = flagValue(args, "--agent");
  const runId = args.find((arg, index) => !arg.startsWith("-") && args[index - 1] !== "--agent");
  if (runId === undefined || agent === null) {
    deps.stderr("arbitrate requires <run-id> --agent <kind>\n");
    return 2;
  }

  const root = deps.stateDir ?? stateRoot();
  const store = makeStore(deps);
  const run = await store.findRunById(runId);
  if (run === null) {
    deps.stderr(`no run found with id ${runId}\n`);
    return 1;
  }
  const dir = buildRunDir(root, run.projectHash, run.runId);
  if (!(await checkWorkflowPreconditions(deps, {
    command: "arbitrate",
    run,
    stages: ["validating", "arbitrating", "deciding"],
    artifacts: [
      join(dir, "consensus.json"),
      join(dir, "normalized", "findings.json"),
      join(dir, "validations", "records.json"),
    ],
  }))) return 1;
  const { items, findings, validations } = await loadRunContext(dir);
  const targets = items.filter((item) => item.relation === "disputed" || item.relation === "possible_match" || item.status === "inconclusive");

  const rawReports = await loadRawReports(dir);
  const reviewAgentKinds = [rawReports.a?.agentKind, rawReports.b?.agentKind]
    .filter((kind): kind is string => kind !== undefined);
  const metadata: ArbitrationRunMetadata = {
    reviewAgentKinds,
    agentKind: agent,
    model: null,
    provider: null,
    independence: assessIndependence(reviewAgentKinds, agent),
  };
  if (metadata.independence === "weak") {
    deps.stderr("Arbitration independence is weak: the arbiter repeats a reviewer kind.\n");
  }

  const gateway = deps.gateway ?? new HerdrAgentAdapter({ run: deps.run });
  const arbitrationAgentWork = join(dir, "arbitration", "agent-work");
  await mkdir(arbitrationAgentWork, { recursive: true });
  const pane = await gateway.splitPane({ cwd: arbitrationAgentWork });
  const started = await gateway.startAgent({ name: workflowAgentName(runId, "arb"), kind: agent, paneId: pane.paneId });
  const advices = [];
  await mkdir(join(dir, "arbitration"), { recursive: true });
  for (const item of targets) {
    const related = findings.filter((finding) => item.findingIds.includes(finding.findingId));
    const prompt = buildArbitrationPrompt({ item, findings: related, validations });
    let outcome = await gateway.prompt({ target: started.name, text: prompt, until: ["idle", "done"], timeoutMs: 600_000 });
    let content = outcome.kind === "done" ? outcome.output : "";
    let parsed = parseArbitrationAdvice(content);
    if (!parsed.ok) {
      outcome = await gateway.prompt({ target: started.name, text: buildArbitrationRepairPrompt(parsed.error), until: ["idle", "done"], timeoutMs: 300_000 });
      content = outcome.kind === "done" ? outcome.output : "";
      parsed = parseArbitrationAdvice(content);
    }
    await writeFile(join(dir, "arbitration", `${item.itemId}.txt`), content, "utf8");
    if (parsed.ok && parsed.advice.itemId === item.itemId) advices.push(parsed.advice);
  }
  await writeJsonAtomic(join(dir, "arbitration", "advice.json"), advices);
  await writeJsonAtomic(join(dir, "arbitration", "metadata.json"), metadata);
  if (advices.length === targets.length && run.stage === "validating") {
    await store.transition(runId, "arbitrating", { adviceCount: advices.length, agentKind: agent });
  }
  if (json) deps.stdout(`${JSON.stringify({ runId, agentKind: agent, advices }, null, 2)}\n`);
  else deps.stdout(`Recorded ${advices.length} arbitration advice item(s) for ${pc.cyan(runId)}\n`);
  return advices.length === targets.length ? 0 : 1;
}

async function nextFixPlanVersion(dir: string): Promise<number> {
  const existing = await readJsonOrDefault(join(dir, "fix-plan.json"), null, (value) => decodeArtifact(LockedFixPlanSchema, value, "fix-plan.json"));
  return existing === null ? 1 : existing.version + 1;
}

async function runDecideCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const store = makeStore(deps);
  let runId = args.find((arg, index) => !arg.startsWith("-") && !["--item", "--decision", "--reason"].includes(args[index - 1] ?? ""));
  if (runId === undefined && isInteractive(deps)) {
    runId = await selectRunId(deps, store, "Select a run to decide", (stage) => stage === "arbitrating" || stage === "deciding") ?? undefined;
  }
  if (runId === undefined) {
    deps.stderr("decide requires a run id\n");
    return 2;
  }
  const root = deps.stateDir ?? stateRoot();
  const run = await store.findRunById(runId);
  if (run === null) {
    deps.stderr(`no run found with id ${runId}\n`);
    return 1;
  }
  const dir = buildRunDir(root, run.projectHash, run.runId);
  if (!(await checkWorkflowPreconditions(deps, {
    command: "decide",
    run,
    stages: ["arbitrating", "deciding"],
    artifacts: [
      join(dir, "consensus.json"),
      join(dir, "normalized", "findings.json"),
      join(dir, "validations", "records.json"),
      join(dir, "arbitration", "advice.json"),
    ],
  }))) return 1;
  const context = await loadRunContext(dir);
  const decisionsPath = join(dir, "decisions.json");
  const existing = await loadDecisions(decisionsPath);
  const itemId = flagValue(args, "--item");
  const decisionValue = flagValue(args, "--decision");
  const reason = flagValue(args, "--reason");

  if (itemId === null || decisionValue === null) {
    if (isInteractive(deps)) {
      const decisions = await runDecisionWizard(
        context,
        existing,
        prompts(deps),
        async (current) => saveDecisions(decisionsPath, current),
      );
      await saveDecisions(decisionsPath, decisions);
      if (!decisions.some((decision) => decision.decision === "validate_more")) {
        await store.transition(runId, "deciding", { decisionCount: decisions.length, interactive: true });
      }
      if (json) deps.stdout(`${JSON.stringify({ runId, decisions }, null, 2)}\n`);
      else deps.stdout(`Recorded ${decisions.length} decision(s) for ${pc.cyan(runId)}\n`);
      return 0;
    }
    const payload = { runId, items: context.items, decisions: existing };
    if (json) deps.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      deps.stdout(`Decision wizard for ${pc.cyan(runId)}\n`);
      for (const item of context.items) {
        const decided = existing.find((decision) => decision.itemId === item.itemId)?.decision ?? "pending";
        deps.stdout(`  ${item.itemId}: ${item.severity} ${item.relation} — ${decided}\n`);
      }
      deps.stdout("Record a decision with --item <id> --decision approved_fix|deferred|rejected|validate_more [--reason text].\n");
    }
    return 0;
  }
  if (!isDecisionValue(decisionValue)) {
    deps.stderr("invalid decision; use approved_fix, deferred, rejected or validate_more\n");
    return 2;
  }
  const item = context.items.find((candidate) => candidate.itemId === itemId);
  if (item === undefined) {
    deps.stderr(`no consensus item found with id ${itemId}\n`);
    return 1;
  }
  const related = context.findings.filter((finding) => item.findingIds.includes(finding.findingId));
  const itemValidations = context.validations.filter((value) => typeof value === "object" && value !== null && (value as { itemId?: unknown }).itemId === item.itemId);
  const itemArbitration = context.arbitration.filter((value) => typeof value === "object" && value !== null && (value as { itemId?: unknown }).itemId === item.itemId);
  const record: UserDecision = {
    itemId,
    decision: decisionValue,
    reason,
    decidedAt: new Date().toISOString(),
    evidenceSnapshotSha256: evidenceSnapshotSha256({ item, findings: related, validations: itemValidations, arbitration: itemArbitration }),
  };
  const updated = upsertDecision(existing, record);
  await saveDecisions(decisionsPath, updated);
  if (decisionValue !== "validate_more") {
    await store.transition(runId, "deciding", { itemId, decision: decisionValue });
  }
  if (json) deps.stdout(`${JSON.stringify(record, null, 2)}\n`);
  else deps.stdout(`Recorded decision for ${pc.cyan(itemId)}: ${decisionValue}\n`);
  return 0;
}

function safeBranchName(runId: string): string {
  return `herdr-consensus/${runId.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
}

function workflowAgentName(runId: string, role: "arb" | "fix"): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-20);
  return `hc-${safeRunId}-${role}`;
}

async function runLockCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const runId = args.find((arg) => !arg.startsWith("-"));
  if (runId === undefined) {
    deps.stderr("lock requires a run id\n");
    return 2;
  }
  const root = deps.stateDir ?? stateRoot();
  const store = makeStore(deps);
  const run = await store.findRunById(runId);
  if (run === null) {
    deps.stderr(`no run found with id ${runId}\n`);
    return 1;
  }
  const dir = buildRunDir(root, run.projectHash, run.runId);
  if (!(await checkWorkflowPreconditions(deps, {
    command: "lock",
    run,
    stages: ["deciding"],
    artifacts: [
      join(dir, "consensus.json"),
      join(dir, "normalized", "findings.json"),
      join(dir, "decisions.json"),
    ],
  }))) return 1;
  const context = await loadRunContext(dir);
  const decisions = await loadDecisions(join(dir, "decisions.json"));
  for (const item of context.items) {
    const autoApproved = ((item.severity === "P0" || item.severity === "P1") && (item.status === "common_confirmed" || item.relation === "common"))
      || (item.severity === "P2" && item.status === "validated_true");
    if (autoApproved) continue;
    const decision = decisions.find((candidate) => candidate.itemId === item.itemId);
    if (decision === undefined) {
      deps.stderr(`cannot lock: missing decision for ${item.itemId}\n`);
      return 1;
    }
    if (decision.decision === "validate_more") {
      deps.stderr(`cannot lock: ${item.itemId} requires more validation\n`);
      return 1;
    }
    const findings = context.findings.filter((finding) => item.findingIds.includes(finding.findingId));
    const validations = context.validations.filter((value) => typeof value === "object" && value !== null && (value as { itemId?: unknown }).itemId === item.itemId);
    const arbitration = context.arbitration.filter((value) => typeof value === "object" && value !== null && (value as { itemId?: unknown }).itemId === item.itemId);
    const currentSnapshot = evidenceSnapshotSha256({ item, findings, validations, arbitration });
    if (decision.evidenceSnapshotSha256 !== currentSnapshot) {
      deps.stderr(`cannot lock: stale evidence snapshot for ${item.itemId}\n`);
      return 1;
    }
  }
  const plan = generateLockedFixPlan({ runId, version: await nextFixPlanVersion(dir), items: context.items, findings: context.findings, decisions });
  await saveFixPlanVersion(dir, plan, renderFixPlanMarkdown(plan));
  await store.transition(runId, "locked", { version: plan.version, sha256: plan.sha256, itemCount: plan.items.length });
  if (json) deps.stdout(`${JSON.stringify(plan, null, 2)}\n`);
  else deps.stdout(`Locked fix plan v${plan.version} for ${pc.cyan(runId)} (${plan.items.length} item${plan.items.length === 1 ? "" : "s"})\nSHA-256: ${plan.sha256}\n`);
  return 0;
}

async function runApplyCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const agent = flagValue(args, "--agent");
  const regressionApproved = hasFlag(args, "--approve-regression");
  const runId = args.find((arg, index) => !arg.startsWith("-") && args[index - 1] !== "--agent");
  if (runId === undefined || agent === null) {
    deps.stderr("apply requires <run-id> --agent <kind>\n");
    return 2;
  }
  const root = deps.stateDir ?? stateRoot();
  const store = makeStore(deps);
  const run = await store.findRunById(runId);
  if (run === null) {
    deps.stderr(`no run found with id ${runId}\n`);
    return 1;
  }
  const dir = buildRunDir(root, run.projectHash, run.runId);
  if (!(await checkWorkflowPreconditions(deps, {
    command: "apply",
    run,
    stages: ["locked"],
    artifacts: [join(dir, "fix-plan.json")],
  }))) return 1;
  if (!regressionApproved) {
    deps.stderr("apply requires explicit --approve-regression before it may run project code\n");
    return 2;
  }
  const plan = await readJsonOrDefault(join(dir, "fix-plan.json"), null, (value) => decodeArtifact(LockedFixPlanSchema, value, "fix-plan.json"));
  if (plan === null) {
    deps.stderr("fix-plan.json is missing; run lock first\n");
    return 1;
  }
  try {
    await verifyLockedFixPlanIntegrity({ plan, run, runDir: dir });
  } catch (error) {
    deps.stderr(`cannot apply: ${errorMessage(error)}\n`);
    return 1;
  }
  const clean = await ensureCleanGitWorktree(run.projectPath, deps.run);
  if (!clean.ok) {
    deps.stderr(`cannot apply: ${clean.reason}\n`);
    return 1;
  }
  const worktreePath = join(dir, "worktree");
  const branchName = safeBranchName(runId);
  try {
    await createFixWorktree({ projectPath: run.projectPath, worktreePath, branchName, run: deps.run });
  } catch (error) {
    deps.stderr(`failed to create worktree: ${errorMessage(error)}\n`);
    return 1;
  }
  let baseCommit: string;
  try {
    baseCommit = await readHeadCommit(worktreePath, deps.run);
  } catch (error) {
    deps.stderr(`failed to capture apply base commit: ${errorMessage(error)}\n`);
    return 1;
  }
  const gateway = deps.gateway ?? new HerdrAgentAdapter({ run: deps.run });
  const pane = await gateway.splitPane({ cwd: worktreePath });
  const started = await gateway.startAgent({ name: workflowAgentName(runId, "fix"), kind: agent, paneId: pane.paneId });
  const outcome = await gateway.prompt({ target: started.name, text: buildImplementationPrompt(plan), until: ["idle", "done"], timeoutMs: 1_800_000 });
  await mkdir(join(dir, "logs"), { recursive: true });
  await writeFile(join(dir, "logs", "apply-agent-output.txt"), outcome.kind === "done" ? outcome.output : JSON.stringify(outcome, null, 2), "utf8");
  if (outcome.kind !== "done") {
    deps.stderr(`apply agent did not complete: ${outcome.kind}\n`);
    return 1;
  }

  let changedPaths: string[];
  try {
    changedPaths = await listChangedPaths(worktreePath, deps.run, baseCommit);
  } catch (error) {
    deps.stderr(`failed to inspect apply changes: ${errorMessage(error)}\n`);
    return 1;
  }
  let currentHead: string;
  try {
    currentHead = await readHeadCommit(worktreePath, deps.run);
  } catch (error) {
    deps.stderr(`failed to verify apply HEAD: ${errorMessage(error)}\n`);
    return 1;
  }
  const headMoved = currentHead !== baseCommit;
  const pathPolicy = verifyAllowedPaths(plan, changedPaths);
  if (headMoved) pathPolicy.violations.unshift(`HEAD moved from ${baseCommit} to ${currentHead}`);
  pathPolicy.ok = pathPolicy.violations.length === 0;
  await writeJsonAtomic(join(dir, "logs", "path-policy.json"), { baseCommit, currentHead, headMoved, changedPaths, ...pathPolicy });
  if (!pathPolicy.ok) {
    deps.stderr(`apply changed paths outside the locked plan: ${pathPolicy.violations.join(", ")}\n`);
    return 1;
  }

  const validationRecords = await readJsonOrDefault(
    join(dir, "validations", "records.json"),
    [] as ValidationRecord[],
    (value) => decodeArtifact(ValidationRecordsArtifactSchema, value, "validation records"),
  );
  const targetedChecks = await runTargetedChecks(plan, validationRecords, worktreePath, deps.run);
  await writeJsonAtomic(join(dir, "logs", "targeted-checks.json"), targetedChecks);
  if (targetedChecks.some((check) => check.exitCode !== 0)) {
    deps.stderr("one or more targeted checks failed; worktree and logs were preserved\n");
    return 1;
  }

  const regressionArgv = await detectValidationCommand(worktreePath);
  if (regressionArgv === null) {
    deps.stderr("cannot apply: no supported project-level regression command was detected\n");
    return 1;
  }
  const regressionResult = await runRegression({ worktreePath, argv: regressionArgv, run: deps.run, approvedByUser: true });
  const workspaceSnapshotSha256 = await computeWorkspaceSnapshotSha256({ worktreePath, baseCommit, run: deps.run });
  const regression = { ...regressionResult, workspaceSnapshotSha256 };
  await writeJsonAtomic(join(dir, "logs", "regression.json"), regression);
  if (regression.exitCode !== 0) {
    deps.stderr("approved regression failed; worktree and logs were preserved\n");
    return 1;
  }

  await store.transition(runId, "applying", { agentKind: agent, worktreePath, branchName, planVersion: plan.version, planSha256: plan.sha256 });
  const payload = { runId, worktreePath, branchName, outcome: outcome.kind };
  if (json) deps.stdout(`${JSON.stringify(payload, null, 2)}\n`);
  else deps.stdout(`Started apply in ${pc.cyan(worktreePath)} on branch ${branchName}; agent outcome: ${outcome.kind}\n`);
  return 0;
}

async function runReportCommand(args: readonly string[], json: boolean, deps: CliDeps): Promise<number> {
  const store = makeStore(deps);
  let runId = args.find((arg) => !arg.startsWith("-"));
  if (runId === undefined && isInteractive(deps)) {
    runId = await selectRunId(deps, store, "Select a run to report", (stage) => stage === "applying" || stage === "reported") ?? undefined;
  }
  if (runId === undefined) {
    deps.stderr("report requires a run id\n");
    return 2;
  }
  const root = deps.stateDir ?? stateRoot();
  const run = await store.findRunById(runId);
  if (run === null) {
    deps.stderr(`no run found with id ${runId}\n`);
    return 1;
  }
  const dir = buildRunDir(root, run.projectHash, run.runId);
  if (run.stage === "reported") {
    const reportPath = join(dir, "final-report.json");
    try {
      const existing = await readFile(reportPath, "utf8");
      if (json) deps.stdout(existing.endsWith("\n") ? existing : `${existing}\n`);
      else deps.stdout(`Final report for ${pc.cyan(runId)}: ${reportPath}\n`);
      return 0;
    } catch (error) {
      deps.stderr(`failed to open final report: ${errorMessage(error)}\n`);
      return 1;
    }
  }
  const worktreePath = join(dir, "worktree");
  if (!(await checkWorkflowPreconditions(deps, {
    command: "report",
    run,
    stages: ["applying"],
    artifacts: [
      join(dir, "consensus.json"),
      join(dir, "validations", "records.json"),
      join(dir, "arbitration", "advice.json"),
      join(dir, "arbitration", "metadata.json"),
      join(dir, "decisions.json"),
      join(dir, "fix-plan.json"),
      join(dir, "logs", "path-policy.json"),
      join(dir, "logs", "targeted-checks.json"),
      join(dir, "logs", "regression.json"),
      worktreePath,
    ],
  }))) return 1;
  const consensus = await readJsonOrDefault(join(dir, "consensus.json"), null, (value) => decodeArtifact(ConsensusArtifactSchema, value, "consensus.json"));
  const validations = await readJsonOrDefault(join(dir, "validations", "records.json"), [] as ValidationRecord[], (value) => decodeArtifact(ValidationRecordsArtifactSchema, value, "validation records"));
  const arbitration = await readJsonOrDefault(join(dir, "arbitration", "advice.json"), [] as unknown[], (value) => decodeArtifact(ArbitrationAdviceArtifactSchema, value, "arbitration advice"));
  const arbitrationMetadata = await readJsonOrDefault(join(dir, "arbitration", "metadata.json"), null, (value) => decodeArtifact(ArbitrationMetadataArtifactSchema, value, "arbitration metadata"));
  const decisions = await loadDecisions(join(dir, "decisions.json"));
  const fixPlan = await readJsonOrDefault(join(dir, "fix-plan.json"), null, (value) => decodeArtifact(LockedFixPlanSchema, value, "fix-plan.json"));
  if (fixPlan === null) {
    deps.stderr("fix-plan.json is missing\n");
    return 1;
  }
  await verifyLockedFixPlanIntegrity({ plan: fixPlan, run, runDir: dir });
  const targetedChecks = await readJsonOrDefault(
    join(dir, "logs", "targeted-checks.json"),
    [] as import("./reporting/types.js").UnifiedReport["targetedChecks"],
    (value) => decodeArtifact(TargetedChecksArtifactSchema, value, "targeted checks"),
  );
  const regression = await readJsonOrDefault(
    join(dir, "logs", "regression.json"),
    null,
    (value) => decodeArtifact(RegressionArtifactSchema, value, "regression"),
  );
  if (regression === null || regression.approvedByUser !== true || regression.exitCode !== 0) {
    deps.stderr("regression.json must contain an approved successful regression result\n");
    return 1;
  }
  const pathPolicyArtifactForDiff = await readJsonOrDefault(join(dir, "logs", "path-policy.json"), null, (value) => decodeArtifact(PathPolicyArtifactSchema, value, "path-policy.json"));
  if (pathPolicyArtifactForDiff === null) throw new Error("missing path-policy.json artifact");
  const reportHead = await readHeadCommit(worktreePath, deps.run);
  if (reportHead !== pathPolicyArtifactForDiff.baseCommit) {
    deps.stderr(`cannot report: worktree HEAD moved from ${pathPolicyArtifactForDiff.baseCommit} to ${reportHead}\n`);
    return 1;
  }
  const changedPaths = await listChangedPaths(worktreePath, deps.run, pathPolicyArtifactForDiff.baseCommit);
  const pathPolicy = verifyAllowedPaths(fixPlan, changedPaths);
  if (!pathPolicy.ok) {
    deps.stderr(`cannot report: changed paths outside the locked plan: ${pathPolicy.violations.join(", ")}\n`);
    return 1;
  }
  const currentWorkspaceSnapshotSha256 = await computeWorkspaceSnapshotSha256({ worktreePath, baseCommit: pathPolicyArtifactForDiff.baseCommit, run: deps.run });
  if (currentWorkspaceSnapshotSha256 !== regression.workspaceSnapshotSha256) {
    deps.stderr("cannot report: worktree contents changed after the approved regression\n");
    return 1;
  }
  const diff = await collectGitDiffSummary(worktreePath, deps.run, pathPolicyArtifactForDiff.baseCommit);
  let report;
  try {
    report = buildUnifiedReport({ run, consensus, validations, arbitration, arbitrationMetadata, decisions, fixPlan, gitDiffSummary: diff, changedPaths, pathPolicy, targetedChecks, regression });
  } catch (error) {
    deps.stderr(`failed to build final report: ${errorMessage(error)}\n`);
    return 1;
  }
  await writeJsonAtomic(join(dir, "final-report.json"), report);
  await writeFile(join(dir, "final-report.md"), renderUnifiedReportMarkdown(report), "utf8");
  await store.transition(runId, "reported", { regressionExitCode: regression?.exitCode ?? null });
  if (json) deps.stdout(`${JSON.stringify(report, null, 2)}\n`);
  else deps.stdout(`Wrote final report for ${pc.cyan(runId)}\n`);
  return 0;
}

export function resolveMainModule(moduleUrl: string, entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}

function isMainModule(): boolean {
  return resolveMainModule(import.meta.url, process.argv[1]);
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
