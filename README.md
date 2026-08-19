# Herdr Consensus

![version](https://img.shields.io/badge/version-0.1.0-blue)
![license](https://img.shields.io/badge/license-Apache--2.0-green)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![herdr](https://img.shields.io/badge/Herdr-%E2%89%A50.8.0-blueviolet)

An independent Herdr plugin and CLI that turns two isolated local Coding Agent review reports into a traceable consensus, validation, human decision, locked fix plan, isolated worktree fix, and final report.

> Maintainer/AI handoff status is recorded in [`HANDOFF.md`](./HANDOFF.md).

## Attribution

**Herdr is not this project.** This is a plugin *for* Herdr, built by a third party.

- [Herdr](https://github.com/herdrdev/herdr) is a terminal workspace manager for AI coding agents, created and maintained by the Herdr team ([herdrdev](https://github.com/herdrdev)). All Herdr code, trademarks, and documentation belong to their respective owners.
- Herdr Consensus does **not** fork, modify, bundle, or claim ownership of Herdr. It runs *alongside* Herdr and drives it only through the public `herdr` CLI (`herdr tab create`, `herdr agent start`, `herdr agent prompt`, and so on).
- Herdr Consensus is licensed separately under Apache-2.0 (see `LICENSE`).

## What it does

1. Two Agents review the same project independently, in isolated, read-only sessions.
2. Reports are normalized and merged into a consensus of common, single-source, and disputed findings.
3. P2 findings get a validation plan (explicit approval before any command runs); disputed/uncertain items get optional third-AI advice.
4. A human adjudicates each finding item by item — the AI never has the final say.
5. Approved items are locked into an immutable, SHA-256-hashed fix plan.
6. Fixes happen in an isolated `git worktree`, never in the main worktree, followed by an approved regression run.
7. A unified Markdown/JSON report records the full evidence chain.

It does **not** replace Herdr, does **not** fork Herdr, and does **not** automatically push, merge, deploy, or create PRs.

## Requirements

- Node.js 20+
- pnpm
- Git
- Herdr CLI available on `PATH`
- At least one configured Herdr agent for review/fix workflows
- macOS (v1 is macOS-only; Linux is not yet verified or declared supported)

## Install from source

```bash
pnpm install
pnpm build
node dist/cli.js doctor
```

For local CLI use:

```bash
pnpm build
npm link
herdr-consensus doctor
```

To uninstall a globally linked or installed copy:

```bash
npm unlink -g herdr-consensus
# Or, for a package installation:
npm uninstall -g herdr-consensus
```

## Main workflow

```bash
# 1. Check environment
herdr-consensus doctor

# 2. Start two independent read-only reviews
herdr-consensus start --agent-a claude --agent-b codex

# Or import existing reports
herdr-consensus import --agent-a ./report-a.md --agent-b ./report-b.md

# 3. Inspect runs
herdr-consensus status
herdr-consensus resume <run-id>

# 4. Validate P2 items; first show the plan, then explicitly approve
herdr-consensus validate <run-id>
herdr-consensus validate <run-id> --approve

# 5. Ask a third AI for read-only advice on disputed/uncertain items
herdr-consensus arbitrate <run-id> --agent gemini

# 6. Record user decisions
herdr-consensus decide <run-id>
herdr-consensus decide <run-id> --item <item-id> --decision approved_fix --reason "confirmed"

# 7. Lock the fix plan
herdr-consensus lock <run-id>

# 8. Apply in an isolated git worktree and explicitly approve project regression
herdr-consensus apply <run-id> --agent codex --approve-regression

# 9. Export the final report from the persisted successful regression evidence
herdr-consensus report <run-id>
```

## State and recovery

State is stored outside the reviewed repository:

- `$XDG_STATE_HOME/herdr-consensus/`
- macOS fallback: `~/Library/Application Support/herdr-consensus/`
- Linux fallback (`~/.local/state/herdr-consensus/`) exists in code but is not verified or declared supported for v1

Each run stores raw artifacts, normalized data, consensus, validations, arbitration advice, decisions, fix plans, logs, and final reports under its run directory. Use:

```bash
herdr-consensus status
herdr-consensus resume <run-id>
```

## Safety model

- Review and arbitration keep the reviewed project read-only. Each review Agent may write only its JSON report inside the run's plugin-owned state directory.
- Validation commands are planned first and require explicit `--approve`.
- Apply requires `--approve-regression`; the approved regression runs in the isolated worktree and must pass before the run advances.
- Validation uses argv arrays, not shell interpolation.
- Dangerous validation commands such as `sudo`, deletion, deployment, migration, and remote download patterns are blocked.
- Fixing requires a clean Git worktree.
- Fixing happens in an isolated `git worktree`, never directly in the main worktree.
- The implementation agent receives the locked plan version and SHA-256 and is instructed not to perform out-of-plan changes.
- The tool never commits, merges, pushes, creates PRs, deploys, or cleans user files automatically.

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Current validation matrix

Automated fixture/unit coverage is complete for the implemented v1 modules. Real Agent smoke tests used a clean minimal Git fixture and verified that its worktree remained unchanged.

| Combination | Status |
| --- | --- |
| Codex + Claude read-only smoke | Verified on macOS / Herdr 0.8.0; run reached `consensus` |
| Codex + Pi read-only smoke | Verified on macOS / Herdr 0.8.0; run reached `consensus` |
| Full workflow (review → apply → report) | Verified once end-to-end on macOS with hermes + pi against a real project |
| macOS fixture tests | Latest source tests: 48 files / 236 tests pass; lint/typecheck/build/8-file tarball/production install and installed `.bin` version+doctor revalidation passed |
| Independent maintainer sign-off | Passed on macOS: install from source, `npm link`, `--version`, `doctor`, `import`→`status`→`resume` recovery, and `npm unlink -g` removal |
| Linux | Out of scope for v1 (macOS-only release; not verified or declared supported) |

See `CHANGELOG.md` for exact command results for each phase.

## License

Apache-2.0. See `LICENSE`.

Herdr is a separate project by the Herdr team and retains its own license and ownership.
