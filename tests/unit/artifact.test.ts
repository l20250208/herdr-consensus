import { describe, expect, it } from "vitest";
import { makeArtifact, sha256Hex } from "../../src/reports/artifact.js";

describe("sha256Hex", () => {
  it("is a 64-character hex digest", () => {
    expect(sha256Hex("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });

  it("differs for different content", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("makeArtifact", () => {
  it("fills sourceId, agentKind, content and sha256", () => {
    const artifact = makeArtifact({
      sourceId: "agent_a",
      agentKind: "claude",
      content: "raw output",
    });
    expect(artifact.sourceId).toBe("agent_a");
    expect(artifact.agentKind).toBe("claude");
    expect(artifact.content).toBe("raw output");
    expect(artifact.sha256).toBe(sha256Hex("raw output"));
    expect(artifact.model).toBeNull();
    expect(artifact.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
