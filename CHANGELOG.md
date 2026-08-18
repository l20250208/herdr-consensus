# Changelog

本文件记录 Herdr Consensus 的重要变更。每次完成工作后，都要追加：修改了哪些文件、为什么修改、如何验证、下一位维护者需要注意什么。

## [Unreleased]

### 2026-08-18 — 独立维护者外部签核完成，阶段 12 全部发布门槛通过

- **修改文件**：`DESIGN.md`（阶段 12 状态改为 `已完成`、头部状态/下一阶段更新）、`README.md`（验证矩阵新增独立维护者签核行）、`CHANGELOG.md`。
- **修改原因**：按 `DESIGN.md` §11.4 的最后一项发布门槛——由未参与开发的人照 README 完成安装/卸载/恢复。签核人（项目所有者本人，未参与实现）在真实 macOS 终端完成，结果全部通过。
- **验证结果（签核实录）**：
  - 环境：Node v22.23.1、pnpm 11.9.0、HerDr 0.8.0。
  - 源码安装：`pnpm install` + `pnpm build` + `node dist/cli.js doctor` → `All required checks passed`（非 HerDr pane 中 Agent 枚举为 warning，符合预期）。
  - 全局链接：`npm link` + `herdr-consensus --version` → `0.1.0` + `doctor` → 通过。
  - 恢复流程：`import`（两份报告 → run 推进到 `consensus`）+ `status`（列出 run）+ `resume <run-id>`（给出下一步 `validate`），全部退出 0。
  - 卸载：`npm unlink -g herdr-consensus` + `herdr-consensus --version` → `zsh: command not found`。
  - 额外确认：签核环境路径 `/tmp` 被真实解析为 `/private/tmp`，CLI realpath 处理在真实终端下正常。
- **当前结论**：阶段 12 全部发布门槛已验证通过；剩余动作只有“是否 commit 脏 `main` 工作区并发布”，属维护者决策，AI 不自动执行。
- **下一位维护者注意**：签核过程在状态目录留下了一个真实测试 run（`run-20260818165353-f9033a68`），属无害签核痕迹，未清理。提交前仍需重新审查脏 `main` 工作区全部既有修改。

### 2026-08-18 — v1 平台范围收窄为 macOS（方案 B）

- **修改文件**：`DESIGN.md`（新增 §12.3 平台范围调整、更新 §7.1/§11.4/阶段 12 行与头部状态）、`herdr-plugin.toml`（`platforms` 改为 `["macos"]`）、`README.md`（Requirements 增加 macOS 说明、状态目录回退与验证矩阵的 Linux 行改为未验证/未声明）、`CHANGELOG.md`。
- **修改原因**：用户选择方案 B——首发只面向 macOS。此前 manifest 声明 `["linux", "macos"]`，但 Linux fixture 从未验证，属超卖；按 `DESIGN.md` §15 先改设计再改代码。
- **技术影响**：撤销 Linux 支持声明，Linux 移出 v1 验收项；`src/state/paths.ts` 的非 Darwin 状态目录回退代码保留但不再作为受支持承诺。数据模型、CLI 接口、阶段顺序与安全边界均不变。
- **验证**：`git diff --check` 通过；本条目仅涉及文档与 manifest 平台字段，无运行时行为变化。
- **下一位维护者注意**：若未来要支持 Linux，需补 Linux 无模型 fixture 与真实烟雾测试后再恢复 `platforms` 声明，不能只改回 manifest。阶段 12 仍剩“未参与开发的维护者照 README 完成 macOS 安装/恢复/卸载”一项外部签核。

### 2026-08-18 — 第三轮独立代码审查与最新发布门槛复验

- **审查结论**：`Ready to merge: Yes`（就实现本身而言，外部签核除外）。第三轮只读复核确认第二轮 5 个 Important 整改均已正确落地，未发现新的阻断问题：
  1. `deciding` 阶段把某项改回 `validate_more` 后仍可继续 `validate`/`arbitrate`/`decide`，状态机不倒退，`lock` 在存在 `validate_more` 时继续失败关闭；
  2. 结构非法 artifact（如 `{"items":null}`）在运行时 schema 解码时失败关闭，不再降级为空数据；
  3. `apply` 在任何外部命令前校验根 fix-plan 的 runId、版本、SHA-256、最新 `locked` 审计事件与不可变 `fix-plans/vN.json` archive 完全一致；
  4. 回归证据绑定 worktree 内容快照 SHA-256（路径/类型/mode/删除标记/内容），`report` 重算后拒绝允许路径内的回归后修改；
  5. fix-plan archive/latest 发布为一次可回滚操作，latest Markdown 失败后清除本次 archive/latest 并可安全重试同一版本。
