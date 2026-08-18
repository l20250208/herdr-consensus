import { createHash } from "node:crypto";
import type { ConsensusItem, NormalizedFinding } from "../consensus/types.js";
import type { UserDecision } from "../decisions/types.js";
import type { LockedFixPlan, LockedFixPlanItem } from "./types.js";

function sha256Canonical(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function computeLockedFixPlanSha256(plan: Omit<LockedFixPlan, "sha256">): string {
  return sha256Canonical({
    runId: plan.runId,
    version: plan.version,
    items: plan.items.map((item) => ({
      itemId: item.itemId,
      severity: item.severity,
      acceptanceCriteria: item.acceptanceCriteria,
      allowedPaths: item.allowedPaths,
    })),
    createdAt: plan.createdAt,
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function buildFixPlanItem(item: ConsensusItem, findings: readonly NormalizedFinding[]): LockedFixPlanItem {
  const related = findings.filter((finding) => item.findingIds.includes(finding.findingId));
  const paths = uniqueSorted(related.map((finding) => finding.location?.path).filter((path): path is string => path !== undefined));
  const criteria = uniqueSorted([
    `Resolve consensus item ${item.itemId} (${item.severity}).`,
    ...related.map((finding) => finding.title),
    ...related.flatMap((finding) => finding.reproduction.map((step) => `Validation: ${step}`)),
  ]);
  return { itemId: item.itemId, severity: item.severity, acceptanceCriteria: criteria, allowedPaths: paths };
}

export function generateLockedFixPlan(input: {
  runId: string;
  version: number;
  items: readonly ConsensusItem[];
  findings: readonly NormalizedFinding[];
  decisions: readonly UserDecision[];
  createdAt?: string;
}): LockedFixPlan {
  const approved = new Set(input.decisions.filter((decision) => decision.decision === "approved_fix").map((decision) => decision.itemId));
  for (const item of input.items) {
    if ((item.severity === "P0" || item.severity === "P1") && (item.status === "common_confirmed" || item.relation === "common")) approved.add(item.itemId);
    if (item.severity === "P2" && item.status === "validated_true") approved.add(item.itemId);
  }
  const planWithoutHash = {
    runId: input.runId,
    version: input.version,
    items: input.items.filter((item) => approved.has(item.itemId)).map((item) => buildFixPlanItem(item, input.findings)).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  return { ...planWithoutHash, sha256: computeLockedFixPlanSha256(planWithoutHash) };
}

export function renderFixPlanMarkdown(plan: LockedFixPlan): string {
  const lines = [`# Locked Fix Plan`, "", `Run: ${plan.runId}`, `Version: ${plan.version}`, `SHA-256: ${plan.sha256}`, ""];
  for (const item of plan.items) {
    lines.push(`## ${item.itemId} (${item.severity})`, "", "Acceptance criteria:");
    for (const criterion of item.acceptanceCriteria) lines.push(`- ${criterion}`);
    lines.push("", "Allowed paths:");
    for (const path of item.allowedPaths) lines.push(`- ${path}`);
    if (item.allowedPaths.length === 0) lines.push("- (none specified)");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
