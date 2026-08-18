import { access, link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { LockedFixPlan } from "./types.js";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function writeExclusive(path: string, content: string): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function restoreText(path: string, previous: string | null): Promise<void> {
  if (previous === null) {
    await unlink(path).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
    return;
  }
  await writeTextAtomic(path, previous);
}

export async function saveFixPlanVersion(
  runDir: string,
  plan: LockedFixPlan,
  markdown: string,
): Promise<void> {
  const versionsDir = join(runDir, "fix-plans");
  await mkdir(versionsDir, { recursive: true });
  const jsonPath = join(versionsDir, `v${plan.version}.json`);
  const markdownPath = join(versionsDir, `v${plan.version}.md`);
  if (await pathExists(jsonPath) || await pathExists(markdownPath)) {
    throw new Error(`fix-plan version ${plan.version} already exists`);
  }
  const nonce = `${process.pid}-${Date.now()}`;
  const jsonTmp = `${jsonPath}.${nonce}.tmp`;
  const markdownTmp = `${markdownPath}.${nonce}.tmp`;
  const latestJsonPath = join(runDir, "fix-plan.json");
  const latestMarkdownPath = join(runDir, "fix-plan.md");
  const previousLatestJson = await readOptionalText(latestJsonPath);
  const previousLatestMarkdown = await readOptionalText(latestMarkdownPath);
  let jsonPublished = false;
  let markdownPublished = false;
  try {
    await writeExclusive(jsonTmp, `${JSON.stringify(plan, null, 2)}\n`);
    await writeExclusive(markdownTmp, markdown);
    await link(jsonTmp, jsonPath);
    jsonPublished = true;
    await link(markdownTmp, markdownPath);
    markdownPublished = true;
    await writeTextAtomic(latestJsonPath, `${JSON.stringify(plan, null, 2)}\n`);
    await writeTextAtomic(latestMarkdownPath, markdown);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    await restoreText(latestJsonPath, previousLatestJson).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreText(latestMarkdownPath, previousLatestMarkdown).catch((rollbackError) => rollbackErrors.push(rollbackError));
    if (jsonPublished) await unlink(jsonPath).catch(() => undefined);
    if (markdownPublished) await unlink(markdownPath).catch(() => undefined);
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], `failed to publish fix-plan version ${plan.version} and rollback latest files`);
    }
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(`fix-plan version ${plan.version} already exists`);
    }
    throw error;
  } finally {
    await Promise.all([
      unlink(jsonTmp).catch(() => undefined),
      unlink(markdownTmp).catch(() => undefined),
    ]);
  }
}