- **最新发布门槛复验结果**（全部在最新 5 项整改之后重跑，未沿用旧结果）：
  - `pnpm lint`：通过。
  - `pnpm typecheck`：通过。
  - `pnpm test`：48 个测试文件、236 个用例全部通过。
  - `pnpm build`：通过，生成 `dist/cli.js`（124.10 KB）。
  - `npm pack --json`：通过；tarball 8 个文件（LICENSE、README、dist/cli.js、herdr-plugin.toml、package.json、prompts/independent-review.md、schemas/final-report.v1.json、schemas/review-report.v1.json），不包含 `src/`、`tests/` 或内部 `docs/`。
  - 从最新 `.tgz` production-only 安装：29 个运行时包、0 漏洞。
  - 安装后 `.bin/herdr-consensus --version`：输出 `0.1.0`（退出 0）。
  - 安装后 `.bin/herdr-consensus doctor --json`：HerDr 0.8.0 / Node v22 / Git 2.50.1 全部正常，Agent 枚举成功，无 issues/warnings（退出 0）。
  - `git diff --check`：通过。
- **仍属外部发布签核**（不在本次自动化范围内）：Linux 无模型 fixture 验证；由未参与开发的维护者照 README 完成安装、状态恢复和卸载。
- **下一位维护者注意**：实现侧不再有阻断项，但阶段 12 在完成两项外部签核前仍不能标为最终发布；`DESIGN.md` 阶段 6–11 已更新为 `已完成`，阶段 12 保持 `进行中`。脏 `main` 工作区仍需保留，未执行任何 commit/reset/clean/push，真实 Herdr 现场 tab 未关闭。

### 2026-08-18 — 第二轮审查整改实现与 AI 交接

- **修改文件**：新增 `HANDOFF.md`、`src/workflow/artifacts.ts`、`src/fix-plan/verify.ts`、`src/apply/snapshot.ts`；继续修改 `src/cli.ts`、fix-plan store/generator、reporting schema/types、公开 final-report schema、README/DESIGN 及对应 unit/e2e tests。
- **修改原因**：第一轮 3 个 Critical 已在第二轮确认清零；继续修复第二轮发现的 5 个 Important：`deciding` 中的 `validate_more` 循环、结构非法 artifact、locked fix-plan 防篡改、回归证据内容绑定、fix-plan archive/latest 失败回滚。
- **验证结果**：最新 `pnpm typecheck` 通过；定向整改 8 文件/34 用例通过；最新 `pnpm test` 为 48 文件/236 用例全部通过。第二轮审查之前的 lint/build/8 文件 tarball/29 个 production 包安装/安装后 `.bin --version` 与 `doctor --json` 均通过，但这些发布包结果早于最新 5 项修复，必须重建复验。
- **当前结论**：最新 5 项整改尚未进行第三轮独立审查，最新 lint/build/tarball 也未复验，不能标为发布完成或 Ready to merge。
- **下一位维护者注意**：从 `HANDOFF.md` 开始，保留脏 `main` 中所有既有修改；先复核指定安全文件与对抗用例，再重跑完整发布门槛。不得 reset/clean/自动 commit、merge、push。

### 2026-08-18 — 最终代码审查整改启动

- **审查结论**：`Ready to merge: No`。确认 3 个 Critical：发布 manifest 与 8 文件 tarball 不兼容；apply 只看 unstaged diff，可被 stage/commit 绕过；仲裁 Agent 在主项目 cwd 运行。
- **重要缺口**：P2 非零退出误判、`validate_more` 死路、仲裁 prompt marker/错 itemId、损坏 JSON 默认空、锁定不完整/过期决定、无回归仍 reported、open-final-report 不能打开已有报告、fix-plan 归档部分写入不可恢复。
- **状态调整**：撤回“首发功能闭环完成”的当前状态，阶段 6–11 重新标为进行中；先更新设计状态再修改代码。
- **验证说明**：此前 213 项测试和两组真实烟雾仍是有效已测证据，但未覆盖上述对抗场景，不能据此发布。

### 2026-08-18 — 阶段 12：首发功能闭环完成，进入外部签核

#### 新增

- `src/state/json.ts`、`src/workflow/process-review.ts`、`src/workflow/guards.ts`、`src/workflow/resume.ts`：原子 JSON、raw → normalized → consensus 编排、阶段/产物守卫和安全恢复。
- `src/ui/prompts.ts`、`src/ui/decision-wizard.ts`、`src/fix-plan/store.ts`：无参数 Herdr action 交互、逐项证据裁决、逐项落盘和不可变 fix-plan 版本归档。
- `src/arbitration/provenance.ts`、`src/apply/verify.ts`、`src/reporting/schema.ts`、`schemas/final-report.v1.json`：仲裁来源/独立性、修改路径与定向检查验证、最终报告运行时/公开 schema。
- `tests/e2e/cli-workflow.test.ts` 及阶段 12 单元测试：覆盖公共 CLI 全流程、失败关闭、原子写入、恢复、交互、版本、来源、apply 验证、报告 schema 和真实 Herdr 适配边界。
- `docs/superpowers/plans/2026-08-18-release-flow-closure.md`：本轮实现计划与验收检查点。

