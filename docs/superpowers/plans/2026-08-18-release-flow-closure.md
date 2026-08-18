# Herdr Consensus Release Flow Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing module-level implementation into a fail-closed, resumable Herdr plugin whose CLI and four manifest actions complete the documented v1 flow.

**Architecture:** Add focused workflow services between the CLI and the existing report, consensus, validation, decision, fix-plan, apply, and reporting modules. Persist every workflow artifact atomically, enforce adjacent stage transitions and artifact prerequisites, and keep explicit CLI arguments scriptable while using an injected prompt adapter for no-argument Herdr actions.

**Tech Stack:** Node.js 20+, TypeScript ESM, Zod, `@inquirer/prompts`, Vitest, fast-check, tsup, pnpm.

**Spec:** `DESIGN.md` §12.2 (`首发闭环修复设计（2026-08-18）`)

## Global Constraints

- Preserve all pre-existing dirty-worktree changes; never reset, clean, or overwrite unrelated files.
- Update `DESIGN.md` before any further interface change and keep `CHANGELOG.md` accurate.
- Use argv arrays with `child_process.spawn`; never introduce shell interpolation.
- Do not execute validation or write-agent actions without explicit user approval.
- Do not commit, merge, push, create PRs, deploy, or migrate data automatically.
- Use TDD for every production behavior: write one failing test, verify the expected failure, implement the minimum, then rerun the targeted test.
- Only create a Git commit if the staged diff can be proven to contain no pre-existing user changes.

---

### Task 1: Atomic workflow artifacts and safe report-content parsing

**Files:**
- Create: `src/state/json.ts`
- Modify: `src/state/store.ts`
- Create: `src/reports/content.ts`
- Modify: `src/consensus/normalizer.ts`
- Modify: `src/reports/import.ts`
- Test: `tests/unit/json.test.ts`
- Test: `tests/unit/report-content.test.ts`
- Test: `tests/unit/normalizer.test.ts`
- Test: `tests/unit/import.test.ts`

**Interfaces:**
- Produces: `readJsonFile(path): Promise<unknown | null>` and `writeJsonAtomic(path, data): Promise<void>`.
- Produces: `parseReportContent(content): ParseReportContentResult` supporting marker JSON, whole-file JSON, and fenced `json` blocks.
- Produces: `sanitizeReportContent(content): { content: string; rejected: boolean; reason: string | null }` with a 2 MiB UTF-8 limit and terminal-control removal.
- Consumes: existing `parseReviewReport`, `RawReportArtifact`, and `DEFAULT_MARKERS`.

- [ ] **Step 1: Write failing atomic JSON tests**

```ts
it("atomically writes and reads a workflow artifact", async () => {
  const path = join(await tempRoot(), "nested", "artifact.json");
  await writeJsonAtomic(path, { items: ["a"] });
  await expect(readJsonFile(path)).resolves.toEqual({ items: ["a"] });
});

it("ignores a stale temp file when the committed artifact exists", async () => {
  const root = await tempRoot();
  const path = join(root, "artifact.json");
  await writeJsonAtomic(path, { version: 1 });
  await writeFile(join(root, ".artifact.json.tmp"), "{ partial", "utf8");
  await expect(readJsonFile(path)).resolves.toEqual({ version: 1 });
});
```

- [ ] **Step 2: Run the JSON tests and verify RED**

Run: `pnpm vitest run tests/unit/json.test.ts`

Expected: FAIL because `src/state/json.ts` does not exist.

- [ ] **Step 3: Implement and reuse atomic JSON I/O**

```ts
export async function readJsonFile(path: string): Promise<unknown | null>;
export async function writeJsonAtomic(path: string, data: unknown): Promise<void>;
```

Move the existing temp-file, `fsync`, and rename implementation from `RunStore` into `src/state/json.ts`; update `RunStore` to import it without changing run-record behavior.

- [ ] **Step 4: Run the JSON and store tests and verify GREEN**

