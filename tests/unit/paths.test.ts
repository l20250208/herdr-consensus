import { describe, expect, it } from "vitest";
import { projectHash, runDir, runJsonPath, stateRoot } from "../../src/state/paths.js";

describe("stateRoot", () => {
  it("uses XDG_STATE_HOME when set", () => {
    expect(stateRoot({ XDG_STATE_HOME: "/xdg" }, "darwin", "/home/u")).toBe(
      "/xdg/herdr-consensus",
    );
  });

  it("falls back to macOS Application Support", () => {
    expect(stateRoot({}, "darwin", "/Users/u")).toBe(
      "/Users/u/Library/Application Support/herdr-consensus",
    );
  });

  it("falls back to Linux .local/state", () => {
    expect(stateRoot({}, "linux", "/home/u")).toBe("/home/u/.local/state/herdr-consensus");
  });

  it("ignores an empty XDG_STATE_HOME", () => {
    expect(stateRoot({ XDG_STATE_HOME: "" }, "linux", "/home/u")).toBe(
      "/home/u/.local/state/herdr-consensus",
    );
  });
});

describe("projectHash", () => {
  it("is stable for a given path", () => {
    expect(projectHash("/tmp/repo")).toBe(projectHash("/tmp/repo"));
  });

  it("is a 64-character hex digest", () => {
    expect(projectHash("/tmp/repo")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different paths", () => {
    expect(projectHash("/tmp/a")).not.toBe(projectHash("/tmp/b"));
  });
});

describe("run paths", () => {
  it("composes project and run directories", () => {
    expect(runDir("/state", "hash", "run-1")).toBe("/state/projects/hash/runs/run-1");
    expect(runJsonPath("/state", "hash", "run-1")).toBe(
      "/state/projects/hash/runs/run-1/run.json",
    );
  });
});
