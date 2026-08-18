import { z } from "zod";
import { sha256Hex } from "../reports/artifact.js";
import { ARBITRATION_MARKERS } from "./prompt.js";
import type { ArbitrationAdvice } from "./types.js";

const AdviceSchema = z.object({
  itemId: z.string().min(1),
  recommendation: z.enum(["fix", "defer", "reject", "validate_more"]),
  rationale: z.string().min(1),
  evidenceRefs: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  missingValidation: z.array(z.string()),
});

export function extractArbitrationJson(content: string): string | null {
  const start = content.lastIndexOf(ARBITRATION_MARKERS.start);
  if (start < 0) return null;
  const contentStart = start + ARBITRATION_MARKERS.start.length;
  const end = content.indexOf(ARBITRATION_MARKERS.end, contentStart);
  if (end < 0) return null;
  return content.slice(contentStart, end).trim();
}

export function parseArbitrationAdvice(content: string): { ok: true; advice: ArbitrationAdvice } | { ok: false; error: string } {
  const jsonText = extractArbitrationJson(content);
  if (jsonText === null) return { ok: false, error: "missing arbitration JSON markers" };
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText) as unknown; } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  const result = AdviceSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: result.error.message };
  return { ok: true, advice: { ...result.data, artifactSha256: sha256Hex(content) } };
}

export function buildArbitrationRepairPrompt(error: string): string {
  return [
    `Your arbitration response could not be parsed (${error}).`,
    "Re-emit exactly one valid JSON object between the same markers. Do not add prose.",
    ARBITRATION_MARKERS.start,
    "",
    ARBITRATION_MARKERS.end,
  ].join("\n");
}