Run: `pnpm vitest run tests/unit/json.test.ts tests/unit/store.test.ts`

Expected: both files PASS.

- [ ] **Step 5: Write failing report-content tests**

```ts
it.each([
  ["whole JSON", JSON.stringify({ schemaVersion: 1, findings: [] })],
  ["fenced JSON", "```json\n{\"schemaVersion\":1,\"findings\":[]}\n```"],
  ["marked JSON", `${DEFAULT_MARKERS.start}\n{\"schemaVersion\":1,\"findings\":[]}\n${DEFAULT_MARKERS.end}`],
])("parses %s", (_label, content) => {
  expect(parseReportContent(content)).toMatchObject({ ok: true });
});

it("rejects unstructured text without inventing findings", () => {
  expect(parseReportContent("looks fine to me")).toEqual({
    ok: false,
    error: expect.stringContaining("supported formats"),
  });
});

it("rejects reports larger than 2 MiB", () => {
  const result = sanitizeReportContent("x".repeat(2 * 1024 * 1024 + 1));
  expect(result.rejected).toBe(true);
});
```

- [ ] **Step 6: Run report parsing tests and verify RED**

Run: `pnpm vitest run tests/unit/report-content.test.ts tests/unit/normalizer.test.ts tests/unit/import.test.ts`

Expected: FAIL because marker-only parsing cannot accept whole or fenced JSON and no size policy exists.

- [ ] **Step 7: Implement conservative parsing and sanitization**

```ts
export type ParseReportContentResult =
  | { ok: true; report: ReviewReportV1 }
  | { ok: false; error: string };

export function parseReportContent(content: string): ParseReportContentResult;
export function sanitizeReportContent(content: string): {
  content: string;
  rejected: boolean;
  reason: string | null;
};
```

Try marker content first, then trimmed whole-file JSON, then exactly one fenced `json` block. Never infer findings from prose. Strip C0/C1 terminal controls while preserving `\n`, `\r`, and `\t`. Update `normalizeReport` to use `parseReportContent` and update `importReports` to sanitize before creating artifacts.

- [ ] **Step 8: Run targeted tests and verify GREEN**

Run: `pnpm vitest run tests/unit/report-content.test.ts tests/unit/normalizer.test.ts tests/unit/import.test.ts tests/unit/collector.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 9: Commit only if isolation is provable**

```bash
git add src/state/json.ts src/state/store.ts src/reports/content.ts src/consensus/normalizer.ts src/reports/import.ts tests/unit/json.test.ts tests/unit/report-content.test.ts tests/unit/normalizer.test.ts tests/unit/import.test.ts
git diff --cached --check
git commit -m "fix: add safe atomic report processing primitives"
```

Skip the commit if staged hunks contain any pre-existing change.

---

### Task 2: Review processing service and automatic consensus generation

**Files:**
- Create: `src/workflow/process-review.ts`
- Modify: `src/cli.ts`
- Modify: `src/reports/storage.ts`
- Test: `tests/unit/process-review.test.ts`
- Test: `tests/unit/cli-review.test.ts`

**Interfaces:**
- Consumes: `RawReportArtifact`, `normalizeReport`, `runConsensus`, `RunStore`, and atomic JSON I/O.
- Produces: `processReview(input, store): Promise<ProcessReviewResult>`.
- Produces: `loadRawReports(runDir): Promise<Record<"a" | "b", RawReportArtifact | null>>`.
- Persists: `normalized/findings.json` as a combined array and `consensus.json` as `{ items }`.

- [ ] **Step 1: Write the failing processing-service test**

