# AI 任务 Backlog

## 1. 使用方式

本 backlog 供 AI Agent 使用。任务按依赖顺序排列，除非用户另有要求，否则应从上到下完成。

在当前 Phase 尚未完全完成之前，不要跳到下一个 Phase 的任务。

关键前置知识：策略等级（Level 1/2/3）是分类标签，策略步骤总数（totalSteps = SolverBatch[].length）是数量。不要混淆。

## 2. Phase 1 — 应用脚手架

### Task S1 — 初始化 Vite React TS 项目

产出：

- Vite + React + TypeScript 应用已创建。
- `src/game/` 和 `src/ui/` 目录结构已建立。
- Vitest 已配置。

验收：

- `npm run dev` 可以启动并显示页面。
- `npm test` 命令可用。

### Task S2 — 建立基础目录结构

产出：

- 所有核心文件和测试目录的占位文件。

验收：

- 目录结构符合设计文档。
- `tsc --noEmit` 不报错。

## 3. Phase 2 — 类型定义

### Task T1 — 定义核心类型

产出：

- `types.ts` 包含所有核心类型：Position、CellState、Region、BoardState、StrategyType（7 种）、SolverBatch、SolverResult、Level、GeneratorParams。
- 特别关注：SolverBatch 的 strategy 字段类型为 StrategyType，SolverResult 包含 batches/totalSteps/strategyTypesUsed/highestLevel，Level 包含 strategySequence。

验收：

- 可以用 TypeScript 描述一个完整的 5×5 关卡数据及其求解结果。
- `tsc --noEmit` 不报错。

## 4. Phase 3 — 规则引擎

### Task R1 — 实现基础规则函数

产出：

- 邻域检查、候选格获取、唯一候选查找等纯函数。

验收：

- 单元测试覆盖正常和边界情况。

### Task R2 — 实现状态变更函数

产出：

- `applyQueen`（放置 Queen + 返回受影响的 X 位置）、`applyX`、`isBoardComplete`、`createEmptyBoard`。

验收：

- 单元测试覆盖 Queen 放置后的 X 范围、棋盘完成判断。

## 5. Phase 4 — 求解器

### Task SV1 — 实现 Level 1 策略

产出：

- `stepL1Direct`：从所有已确认 Queen 传播 X，合并为一个批次。
- `stepL1Unique`：检查所有行/列/区域，确认唯一候选。
- L1 循环：交替执行直到无产出。

验收：

- 测试：仅需 L1 的棋盘能正确完成。
- 批次策略类型标注正确。

### Task SV2 — 实现 Level 2 策略

产出：

- `stepL2Lock1`（k=1 锁定）、`stepL2Lock2`（k=2 对子）、`stepL2Lock3`（k=3 占位）。

验收：

- 测试：需要 L2 的棋盘能正确完成。

### Task SV3 — 实现 Level 3 策略

产出：

- `stepL3Projection`（含单步致死检查）、`stepL3Capacity`。

验收：

- 测试：需要 L3 的棋盘能正确完成。

### Task SV4 — 实现求解器主循环

产出：

- `solve(board)`：Level 1→2→3 循环，每个策略产出 → 回到 L1。产出 `SolverResult`（含完整 `batches` 数组和 `totalSteps`）。
- 确定性：同一棋盘多次调用返回相同结果。
- 不可解棋盘返回 `complete: false`。

验收：

- 完整求解链路测试。
- 批次序列策略标注正确。
- 不可解棋盘正确处理。

## 6. Phase 5 — 关卡生成器

### Task G1 — 实现 Queen 位置生成

产出：

- `generateQueenPositions(n, rng)`：随机化回溯搜索。返回 n 个合法 Queen 位置。

验收：

- 测试：5×5 到 10×10 棋盘均可在合理时间内生成。
- 测试：Queen 位置不违反行列邻接约束。

### Task G2 — 实现区域生成

产出：

- `generateRegions(n, queenPositions, complexity, rng)`：多源 BFS 竞争生长。
- `complexity` 参数控制区域跨度和重叠度。
- 后处理保证连通性。

验收：

- 测试：区域覆盖所有格子。
- 测试：每区域连通且恰含 1 Queen。
- 测试：不同 complexity 产出不同形态的区域布局。

### Task G3 — 实现主生成流程

产出：

- `generateLevel(params: GeneratorParams)`：完整生成 + solver 验证 + 二分搜索 targetSteps 控制。
- 种子化随机确定性（使用 `random.ts` 的 createRNG）。
- tolerance 设定（max(3, floor(targetSteps * 0.1))）和 maxRetries（30）。
- 二分收敛失败时返回 bestLevel。
- 关卡数据中填入 strategySequence（`result.batches.map(b => b.strategy)`）。