#### 修改

- `src/cli.ts`：`start`/`import` 自动进入共识，四个无参数 action 可交互，后续命令严格校验阶段与产物，仲裁/修复 Agent 使用 run 唯一名称，apply/report 接入验证证据。
- `src/herdr/adapter.ts`、`src/reports/collector.ts`、`src/reports/contract.ts`、`src/reports/extract.ts`：使用稳定 Agent `name`、独立非聚焦 tab、瞬态 shell 重试、unwrapped 读取、最新 marker、受控 artifact 文件通道、无提交痕迹 stalled 重试和终端字符串硬换行规范化。
- `src/reports/content.ts`、`src/reports/import.ts`、`src/consensus/normalizer.ts`：统一支持 marker/完整 JSON/fenced JSON、2 MiB 上限和终端控制字符清理。
- `package.json`：发布 `files` 白名单只包含 bundle、manifest、README、LICENSE、公开 schemas 和 prompts。
- `README.md`、`DESIGN.md`：同步完整工作流、安全边界、卸载方式、验证矩阵和当前阶段状态。

#### 原因

- 修复模块虽存在但 CLI 主流程未串联、Herdr action 无参数即失败、状态可跳级、最终报告可在证据缺失时生成等首发阻断问题。
- 真实 Herdr 0.8.0 烟雾测试连续暴露 Agent kind/稳定名称混淆、pane shell 竞态、窄 pane/TUI 重绘污染、cwd 外写入批准和首次 prompt 未提交等集成边界；逐项以失败测试和最小安全调整修复。

#### 验证

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：47 个测试文件、213 个用例全部通过。
- `pnpm build`：通过，生成 `dist/cli.js`（105.57 KB）。
- `npm pack --dry-run --json`：通过；包内 8 个文件，不包含 `src/`、`tests/` 或内部 `docs/`。
- 实际 `.tgz` 解包后执行 `pnpm install --prod`：29 个运行时包安装成功；随后从解包目录运行 `node dist/cli.js doctor --json` 退出 0。裸解包未安装依赖时按预期报缺少 `picocolors`；离线安装因本机 store 缺少 `@inquirer/prompts` tarball 失败，联网的 production-only 安装通过。
- `node dist/cli.js doctor --json`：退出 0；Node.js v22.23.1、Git 2.50.1、Herdr 0.8.0 和 Agent 枚举全部正常，无 issues/warnings。
- Codex + Claude 真实只读 fixture：`run-20260818110250-3fd884c6` 到达 `consensus`，两槽 collected，2 个共识项；raw/normalized/consensus 产物存在，fixture `git diff --exit-code` 为 0。
- Codex + Pi 真实只读 fixture：`run-20260818110621-c4550cd0` 到达 `consensus`，两槽 collected，1 个共识项；raw/normalized/consensus 产物存在，fixture `git diff --exit-code` 为 0。
- `git diff --check`：通过。

#### 下一位维护者注意

- 阶段 2、7–11 已完成；阶段 12 的功能闭环和 macOS 真实 Agent 门槛已完成，但 Linux 无模型 fixture 与“未参与开发者照 README 安装/恢复”仍待外部签核，不能把首发候选标为最终发布。
- Review Agent cwd 是插件状态下的 `agent-output/<slot>/`，被审查项目通过绝对路径只读访问；不要把 cwd 改回主项目或删除受控 artifact 文件优先通道。
- 本轮按用户确认在已有脏 `main` 工作区内原地实现，没有 commit、reset、clean、push 或关闭 Herdr 现场 tab；提交时需审查并保留此前已有的阶段 6–12 修改。

### 2026-08-18 — 阶段 12 设计调整：真实 Herdr 0.8.0 时序与身份字段

#### 调整

- `DESIGN.md`：记录真实冒烟发现的 `agent`/`name` 字段语义、split pane shell 就绪竞态及窄 pane 的 wrapped terminal 输出，并先定义稳定名称解析、有限重试、`recent-unwrapped` 读取、独立非聚焦 tab 与新增验收测试。

#### 原因