```ts
it("normalizes both slots, writes consensus, and advances adjacent stages", async () => {
  const fixture = await createReviewingRunWithTwoArtifacts();
  const result = await processReview({
    run: fixture.run,
    runDir: fixture.runDir,
    artifacts: fixture.artifacts,
  }, fixture.store);

  expect(result.findings.map((f) => f.sourceId)).toEqual(["agent_a", "agent_b"]);
  expect(result.items).toHaveLength(1);
  expect((await fixture.store.findRunById(fixture.run.runId))?.stage).toBe("consensus");
  await expect(readJsonFile(join(fixture.runDir, "consensus.json")))
    .resolves.toEqual({ items: result.items });
});
```

- [ ] **Step 2: Run the processing test and verify RED**

Run: `pnpm vitest run tests/unit/process-review.test.ts`

Expected: FAIL because the workflow service is missing.

- [ ] **Step 3: Implement `processReview`**

```ts
export interface ProcessReviewResult {
  findings: NormalizedFinding[];
  items: ConsensusItem[];
}

export async function processReview(
  input: ProcessReviewInput,
  store: RunStore,
): Promise<ProcessReviewResult>;
```

Validate both artifacts before writing. Normalize slot A with `sourceId: "agent_a"` and slot B with `sourceId: "agent_b"`, even for imports. Write findings, transition to `normalized`, compute/write consensus, then transition to `consensus`. If either report cannot parse, throw a user-facing `ReviewProcessingError` before any stage transition.

- [ ] **Step 4: Run the processing test and verify GREEN**

Run: `pnpm vitest run tests/unit/process-review.test.ts`

Expected: PASS.

- [ ] **Step 5: Change CLI review tests to require the full closure**

```ts
expect(runs[0]?.stage).toBe("consensus");
expect(JSON.parse(await readFile(join(runDir, "normalized", "findings.json"), "utf8")))
  .toHaveLength(0);
expect(JSON.parse(await readFile(join(runDir, "consensus.json"), "utf8")))
  .toEqual({ items: [] });
```

Add an import test using whole-file JSON and a negative test asserting that unstructured text is saved under `raw/`, returns exit code 1, and leaves the run at `reviewing`.

- [ ] **Step 6: Run CLI review tests and verify RED**

Run: `pnpm vitest run tests/unit/cli-review.test.ts`

Expected: FAIL because `start` and `import` still stop after raw storage.

- [ ] **Step 7: Connect `start` and `import` to processing**

Call `processReview` only after two valid collected artifacts exist. On processing failure, print the precise supported-format error, retain raw artifacts, and return 1. Include `{ stage: "consensus" }` in JSON output.

- [ ] **Step 8: Run targeted CLI tests and verify GREEN**

Run: `pnpm vitest run tests/unit/process-review.test.ts tests/unit/cli-review.test.ts`

Expected: both files PASS.

- [ ] **Step 9: Commit only if isolation is provable**

```bash
git add src/workflow/process-review.ts src/cli.ts src/reports/storage.ts tests/unit/process-review.test.ts tests/unit/cli-review.test.ts
git diff --cached --check
git commit -m "fix: close review to consensus workflow"
```

---

### Task 3: Adjacent stage transitions and command prerequisites

**Files:**
- Modify: `src/state/store.ts`
- Create: `src/workflow/guards.ts`
- Modify: `src/cli.ts`
- Test: `tests/unit/store.test.ts`
- Create: `tests/unit/workflow-guards.test.ts`
- Modify: `tests/unit/cli-validate.test.ts`
- Modify: `tests/unit/cli-arbitrate.test.ts`
- Modify: `tests/unit/cli-decide.test.ts`
- Modify: `tests/unit/cli-lock.test.ts`
- Modify: `tests/unit/cli-apply.test.ts`
- Modify: `tests/unit/cli-report.test.ts`

**Interfaces:**
- Produces: `requireRunStage(run, allowedStages)` and `requireArtifacts(paths)` returning actionable failures.
- Changes: `RunStore.transition` accepts same-stage idempotence or exactly `currentIndex + 1`.

- [ ] **Step 1: Write the failing state-machine test**

