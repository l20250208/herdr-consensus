import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawReportArtifact } from "./artifact.js";
import type { Slot } from "./collector.js";

/**
 * Persists collected raw reports under `<runDir>/raw/`: one `.txt` per slot
 * plus a `manifest.json` holding the full artifacts (including sha256 and any
 * null slots).
 */
export async function saveRawReports(
  runDirPath: string,
  artifacts: Record<Slot, RawReportArtifact | null>,
): Promise<void> {
  const rawDir = join(runDirPath, "raw");
  await mkdir(rawDir, { recursive: true });
  for (const slot of ["a", "b"] as const) {
    const artifact = artifacts[slot];
    if (artifact !== null) {
      await writeFile(join(rawDir, `${slot}.txt`), artifact.content, "utf8");
    }
  }
  const manifest: Record<Slot, RawReportArtifact | null> = { a: artifacts.a, b: artifacts.b };
  await writeFile(join(rawDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
