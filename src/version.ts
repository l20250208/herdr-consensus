export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

/**
 * Extracts the first `major.minor.patch` triple from an arbitrary version
 * string (e.g. `v22.23.1`, `git version 2.50.1 (Apple Git-155)`, `herdr 0.8.0`).
 * Returns `null` when no triple is present.
 */
export function parseSemver(input: string): SemVer | null {
  const match = SEMVER_PATTERN.exec(input);
  if (match === null) return null;
  const [, majorText, minorText, patchText] = match;
  if (majorText === undefined || minorText === undefined || patchText === undefined) {
    return null;
  }
  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
  };
}

/** Compares `version` against `minimum`; returns true when `version >= minimum`. */
export function satisfiesMinimum(version: SemVer, minimum: SemVer): boolean {
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  return version.patch >= minimum.patch;
}
