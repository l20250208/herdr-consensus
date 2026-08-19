import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("published plugin manifest", () => {
  it("runs actions from the prebuilt bundle and declares build steps for git installs", async () => {
    const manifest = await readFile(new URL("../../herdr-plugin.toml", import.meta.url), "utf8");

    // Actions target the bundled entry point.
    expect(manifest).toContain('command = ["node", "dist/cli.js"');
    // Git-based `herdr plugin install` builds the bundle from source on install.
    expect(manifest).toContain("[[build]]");
    expect(manifest).toContain('command = ["pnpm", "install"]');
    expect(manifest).toContain('command = ["pnpm", "run", "build"]');
    // npm packaging pre-builds the bundle so the tarball is self-contained.
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.prepack).toBe("pnpm run build");
  });
});
