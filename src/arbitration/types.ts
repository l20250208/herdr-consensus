export type ArbitrationRecommendation = "fix" | "defer" | "reject" | "validate_more";
export type ArbitrationConfidence = "low" | "medium" | "high";

export interface ArbitrationAdvice {
  itemId: string;
  recommendation: ArbitrationRecommendation;
  rationale: string;
  evidenceRefs: string[];
  confidence: ArbitrationConfidence;
  missingValidation: string[];
  artifactSha256: string;
}

export type ArbitrationIndependence = "strong" | "weak" | "unknown";

export interface ArbitrationRunMetadata {
  reviewAgentKinds: string[];
  agentKind: string;
  model: string | null;
  provider: string | null;
  independence: ArbitrationIndependence;
}