验收：

- 测试：不同 targetSteps 产出不同策略步骤总数的关卡。
- 测试：生成的关卡有唯一解且可用 Level 1-3 求解。
- 测试：相同种子产生相同关卡。
- 测试：输出包含完整 strategySequence。

## 7. Phase 6 — 状态管理

### Task SM1 — 实现游戏状态 Store

产出：

- zustand store，持有：关卡数据、玩家棋盘、操作历史（{pos, wasX}[]）、求解器展示状态（solverResult + currentStepIndex）、生成器状态（isGenerating）。
- 暴露方法：toggleX、confirmQueen、undoX、redoX、requestSolve、requestGenerate、loadLevel、resetBoard、setSolverStep。

验收：

- 完整游戏流程可通过 store 完成。
- 操作历史正确，撤销/重做可用。

## 8. Phase 7 — 可玩 UI

### Task U1 — 实现棋盘和格子组件

产出：

- `Board.tsx` + `Cell.tsx`：CSS Grid 棋盘，区域颜色渲染，Queen/X 标记显示。

验收：

- 棋盘正确渲染。
- 点击可标记 X。

### Task U2 — 实现 HUD 和工具栏

产出：

- `Hud.tsx`：n×n、步骤总数、Queen 进度。
- `Toolbar.tsx`：撤销/重做/重置/求解器/生成器按钮。

验收：

- 信息显示正确。
- 按钮功能可用。

### Task U3 — 实现求解器面板

产出：

- `SolverPanel.tsx`：总览 + 批次列表 + 播放控制。Board 同步显示当前步骤状态。

验收：

- 步骤列表正确显示策略类型、消除数、描述。
- 播放控制功能齐全。
- 桌面侧边滑入 / 移动端底部滑入。

### Task U4 — 实现生成器面板

产出：

- `GeneratorPanel.tsx`：n 选择 + 复杂度选择（简单/中等/困难，内部映射 targetSteps）+ 生成按钮 + 加载状态。可选高级 targetSteps 直接输入。

验收：

- 调整参数后可生成新关卡。
- 生成完成后自动加载。

## 9. Phase 8 — 动效与适配

### Task A1 — 添加交互动效

产出：

- 标记 X / 确认 Queen / 传播 X / 错误反馈 / 唯一候选高亮 / 完成动效。

验收：

- 所有主要交互有清晰动效。
- 动效不阻塞操作。

### Task A2 — 移动端与桌面端适配

产出：

- 响应式布局。移动端面板底部滑入。≥36px 格子。

验收：

- 320px 宽度下 10×10 仍可操作。
- 桌面端布局不溢出。

## 10. Phase 9 — 验证

### Task V1 — 运行全量测试和构建

产出：

- 所有单元测试通过。
- `npm run build` 无错误。

验收：

- 测试覆盖核心逻辑和关键边界。

### Task V2 — 浏览器手动验证

产出：

- 手动完成 3 个不同参数关卡的游玩和求解器验证。

验收：

- 核心流程无阻塞 bug。
- 已知问题已记录。

### Task V3 — 移动端布局验证

产出：

- 移动端视口验证。

验收：

- 布局不重叠。
- 10×10 可辨识和操作。

## 11. MVP 后候选任务

- 生成器性能优化。
- 策略类型约束（必须包含某种 StrategyType）。
- 策略序列精确控制。
- 提示功能。
- 关卡导出/导入。
- 更大棋盘。
- 暗色主题。
- 键盘快捷键。

## 12. 提示词模板

### 完整 MVP 提示词

```text
读取 CLAUDE.md、AGENTS.md、Queen解谜游戏原型设计.md、LinkedIn-Queens-solving-strategies.md、AI_DEVELOPMENT_FRAMEWORK.md、AI_IMPLEMENTATION_PLAN.md、ACCEPTANCE_CRITERIA.md 和 AI_TASK_BACKLOG.md。

按 backlog 顺序实现完整 MVP。注意区分策略等级（分类）和策略步骤总数（数量）。求解器实现全部 7 种策略类型并输出完整 SolverBatch[] 序列。生成器通过 targetSteps 控制关卡复杂度。实现可交互棋盘 UI 和求解器可视化面板。加入几何动感风格的视觉表现和交互动效。运行测试和 build，启动 dev server，并报告本地 URL 与已知限制。
```
