# AGENTS.md

本文件是通用 AI Agent 指令。若使用 Claude Code，请优先读取 `CLAUDE.md`，再读取本文件。

## 项目角色

本仓库用于开发一款 Vite + React + TypeScript 的关卡制 Queen 解谜游戏原型：

> 皇后消元解谜：通过标记不可能格（X）缩小候选范围，逐层消元直到确认所有 Queen。

当前阶段：

- MVP 开发中。Agent 应按照文档框架持续推进实现。
- 除非用户明确要求暂停或改变方向，否则持续推进。

## 信息优先级

后续 AI Agent 读取信息时，按以下优先级执行：

1. 当前对话中用户的最新指令。
2. `CLAUDE.md`，仅 Claude Code 使用。
3. `AGENTS.md`。
4. `Queen解谜游戏原型设计.md`。
5. `LinkedIn-Queens-solving-strategies.md`。
6. `ACCEPTANCE_CRITERIA.md`。
7. `AI_DEVELOPMENT_FRAMEWORK.md`。
8. `AI_IMPLEMENTATION_PLAN.md`。
9. `AI_TASK_BACKLOG.md`。

如果文档之间存在冲突，优先遵循更新、更具体的指令，并在合适时同步修正文档。

## 核心概念区分

**必须理解以下概念的区别，不可混淆：**

| 概念 | 含义 | 性质 |
|---|---|---|
| 策略等级 (Level) | 策略的难度分类标签 | 分类，不是数量 |
| 策略类型 (StrategyType) | 7 种具体的策略名称 | 枚举值 |
| 策略批次 (SolverBatch) | 求解器中每次策略执行的一个步骤 | 可计数的个体 |
| 策略步骤总数 (totalSteps) | 最优解中 SolverBatch 的总个数 | 数量 |
| 策略序列 (strategySequence) | SolverBatch 的 StrategyType 按顺序排列 | 序列 |

例如 10×10 棋盘的最优解可能含 34 个策略批次（totalSteps=34），其中使用了 L1_Direct、L1_Unique、L2_Lock1 三种策略类型，最高策略等级为 Level 2。

## 产品核心原则

原型必须保留以下原则：

- 是固定关卡 Queen Puzzle，不是无尽模式。
- 玩家的核心操作是标记 X 和确认 Queen。
- 求解器实现全部 7 种策略类型（L1_Direct / L1_Unique / L2_Lock1 / L2_Lock2 / L2_Lock3 / L3_Projection / L3_Capacity）。
- 策略按 Level 1→2→3 循环执行，任意策略产出新 X 立即回到 Level 1。
- 求解器输出完整的 SolverBatch[] 序列。
- 关卡全部由生成器生成，无手工关卡。
- 生成器参数：n（棋盘大小）+ targetSteps（目标策略步骤总数）。
- 生成器通过 targetSteps 控制关卡推理复杂度。
- Level 数据中记录完整的最优解策略类型序列（strategySequence），为未来策略序列控制做准备。
- 推理过程可回溯（撤销 X 标记）。
- 表现层干净美观，动效服务于信息传达。

## MVP 不做什么

除非用户明确要求，不要加入以下内容：

- Level 4 策略（假设型消元/反证法）。
- 手工设计关卡。
- 关卡间进度/解锁/星级评分。
- 时间限制、步数限制、体力系统。
- 道具系统（求解器已提供提示功能）。
- 多人竞技、排行榜。
- Canvas/WebGL 渲染。
- 移动端原生 App 壳。
- 主题皮肤。
- 复杂后端/数据库。
- 用户账号系统。
- 策略序列精确指定（MVP 仅记录，不控制）。

## 技术方向

正式实现时，使用：

- Vite。
- React。
- TypeScript。
- Vitest 做规则和求解器测试。
- 第一版优先使用 CSS/DOM 渲染。

目标架构：

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

核心游戏规则、求解器、生成器必须保持纯逻辑，并与 React UI 解耦。

职责边界：