- Codex + Claude 真实只读冒烟中，Herdr Agent 对象的 `agent` 是 Agent kind，而 `name` 才是后续命令需要的稳定目标；新 split pane 也可能短暂未到 shell prompt；默认 `recent` 终端输出还会按窄 pane 宽度拆散 JSON。
- 实测把窄 pane 事后 zoom 到全宽仍无法恢复已截断/拆散的 scrollback，因此不能用猜测性去换行；每个长报告 Agent 需要从一开始就在独立全宽 tab 运行。
- 独立 tab 输出确认终端会先回显 prompt 中的空 marker 模板，再显示 Agent 报告；原提取器错误选择第一对 marker，方案调整为只采纳最后一对完整 marker。
- 对第四次真实输出执行恢复时确认：即使 148 列全宽，TUI 仍在超长 JSON 字符串内插入物理换行。方案追加 100 字符输出约束，并只在 JSON 字符串状态内部规范化终端换行；原始 artifact 不改写。
- Claude 终端还把输入框回显插进 JSON 对象，所有 Herdr terminal source 都无法提供无污染的完整模型消息；方案新增受控的 `HERDR_CONSENSUS_OUTPUT` 插件 artifact 文件通道，终端解析降为兼容回退，项目目录仍严格只读。
- 第五次真实测试中 Claude 成功写入 artifact，Codex 因 artifact 位于其 cwd 外触发写入批准并停在 `blocked`；方案把每个 Agent cwd 移到独立 artifact 子目录，被审查项目只以绝对路径提供，避免扩大主项目写权限。
- 第六次真实测试中 Codex 已成功收集；Claude 新 tab 的首次 prompt 未显示且返回 stalled。方案只允许在 artifact 缺失且终端无合同 marker 的确证条件下重发一次，避免重复执行已经提交的审查。

#### 验证

- 已通过 `herdr agent get hc179ab4dd-b` 与 `herdr agent get claude` 对照确认字段语义；前者能命中稳定名称，后者返回 `agent_not_found`。
- 实现与两组真实冒烟仍待继续，不能据此标记阶段 12 完成。

#### 下一位维护者注意

- 只重试明确的 pane shell 未就绪错误；不得对未知启动错误盲目重试或用 Agent kind 作为后续提示目标。

### 2026-08-18 — 阶段 12 设计调整：首发闭环修复

#### 修改

- `DESIGN.md`：补充阶段 12 首发闭环修复设计，覆盖 review processing、可恢复 resume、Herdr action 交互参数、阶段/产物守卫、原子产物写入、导入格式和发布包范围；阶段 12 从“阻塞”调整为“进行中”，并把尚未满足验收门槛的阶段 2、7–11 如实重新标为“进行中”。
- `CHANGELOG.md`：记录本次先设计、后实现的接口调整和验收门槛。

#### 原因

- 首发审查发现阶段 5 的标准化/共识模块未接入 CLI，四个无参数 Herdr action 与 CLI 参数要求不兼容，`resume` 和裁决向导也未达到设计行为；必须按 `DESIGN.md` §15 先修订方案再修改代码。

#### 验证

- 对照 `DESIGN.md` 的稳定数据模型、CLI、Herdr actions、状态机、测试策略和发布门槛完成文档自查。
- 本条仅记录设计调整；实现与自动化验证尚未开始，不能据此判定阶段 12 完成。

#### 下一位维护者注意

- 实现必须从失败测试开始，并优先完成 raw → normalized → consensus 的主流程闭环；不得先处理真实烟雾测试而继续绕过缺失的 processing 阶段。
- 当前工作区已有阶段 6–12 的未提交修改，后续编辑必须保留这些现有内容，不得 reset 或清理。

### 2026-08-18 — 阶段 12：文档、真实烟雾测试和首发

#### 新增

- `README.md`：安装、主工作流、状态恢复、安全模型、开发命令和验证矩阵。
- `LICENSE`：Apache-2.0 许可证文本。

#### 修改

- `package.json`：声明 `license: Apache-2.0`，新增 `pnpm lint` 脚本（当前等同 `tsc --noEmit`）。
- `src/herdr/adapter.ts`：`pane split` 增加 Herdr 0.8.0 必需的 `--direction right`；非零退出时同时解析 stdout/stderr 中的 JSON error envelope。
- `src/cli.ts`：新审查 Agent 名称改为由 runId 派生的短唯一名称，避免 Herdr workspace 内旧 Agent 名冲突且满足命名规则。
- `tests/integration/fixtures/fake-herdr.mjs`、`tests/integration/herdr-adapter.test.ts`：覆盖 stderr error envelope 解析。
- `DESIGN.md`：记录阶段 12 烟雾测试发现的 Herdr CLI 参数/错误输出差异；阶段 12 仍标记为阻塞。

#### 原因

- 按 `DESIGN.md` 阶段 12 补齐首发所需的用户文档、许可证、安装/恢复说明和兼容性/烟雾测试矩阵。