```ts
it("rejects skipping a lifecycle stage", async () => {
  const store = new RunStore(await tempRoot());
  await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });
  await expect(store.transition("run-1", "consensus"))
    .rejects.toThrow(/skip.*reviewing/i);
});
```

- [ ] **Step 2: Run the store test and verify RED**

Run: `pnpm vitest run tests/unit/store.test.ts`

Expected: FAIL because forward skips are currently accepted.

- [ ] **Step 3: Enforce adjacent transitions**

```ts
if (targetIndex > currentIndex + 1) {
  throw new Error(`cannot skip from ${run.stage} to ${to}; next stage is ${RUN_STAGES[currentIndex + 1]}`);
}
```

- [ ] **Step 4: Run the store test and verify GREEN**

Run: `pnpm vitest run tests/unit/store.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing command-guard tests**

Add one test per command proving that a `reviewing` run cannot execute `validate`, `arbitrate`, `decide`, `lock`, `apply`, or `report`. Also prove `lock` rejects missing decisions/consensus and `report` rejects missing fix-plan/worktree instead of emitting null sections.

```ts
const code = await main(["lock", runId], deps);
expect(code).toBe(1);
expect(err()).toMatch(/requires stage deciding|missing consensus/i);
expect(await pathExists(join(dir, "fix-plan.json"))).toBe(false);
```

- [ ] **Step 6: Run guard tests and verify RED**

Run: `pnpm vitest run tests/unit/workflow-guards.test.ts tests/unit/cli-validate.test.ts tests/unit/cli-arbitrate.test.ts tests/unit/cli-decide.test.ts tests/unit/cli-lock.test.ts tests/unit/cli-apply.test.ts tests/unit/cli-report.test.ts`

Expected: failures show commands currently skip stages or accept missing artifacts.

- [ ] **Step 7: Implement and apply centralized guards**

```ts
export function requireRunStage(run: RunRecord, stages: readonly RunStage[]): void;
export async function requireArtifacts(paths: readonly string[]): Promise<void>;
```

Use exact stage expectations: `validate=consensus`, `arbitrate=validating`, `decide=arbitrating`, `lock=deciding`, `apply=locked`, `report=applying`. Commands with zero target items must still record their adjacent stage transition, but never synthesize missing input.

- [ ] **Step 8: Update fixtures to advance through real stages**

Test helpers must call each adjacent transition rather than seeding a late-stage file on a `created` run. Do not weaken production guards to preserve old tests.

- [ ] **Step 9: Run all guard tests and verify GREEN**

Run the command from Step 6 again.

Expected: all selected files PASS.

- [ ] **Step 10: Commit only if isolation is provable**

Stage only Task 3 files, inspect the cached diff, and commit as `fix: enforce workflow stage prerequisites` if no pre-existing hunks are included.

---

### Task 4: Resumable processing and injected interactive prompts

**Files:**
- Create: `src/workflow/resume.ts`
- Create: `src/ui/prompts.ts`
- Modify: `src/cli.ts`
- Modify: `src/commands/resume.ts`
- Test: `tests/unit/resume-workflow.test.ts`
- Test: `tests/unit/cli-actions.test.ts`
- Modify: `tests/unit/commands.test.ts`

**Interfaces:**
- Produces: `resumeRun(runId, deps): Promise<ResumeResult>`.
- Produces: `PromptAdapter` with `input`, `select`, and `confirm` methods wrapping `@inquirer/prompts`.
- Adds to `CliDeps`: optional `prompts?: PromptAdapter` and `interactive?: boolean`.

- [ ] **Step 1: Write failing resume tests**

```ts
it("resumes reviewing from complete raw artifacts to consensus", async () => {
  const fixture = await createReviewingRunWithSavedRaw();
  const result = await resumeRun(fixture.run.runId, fixture.deps);
  expect(result.stage).toBe("consensus");
});

