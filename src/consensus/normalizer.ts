import { z } from "zod";
import type { RawReportArtifact } from "../reports/artifact.js";
import { DEFAULT_MARKERS } from "../reports/contract.js";
import { extractReportJson, parseReviewReport } from "../reports/extract.js";
import { normalizeRepoPath } from "./path.js";
import { mapSeverity } from "./severity.js";
import type { NormalizedFinding, SourceLocation } from "./types.js";

const RawLocationSchema = z.object({
  path: z.string(),
  startLine: z.number().int().positive().nullish(),
  endLine: z.number().int().positive().nullish(),
  symbol: z.string().nullish(),
});

const RawFindingSchema = z.object({
  title: z.string(),
  category: z.string(),
  severity: z.string(),
  location: RawLocationSchema.nullish(),
  rootCause: z.string().nullish(),
  impact: z.string(),
  evidence: z.array(z.string()).default([]),
  reproduction: z.array(z.string()).default([]),
  suggestedFix: z.string().nullish(),
});

function normalizeLocation(
  loc: z.infer<typeof RawLocationSchema> | null | undefined,
  repoRoot: string,
): SourceLocation | null {
  if (loc === null || loc === undefined) return null;
  const path = normalizeRepoPath(loc.path, repoRoot);
  if (path === null) return null;
  return {
    path,
    startLine: loc.startLine ?? null,
    endLine: loc.endLine ?? null,
    symbol: loc.symbol ?? null,
  };
}

/**
 * Normalizes one raw report artifact into `NormalizedFinding[]`. Untrusted
 * input is validated per-finding; invalid findings are skipped and unparseable
 * reports yield no findings.
 */
export function normalizeReport(
  artifact: RawReportArtifact,
  options: { repoRoot: string; sourceId: string },
): NormalizedFinding[] {
  const json = extractReportJson(artifact.content, DEFAULT_MARKERS);
  if (json === null) return [];
  const parsed = parseReviewReport(json);
  if (!parsed.ok) return [];

  const out: NormalizedFinding[] = [];
  let index = 0;
  for (const raw of parsed.report.findings) {
    const result = RawFindingSchema.safeParse(raw);
    if (!result.success) continue;
    index++;
    const finding = result.data;
    const severity = mapSeverity(finding.severity);
    out.push({
      findingId: `${options.sourceId}-${index}`,
      sourceId: options.sourceId,
      originalSeverity: finding.severity,
      severity,
      title: finding.title,
      category: finding.category,
      location: normalizeLocation(finding.location, options.repoRoot),
      rootCause: finding.rootCause ?? null,
      impact: finding.impact,
      evidence: finding.evidence,
      evidenceTier: "agent_asserted",
      reproduction: finding.reproduction,
      suggestedFix: finding.suggestedFix ?? null,
      needsRuntimeValidation: severity === "P2",
      rawArtifactSha256: artifact.sha256,
    });
  }
  return out;
}
