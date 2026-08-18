import type { ConsensusItem, NormalizedFinding } from "../consensus/types.js";
import { evidenceSnapshotSha256 } from "../decisions/snapshot.js";
import { upsertDecision } from "../decisions/store.js";
import type { UserDecision, UserDecisionValue } from "../decisions/types.js";
import type { PromptAdapter } from "./prompts.js";

export interface DecisionWizardContext {
  items: ConsensusItem[];
  findings: NormalizedFinding[];
  validations: unknown[];
  arbitration: unknown[];
}

function belongsToItem(value: unknown, itemId: string): boolean {
  return typeof value === "object" && value !== null && (value as { itemId?: unknown }).itemId === itemId;
}

function summary(
  item: ConsensusItem,
  findings: readonly NormalizedFinding[],
  validations: readonly unknown[],
  arbitration: readonly unknown[],
): string {
  const lines = [`${item.itemId} — ${item.severity} ${item.relation}`];
  for (const finding of findings) {
    lines.push(`Finding: ${finding.title}`);
    lines.push(`Impact: ${finding.impact}`);
    if (finding.evidence.length > 0) lines.push(`Evidence: ${finding.evidence.join("; ")}`);
  }
  if (validations.length > 0) lines.push(`Validation: ${JSON.stringify(validations)}`);
  if (arbitration.length > 0) lines.push(`Arbitration: ${JSON.stringify(arbitration)}`);
  return lines.join("\n");
}

export async function runDecisionWizard(
  context: DecisionWizardContext,
  existing: readonly UserDecision[],
  prompts: PromptAdapter,
  persist: (decisions: UserDecision[]) => Promise<void>,
): Promise<UserDecision[]> {
  let decisions = [...existing];
  for (const item of context.items) {
    if (decisions.some((decision) => decision.itemId === item.itemId && decision.decision !== "validate_more")) continue;
    const findings = context.findings.filter((finding) => item.findingIds.includes(finding.findingId));
    const validations = context.validations.filter((value) => belongsToItem(value, item.itemId));
    const arbitration = context.arbitration.filter((value) => belongsToItem(value, item.itemId));
    const decision = await prompts.select<UserDecisionValue>(
      summary(item, findings, validations, arbitration),
      [
        { name: "加入修复", value: "approved_fix" },
        { name: "延期", value: "deferred" },
        { name: "不处理", value: "rejected" },
        { name: "返回补充验证", value: "validate_more" },
      ],
    );
    const enteredReason = await prompts.input(`Reason for ${item.itemId} (optional)`);
    const record: UserDecision = {
      itemId: item.itemId,
      decision,
      reason: enteredReason.trim() === "" ? null : enteredReason,
      decidedAt: new Date().toISOString(),
      evidenceSnapshotSha256: evidenceSnapshotSha256({
        item,
        findings,
        validations,
        arbitration,
      }),
    };
    decisions = upsertDecision(decisions, record);
    await persist(decisions);
  }
  return decisions;
}