it("does not restart agents when raw artifacts are incomplete", async () => {
  const fixture = await createReviewingRunWithOneRawArtifact();
  await expect(resumeRun(fixture.run.runId, fixture.deps))
    .rejects.toThrow(/cannot resume.*missing raw/i);
});
```

- [ ] **Step 2: Run resume tests and verify RED**

Run: `pnpm vitest run tests/unit/resume-workflow.test.ts`

Expected: FAIL because resume only formats status.

- [ ] **Step 3: Implement safe resume dispatch**

For `reviewing`, load both raw artifacts and call `processReview`. For `normalized`, load normalized findings split by `sourceId`, recompute/write `{ items }`, and transition to `consensus`. For later stages, return a `nextCommand` string without executing an approval-bearing action.

- [ ] **Step 4: Run resume tests and verify GREEN**

Run: `pnpm vitest run tests/unit/resume-workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing no-argument action tests**

Inject a fake `PromptAdapter`. Prove:

```ts
await main(["start"], { ...deps, interactive: true, prompts: fakePrompts([
  "claude", "codex",
]) });

await main(["resume"], { ...deps, interactive: true, prompts: fakePrompts([runId]) });

await expect(main(["start"], { ...deps, interactive: false }))
  .resolves.toBe(2);
```

Also cover no-argument `decide` and `report` run selection without invoking real terminal input.

- [ ] **Step 6: Run action tests and verify RED**

Run: `pnpm vitest run tests/unit/cli-actions.test.ts`

Expected: FAIL because the CLI has no prompt adapter.

- [ ] **Step 7: Implement prompt adapter and missing-argument selection**

```ts
export interface PromptAdapter {
  input(message: string): Promise<string>;
  select<T>(message: string, choices: Array<{ name: string; value: T }>): Promise<T>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}
```

Use interactive prompts only when `deps.interactive ?? (process.stdin.isTTY && process.stdout.isTTY)` is true. Otherwise preserve explicit usage errors. Sort unfinished runs by `updatedAt` descending.

- [ ] **Step 8: Run action and existing CLI tests and verify GREEN**

Run: `pnpm vitest run tests/unit/cli-actions.test.ts tests/unit/cli.test.ts tests/unit/commands.test.ts`

Expected: all selected files PASS.

- [ ] **Step 9: Commit only if isolation is provable**

Stage only Task 4 files, inspect, and commit as `feat: add resumable interactive plugin actions` when safe.

---

### Task 5: Real decision wizard and immutable fix-plan versions

**Files:**
- Create: `src/ui/decision-wizard.ts`
- Modify: `src/cli.ts`
- Create: `src/fix-plan/store.ts`
- Modify: `tests/unit/cli-decide.test.ts`
- Modify: `tests/unit/cli-lock.test.ts`
- Test: `tests/unit/decision-wizard.test.ts`
- Test: `tests/unit/fix-plan-store.test.ts`

**Interfaces:**
- Produces: `runDecisionWizard(context, existing, prompts): Promise<UserDecision[]>`.
- Produces: `saveFixPlanVersion(runDir, plan, markdown): Promise<void>` writing immutable `fix-plans/v<N>.*` and latest root copies.

- [ ] **Step 1: Write failing decision-wizard tests**

