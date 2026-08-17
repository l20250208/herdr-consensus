import pc from "picocolors";
import { pathToFileURL } from "node:url";
import { spawnRunner, type Runner } from "./spawn.js";
import { runDoctor } from "./env.js";
import { formatDoctorReport } from "./commands/doctor.js";

export const PLUGIN_VERSION = "0.1.0";

export interface CliDeps {
  run: Runner;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface ParsedArgv {
  command: string | null;
  json: boolean;
  help: boolean;
  version: boolean;
  args: string[];
}

const PLANNED_STAGES: Record<string, string> = {
  start: "stage 4 (dual-agent review)",
  import: "stage 4 (dual-agent review)",
  status: "stage 2 (state store)",
  resume: "stage 2 (state store)",
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
  start        Start a new consensus review          (not implemented)
  import       Import two existing reports           (not implemented)
  status       Show run status                       (not implemented)
  resume       Resume a run                          (not implemented)
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

  const planned = PLANNED_STAGES[parsed.command];
  if (planned !== undefined) {
    deps.stderr(`${pc.yellow(`"${parsed.command}" is not implemented yet`)} (${planned}).\n`);
    return 2;
  }

  deps.stderr(`${pc.red(`unknown command: ${parsed.command}`)}\n`);
  deps.stderr(USAGE);
  return 2;
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
