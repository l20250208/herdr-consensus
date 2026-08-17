import { describe, expect, it } from "vitest";
import { parseSemver, satisfiesMinimum } from "../../src/version.js";

describe("parseSemver", () => {
  it("parses a bare semantic version", () => {
    expect(parseSemver("22.23.1")).toEqual({ major: 22, minor: 23, patch: 1 });
  });

  it("parses a version with a leading v", () => {
    expect(parseSemver("v20.11.0")).toEqual({ major: 20, minor: 11, patch: 0 });
  });

  it("parses a git version string with trailing metadata", () => {
    expect(parseSemver("git version 2.50.1 (Apple Git-155)")).toEqual({
      major: 2,
      minor: 50,
      patch: 1,
    });
  });

  it("parses a herdr version string", () => {
    expect(parseSemver("herdr 0.8.0")).toEqual({ major: 0, minor: 8, patch: 0 });
  });

  it("returns null when no version triple is present", () => {
    expect(parseSemver("no version here")).toBeNull();
  });
});

describe("satisfiesMinimum", () => {
  const minimum = { major: 20, minor: 0, patch: 0 };

  it("accepts a newer major", () => {
    expect(satisfiesMinimum({ major: 22, minor: 0, patch: 0 }, minimum)).toBe(true);
  });

  it("accepts the exact minimum", () => {
    expect(satisfiesMinimum({ major: 20, minor: 0, patch: 0 }, minimum)).toBe(true);
  });

  it("accepts a newer minor on the same major", () => {
    expect(satisfiesMinimum({ major: 20, minor: 3, patch: 0 }, minimum)).toBe(true);
  });

  it("rejects an older major", () => {
    expect(satisfiesMinimum({ major: 19, minor: 11, patch: 0 }, minimum)).toBe(false);
  });

  it("rejects an older minor on the same major", () => {
    expect(
      satisfiesMinimum({ major: 20, minor: 0, patch: 0 }, { major: 20, minor: 1, patch: 0 }),
    ).toBe(false);
  });

  it("rejects an older patch on the same minor", () => {
    expect(
      satisfiesMinimum({ major: 20, minor: 0, patch: 0 }, { major: 20, minor: 0, patch: 1 }),
    ).toBe(false);
  });
});
