import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  decodeRunRecord,
  generateRunId,
  RunRecordError,
  RUN_STAGES,
  stageIndex,
} from "../../src/state/run.js";

describe("generateRunId", () => {
  it("produces ids matching the expected shape", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRunId()).toMatch(/^run-\d{14}-[0-9a-f]{8}$/);
    }
  });

  it("produces unique ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateRunId());
    expect(seen.size).toBe(200);
  });
});

describe("stageIndex", () => {
  it("orders stages from created to reported", () => {
    expect(stageIndex("created")).toBe(0);
    expect(stageIndex("reported")).toBe(RUN_STAGES.length - 1);
    expect(stageIndex("reviewing")).toBeGreaterThan(stageIndex("created"));
  });

  it("rejects unknown stages", () => {
    expect(() => stageIndex("bogus" as never)).toThrow();
  });
});

function validRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    runId: "run-20260818000000-00000000",
    projectPath: "/tmp/repo",
    projectHash: "abc",
    stage: "created",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    events: [
      { seq: 1, at: "2026-08-18T00:00:00.000Z", type: "created", from: null, to: "created", detail: {} },
    ],
    ...overrides,
  };
}

describe("decodeRunRecord", () => {
  it("accepts a valid record", () => {
    const run = decodeRunRecord(validRun());
    expect(run.runId).toBe("run-20260818000000-00000000");
    expect(run.stage).toBe("created");
    expect(run.events).toHaveLength(1);
  });

  it("rejects an unsupported schema version with a clear message", () => {
    expect(() => decodeRunRecord(validRun({ schemaVersion: 99 }))).toThrow(/schema version 99/);
  });

  it("rejects an invalid record", () => {
    expect(() => decodeRunRecord({ schemaVersion: CURRENT_SCHEMA_VERSION })).toThrow(RunRecordError);
  });

  it("rejects an unknown stage", () => {
    expect(() => decodeRunRecord(validRun({ stage: "bogus" }))).toThrow(RunRecordError);
  });
});
