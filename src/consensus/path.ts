import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

/**
 * Converts an absolute or relative path to a repo-relative path using forward
 * slashes. Returns `null` for empty paths and for paths that escape the repo.
 */
export function normalizeRepoPath(raw: string, repoRoot: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const abs = isAbsolute(trimmed) ? normalize(trimmed) : resolve(repoRoot, trimmed);
  const rel = relative(repoRoot, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}