```ts
it("shows evidence and writes one snapshot-bound decision per item", async () => {
  const prompts = recordingPrompts(["approved_fix", "because reproduced"]);
  const decisions = await runDecisionWizard(contextWithOneDisputedItem(), [], prompts);
  expect(prompts.messages.join("\n")).toContain("validation");
  expect(prompts.messages.join("\n")).toContain("arbitration");
  expect(decisions[0]).toMatchObject({ itemId: "i1", decision: "approved_fix" });
  expect(decisions[0]?.evidenceSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Run wizard tests and verify RED**

Run: `pnpm vitest run tests/unit/decision-wizard.test.ts tests/unit/cli-decide.test.ts`

Expected: FAIL because no interactive wizard exists.

- [ ] **Step 3: Implement the wizard and connect `decide`**

The wizard iterates undecided items, renders both normalized findings plus validation/arbitration summaries, offers exactly `approved_fix`, `deferred`, `rejected`, `validate_more`, asks an optional reason, computes the existing evidence snapshot, and saves after every item so interruption is recoverable.

- [ ] **Step 4: Run decision tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write failing immutable-plan tests**

```ts
await saveFixPlanVersion(dir, planV1, renderFixPlanMarkdown(planV1));
await saveFixPlanVersion(dir, planV2, renderFixPlanMarkdown(planV2));
expect(JSON.parse(await readFile(join(dir, "fix-plans", "v1.json"), "utf8"))).toEqual(planV1);
expect(JSON.parse(await readFile(join(dir, "fix-plan.json"), "utf8"))).toEqual(planV2);
await expect(saveFixPlanVersion(dir, planV1, "duplicate"))
  .rejects.toThrow(/already exists/i);
```

- [ ] **Step 6: Run fix-plan store tests and verify RED**

Run: `pnpm vitest run tests/unit/fix-plan-store.test.ts tests/unit/cli-lock.test.ts`

Expected: FAIL because root files are overwritten without archives.

- [ ] **Step 7: Implement immutable version storage and connect `lock`**

Write version files with exclusive-create semantics, then atomically update root latest copies. A duplicate version fails before changing latest. Keep SHA calculation unchanged.

- [ ] **Step 8: Run lock tests and verify GREEN**

Run the command from Step 6.

Expected: PASS.

- [ ] **Step 9: Commit only if isolation is provable**

Stage only Task 5 files, inspect, and commit as `feat: add recoverable decisions and immutable fix plans` when safe.

---

### Task 6: Arbitration provenance and independence warnings

**Files:**
- Modify: `src/arbitration/types.ts`
- Create: `src/arbitration/provenance.ts`
- Modify: `src/cli.ts`
- Modify: `src/reporting/types.ts`
- Modify: `tests/unit/arbitration.test.ts`
- Modify: `tests/unit/cli-arbitrate.test.ts`
- Modify: `tests/unit/reporting.test.ts`

**Interfaces:**
- Produces: `ArbitrationRunMetadata { agentKind, model, provider, independence }`.
- Produces: `assessIndependence(reviewKinds, arbiterKind): "strong" | "weak" | "unknown"`.
- Persists: `arbitration/metadata.json` alongside `advice.json`.

- [ ] **Step 1: Write failing provenance tests**

```ts
expect(assessIndependence(["codex", "claude"], "codex")).toBe("weak");
expect(assessIndependence(["codex", "claude"], "gemini")).toBe("strong");
expect(assessIndependence([], "gemini")).toBe("unknown");
```

Add a CLI test asserting `metadata.json` records `model: null` when Herdr cannot expose it and that a same-kind arbiter prints an independence warning.

- [ ] **Step 2: Run arbitration tests and verify RED**

Run: `pnpm vitest run tests/unit/arbitration.test.ts tests/unit/cli-arbitrate.test.ts tests/unit/reporting.test.ts`

Expected: FAIL because provenance is not recorded.

- [ ] **Step 3: Implement provenance recording**

Derive review kinds from `raw/manifest.json`; never invent a model/provider. Store `null` when unavailable. Include metadata in the unified report and terminal warning without changing advice decisions.

- [ ] **Step 4: Run arbitration/report tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit only if isolation is provable**

Stage only Task 6 files, inspect, and commit as `feat: record arbitration provenance` when safe.

---

### Task 7: Apply-time path enforcement, targeted checks, and final report schema

**Files:**
- Modify: `src/apply/git.ts`
- Create: `src/apply/verify.ts`
- Modify: `src/cli.ts`
- Modify: `src/reporting/types.ts`
- Modify: `src/reporting/generate.ts`
- Create: `schemas/final-report.v1.json`
- Modify: `tests/unit/apply.test.ts`
- Modify: `tests/unit/cli-apply.test.ts`
- Modify: `tests/unit/reporting.test.ts`
- Modify: `tests/unit/cli-report.test.ts`

**Interfaces:**
- Produces: `listChangedPaths(worktreePath, run): Promise<string[]>`.
- Produces: `verifyAllowedPaths(plan, changedPaths): { ok: boolean; violations: string[] }`.
- Produces: `runTargetedChecks(plan, validationRecords, worktreePath, run)` that only reuses previously approved argv arrays.
- Adds `schemaVersion: 1`, changed paths, path-policy result, and targeted-check results to `UnifiedReport`.

- [ ] **Step 1: Write failing apply verification tests**

```ts
it("rejects changes outside all locked allowedPaths", () => {
  const result = verifyAllowedPaths(planAllowing(["src/a.ts"]), ["src/a.ts", "src/b.ts"]);
  expect(result).toEqual({ ok: false, violations: ["src/b.ts"] });
});

