import type { AgentInfo, PromptInput, PromptOutcome, StartAgentInput } from "../herdr/types.js";
import { makeArtifact, type RawReportArtifact, type ReportSourceId } from "./artifact.js";
import {
  buildReviewContract,
  CONTRACT_VERSION,
  DEFAULT_MARKERS,
  type ContractMarkers,
} from "./contract.js";
import { buildRepairPrompt, extractReportJson, parseReviewReport } from "./extract.js";

export type Slot = "a" | "b";

export interface ReviewSource {
  slot: Slot;
  kind: string;
  name: string;
}

export interface ReviewAgentGateway {
  splitPane(input: { cwd: string }): Promise<{ paneId: string }>;
  startAgent(input: StartAgentInput): Promise<AgentInfo>;
  prompt(input: PromptInput): Promise<PromptOutcome>;
}

export type CollectOutcomeKind =
  | "collected"
  | "blocked"
  | "exited"
  | "timed_out"
  | "stalled"
  | "invalid"
  | "failed";

export interface CollectOutcome {
  slot: Slot;
  kind: CollectOutcomeKind;
  detail: string | null;
  repairs: number;
}

export interface CollectedReview {
  contract: string;
  contractVersion: number;
  artifacts: Record<Slot, RawReportArtifact | null>;
  outcomes: CollectOutcome[];
}

interface CollectInput {
  projectPath: string;
  cwd: string;
  sources: [ReviewSource, ReviewSource];
  markers?: ContractMarkers;
}

interface OneResult {
  outcome: CollectOutcome;
  artifact: RawReportArtifact | null;
}

function slotToSourceId(slot: Slot): ReportSourceId {
  return slot === "a" ? "agent_a" : "agent_b";
}

/**
 * Runs two reviewers independently against the same versioned contract and
 * collects their raw reports. Invalid JSON gets exactly one repair request.
 */
export class ReviewCollector {
  constructor(private readonly gateway: ReviewAgentGateway) {}

  async collect(input: CollectInput): Promise<CollectedReview> {
    const markers = input.markers ?? DEFAULT_MARKERS;
    const contract = buildReviewContract({ projectPath: input.projectPath, markers });
    const [a, b] = await Promise.all([
      this.collectOne(input, input.sources[0], contract, markers),
      this.collectOne(input, input.sources[1], contract, markers),
    ]);
    return {
      contract,
      contractVersion: CONTRACT_VERSION,
      artifacts: { a: a.artifact, b: b.artifact },
      outcomes: [a.outcome, b.outcome],
    };
  }

  private async collectOne(
    input: CollectInput,
    source: ReviewSource,
    contract: string,
    markers: ContractMarkers,
  ): Promise<OneResult> {
    const sourceId = slotToSourceId(source.slot);
    try {
      const { paneId } = await this.gateway.splitPane({ cwd: input.cwd });
      await this.gateway.startAgent({ name: source.name, kind: source.kind, paneId });
      const result = await this.gateway.prompt({ target: source.name, text: contract });

      if (result.kind === "blocked") {
        return {
          artifact: makeArtifact({ sourceId, agentKind: source.kind, content: result.output }),
          outcome: { slot: source.slot, kind: "blocked", detail: null, repairs: 0 },
        };
      }
      if (result.kind === "exited") {
        return { artifact: null, outcome: { slot: source.slot, kind: "exited", detail: result.message, repairs: 0 } };
      }
      if (result.kind === "timed_out") {
        return { artifact: null, outcome: { slot: source.slot, kind: "timed_out", detail: result.message, repairs: 0 } };
      }
      if (result.kind === "stalled") {
        return { artifact: null, outcome: { slot: source.slot, kind: "stalled", detail: result.message, repairs: 0 } };
      }

      const json = extractReportJson(result.output, markers);
      if (json === null) {
        return await this.repairOnce(source, sourceId, markers, result.output, "no JSON found between markers");
      }
      const parsed = parseReviewReport(json);
      if (!parsed.ok) {
        return await this.repairOnce(source, sourceId, markers, result.output, parsed.error);
      }
      return {
        artifact: makeArtifact({ sourceId, agentKind: source.kind, content: result.output }),
        outcome: { slot: source.slot, kind: "collected", detail: null, repairs: 0 },
      };
    } catch (error) {
      return {
        artifact: null,
        outcome: {
          slot: source.slot,
          kind: "failed",
          detail: error instanceof Error ? error.message : String(error),
          repairs: 0,
        },
      };
    }
  }

  private async repairOnce(
    source: ReviewSource,
    sourceId: ReportSourceId,
    markers: ContractMarkers,
    originalOutput: string,
    parseError: string,
  ): Promise<OneResult> {
    const repairPrompt = buildRepairPrompt(parseError, markers);
    let repaired: PromptOutcome;
    try {
      repaired = await this.gateway.prompt({ target: source.name, text: repairPrompt });
    } catch (error) {
      return this.invalid(source, sourceId, originalOutput, parseError);
    }

    if (repaired.kind !== "done") {
      return this.invalid(source, sourceId, originalOutput, parseError);
    }
    const json = extractReportJson(repaired.output, markers);
    if (json === null) return this.invalid(source, sourceId, originalOutput, parseError);
    const parsed = parseReviewReport(json);
    if (!parsed.ok) return this.invalid(source, sourceId, originalOutput, parseError);

    return {
      artifact: makeArtifact({ sourceId, agentKind: source.kind, content: repaired.output }),
      outcome: { slot: source.slot, kind: "collected", detail: null, repairs: 1 },
    };
  }

  private invalid(
    source: ReviewSource,
    sourceId: ReportSourceId,
    originalOutput: string,
    parseError: string,
  ): OneResult {
    return {
      artifact: makeArtifact({ sourceId, agentKind: source.kind, content: originalOutput }),
      outcome: { slot: source.slot, kind: "invalid", detail: parseError, repairs: 1 },
    };
  }
}