#### 验证

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：35 个测试文件、155 个用例全部通过。
- `pnpm build`：通过，生成 `dist/cli.js`（66.70 KB）。
- `node dist/cli.js doctor --json`：通过；检测到 Node.js v22.23.1、Git 2.50.1、Herdr 0.8.0、当前会话中 2 个 Agent（pi working、claude idle）。
- Codex+Claude 真实 fixture 烟雾测试：仍失败。已修复前两轮暴露的问题（`pane split` 缺少 `--direction`、固定 Agent 名冲突/命名过长），最新失败为 Codex 槽 `agent target pane w7:pA is not an available shell`，Claude 槽 `agent_prompt_stalled`。

#### 下一位维护者注意

- 真实模型组合烟雾测试未在本次会话完成；README 已明确 Codex+Claude、Codex+Pi 和 Linux fixture 状态为未验证。
- `pnpm lint` 目前是类型检查占位；若引入 ESLint，需先评估依赖和设计影响。
- 阶段 1–11 已完成；阶段 12 文档和本机自动化验证已完成，但仍阻塞在真实 Agent 端到端烟雾测试与 Linux fixture 验证。下一步应优先排查 Herdr 真实 pane split 返回的 pane 可用性、`agent prompt --wait` 的 stalled 行为，并完成 Codex+Claude、Codex+Pi、Linux fixture 验证。

### 2026-08-18 — 阶段 11：回归与统一报告

#### 新增

- `src/reporting/types.ts`：统一报告数据结构。
- `src/reporting/generate.ts`：收集 worktree diff 摘要、运行回归命令、生成 JSON/Markdown 报告。
- `src/cli.ts`：接入 `report <run-id>`，读取共识、验证、仲裁、决定、fix-plan、diff 和回归结果，写入 `final-report.json` 与 `final-report.md`，推进状态到 `reported`。
- 测试：`tests/unit/reporting.test.ts`、`tests/unit/cli-report.test.ts`，并更新 `tests/unit/cli.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 11 导出可追溯的统一报告，汇总每个问题的证据、决定、修复计划、实际 diff 摘要和回归测试结果。

#### 验证

- `pnpm test`：35 个测试文件、154 个用例全部通过。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（66.58 KB）。

#### 下一位维护者注意

- `report` 会在运行目录的 `worktree/` 下自动检测已有项目测试入口并运行回归；未检测到测试入口时记录 `regression: null`。
- diff 摘要使用 `git diff --stat`，报告不自动 commit、merge、push 或清理 worktree。
- Markdown 报告当前以 JSON 块保留完整追溯数据；阶段 12 README/发布文档可补充更友好的示例输出。
- 下一阶段应完成 README、LICENSE、安装/恢复说明、真实或声明未完成的烟雾测试矩阵。

### 2026-08-18 — 阶段 10：worktree 统一修复

#### 新增

- `src/apply/git.ts`：Git 安全检查，确认目标是 Git worktree 且主工作区干净；通过 `git worktree add -b` 创建隔离 worktree。
- `src/apply/prompt.ts`：写入 Agent 实现 prompt，强制引用 runId、计划版本和 SHA-256，禁止计划外重构、commit、merge、push、部署。
- `src/cli.ts`：接入 `apply <run-id> --agent <kind>`，读取锁定 `fix-plan.json`，创建隔离 worktree，启动写入 Agent 并保存输出日志。
- 测试：`tests/unit/apply.test.ts`、`tests/unit/cli-apply.test.ts`，并更新 `tests/unit/cli.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 10 在不修改主工作目录的前提下，把锁定修复清单交给单一写入 Agent，在独立 Git worktree 中执行修复。

#### 验证

- `pnpm test`：33 个测试文件、151 个用例全部通过。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（62.84 KB）。

#### 下一位维护者注意

- `apply` 当前负责安全检查、worktree 创建、写入 Agent 启动和输出保存；“每完成一个问题运行定向测试”和项目级回归汇总留给阶段 11 报告/回归流程补齐。
- 主工作区只读检查依赖 `git status --porcelain`；若有未提交修改会拒绝执行，不会 reset 或清理用户文件。
- worktree 路径为运行目录下 `worktree/`，分支名为 `herdr-consensus/<run-id>`；失败时保留现场并返回非零。
- 写入 Agent prompt 已包含锁定计划 hash 和禁止范围，但后续仍需在阶段 11 diff 报告中审查是否越界。

### 2026-08-18 — 阶段 9：锁定修复清单

#### 新增

