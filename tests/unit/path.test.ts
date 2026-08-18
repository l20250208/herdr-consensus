import { describe, expect, it } from "vitest";
import { normalizeRepoPath } from "../../src/consensus/path.js";

describe("normalizeRepoPath", () => {
  it("converts absolute paths under the repo to relative", () => {
    expect(normalizeRepoPath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("keeps relative paths", () => {
    expect(normalizeRepoPath("src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("rejects paths escaping the repo", () => {
    expect(normalizeRepoPath("../etc/passwd", "/repo")).toBeNull();
    expect(normalizeRepoPath("/etc/passwd", "/repo")).toBeNull();
  });

  it("returns null for empty paths", () => {
    expect(normalizeRepoPath("", "/repo")).toBeNull();
  });
});
