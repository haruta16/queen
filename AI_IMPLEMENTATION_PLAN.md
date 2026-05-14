# AI 实现计划

## 1. 范围

本文档用于 Vite + React + TypeScript 版本的 Queen 解谜游戏原型实现。

当前状态：

- 已有完整的玩法设计文档和策略体系文档。
- 已有 AI 开发框架文档。
- 在用户要求开始实现时，Agent 按本文档的 Phase 顺序执行。

目标 MVP：

> 一个浏览器可玩的 Queen 解谜游戏原型，包含：关卡生成器（通过 n 和 targetSteps 控制关卡推理复杂度）、求解器（实现全部 7 种策略类型，输出完整 SolverBatch[] 序列并可视化展示）、可交互棋盘 UI、以及几何动感风格的视觉表现。

关键概念（实现前必须理解）：

| 概念 | 含义 |
|---|---|
| 策略等级 (Level) | 分类标签。Level 1/2/3。不是数量。 |
| 策略类型 (StrategyType) | 7 种具体策略枚举值。 |
| 策略批次 (SolverBatch) | 求解器每次策略执行的输出单元，可计数。 |
| 策略步骤总数 (totalSteps) | SolverBatch[] 的 length。生成器核心参数。 |

## 2. Phase 0 — 准备

目标：

- 让仓库进入可实现状态。

任务：

- 与用户确认正式开始实现。
- 阅读所有设计文档（重点：策略等级 vs 策略步骤总数的区别、求解器批次合同、生成器二分搜索流程）。
- 根据环境决定包管理器（npm / yarn / pnpm）。
- 安装 zustand（状态管理）。

退出标准：

- Agent 理解当前设计，不需要再向用户确认 MVP 的基础方向。

## 3. Phase 1 — 应用脚手架

目标：

- 创建 Vite + React + TypeScript 项目。

任务：

- 初始化 Vite React TS 项目。
- 添加 Vitest 和测试配置。
- 安装 zustand。
- 建立目录结构：`src/game/` 和 `src/ui/`。
- 关键文件占位：`types.ts`、`rules.ts`、`solver.ts`、`generator.ts`、`random.ts`、`store.ts`。
- 初始 App 界面保持简洁。

退出标准：

- `npm run dev` 可以启动。
- `npm test` 可以运行（即使没有测试用例）。
- 目录结构符合设计文档。

## 4. Phase 2 — 类型定义

目标：

- 定义所有核心数据结构。

需要定义的类型：

- `Position`、`CellState`、`Region`：基础数据结构。
- `BoardState`：玩家棋盘状态。
- `StrategyType`：7 种策略类型枚举（L1_Direct / L1_Unique / L2_Lock1 / L2_Lock2 / L2_Lock3 / L3_Projection / L3_Capacity）。
- `SolverBatch`：求解步骤批次（index、strategy、eliminations、queenConfirmed、description）。
- `SolverResult`：求解结果（complete、batches、totalSteps、strategyTypesUsed、highestLevel）。
- `Level`：关卡数据（id、n、regions、seed、targetSteps、actualSteps、strategySequence、solverResult）。
- `GeneratorParams`：生成器参数（n、targetSteps、seed?）。
- `RNG`：种子化随机数生成器类型（`() => number`）。

退出标准：

- 一个完整的关卡（含求解结果）可以用结构化 TypeScript 数据表达。
- 所有类型在 `types.ts` 中集中定义。
- 类型之间关系清晰，无循环引用。

## 5. Phase 3 — 规则引擎

目标：

- 实现纯游戏逻辑函数。

核心函数：

- `getAdjacentPositions(pos, n)`：获取 8 邻域内的合法坐标。
- `hasAdjacentQueen(board, pos)`：检查某格是否与任何 Queen 相邻。
- `isValidQueenPlacement(board, pos)`：检查在给定位置放置 Queen 是否违反规则。
- `getCandidatesInRow(board, row)`：获取某行中所有候选格。
- `getCandidatesInCol(board, col)`：获取某列中所有候选格。
- `getCandidatesInRegion(board, regionId)`：获取某区域中所有候选格。
- `findUniqueCandidates(board)`：找出所有行/列/区域中候选数为 1 的位置。
- `applyQueen(board, pos)`：放置 Queen 并返回新棋盘 + 受影响的 X 位置列表。
- `applyX(board, pos)`：标记 X 并返回新棋盘。
- `isBoardComplete(board)`：检查棋盘是否已放置 n 个 Queen 且全部合法。
- `createEmptyBoard(n, regions)`：创建初始棋盘（仅含区域信息，无 Queen 无 X）。

退出标准：

- 所有规则函数为纯函数，可脱离 React 独立运行。
- 单元测试覆盖正常情况和边界情况。

## 6. Phase 4 — 求解器

目标：

- 实现全部 7 种策略类型和 Level 1→2→3 主循环，输出完整 SolverBatch[] 序列。

核心函数：

- `solve(board)`：主求解函数。
  - 返回 `SolverResult`，包含完整 `batches` 数组。
  - 若 Level 1-3 循环跑完仍无法完成，返回 `complete: false`。
  - **必须严格遵守设计文档 4.2 节的「批次合同」**：无产出不记录批次、一次调用一个批次、批次内不连锁、index 从 1 递增。