- `src/fix-plan/types.ts`：`LockedFixPlan` 与计划项契约。
- `src/fix-plan/generate.ts`：从共识项、标准化 findings 和用户决定生成 fix-plan，计算规范化 SHA-256，并渲染 Markdown。
- `src/cli.ts`：接入 `lock <run-id>`，写入 `fix-plan.json` 与 `fix-plan.md`，推进状态到 `locked`。
- 测试：`tests/unit/fix-plan.test.ts`、`tests/unit/cli-lock.test.ts`，并更新 `tests/unit/cli.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 9 将已确认 P0/P1、验证成立 P2 和用户批准项合并为不可静默变更的锁定修复清单，为 worktree 修复阶段提供唯一输入。

#### 验证

- `pnpm test`：31 个测试文件、147 个用例全部通过。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（58.84 KB）。

#### 下一位维护者注意

- `lock` 会读取现有 `fix-plan.json` 的 version 并递增；当前会覆盖根路径 `fix-plan.json`/`fix-plan.md` 为最新版本，旧版本归档目录尚未实现。
- 自动纳入规则：common/confirmed P0/P1、`status === validated_true` 的 P2、以及 `decisions.json` 中 `approved_fix` 的项。
- `allowedPaths` 来自相关 finding 的 `location.path`；缺少位置时为空，阶段 10 写入 Agent 必须据此限制修改范围并提示风险。
- `sha256` 对不含自身 hash 的规范化计划对象计算，后续实现提示应引用 runId、version 和该 hash。

### 2026-08-18 — 阶段 8：用户逐项裁决向导

#### 新增

- `src/decisions/types.ts`：`UserDecision` 与固定用户动作契约。
- `src/decisions/snapshot.ts`：对共识项、相关 findings、验证记录和仲裁建议计算证据快照 SHA-256。
- `src/decisions/store.ts`：`decisions.json` 加载、保存和按 itemId 覆盖更新。
- `src/cli.ts`：接入 `decide <run-id>` 列出待裁决项；`--item <id> --decision approved_fix|deferred|rejected|validate_more [--reason]` 记录决定并推进到 `deciding`。
- 测试：`tests/unit/decisions.test.ts`、`tests/unit/cli-decide.test.ts`，并更新 `tests/unit/cli.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 8 实现可恢复的逐项裁决基础能力；每项用户决定必须绑定当时证据快照，供阶段 9 锁定修复清单使用。

#### 验证

- `pnpm test`：29 个测试文件、145 个用例全部通过。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（55.08 KB）。

#### 下一位维护者注意

- 当前裁决以 CLI 参数形式实现，`decide <run-id>` 可列出 pending/已决状态；后续若接入 `@inquirer/prompts` 交互 UI，应复用现有 `UserDecision`、snapshot 与 store 契约。
- `validate_more` 仅记录用户选择，不自动回退状态机；状态机回退若需要实现，必须先按 `DESIGN.md` §15 调整阶段转换规则。
- 重复裁决同一 item 会覆盖该 item 的未锁定决定；阶段 9 锁定后应生成新 fix-plan 版本而不是覆盖旧版本。
- 证据快照包含 `consensus.json` 对应 item、`normalized/findings.json` 相关 finding、`validations/records.json` 和 `arbitration/advice.json`。

### 2026-08-18 — 阶段 7：第三方 AI 建议

#### 新增

- `src/arbitration/types.ts`：`ArbitrationAdvice`、推荐动作与置信度契约。
- `src/arbitration/prompt.ts`：只读第三方仲裁 prompt，要求引用证据并输出严格 JSON。
- `src/arbitration/parser.ts`：仲裁 JSON 标记提取、Zod 校验、一次格式修复 prompt。
- `src/cli.ts`：接入 `arbitrate <run-id> --agent <kind>`，启动独立 Agent，对 disputed/possible_match/inconclusive 项生成建议并写入 `arbitration/advice.json`。
- 测试：`tests/unit/arbitration.test.ts`、`tests/unit/cli-arbitrate.test.ts`，并更新 `tests/unit/cli.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 7 为争议项和不确定项提供第三方 AI 只读建议；第三方 AI 不能修改代码，也不能替代用户最终裁决。

#### 验证

- `pnpm test`：27 个测试文件、141 个用例全部通过。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（51.16 KB）。

#### 下一位维护者注意

- `arbitrate` 当前读取 `consensus.json`、可选 `normalized/findings.json` 和 `validations/records.json`；阶段 8 裁决向导应消费 `arbitration/advice.json`。
- 解析失败时会发送一次格式修复 prompt；再次失败则不写入 advice，只保留原始输出 `<itemId>.txt`，命令返回非零。
- 独立性提示/模型提供商比较尚未做 UI 展示；当前记录 `agentKind` 到审计事件，后续若要检测模型需接入 Herdr agent metadata。
- 第三方建议只覆盖 `disputed`、`possible_match` 或 `status === inconclusive` 项，不会自动改变共识状态或用户决定。

### 2026-08-18 — 阶段 6：P2 验证系统

#### 新增

- `src/validation/types.ts`：验证计划与 `ValidationRecord` 契约。
- `src/validation/safety.ts`：验证命令安全检查，阻止 `sudo`、删除、部署、迁移、远程下载等危险模式。
- `src/validation/planner.ts`：基于仓库已有测试入口生成 P2 验证计划（pnpm/npm/yarn、pytest、cargo、go、gradle）。
- `src/validation/runner.ts`：以 argv 数组执行验证，记录 stdout/stderr、退出码、耗时相关时间戳与输出哈希。
- `src/cli.ts`：接入 `validate <run-id>`；默认只展示计划，必须显式 `--approve` 才执行并写入 `validations/records.json`。
- 测试：`tests/unit/validation.test.ts`、`tests/unit/cli-validate.test.ts`，并更新 `tests/unit/cli.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 6 为 P2 项建立可审批、可追踪的验证系统；执行报告中的任意 shell 字符串仍被禁止，只使用项目已有测试入口。

