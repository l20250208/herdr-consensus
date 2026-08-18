import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsensusItem } from "../consensus/types.js";
import type { ValidationPlan } from "./types.js";
import { checkValidationCommandSafety } from "./safety.js";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function nodeTestCommand(projectPath: string): Promise<string[] | null> {
  const pkg = join(projectPath, "package.json");
  if (!(await exists(pkg))) return null;
  const parsed = JSON.parse(await readFile(pkg, "utf8")) as { scripts?: Record<string, string> };
  if (parsed.scripts?.test === undefined) return null;
  if (await exists(join(projectPath, "pnpm-lock.yaml"))) return ["pnpm", "test"];
  if (await exists(join(projectPath, "yarn.lock"))) return ["yarn", "test"];
  return ["npm", "test"];
}

export async function detectValidationCommand(projectPath: string): Promise<string[] | null> {
  const node = await nodeTestCommand(projectPath);
  if (node !== null) return node;
  if (await exists(join(projectPath, "pytest.ini")) || await exists(join(projectPath, "pyproject.toml"))) return ["pytest"];
  if (await exists(join(projectPath, "Cargo.toml"))) return ["cargo", "test"];
  if (await exists(join(projectPath, "go.mod"))) return ["go", "test", "./..."];
  if (await exists(join(projectPath, "gradlew"))) return ["./gradlew", "test"];
  return null;
}

export async function planP2Validations(input: { projectPath: string; items: readonly ConsensusItem[] }): Promise<ValidationPlan[]> {
  const argv = await detectValidationCommand(input.projectPath);
  if (argv === null) return [];
  const safety = checkValidationCommandSafety(argv);
  if (!safety.safe) return [];
  return input.items
    .filter((item) => item.severity === "P2" && item.status !== "validated_true")
    .map((item) => ({ itemId: item.itemId, argv, cwd: input.projectPath, timeoutMs: 120_000, reason: "project test command detected" }));
}
