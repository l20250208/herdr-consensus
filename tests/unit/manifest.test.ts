import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("published plugin manifest", () => {
  it("runs the prebuilt bundle without source-only build steps", async () => {
    const manifest = await readFile(new URL("../../herdr-plugin.toml", import.meta.url), "utf8");

    expect(manifest).not.toContain("[[build]]");
    expect(manifest).not.toContain("pnpm run build");
    expect(manifest).toContain('command = ["node", "dist/cli.js"');
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.prepack).toBe("pnpm run build");
  });
});