#### 验证

- `pnpm test`：25 个测试文件、138 个用例全部通过。
- `pnpm typecheck`：无错误。
- `pnpm build`：生成 `dist/cli.js`（45.51 KB）。

#### 下一位维护者注意

- `validate` 当前读取运行目录下的 `consensus.json`（数组或 `{ items }`），阶段 5 尚未提供 CLI 串联写入，因此端到端流程需在后续阶段接入。
- 退出码 `0` 被归类为 `validated_false`（现有测试通过，未复现问题），非零为 `validated_true`，超时/无法启动为 `inconclusive`；失败执行不自动等同真实缺陷之外的语义判断留给阶段 8 用户裁决。
- `--approve` 是显式执行开关；无 `--approve` 只打印命令计划，满足“无隐式 yes”。
- 危险命令策略偏保守；如需执行迁移、部署或凭据相关验证，必须先按 `DESIGN.md` §15 调整设计。

### 2026-08-18 — 阶段 5：标准化与共识引擎

#### 新增

- `src/consensus/types.ts`：`Severity`/`EvidenceTier`/`SourceLocation`/`NormalizedFinding`/`ConsensusItem` 稳定契约，`SEVERITY_ORDER`、`higherSeverity`。
- `src/consensus/severity.ts`：自由文本严重程度 → P0–P3（未知默认 P2）。
- `src/consensus/path.ts`：绝对/相对路径转仓库相对路径，拒绝 `..` 越界与仓库外路径。
- `src/consensus/text.ts`：token 化与 Jaccard 相似度。
- `src/consensus/normalizer.ts`：Zod 校验 + 归一化（严重程度映射、路径归一化、原始等级保留、逐条跳过非法项）。
- `src/consensus/matcher.ts`：确定性匹配（同文件 + 行区间重叠）+ 加权相似度（路径 .30 / 位置符号 .20 / 类别 .15 / 标题根因 .25 / 修复 .10）。
- `src/consensus/dispute.ts`：严重程度差两级以上、根因/修复互斥、保护 vs 可利用冲突检测。
- `src/consensus/engine.ts`：`runConsensus` 生成 common/single_source/possible_match/disputed 的 `ConsensusItem[]`。
- `schemas/review-report.v1.json`：审查报告的 JSON Schema 文档。
- 测试：`tests/unit/{severity,path,normalizer,matcher,dispute,consensus}.test.ts`、`tests/unit/consensus.property.test.ts`（fast-check）、`tests/unit/finding-helper.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 5 把两份原始报告标准化为 `NormalizedFinding` 并计算稳定的交集/单方/可能相同/分歧快照，为阶段 6 验证与阶段 7 仲裁提供输入。

#### 验证

- `pnpm test`：23 个测试文件、133 个用例全部通过（新增 31 个，含 fast-check 性质测试）。
- `pnpm typecheck`：无错误；`pnpm build`：`dist/cli.js`（38.91 KB）。
- 性质测试覆盖：相似度对称且 ∈[0,1]、确定性匹配对称、路径归一化不含 `..` 段、`runConsensus` 对每个 finding 恰好分区一次。

#### 下一位维护者注意

- 确定性匹配解释为“同文件 + 行区间重叠”；符号/类别/错误标识折叠进相似度权重。阈值 ≥0.80 合并、0.55–0.79 possible_match、<0.55 单方。
- “根因/修复互斥”用 token 零重叠启发式（保守：误判会路由到阶段 7 仲裁，符合“宁交用户确认”）；纯语义的存在/不存在与保护冲突留待阶段 7 第三方 AI。
- 归一化 `evidenceTier` 默认 `agent_asserted`，共识合并后升为 `corroborated`；`needsRuntimeValidation` 仅对 P2 置真。
- 未接入 CLI（`normalize`/`consensus` 尚无可独立运行命令），阶段 6/7 会在 run 流程中调用这些模块并写 `consensus.json`。

### 2026-08-18 — 阶段 4：双 Agent 独立审查

#### 新增

- `src/reports/contract.ts`：版本化的只读审查契约（统一 prompt），含唯一 JSON 标记与输出格式说明。
- `src/reports/artifact.ts`：`RawReportArtifact` 与 `sha256Hex`/`makeArtifact`。
- `src/reports/extract.ts`：标记间 JSON 提取、轻量报告校验、格式修复 prompt。
- `src/reports/collector.ts`：`ReviewCollector`，并行启动两名审查者、收集原始报告，无效 JSON 恰好一次修复后放弃并保留原文。
- `src/reports/import.ts`：导入两份已有报告为 import 来源的 artifact。
- `src/reports/storage.ts`：把原始报告写入 `<run>/raw/{a,b}.txt` 与 `manifest.json`。
- `src/cli.ts`：接入 `start`/`import` 命令（`--agent-a`/`--agent-b`），创建 run、推进到 `reviewing`、保存原始报告。
- `prompts/independent-review.md`：审查契约的人读文档。
- 测试：`tests/unit/{contract,extract,artifact,collector,import,storage}.test.ts`、`tests/unit/cli-review.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 4 实现双 Agent 独立只读审查的入口与原始报告收集；两名 Agent 使用同一契约且互不可见，无效 JSON 仅一次修复机会。

