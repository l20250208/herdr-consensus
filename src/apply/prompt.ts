import type { LockedFixPlan } from "../fix-plan/types.js";

export function buildImplementationPrompt(plan: LockedFixPlan): string {
  return [
    "You are the implementation agent for Herdr Consensus.",
    "Modify code only to implement the locked fix plan below.",
    "Do not add opportunistic refactors or fixes outside the plan.",
    "Respect allowedPaths for each item; if a required path is missing or outside the allowed list, stop and explain.",
    "After each item, run or describe the targeted acceptance check. Do not commit, merge, push, deploy, or create PRs.",
    "",
    `Run ID: ${plan.runId}`,
    `Fix plan version: ${plan.version}`,
    `Fix plan SHA-256: ${plan.sha256}`,
    "",
    "LOCKED_FIX_PLAN_JSON:",
    JSON.stringify(plan, null, 2),
  ].join("\n");
}
