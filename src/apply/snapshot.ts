import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Runner } from "../spawn.js";
import { listChangedPaths } from "./verify.js";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function computeWorkspaceSnapshotSha256(input: {
  worktreePath: string;
  baseCommit: string;
  run: Runner;
}): Promise<string> {
  const changedPaths = await listChangedPaths(input.worktreePath, input.run, input.baseCommit);
  const hash = createHash("sha256");
  hash.update(`${JSON.stringify({ baseCommit: input.baseCommit, changedPaths })}\n`);
  const root = resolve(input.worktreePath);

  for (const path of changedPaths) {
    const absolutePath = resolve(root, path);
    const fromRoot = relative(root, absolutePath);
    if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
      throw new Error(`changed path escapes worktree: ${path}`);
    }
    try {
      const stat = await lstat(absolutePath);
      const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : "other";
      hash.update(`${JSON.stringify({ path, kind, mode: stat.mode })}\n`);
      if (stat.isSymbolicLink()) {
        hash.update(await readlink(absolutePath));
      } else if (stat.isFile()) {
        for await (const chunk of createReadStream(absolutePath)) hash.update(chunk as Buffer);
      }
      hash.update("\n");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        hash.update(`${JSON.stringify({ path, kind: "deleted" })}\n`);
        continue;
      }
      throw error;
    }
  }
  return hash.digest("hex");
}
