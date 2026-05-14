# CLAUDE.md

## 给 Claude Code 的项目指令

本项目是一个 Vite + React + TypeScript 的关卡制 Queen 解谜游戏原型。

当前阶段为 MVP 开发。Claude Code 的职责是按照文档框架独立、完整地实现 MVP。

除非用户明确要求暂停或改变方向，否则应持续推进开发直到 MVP 完成。

## 必读顺序

Claude Code 开始任何任务前，按以下顺序读取：

1. `CLAUDE.md`：本文件，Claude Code 专用执行入口。
2. `AGENTS.md`：通用 AI Agent 项目约束。
3. `Queen解谜游戏原型设计.md`：玩法设计真相来源。
4. `LinkedIn-Queens-solving-strategies.md`：策略体系详细参考。
5. `ACCEPTANCE_CRITERIA.md`：验收标准。
6. 需要拆任务时，再读取 `AI_IMPLEMENTATION_PLAN.md` 和 `AI_TASK_BACKLOG.md`。

如果用户当前对话中的最新指令与文档冲突，优先执行用户最新指令，并在必要时同步更新文档。

## 核心目标

开发一个完整的 Queen 解谜游戏 MVP：

> 关卡制 Queen 消元解谜，包含关卡生成器（可按 n 和策略步骤总数生成关卡）、求解器（可视化展示全部 7 种策略的求解步骤序列）、可交互棋盘 UI、美观的视觉表现。

MVP 目标：

- 浏览器可玩。
- 关卡生成器可根据 n（5-10）和 targetSteps（策略步骤总数）生成唯一解关卡。
- 求解器实现全部 7 种策略类型（L1_Direct / L1_Unique / L2_Lock1 / L2_Lock2 / L2_Lock3 / L3_Projection / L3_Capacity），按 Level 1→2→3 循环执行。
- 求解器输出完整的 `SolverBatch[]` 序列，每批次标注策略类型。
- 求解器面板可逐步骤可视化展示求解过程。
- 玩家可在棋盘上标记 X 和确认 Queen。
- 撤销/重做 X 标记。
- 几何动感风格的视觉表现，包含清晰的交互动效。
- 桌面和移动端适配。

## 技术约束

正式实现时使用：

- Vite。
- React。
- TypeScript。
- Vitest。
- 第一版优先 CSS/DOM 渲染，不使用 Canvas/WebGL。

推荐结构：

```text
src/game/types.ts
src/game/rules.ts
src/game/solver.ts
src/game/generator.ts
src/game/random.ts
src/game/store.ts
src/game/__tests__/rules.test.ts
src/game/__tests__/solver.test.ts
src/game/__tests__/generator.test.ts
src/ui/Board.tsx
src/ui/Cell.tsx
src/ui/Hud.tsx
src/ui/Toolbar.tsx
src/ui/SolverPanel.tsx
src/ui/GeneratorPanel.tsx
src/ui/useInput.ts
src/App.tsx
src/main.tsx
```

职责边界：

- `types.ts`：所有类型定义，无逻辑。
- `rules.ts`：纯规则函数（邻接检查、区域有效性、唯一候选检查）。
- `solver.ts`：纯函数求解器。**严格遵循设计文档 4.2 节的「批次合同」**（无产出不记录、一次调用一个批次、批次内不连锁）。输出 `SolverBatch[]` 序列。
- `generator.ts`：纯函数+随机，给定参数生成合法棋盘。内部调用 solver 验证。使用二分搜索调整 regionComplexity 以匹配 targetSteps。
- `random.ts`：种子化 PRNG（mulberry32），生成器和测试共用。
- `store.ts`：zustand store，持有游戏状态，调用规则函数和求解器，向 UI 暴露操作。
- UI 组件只负责渲染和触发 action，不承载核心规则和求解逻辑。

## 关键概念区分

AI 开发时必须理解以下区分，避免混淆：

| 概念 | 含义 | 例子 |
|---|---|---|
| 策略等级 (Level) | 分类标签，不是数量 | Level 1、Level 2、Level 3 |
| 策略类型 (StrategyType) | 7 种具体策略 | L1_Direct、L2_Lock1... |
| 策略批次/步 (Batch/Step) | 求解器中每次策略执行，可计数 | 第 3 批次：L2_Lock1 消除 4 个 X |
| 策略步骤总数 (totalSteps) | 最优解中所有批次的个数 | 34 步、52 步 |
| 策略序列 (strategySequence) | 批次按顺序的策略类型列表 | [L1_Unique, L1_Direct, L1_Unique, L2_Lock1, ...] |

等级是等级（分类），数量是数量（计数）。不要混淆。

## 开发纪律

开发时：

- 先实现规则正确，再追求视觉 polish。
- 核心逻辑（rules/solver/generator）必须纯函数，可脱离 React 独立运行和测试。
- 求解器是生成器的前置依赖——生成器需要求解器验证策略步骤总数。
- 求解器的批次合并粒度必须在整个项目中保持一致（生成器依赖求解器的计数）。
- 每个阶段结束时尽量保持项目可运行。
- 规则变化必须补测试。
- 不要在 UI 组件中嵌入求解或生成逻辑。
- 不加入 MVP 范围外的机制。

## 推荐开发顺序

1. 初始化 Vite + React + TypeScript 项目。
2. 定义所有类型（types.ts）——包含 SolverBatch、SolverResult 等完整类型。
3. 实现纯规则函数（rules.ts）+ 测试。
4. 实现求解器（solver.ts）+ 测试——全部 7 种策略类型，完整主循环。
5. 实现关卡生成器（generator.ts）+ 测试——Queen 布局 + 区域生长 + solver 验证。
6. 实现状态管理（store.ts）。
7. 构建可玩的 React UI（Board/Cell/Hud/Toolbar）。
8. 实现求解器可视化面板（SolverPanel）——逐步骤播放。
9. 实现生成器参数面板（GeneratorPanel）——n + 复杂度选择。
10. 添加动效和视觉 polish。
11. 添加移动端适配。
12. 运行全量测试、build、启动 dev server。

## 推荐启动提示词

完整 MVP 开发时使用：

```text
读取 CLAUDE.md、AGENTS.md、Queen解谜游戏原型设计.md、LinkedIn-Queens-solving-strategies.md、ACCEPTANCE_CRITERIA.md、AI_IMPLEMENTATION_PLAN.md 和 AI_TASK_BACKLOG.md。

按文档实现完整 MVP。使用 Vite + React + TypeScript。核心规则和求解器保持纯函数并添加 Vitest 测试。求解器实现全部 7 种策略类型。实现关卡生成器，支持 n=5-10 和 targetSteps 控制。实现可交互棋盘 UI 和求解器可视化面板。加入几何动感风格的视觉表现和交互动效。运行测试和 build，启动 dev server，并报告本地 URL 与已知限制。
```