- Level 1 实现：
  - `stepL1Direct(board)`：对每个已确认 Queen，标记同行/同列/同区域/相邻 8 格为 X。返回本批次的 SolverBatch 或 null。
  - `stepL1Unique(board)`：检查所有行/列/区域。若某个单位的候选数为 1 → 确认 Queen。返回本批次的 SolverBatch 或 null。
  - L1 循环：交替执行直到两者都不再产出。

- Level 2 实现：
  - `stepL2Lock1(board)`：k=1 锁定。检查行↔区域、列↔区域、行↔列的单向锁定关系。
  - `stepL2Lock2(board)`：k=2 对子。两行↔两列、两区域↔两行/列。
  - `stepL2Lock3(board)`：k=3 占位。三单位↔三资源。
  - 每个 step 返回 SolverBatch 或 null。

- Level 3 实现：
  - `stepL3Projection(board)`：候选集合共同相邻投影 + 单步致死检查。
  - `stepL3Capacity(board)`：容量溢出检测。
  - 每个 step 返回 SolverBatch 或 null。

- 主循环逻辑：
```text
loop:
  do {
    batch = stepL1Direct();  if batch → push to result, continue loop
    batch = stepL1Unique();  if batch → push to result, continue loop
  } while (either produced)

  for strategy in [L2_Lock1, L2_Lock2, L2_Lock3]:
    batch = strategy(); if batch → push to result, goto loop_start

  for strategy in [L3_Projection, L3_Capacity]:
    batch = strategy(); if batch → push to result, goto loop_start

  break  // no strategy produced — stuck (incomplete if board not solved)
```

关键实现要点：

- **批次合并粒度**：这是一个关键设计决策，必须在求解器中明确定义且保持一致。例如：一次 L1_Direct 执行可能消除来自多个 Queen 的 X——是合并为一个批次还是每个 Queen 一个批次？推荐合并为一个批次（因为它们是同一次策略执行的结果）。此粒度直接影响 totalSteps 数值，生成器依赖此数值。
- 每个 SolverBatch 的 index 从 1 开始递增。
- description 字段应包含人类可读信息，如 "从 r3c2 的 Queen 传播，消除同行/列/区域/相邻共 6 个 X"。

退出标准：

- 求解器可对已知唯一解的合法棋盘完成求解，输出完整 SolverBatch[]。
- 求解器可识别需要 Level 4 的棋盘（返回 incomplete）。
- 每个批次带有正确的 strategy 标签。
- 单元测试覆盖各策略类型的关键场景。
- 求解器对同一棋盘多次调用返回相同的批次序列（确定性）。

## 7. Phase 5 — 关卡生成器

目标：

- 实现可根据 n 和 targetSteps 生成合法关卡的生成器。

核心函数：

- `generateQueenPositions(n, rng)`：带随机化的回溯搜索。返回 n 个 Queen 位置。
- `generateRegions(n, queenPositions, complexity, rng)`：多源 BFS 竞争生长。
  - `complexity` 参数控制：
    - **生长方向偏好**：低复杂度偏好同行/同列方向扩展，高复杂度随机多方向扩展。
    - **区域边界波动**：高复杂度下区域边界更不规则，增加区域间候选交叉。
- `generateLevel(params: GeneratorParams)`：主生成函数。
  1. `queenPositions = generateQueenPositions(n, rng)`
  2. 根据 targetSteps 估算初始 complexity
  3. `regions = generateRegions(n, queenPositions, complexity, rng)`
  4. `board = createEmptyBoard(n, regions)`
  5. `result = solve(board)`
  6. 若 `!result.complete` → 拒绝，调整 complexity，回到步骤 3
  7. `steps = result.totalSteps`
  8. 若 `|steps - targetSteps| ≤ tolerance` → 构建 Level 数据，填入 result（含 strategySequence），输出
  9. 若 `steps < targetSteps` → 提高 complexity，回到步骤 3
  10. 若 `steps > targetSteps` → 降低 complexity，回到步骤 3
  11. 超过最大重试次数 → 放宽 tolerance 或返回 closest match

- `seededRandom(seed)`：种子化随机数生成器工具函数。

关键实现要点：

- tolerance 建议设为 `Math.max(3, Math.floor(targetSteps * 0.1))`（±3 或 ±10%，取大）。
- complexity 参数的调节步长需要实验调优，初始可设为线性增减。
- 区域必须保证连通性（后处理修复）。
- 生成器记录 strategySequence（`result.batches.map(b => b.strategy)`），存入 Level 数据。
- 解的唯一性验证：生成器生成棋盘后，求解器求解。由于求解器是确定性的，若求解器给出完整解则说明该棋盘在当前策略体系下有唯一解。更严格的唯一性验证可用不同初始顺序的求解器再次求解确认——但 MVP 阶段不强制。

退出标准：