#### 验证

- `pnpm test`：16 个测试文件、102 个用例全部通过（新增 29 个）。
- `pnpm typecheck`：无错误；`pnpm build`：`dist/cli.js`（38.91 KB）。
- 实机冒烟：`start`（缺参数）退出码 2；`import` 创建 run 并写入 `run.json`、`raw/{a,b}.txt`、`raw/manifest.json`。

#### 下一位维护者注意

- 导入报告的 `sourceId`/`agentKind` 均为 `"import"`，两个槽位用 `raw/a.txt`/`raw/b.txt` 与返回的 `Record<Slot, ...>` 区分；阶段 5 归一化时按 a/b 槽位消费。
- 修复成功时 artifact 内容为修复后的输出，失败时为原始输出；sha256 始终针对该 content。
- 实机 `start` 会真实分裂 pane 并启动 Agent（未在本阶段冒烟，留待阶段 12 e2e）；`ReviewCollector` 通过 `ReviewAgentGateway` 接口注入，测试用假 gateway。
- 运行阶段：`start`/`import` 把 run 推进到 `reviewing`；阶段 5 读取 `raw/` 完成归一化后推进到 `normalized`。

### 2026-08-18 — 阶段 3：Herdr Agent Adapter

#### 新增

- `src/herdr/types.ts`：`AgentStatus`、`AgentInfo`、`HerdrError`、`PromptOutcome` 与 `classifyErrorCode`（timeout/stalled/exited 等错误分类）。
- `src/herdr/adapter.ts`：`HerdrAgentAdapter`，封装 `pane split`、`agent list/get/start/prompt/wait/read`，解析 Herdr 的 `{result}`/`{error:{code,message}}` JSON 信封，区分 spawn/protocol/超时等失败。
- `src/spawn.ts`：`RunnerOptions` 增加 `env`；`SpawnResult` 增加 `timedOut`，使超时在适配层可分类。
- `tests/integration/fixtures/fake-herdr.mjs`：场景驱动的假 `herdr` 可执行文件。
- `tests/integration/herdr-adapter.test.ts`、`tests/unit/herdr.test.ts`。

#### 原因

- 按 `DESIGN.md` 阶段 3 建立通过官方 `herdr` CLI 调用 Agent 的适配层，不解析私有 socket 协议，为阶段 4 双 Agent 审查提供稳定接口。

#### 验证

- `pnpm test`：9 个测试文件、73 个用例全部通过（新增 19 个）。
- 假 `herdr` 集成测试覆盖：完成（done）、阻塞（blocked）、退出（exit）、超时（timeout），以及 pane split、start、list、get、read、wait。
- `pnpm typecheck`：无错误；`pnpm build`：生成 `dist/cli.js`（19.64 KB）。

#### 下一位维护者注意

- 实测 Herdr 0.8.0：`agent list`/`get` 返回 `{result}`/`{error:{code,message}}` 信封；`agent read` 返回纯文本（非 JSON）；`prompt` 用 `--wait --until --timeout`，错误码为 `timeout`、`agent_prompt_stalled`、`agent_not_found`。
- `agent start`/`prompt`/`wait` 的成功返回结构按 `result.agent` 推断（未对真实 Agent 跑突变命令），阶段 4 端到端时需再次确认；如有偏差按 §15 修正。
- 适配器默认通过 `HERDR_BIN_PATH ?? "herdr"` 定位二进制，支持注入 `env`（用于 `HERDR_PLUGIN_CONTEXT_JSON` 等上下文）。
- `prompt` 默认超时 600s 并始终传 `--timeout`，避免 `--wait` 无限挂起；`read` 失败在结果中按 best-effort 处理。

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