it("runs only approved validation argv for matching plan items", async () => {
  await runTargetedChecks(planWithItem("i1"), [approvedRecord("i1", ["pnpm", "test"])], worktree, runner);
  expect(calls).toEqual([["pnpm", "test"]]);
});
```

- [ ] **Step 2: Run apply tests and verify RED**

Run: `pnpm vitest run tests/unit/apply.test.ts tests/unit/cli-apply.test.ts`

Expected: FAIL because apply does not inspect changed paths or run targeted checks.

- [ ] **Step 3: Implement post-agent apply verification**

Use `git diff --name-only` in the isolated worktree. If any changed path is outside the union of locked `allowedPaths`, preserve the worktree/log, print violations, return 1, and do not transition to `applying`. Re-run only safe, previously approved validation argv records for plan item IDs; persist results under `logs/targeted-checks.json`.

- [ ] **Step 4: Run apply tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write failing final-report schema tests**

Add `schemaVersion: 1` to the report fixture and validate the emitted report against Zod or a test-local import of the JSON Schema constraints. Assert missing consensus, fix-plan, changed-path policy, or regression evidence cannot produce a successful final report.

- [ ] **Step 6: Run report tests and verify RED**

Run: `pnpm vitest run tests/unit/reporting.test.ts tests/unit/cli-report.test.ts`

Expected: FAIL because the report type/schema lacks the new fields and currently accepts null prerequisites.

- [ ] **Step 7: Implement schema-aligned report generation**

Create `schemas/final-report.v1.json` with required top-level keys matching the runtime `UnifiedReport`. Include arbitration metadata, changed paths, path policy, targeted checks, regression, and existing evidence sections. Make missing mandatory input a command failure rather than a null-filled successful report.

- [ ] **Step 8: Run apply/report tests and verify GREEN**

Run: `pnpm vitest run tests/unit/apply.test.ts tests/unit/cli-apply.test.ts tests/unit/reporting.test.ts tests/unit/cli-report.test.ts`

Expected: all selected files PASS.

- [ ] **Step 9: Commit only if isolation is provable**

Stage only Task 7 files, inspect, and commit as `fix: verify locked apply scope and final reports` when safe.

---

### Task 8: Distribution boundary and complete no-model CLI fixture

**Files:**
- Modify: `package.json`
- Create: `tests/e2e/cli-workflow.test.ts`
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Package `files` allowlist includes `dist/`, `herdr-plugin.toml`, `README.md`, `LICENSE`, `schemas/`, and `prompts/` only.
- E2E fixture drives public CLI commands with injected fake Herdr/runner dependencies and inspects state artifacts after every stage.

- [ ] **Step 1: Write the failing no-model E2E test**

```ts
it("runs review through final report without changing the fixture main worktree", async () => {
  const before = await gitStatus(fixtureRepo);
  const review = await invoke(["start", "--agent-a", "claude", "--agent-b", "codex"]);
  await invoke(["validate", review.runId]);
  await invoke(["validate", review.runId, "--approve"]);
  await invoke(["arbitrate", review.runId, "--agent", "gemini"]);
  await invokeDecisionWizard(review.runId);
  await invoke(["lock", review.runId]);
  await invoke(["apply", review.runId, "--agent", "codex"]);
  await invoke(["report", review.runId]);
  expect((await loadRun(review.runId)).stage).toBe("reported");
  expect(await gitStatus(fixtureRepo)).toBe(before);
});
```

The fake gateway must return one common P1, one P2, and one disputed item so validation, arbitration, decisions, lock, apply, and report are all exercised.

- [ ] **Step 2: Run E2E and verify RED**

Run: `pnpm vitest run tests/e2e/cli-workflow.test.ts`

Expected: FAIL at the first remaining workflow gap.

- [ ] **Step 3: Fix only defects exposed by the E2E test**

For each failure, add or tighten a focused unit test before changing production code. Do not weaken the E2E expectations or seed internal artifacts that a public command should create.

- [ ] **Step 4: Run E2E and verify GREEN**

Run: `pnpm vitest run tests/e2e/cli-workflow.test.ts`

Expected: PASS with final stage `reported` and unchanged fixture main worktree.

- [ ] **Step 5: Write the failing package-boundary check**

Run: `npm_config_cache=/tmp/herdr-consensus-npm-cache npm pack --dry-run --json`

Expected before `files` allowlist: output includes `src/` and `tests/`, violating `DESIGN.md` §12.2.

- [ ] **Step 6: Add the package allowlist and verify the dry run**

```json
"files": [
  "dist",
  "herdr-plugin.toml",
  "README.md",
  "LICENSE",
  "schemas",
  "prompts"
]
```

Run the dry-run command again and assert no entry starts with `src/`, `tests/`, or `docs/`.

- [ ] **Step 7: Run the complete automated release gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npm_config_cache=/tmp/herdr-consensus-npm-cache npm pack --dry-run --json
node dist/cli.js doctor --json
```

