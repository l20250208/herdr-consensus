import { describe, expect, it } from "vitest";
import { mapSeverity } from "../../src/consensus/severity.js";

describe("mapSeverity", () => {
  it("maps P-prefixed severities case-insensitively", () => {
    expect(mapSeverity("P0")).toBe("P0");
    expect(mapSeverity("p1")).toBe("P1");
    expect(mapSeverity("P2")).toBe("P2");
    expect(mapSeverity("p3")).toBe("P3");
  });

  it("maps word severities", () => {
    expect(mapSeverity("critical")).toBe("P0");
    expect(mapSeverity("High")).toBe("P1");
    expect(mapSeverity("medium")).toBe("P2");
    expect(mapSeverity("low")).toBe("P3");
  });

  it("defaults unknown severities to P2", () => {
    expect(mapSeverity("some weird thing")).toBe("P2");
  });
});