- `types.ts`：所有数据结构定义，包含 SolverBatch、SolverResult、Level 等完整类型。无逻辑。
- `rules.ts`：纯函数规则引擎，负责邻接检查、区域有效性、候选计算、唯一候选判断。
- `solver.ts`：纯函数求解器，实现全部 7 种策略类型，按 Level 1→2→3 循环，输出 `SolverBatch[]`。批次合并粒度必须一致。不依赖 React。
- `generator.ts`：纯函数+随机数生成器。给定 n、targetSteps 和种子，生成合法棋盘。内部调用 solver 验证。通过调整区域复杂度参数控制 targetSteps。
- `store.ts`：持有当前游戏状态，调用规则函数、求解器和生成器，向 UI 暴露操作。
- UI 组件只负责渲染和触发 action，不承载规则、求解或生成逻辑。

## 玩法不变量

未来实现必须用测试保护这些规则：

- 棋盘为 n×n，每格属于恰好一个颜色区域。
- 每个颜色区域是单连通块。
- 每行恰好 1 个 Queen。
- 每列恰好 1 个 Queen。
- 每个颜色区域恰好 1 个 Queen。
- 任意两个 Queen 8 邻域不相邻。
- 确认 Queen 的操作只能在该格是某行/列/区域的唯一候选时执行。
- 撤销 X 标记必须恢复标记前的棋盘状态。
- 求解器必须使用 Level 1-3 策略就能完成（若不能，该关卡无效）。
- 求解器对同一棋盘状态的批次输出是确定的（相同状态 → 相同 SolverBatch[]）。
- 生成器生成的关卡必须有唯一解。
- 关卡数据必须确定、可序列化（含种子、strategySequence）。

## Agent 工作流程

未来任何开发任务都应遵循：

1. 先读取 `CLAUDE.md` 和相关设计文档。
2. 简要复述本次任务目标。
3. 做小而完整的改动。
4. 涉及规则或求解逻辑变化时，新增或更新测试。
5. 运行相关检查。
6. 只有在用户要求可试玩应用，或已经进入实现阶段时，才启动本地 dev server。
7. 最后说明改了什么、验证了什么、还有什么未完成。

长时间自主开发时：

- 严格按 Phase 顺序推进。
- 每个 Phase 结束时都尽量保持项目可运行。
- 除非 Phase 明确要求，否则避免大规模重写。
- 求解器先于生成器实现（生成器依赖求解器验证）。
- 核心逻辑（rules/solver/generator）先于 UI 实现。
- 基础 UI 先于动效 polish。
- 如果某个设计选择影响核心乐趣，记录到 `DECISIONS.md`。

## 文档规则

- 具体实现开始前，玩法决策都放在 Markdown 文档中。
- 实现开始后，只有行为发生实质变化时才更新文档。
- 不要让 `Queen解谜游戏原型设计.md` 与实现互相矛盾。
- 只在非显而易见的复杂逻辑处添加简短注释。
- 测试和源码同等重要，不可省略。

## MVP 完成定义

只有同时满足以下条件，MVP 才算完成：

- 关卡生成器可根据 n（5-10）和 targetSteps 生成合法关卡。
- 生成器可通过 targetSteps 区分不同推理复杂度的关卡。
- 生成器生成的关卡有唯一解且可用 Level 1-3 策略求解。
- 生成器的关卡数据包含完整的最优解策略类型序列（strategySequence）。
- 求解器实现全部 7 种策略类型，输出完整 SolverBatch[] 序列。
- 玩家可以在棋盘上标记 X 和确认 Queen。
- 规则检查实时生效，错误操作有清晰反馈。
- 求解器可以自动求解并可视化展示策略批次序列。
- 求解器面板支持逐步骤播放/暂停/前进/后退。
- 求解器面板在桌面端侧边滑入，移动端底部滑入。
- 生成器参数面板可用（n 选择 + 复杂度选择 → 映射为 targetSteps + 生成按钮）。
- 撤销/重做 X 标记功能正常。
- 桌面和移动端布局适配良好。
- 视觉表现干净美观（几何动感风格，明亮色块，清晰边框）。
- 交互动效清晰（标记/确认/传播/错误/完成）。
- 核心规则有自动化测试。
- 求解器有自动化测试（覆盖各策略类型）。
- 生成器有自动化测试（覆盖 targetSteps 控制有效性）。
- 至少完成一次浏览器可玩性验证。
- 最终回复包含本地试玩 URL 和已知限制。