Expected: lint/typecheck/test/build/package commands exit 0. `doctor` may return an Agent-enumeration warning outside a Herdr pane; record the exact result.

- [ ] **Step 8: Attempt real Herdr smoke tests**

Run Codex + Claude and Codex + Pi read-only fixture reviews from a valid Herdr pane. Record the exact Herdr version, command, Agent states, outputs, and failures. Do not mark either combination verified unless it reaches `consensus` from the public `start` command.

- [ ] **Step 9: Update project documentation truthfully**

Update `README.md` validation matrix, `DESIGN.md` phase statuses/current phase, and the top `[Unreleased]` CHANGELOG entry with:

- every file modified;
- why it changed;
- exact verification commands and results;
- real smoke-test status;
- remaining blockers and next-maintainer instructions.

Keep stage 12 `进行中` or `阻塞` if any required real combination or Linux fixture remains unverified.

- [ ] **Step 10: Commit only if isolation is provable**

Stage the exact Task 8 files plus previously uncommitted task files only after reviewing `git diff --cached --stat` and `git diff --cached`. If pre-existing user changes cannot be separated safely, do not commit and report that constraint.

---

## Plan Self-Review Results

- Spec coverage: processing, import formats, atomic persistence, resume, no-argument actions, decision wizard, stage guards, immutable plans, arbitration provenance, apply verification, final schema, E2E, packaging, smoke tests, and documentation are each assigned to a task.
- Placeholder scan: no TBD/TODO/“implement later” steps remain; environment-dependent smoke tests specify how to record a blocked result.
- Type consistency: `ProcessReviewResult`, `PromptAdapter`, `ArbitrationRunMetadata`, and apply/report verification outputs are introduced before later consumers use them.
- Scope control: no web service, database, automatic commit/push/PR/deploy, or model API integration is introduced.
