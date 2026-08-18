import { mkdir, open, readFile, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function readJsonFile(filePath: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(text) as unknown;
}

/** Writes JSON to a temp file, fsyncs it, then atomically renames it. */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.${basename(filePath)}.tmp`);
  const content = `${JSON.stringify(data, null, 2)}\n`;

  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, filePath);

  try {
    const dirHandle = await open(dir, "r");
    await dirHandle.sync();
    await dirHandle.close();
  } catch {
    // Some filesystems do not support directory fsync. The atomic rename still
    // prevents readers from observing a partially written JSON document.
  }
}
