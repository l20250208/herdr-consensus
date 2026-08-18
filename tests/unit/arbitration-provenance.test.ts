import { describe, expect, it } from "vitest";
import { assessIndependence } from "../../src/arbitration/provenance.js";

describe("arbitration independence", () => {
  it("is weak when the arbiter repeats a reviewer kind", () => {
    expect(assessIndependence(["codex", "claude"], "codex")).toBe("weak");
  });

  it("is strong when the arbiter kind differs from both reviewers", () => {
    expect(assessIndependence(["codex", "claude"], "gemini")).toBe("strong");
  });

  it("is unknown without two known reviewer kinds", () => {
    expect(assessIndependence([], "gemini")).toBe("unknown");
    expect(assessIndependence(["codex"], "gemini")).toBe("unknown");
  });
});
