import { describe, expect, it } from "vitest";
import { importReports } from "../../src/reports/import.js";
import { sha256Hex } from "../../src/reports/artifact.js";

describe("importReports", () => {
  it("wraps two imported reports as import-sourced artifacts", () => {
    const result = importReports({ a: "report A", b: "report B" });
    expect(result.a.sourceId).toBe("import");
    expect(result.a.agentKind).toBe("import");
    expect(result.a.content).toBe("report A");
    expect(result.a.sha256).toBe(sha256Hex("report A"));
    expect(result.b.content).toBe("report B");
    expect(result.b.sha256).toBe(sha256Hex("report B"));
  });
});
