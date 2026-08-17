import pc from "picocolors";
import type { AgentsReport, BinaryReport, DoctorReport, NodeReport } from "../env.js";

function formatNode(node: NodeReport): string {
  const label = "Node.js";
  if (!node.found) return `${pc.red("✗")} ${label}  ${pc.red("not found")}`;
  if (!node.meetsMinimum) {
    return `${pc.red("✗")} ${label}  ${node.version ?? "unknown"} (required >= ${node.minimum})`;
  }
  return `${pc.green("✓")} ${label}  ${node.version ?? "unknown"}`;
}

function formatBinary(name: string, report: BinaryReport): string {
  if (!report.found) return `${pc.red("✗")} ${name}  ${pc.red(report.error ?? "not found")}`;
  return `${pc.green("✓")} ${name}  ${report.version ?? "unknown"}`;
}

function formatAgents(agents: AgentsReport, herdrFound: boolean): string {
  if (!herdrFound) return `${pc.yellow("!")} Agents  ${pc.yellow("skipped (Herdr missing)")}`;
  if (!agents.detected) return `${pc.yellow("!")} Agents  ${pc.yellow(agents.error ?? "could not enumerate")}`;
  if (agents.list.length === 0) return `${pc.yellow("!")} Agents  ${pc.yellow("none detected")}`;
  const summary = agents.list.map((agent) => `${agent.name} (${agent.status})`).join(", ");
  return `${pc.green("✓")} Agents  ${agents.list.length} detected: ${summary}`;
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    pc.bold("herdr-consensus doctor"),
    "",
    formatNode(report.node),
    formatBinary("Git", report.git),
    formatBinary("Herdr", report.herdr),
    formatAgents(report.agents, report.herdr.found),
    "",
  ];

  if (report.ok) {
    lines.push(pc.green("All required checks passed."));
  } else {
    lines.push(pc.red("Problems found:"));
    for (const issue of report.issues) lines.push(`  ${pc.red("•")} ${issue}`);
  }
  for (const warning of report.warnings) lines.push(`  ${pc.yellow("!")} ${warning}`);

  lines.push("");
  return lines.join("\n");
}