- 生成器可稳定生成 5×5 到 10×10 的合法关卡。
- 给定不同 targetSteps，生成器产出不同策略步骤总数的关卡。
- 生成的关卡有唯一解，且可用 Level 1-3 策略完全求解。
- 相同种子产生相同关卡。
- Level 数据包含完整 strategySequence。
- 单元测试覆盖生成→求解→验证的完整链路。

## 8. Phase 6 — 状态管理

目标：

- 连接核心逻辑和 UI 层。

核心实现：

- `useGameStore`：zustand store，持有：
  - 当前关卡数据（`Level | null`）。
  - 玩家棋盘状态（`BoardState`）。
  - 操作历史（`{ pos: Position, wasX: boolean }[]`，用于撤销/重做 X 标记）。
  - 求解器展示状态（`solverResult: SolverResult | null`、`currentStepIndex: number`）。
  - 生成器参数和状态（`generatorParams`、`isGenerating`）。
- 暴露的操作方法：
  - `toggleX(row, col)`：标记/取消 X。
  - `confirmQueen(row, col)`：确认 Queen（需验证该格在某单位中是唯一候选）。
  - `undoX()` / `redoX()`：撤销/重做 X 标记。
  - `requestSolve()`：触发求解器，存储结果。
  - `requestGenerate(params)`：触发生成器，加载结果。
  - `loadLevel(level)`：直接加载关卡。
  - `resetBoard()`：重置当前关卡的玩家操作。
  - `setSolverStep(index)`：跳转到求解器某一步。

退出标准：

- UI 可以通过 store 完成所有游戏操作。
- 核心逻辑仍然可以脱离 React 独立测试。
- 操作历史正确记录，撤销/重做功能完好。

## 9. Phase 7 — 可玩 UI

目标：

- 构建清晰可玩的棋盘界面。

任务：

- **Board.tsx**：CSS Grid 棋盘，响应式尺寸。根据 currentStepIndex 渲染求解器某一步的状态。
- **Cell.tsx**：单格渲染。区域颜色、Queen 图标（♛）、X 标记（半透明斜线）。
- **Hud.tsx**：顶部信息栏。显示 n×n、策略步骤总数、已确认 Queen 数/n。
- **Toolbar.tsx**：撤销/重做/重置/求解器开关/生成器开关按钮。
- **SolverPanel.tsx**：
  - 桌面端侧边滑入，移动端底部滑入。
  - 显示总览：totalSteps、用到的策略类型、最高策略等级。
  - 批次列表，每行：序号、策略类型标签（用颜色区分）、消除 X 数、描述。
  - 播放/暂停/前一步/后一步/跳至开头/跳至末尾。
  - 当前步骤高亮，Board 同步显示该步骤完成后的棋盘状态。
- **GeneratorPanel.tsx**：
  - 弹窗或抽屉。
  - n 选择（5-10，按钮组）。
  - 复杂度选择：「简单」「中等」「困难」（内部映射为 targetSteps 区间）。
  - 可折叠高级选项：直接输入 targetSteps 数值。
  - 「生成关卡」按钮 + 生成中加载状态。
  - 生成完成自动关闭并加载关卡。
- **useInput.ts**：点击/触摸 → toggleX 或 confirmQueen（根据当前操作模式）。

退出标准：

- 玩家可以在棋盘上点击标记 X 和确认 Queen。
- 规则冲突时 UI 给出明确反馈。
- 不同尺寸棋盘均可读。
- 求解器面板可打开并逐步骤查看。
- 生成器面板可调整参数并生成新关卡。

## 10. Phase 8 — 动效与适配

目标：

- 让原型更容易理解、更有完成感。

任务：

- 标记 X 动效：缩放 + 淡入（~200ms）。
- 确认 Queen 动效：放大闪烁 + 弹入（~300ms）。
- 传播 X 动效：波纹扩散（~400ms，可跳过）。
- 错误反馈动效：红色闪烁 + 回弹（~300ms）。
- 唯一候选高亮：脉冲动画。
- 完成动效：全屏闪光 + 完成提示（~500ms）。
- 求解器步骤切换：棋盘状态平滑过渡。
- 生成关卡动效：区域色块依次填充。
- 移动端适配：≥36px 格子、不重叠的工具栏、面板底部滑入、10×10 可操作。
- 桌面端适配：棋盘 ≤80% 视口高度、面板侧边滑入。

退出标准：

- 每次操作后棋盘变化可理解。
- 原型不是纯表格 demo。
- 移动端和桌面端均可用。

## 11. Phase 9 — 验证

目标：

- 确保原型稳定可用。

任务：

- 运行全量单元测试。
- 运行 `npm run build`。
- 浏览器中手动验证核心流程。
- 记录已知问题。

退出标准：

- 已知问题已记录。
- 本地 URL 可游玩。
- 核心流程无阻塞 bug。

## 12. Phase 10 — 可选扩展

只在 MVP 之后做：

- 生成器性能优化（预生成关卡池、增量调整替代重新生成）。
- 策略类型约束（指定必须包含某种策略类型）。
- 策略序列精确控制。
- 提示功能（求解器给出下一步建议）。
- 关卡导出/导入。
- 更多棋盘尺寸。
- 暗色主题。
- 键盘快捷键。
- 自动标记 X 辅助模式。
- 关卡难度评分系统。
