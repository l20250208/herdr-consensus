# Changelog

本文件记录 Herdr Consensus 的重要变更。每次完成工作后，都要追加：修改了哪些文件、为什么修改、如何验证、下一位维护者需要注意什么。

## [Unreleased]

### 2026-08-18 — 阶段 2：状态存储与运行状态机

#### 新增

- `src/state/paths.ts`：状态根目录解析（`XDG_STATE_HOME` + macOS/Linux 回退）、`projectHash`（sha256 of realpath）与运行目录路径。
- `src/state/run.ts`：运行阶段列表（`created`→`reported`）、`run.json` 的 Zod schema、`generateRunId`、`decodeRunRecord`（区分 schema 版本不兼容与非法记录）。
- `src/state/store.ts`：`RunStore`，提供原子 JSON 写入（临时文件 + fsync + rename）、`createRun`（幂等）、`transition`（前进 + 审计事件 + 同阶段幂等 + 禁止回退）、`listRuns`、`findRunById`。
- `src/commands/status.ts`、`src/commands/resume.ts`：`status` 与 `resume` 命令的展示格式。
- `src/cli.ts`：接入 `status`/`resume` 分发，`CliDeps` 增加 `stateDir` 注入点供测试隔离。
- `tests/unit/run.test.ts`、`paths.test.ts`、`store.test.ts`、`commands.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 2 建立可恢复、可审计、可幂等的本地运行状态，为后续阶段提供 `run.json` 状态机与 `resume` 基础。

#### 验证

- `pnpm test`：7 个测试文件、54 个用例全部通过（新增 28 个）。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（19.52 KB，含 zod）。
- 实机冒烟：`XDG_STATE_HOME=<tmp> node dist/cli.js status` → `No runs found.`（退出码 0）；`status missing-run` → 退出码 1；`resume`（无 id）→ 退出码 2。
- 崩溃恢复：`store.test.ts` 模拟中断写残留 `.tmp` 后仍能读取一致状态并继续前进；重复 `createRun`/同阶段 `transition` 不产生重复事件。

#### 下一位维护者注意

- 运行阶段列表是稳定契约（阶段 3 起按此前进）：`created → reviewing → normalized → consensus → validating → arbitrating → deciding → locked → applying → reported`；已写入 `DESIGN.md` §6.1。
- `transition` 目前只允许前进、同阶段为幂等空操作；`deciding` 需要“返回补充验证”回退时，须按 §15 更新 `DESIGN.md` 再放开回退。
- 状态目录严格按 §7.1（`XDG_STATE_HOME`）实现；尚未接入 `HERDR_PLUGIN_STATE_DIR`，留待插件集成（阶段 12）评估是否需按 §15 调整。
- `run.json` 损坏或 schema 版本不兼容时 `decodeRunRecord` 抛 `RunRecordError`，`status`/`resume` 捕获后返回退出码 1，不猜测状态。

### 2026-08-18 — 阶段 1：工程骨架、插件清单和 `doctor` 环境检查

#### 新增

- `package.json`：声明 `type: module`、`bin`、`engines.node >= 20`、脚本（`build`/`typecheck`/`test`），固定运行时依赖（`zod`、`@inquirer/prompts`、`smol-toml`、`picocolors`）与开发依赖（`typescript`、`vitest`、`@types/node`、`tsup`、`fast-check`）。
- `pnpm-lock.yaml`、`pnpm-workspace.yaml`：锁定依赖版本；`pnpm-workspace.yaml` 用 `allowBuilds: { esbuild: true }` 放行 esbuild 构建脚本。
- `tsconfig.json`：开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`，模块解析用 `NodeNext`。
- `vitest.config.ts`、`tsup.config.ts`：测试配置与 ESM 打包（含 shebang banner）。
- `herdr-plugin.toml`：插件清单，含两条 `[[build]]` 与四个 `[[actions]]`（`new-review`/`resume-review`/`open-decision-wizard`/`open-final-report`）。
- `src/version.ts`、`src/spawn.ts`、`src/env.ts`、`src/commands/doctor.ts`、`src/cli.ts`：语义版本解析、无 shell 子进程运行器、环境探测与 `doctor`、终端格式化、CLI 入口。
- `tests/unit/version.test.ts`、`env.test.ts`、`cli.test.ts`：覆盖版本比较、doctor 探测逻辑和 CLI 分发。
- `.gitignore`。

#### 原因

- 按 `DESIGN.md` 阶段 1 建立可构建、可测试的 TypeScript 工程骨架，并交付只读的 `doctor` 环境预检；`doctor` 只报告缺项，不自动安装。

#### 验证

- `pnpm test`：3 个测试文件、26 个用例全部通过。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（10.82 KB，单 shebang）。
- 实机冒烟：`node dist/cli.js doctor` 退出码 0，报告 Node.js v22.23.1、Git 2.50.1、Herdr 0.8.0、2 个 Agent；`--json` 输出可解析 JSON；`--version` 输出 `0.1.0`；未实现命令退出码 2。

#### 下一位维护者注意

- 实测 Herdr 0.8.0：`herdr agent list` 返回 `{result:{agents:[{agent,agent_status,pane_id,workspace_id}]}}`；`herdr agent start <name> --kind KIND --pane ID`；`herdr agent prompt <target> <text> [--wait]`；可用 kind 为 `pi|claude|codex|gemini|cursor|devin|agy|cline|omp|mastracode|opencode|copilot|kimi|kiro|droid|amp|grok|hermes|kilo|qodercli|maki`。
- 插件清单格式已核对官方文档：顶层 `id`/`name`/`version`/`min_herdr_version` 必填；`command` 为 argv 数组，以插件目录为 cwd 解析；运行时注入 `HERDR_PLUGIN_CONTEXT_JSON`、`HERDR_PLUGIN_STATE_DIR` 等环境变量。
- `doctor` 将 Agent 枚举失败视为告警而非硬失败（审查可在尚无 Agent 运行时启动）。
- `start`/`import`/`status`/`resume`/`validate`/`arbitrate`/`decide`/`lock`/`apply`/`report` 目前是返回退出码 2 的占位实现，下一阶段是阶段 2（状态存储与运行状态机）。
- 依赖解析使用 TypeScript 7.0.2（原生编译器）；`LICENSE` 按设计留到阶段 12 再确定。

### 2026-08-17 — 初始化设计和协作规则

#### 新增

- `DESIGN.md`：确定双报告共识、P2 运行验证、第三方 AI 建议、用户逐项裁决、锁定清单和隔离 worktree 统一修复的完整技术方案。
- `AGENTS.md`：为 Codex 提供项目协作规则。
- `CLAUDE.md`：为 Claude Code 提供与 `AGENTS.md` 完全相同的项目协作规则。
- `CHANGELOG.md`：建立逐次记录变更的格式。

#### 原因

- 在写功能代码前锁定产品边界、数据模型、安全约束、测试标准和实现顺序。
- 让 Codex、Claude Code 或其他参与者在不同会话中仍能从同一设计和进度继续工作。

#### 验证

- 确认四份要求文档均位于项目根目录。
- 确认 `AGENTS.md` 与 `CLAUDE.md` 内容完全一致。
- 本次没有创建功能代码、依赖、构建产物或目标仓库修改。

#### 下一位维护者注意

- 当前应从 `DESIGN.md` 的阶段 1 开始，不得跳到双 Agent 或修复功能。
- 阶段 1 首先建立 TypeScript 工程骨架、`herdr-plugin.toml` 和只读 `doctor`；依赖版本要在 lockfile 中固定。
- 若实际 Herdr API 与设计不符，先更新 `DESIGN.md`，再写代码。
