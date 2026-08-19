# Herdr Consensus AI 交接文档

> 交接时间：2026-08-18（Asia/Shanghai）  
> 工作目录：`<repo>`（本仓库根目录）
> 当前分支：`main`（用户明确选择在现有脏工作区原地继续）  
> 当前结论：实现已继续推进，但尚不可宣布发布完成；需第三轮独立代码审查及最新发布包复验。

## 1. 下一位 AI 先做什么

1. 完整阅读 `AGENTS.md` 和 `DESIGN.md`，不要跳过阶段规则。
2. 阅读本文全部内容，再查看 `git status --short` 和 `git diff --check`。
3. 不要 reset、clean、checkout、覆盖或提交不明来源的现有修改；整个阶段 6–12 实现都在这个脏 `main` 中。
4. 先对第二轮审查后的 5 项整改做第三轮只读代码审查，重点文件和用例见第 6 节。
5. 审查无阻断后，依次运行最新完整门槛：

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   npm pack --dry-run --json --cache <临时可写 cache>
   ```

6. 从最新实际 `.tgz` 做 production-only 安装，并运行安装后的符号链接入口：

   ```bash
   <temp>/install/node_modules/.bin/herdr-consensus --version
   <temp>/install/node_modules/.bin/herdr-consensus doctor --json
   ```

7. 只有上述步骤通过，才更新 `DESIGN.md` 阶段 6–11 的真实状态和 `CHANGELOG.md`；阶段 12 仍有 Linux fixture 与独立维护者 README 安装/恢复外部签核门槛。

## 2. 用户目标与本轮选择

- 用户最初要求阅读技术文档、判断插件是否完成，随后要求继续完善。
- 用户选择方案 `1`：直接在当前已有修改的 `main` 工作区原地实现。
- 未创建 feature branch，未 commit、merge、push、reset、clean，也未关闭真实 Herdr 烟雾测试留下的 tab。
- 本轮目标是把阶段 6–12 的模块串成可恢复、失败关闭、可发布验证的完整 CLI 工作流。

## 3. 已完成的主要实现

### 3.1 审查收集与共识主流程

- `start` / `import` 已串联 raw → normalized → consensus。
- 支持 marker、完整 JSON、Markdown fenced JSON，单报告限制 2 MiB。
- 终端输出清理 ANSI/控制字符，并仅在 JSON 字符串内部修复终端硬换行。
- 两名 Review Agent 使用独立、非聚焦、全宽 Herdr tab；使用稳定 `name` 而不是 agent kind。
- pane shell 未就绪只做有限重试；首次 prompt 只有在“无 artifact 且无 marker”时重发一次。
- Review Agent cwd 位于 run 状态目录 `agent-output/<slot>/`，项目仅通过绝对路径只读访问。
- 优先读取 `HERDR_CONSENSUS_OUTPUT` 受控文件，终端 marker 作为兼容回退。

### 3.2 状态、恢复、交互和裁决

- JSON 状态采用临时文件 + fsync + rename 原子写入。
- 状态机只允许相邻阶段或同阶段幂等转换。
- `resume` 可按阶段与已有 artifact 给出安全恢复路径。
- Herdr 无参数 actions 支持交互选择 Agent/run/逐项决定/已有报告。
- 决策记录包含 evidence snapshot；损坏 decisions JSON 不再降级为空。
- 多个显式决定可在 `deciding` 阶段继续写入。
- `validate_more` 可在 `arbitrating` 或 `deciding` 中继续 `validate` / `arbitrate` / `decide`；`lock` 在仍存在 `validate_more` 时失败关闭。

### 3.3 验证与仲裁

- P2 验证先展示计划，只有 `--approve` 才执行项目命令。
- 非零、超时或 runner 失败记为 `inconclusive`，不再错误证明 finding 成立。
- 验证结论回写对应 consensus item；每轮验证使用唯一 ID，日志和 records 追加而非覆盖。
- 仲裁 Agent cwd 已隔离到 `arbitration/agent-work/`，不会在主项目 cwd 运行。
- 仲裁只采纳最后一对 marker，且 `itemId` 必须等于当前请求项；缺失/错项建议不推进阶段。
- 仲裁来源、review Agent kinds 和 independence 会持久化并进入最终报告。

### 3.4 锁定计划、apply 和报告

- `lock` 拒绝缺失决定、`validate_more`、过期 evidence snapshot。
- fix-plan 生成不可变版本 JSON/Markdown、规范 SHA-256 和 latest 指针。
- 版本 archive 与 latest 双文件发布现已包含失败回滚；模拟 latest Markdown 发布失败后，可清除本次 archive 并安全重试同一版本。
- `apply` 必须显式传 `--approve-regression`，否则不会创建 worktree 或运行项目代码。
- apply 创建隔离 Git worktree 后立即记录 immutable `baseCommit`。
- 修改范围比较 base commit 与最终工作区，覆盖 committed、staged、unstaged、untracked；HEAD 移动直接失败。
- apply 在执行任何外部修改前验证根 fix-plan 的 schema、runId、规范哈希、locked 审计事件和 `fix-plans/vN.json` archive 完全一致。
- 定向检查和项目级回归都在隔离 worktree 中执行；回归结果原子写入 `logs/regression.json`。
- 回归证据绑定 worktree 内容快照 SHA-256：覆盖变更路径、类型、mode、删除状态和文件内容。
- `report` 不再运行项目代码，只消费已批准且成功的持久化回归证据；报告前重查 HEAD、全量路径策略和内容快照。
- 已进入 `reported` 的 run 只打开既有报告，不重新生成或再次执行命令。
- 最终报告有运行时 Zod schema 和公开 `schemas/final-report.v1.json`。

### 3.5 artifact 运行时失败关闭

新增 `src/workflow/artifacts.ts`，为以下已存在 artifact 做严格运行时解码，而不是 TypeScript 强制转换：

- `consensus.json`
- `normalized/findings.json`
- `validations/records.json`
- `arbitration/advice.json`
- `arbitration/metadata.json`
- `fix-plan.json` 与版本 archive
- `logs/path-policy.json`
- `logs/targeted-checks.json`
- `logs/regression.json`

明确允许缺失的文件才可使用默认值；文件存在但 JSON 语法或结构非法时返回非零。例如 `{"items":null}` 不能再被当成空共识并锁出空计划。

### 3.6 发布包与 CLI 入口

- `herdr-plugin.toml` 已移除安装期 `[[build]]`，actions 直接运行预构建 `dist/cli.js`。
- `package.json` 使用 `files` 白名单，tarball 保持 8 个运行文件；新增 `prepack: pnpm run build`，从源码打包时自动生成 bundle。
- CLI main-module 判断改用两侧 realpath，修复 npm `.bin/herdr-consensus` 符号链接和 macOS `/tmp` → `/private/tmp` 下进程退出 0 但无输出的问题。
- README 已加入 `apply --approve-regression`，并说明 report 只导出持久化回归证据。

## 4. 文件变更分组

以下是当前工作区的重要新增/修改，不代表可以全部直接提交；提交前必须重新审查 dirty worktree。

### 核心新增

- `src/state/json.ts`
- `src/workflow/process-review.ts`
- `src/workflow/guards.ts`
- `src/workflow/resume.ts`
- `src/workflow/artifacts.ts`
- `src/ui/prompts.ts`
- `src/ui/decision-wizard.ts`
- `src/reports/content.ts`
- `src/arbitration/*`
- `src/validation/*`
- `src/decisions/*`
- `src/fix-plan/*`
- `src/apply/*`（含 `snapshot.ts`）
- `src/reporting/*`
- `schemas/final-report.v1.json`
- `tests/e2e/cli-workflow.test.ts`
- 阶段 6–12 对应的 `tests/unit/*.test.ts`
- `README.md`、`LICENSE`
- `docs/superpowers/plans/2026-08-18-release-flow-closure.md`

### 主要修改

- `src/cli.ts`：完整 CLI 编排、交互、阶段守卫、验证/仲裁/裁决/锁定/apply/report。
- `src/herdr/adapter.ts`：Herdr 0.8.0 稳定名称、独立 tab、shell 时序和 unwrapped 读取。
- `src/reports/collector.ts`、`contract.ts`、`extract.ts`、`import.ts`、`storage.ts`。
- `src/consensus/normalizer.ts`、`src/state/store.ts`。
- `herdr-plugin.toml`、`package.json`、`README.md`、`DESIGN.md`、`CHANGELOG.md`。
- fake Herdr integration fixture 和既有 CLI/collector/store tests。

## 5. 已执行验证与真实结果

### 5.1 最新代码状态（第二轮审查后的 5 项修复完成后）

- `pnpm typecheck`：通过。
- 定向整改测试：8 个文件、34 个用例通过。
- `pnpm test`：48 个测试文件、236 个用例全部通过。
- `git diff --check`：在最新 5 项整改前后均曾通过；交接后请再运行一次确认文档编辑未引入空白错误。

注意：最新 5 项整改完成后尚未重新运行 `pnpm lint`、`pnpm build`、最新 tarball 安装和第三轮独立审查。这是下一位 AI 的首要工作，不能沿用旧结果冒充最新验证。

### 5.2 第二轮审查之前的完整发布门槛

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：48 文件、231 用例通过。
- `pnpm build`：通过，生成约 113 KB 的 `dist/cli.js`。
- `npm pack`：通过，tarball 仅 8 文件。
- 实际 tarball production-only 安装：安装 29 个运行时包成功。
- 安装后的 `.bin/herdr-consensus --version`：输出 `0.1.0`。
- 安装后的 `.bin/herdr-consensus doctor --json`：成功执行；Node/Git/Herdr 正常，非 Herdr pane 中 Agent 枚举为 warning。
- npm 默认 cache 因用户目录存在 root-owned 文件报 `EPERM`；验证时使用 `/tmp/herdr-consensus-npm-cache.bgFJg8`，没有修改用户 cache 权限。

以上 bundle/tarball 结果早于最新 5 项整改，只能证明打包链和 npm bin 修复曾经有效；必须重建最新 bundle 后再验证。

### 5.3 真实 Herdr 只读烟雾测试（仍有效）

- Codex + Claude：run `run-20260818110250-3fd884c6` 到达 `consensus`，两槽 collected，2 个共识项，fixture Git 未改变。
- Codex + Pi：run `run-20260818110621-c4550cd0` 到达 `consensus`，两槽 collected，1 个共识项，fixture Git 未改变。
- 真实环境：macOS、Herdr 0.8.0。
- 这些烟雾只覆盖双 Agent 只读审查到 consensus，不替代 apply/report 的无模型 e2e。

## 6. 两轮独立代码审查记录

### 第一轮结论：Ready to merge — No

发现 3 个 Critical 和 8 个 Important：

- manifest build 与 8 文件包不兼容。
- apply 仅检查 unstaged diff，可被 staged/commit 绕过。
- 仲裁在主项目 cwd 运行。
- 非零验证误判、`validate_more` 死路、marker/itemId、损坏 JSON、lock 完整性、无回归 report、已有报告打开、fix-plan 部分写入等。

这些问题已经实现整改，并在第二轮审查中确认 3 个 Critical 全部清零。

### 第二轮结论：Ready to merge — No

第二轮确认先前大多数问题已修复，但指出 5 个 Important：

1. `deciding` 阶段改回 `validate_more` 后无法继续验证。
2. 只拒绝 JSON 语法错误，没有拒绝 schema 非法 artifact。
3. apply 未核对 fix-plan hash、runId、locked audit 和 immutable archive。
4. regression 没有绑定最终 worktree 内容，同一 allowed path 可在回归后被修改。
5. fix-plan archive 成功、latest Markdown 失败时无法回滚和重试。

上述 5 项现已编码修复，并新增对应测试；但修复之后还没有进行第三轮独立代码审查。因此当前仍应按 `Ready to merge: No / 待复核` 处理。

第三轮审查建议重点查看：

- `src/cli.ts`
- `src/workflow/artifacts.ts`
- `src/fix-plan/generate.ts`
- `src/fix-plan/verify.ts`
- `src/fix-plan/store.ts`
- `src/apply/snapshot.ts`
- `src/reporting/types.ts`
- `src/reporting/schema.ts`
- `schemas/final-report.v1.json`
- `tests/unit/cli-decide.test.ts`
- `tests/unit/cli-lock.test.ts`
- `tests/unit/cli-apply.test.ts`
- `tests/unit/cli-report.test.ts`
- `tests/unit/fix-plan-store.test.ts`
- `tests/e2e/cli-workflow.test.ts`

## 7. 最新新增的对抗测试

- `deciding` run 把终态决定改回 `validate_more` 后仍可执行 `validate`。
- 多项显式决定在 `deciding` 中继续记录。
- 损坏 decisions JSON 返回非零。
- `consensus.json = {"items":null}` 不能生成 fix-plan。
- lock 拒绝 missing、`validate_more` 和 stale evidence snapshot。
- 仲裁拒绝错误 `itemId`，并保持可重试阶段。
- apply 缺少 `--approve-regression` 时不调用外部 runner。
- apply 拒绝 HEAD 移动和 locked path 外变化。
- apply 拒绝 schema 合法但内容被篡改的根 fix-plan，且在任何外部命令前停止。
- regression 失败保持 run 为 `locked`。
- report 缺失回归证据时失败，且不会重新执行回归。
- report 拒绝 apply 后 HEAD 移动。
- report 拒绝成功回归后对同一 allowed file 的内容修改。
- 已 reported run 只读取既有报告。
- archive 任一 sibling 已存在时不产生部分版本。
- latest Markdown 发布失败时回滚 archive/latest，移除故障后同一版本可重试。
- npm bin 符号链接能够被 CLI 入口判定识别。

## 8. 当前已知待办与发布边界

必须完成：

- 第三轮独立只读代码审查，复核第 6 节的 5 项整改。
- 最新 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- 最新 `npm pack --dry-run --json`，确认仍为 8 文件。
- 从最新 `.tgz` 做 production-only 安装并运行 `.bin` 的 version/doctor。
- 根据第三轮结论更新 `DESIGN.md` 阶段表和 `CHANGELOG.md` 完成记录。

仍属外部发布签核：

- Linux fixture 验证。
- 由未参与开发的维护者照 README 完成安装、状态恢复和卸载。

不要做：

- 不要自动 commit、merge、push、建 PR 或部署。
- 不要清理 `/tmp` 或 Herdr tab 来“整理现场”，除非用户明确授权。
- 不要把旧的 231 用例/旧 tarball 结果当作最新 5 项整改后的验证。
- 不要因测试失败删除测试、放宽 schema 或伪造 baseline。

## 9. 推荐接力命令

```bash
cd <repo>
sed -n '1,240p' AGENTS.md
sed -n '1,760p' DESIGN.md
git status --short
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

打包时不要使用有权限问题的默认 npm cache；创建新的临时目录：

```bash
mktemp -d /tmp/herdr-consensus-npm-cache.XXXXXX
mktemp -d /tmp/herdr-consensus-package.XXXXXX
npm pack --json --cache <cache-dir> --pack-destination <package-dir>
```

若依赖安装在 sandbox 中因网络无输出/失败，按环境审批流程申请最小范围的 `npm install` 联网权限，不要修改 `~/.npm` 的所有权。
