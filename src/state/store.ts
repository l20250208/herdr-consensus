import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { projectHash, runJsonPath as buildRunJsonPath } from "./paths.js";
import { readJsonFile, writeJsonAtomic } from "./json.js";
import {
  CURRENT_SCHEMA_VERSION,
  RUN_STAGES,
  decodeRunRecord,
  stageIndex,
  type AuditEvent,
  type RunRecord,
  type RunStage,
} from "./run.js";

export interface CreateRunInput {
  runId: string;
  projectPath: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class RunStore {
  constructor(private readonly root: string) {}

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    const hash = projectHash(input.projectPath);
    const existing = await this.getRun(hash, input.runId);
    if (existing !== null) return existing;

    const now = new Date().toISOString();
    const run: RunRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      runId: input.runId,
      projectPath: input.projectPath,
      projectHash: hash,
      stage: "created",
      createdAt: now,
      updatedAt: now,
      events: [{ seq: 1, at: now, type: "created", from: null, to: "created", detail: {} }],
    };
    await this.saveRun(run);
    return run;
  }

  async getRun(hash: string, runId: string): Promise<RunRecord | null> {
    const raw = await readJsonFile(buildRunJsonPath(this.root, hash, runId));
    if (raw === null) return null;
    return decodeRunRecord(raw);
  }

  async saveRun(run: RunRecord): Promise<void> {
    await writeJsonAtomic(buildRunJsonPath(this.root, run.projectHash, run.runId), run);
  }

  /**
   * Advances a run to a later stage and appends an audit event. Reaching the
   * current stage is a no-op (idempotent); moving backwards is rejected.
   */
  async transition(
    runId: string,
    to: RunStage,
    detail: Record<string, unknown> = {},
  ): Promise<RunRecord> {
    const run = await this.findRunById(runId);
    if (run === null) throw new Error(`no run found with id ${runId}`);

    const currentIndex = stageIndex(run.stage);
    const targetIndex = stageIndex(to);
    if (targetIndex === currentIndex) return run;
    if (targetIndex < currentIndex) {
      throw new Error(`cannot move backwards from ${run.stage} to ${to}`);
    }
    if (targetIndex > currentIndex + 1) {
      const next = RUN_STAGES[currentIndex + 1];
      throw new Error(`cannot skip from ${run.stage} to ${to}; next stage is ${next ?? "unknown"}`);
    }

    const now = new Date().toISOString();
    const event: AuditEvent = {
      seq: run.events.length + 1,
      at: now,
      type: "transition",
      from: run.stage,
      to,
      detail,
    };
    const updated: RunRecord = {
      ...run,
      stage: to,
      updatedAt: now,
      events: [...run.events, event],
    };
    await this.saveRun(updated);
    return updated;
  }

  async listRuns(): Promise<RunRecord[]> {
    const projectsDir = join(this.root, "projects");
    let projectEntries: Dirent[];
    try {
      projectEntries = await readdir(projectsDir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    const runs: RunRecord[] = [];
    for (const project of projectEntries) {
      if (!project.isDirectory()) continue;
      const runsDir = join(projectsDir, project.name, "runs");
      let runEntries: Dirent[];
      try {
        runEntries = await readdir(runsDir, { withFileTypes: true });
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") continue;
        throw error;
      }
      for (const entry of runEntries) {
        if (!entry.isDirectory()) continue;
        const run = await this.getRun(project.name, entry.name);
        if (run !== null) runs.push(run);
      }
    }
    return runs;
  }

  async findRunById(runId: string): Promise<RunRecord | null> {
    const runs = await this.listRuns();
    return runs.find((run) => run.runId === runId) ?? null;
  }
}
