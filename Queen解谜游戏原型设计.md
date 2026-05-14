# Queen 解谜游戏原型设计

## 1. 核心定位

一句话概念：

> 一个关卡制 Queen 解谜游戏。玩家通过标记不可能格（X）缩小候选范围，当某行、某列或某颜色区域只剩唯一候选时确认 Queen，逐层消元直到棋盘填满 n 个 Queen。

推荐品类命名：

> Queen Elimination Puzzle / 皇后消元解谜

它不是数独，不是扫雷，不是传统 N-Queen。它的核心是：

- Queens 的四条刚性约束（行列区域各一、互不相邻）。
- 候选消元式的解题推进（标记 X 而非放置 Queen）。
- 从 Level 1 到 Level 3 的递进策略分类体系。
- 固定关卡 Puzzle 的明确解法和短局反馈。

## 2. 玩法规则

### 2.1 基础规则

棋盘为 n×n 网格。每个格子属于恰好一个颜色区域（单连通块）。

```text
每行恰好 1 个 Queen
每列恰好 1 个 Queen
每个颜色区域恰好 1 个 Queen
任意两个 Queen 不能相邻（8 邻域，含斜向）
```

所有解题策略都由这四条规则推导而来。

### 2.2 核心操作

玩家有两种操作：

| 操作 | 效果 |
|---|---|
| 标记 X | 在当前选中的空格上标记 X（表示该格不可能是 Queen）。需基于规则推理。 |
| 确认 Queen | 在当前选中的空格上放置 Queen。只能在该格是某行/列/区域的唯一候选时操作。 |

支持撤销 X 标记（回退标记操作），但不支持撤销已确认的 Queen。

### 2.3 胜负条件

- **胜利**：棋盘上正确放置了 n 个 Queen，满足所有四条规则。
- **失败**：放置了错误的 Queen（违反任意规则），或棋盘进入无解状态。
- 不设时间限制和强制步数限制。

### 2.4 解题范式

```text
观察棋盘 → 标记不可能放 Queen 的空格 / X
→ 某行、某列、某颜色区域只剩唯一候选
→ 确认 Queen
→ 由新 Queen 继续标记更多 X
→ 循环
```

核心观点：**策略的核心是消元，不是放 Queen。** 高级策略负责制造 X，基础唯一规则负责确认 Queen。

## 3. 策略体系（Level 1-3）

完整策略体系见 `LinkedIn-Queens-solving-strategies.md`。MVP 阶段实现 Level 1-3，暂不涉及 Level 4（假设型消元）。

### 3.1 概念层级

理解本项目的策略体系，需要区分三个层级的概念：

| 概念 | 含义 | 例子 |
|---|---|---|
| **策略等级 (Level)** | 策略的难度分类。是一种归类标签，不是可数的个体。 | Level 1、Level 2、Level 3 |
| **策略类型 (StrategyType)** | 等级之下的具体策略。共 7 种。 | L1_Direct、L2_Lock1、L3_Capacity |
| **策略批次 / 策略步 (Batch/Step)** | 求解器中每次策略执行，产出一批 X 消除或确认一个 Queen。是可数的个体。 | 第 1 步：L1_Unique → 确认 Queen 在 (0,2)；第 2 步：L1_Direct → 消除 5 个 X... |

关键区分：

```text
等级是分类，不是数量。
"本关用到了 Level 2" —— 说的是等级（分类）。
"本关最优解需要 34 个策略步" —— 说的是数量（批次个数）。
```

求解器输出的是一串策略批次序列，例如 8×8 棋盘的最优解可能是：

```text
Step  1: L1_Unique  → 确认 Queen at (0,3)
Step  2: L1_Direct  → 消除 6 个 X
Step  3: L1_Unique  → 确认 Queen at (2,5)
Step  4: L1_Direct  → 消除 7 个 X
Step  5: L2_Lock1   → 消除 3 个 X
Step  6: L1_Unique  → 确认 Queen at (5,1)
Step  7: L1_Direct  → 消除 5 个 X
...
Step 26: L1_Unique  → 确认 Queen at (7,7)
Step 27: L1_Direct  → 消除 2 个 X
```

这串序列有 27 个批次——这就是本关的**策略步骤总数**。其中用到了 L1_Direct、L1_Unique、L2_Lock1 三种策略类型，最高策略等级为 Level 2。

### 3.2 Level 1：Queen 约束传播

策略类型：`L1_Direct`、`L1_Unique`

已确认 Queen 直接排除同行、同列、同区域、相邻格（8 方向）。标 X 后连锁检查是否有行/列/区域只剩唯一候选，确认新 Queen。

### 3.3 Level 2：集合占位

策略类型：`L2_Lock1`、`L2_Lock2`、`L2_Lock3`

k 个单位的候选只分布在 k 个资源中 → 资源被独占 → 外部候选标 X。从 k=1（锁定）到 k≥3（多单位占位），全部是同一逻辑。

### 3.4 Level 3：相邻投影与容量溢出

策略类型：`L3_Projection`、`L3_Capacity`

候选集合形成直接共同投影（相邻禁区的交集），或高约束空间（如 2×2 方块）容量被占满后排除外部候选。

## 4. 核心系统

### 4.1 关卡生成器

关卡生成器是本项目的核心系统。它根据参数生成可解的 Queen 关卡。

**输入参数：**

| 参数 | 类型 | 说明 |
|---|---|---|
| `n` | number | 棋盘大小（n×n）。MVP 支持 5-10。 |
| `targetSteps` | number | 目标策略步骤总数——最优解中使用多少个策略批次。这是控制关卡复杂度的核心参数。 |

**targetSteps 的意义：**

求解器的每个策略批次都是一次可辨识的推理步骤。策略步骤总数直接反映关卡的推理复杂度：

- 步骤少的关卡：大部分 Queen 可通过简单的 L1 传播链直接确认，推理路径短、分支少。
- 步骤多的关卡：需要在多个 L1-L2-L3 循环中逐步缩小候选范围，推理路径长、需要更多交叉验证。

对于 n×n 棋盘，策略步骤总数的参考范围（具体数值取决于求解器的批次合并策略）：

| n | 极简（几乎全 L1 链） | 中等（含 L2） | 复杂（含 L3） |
|---|---|---|---|
| 5 | ~12-15 | ~18-25 | ~28-35 |
| 7 | ~16-20 | ~28-38 | ~42-52 |
| 8 | ~18-22 | ~32-44 | ~48-58 |
| 10 | ~22-28 | ~40-54 | ~58-72 |

注意：以上为估算范围，实际值取决于求解器实现细节。生成器内部以求解器的实际输出为准。

**生成流程：**

```text
1. 随机生成合法 Queen 布局（n 个 Queen，满足行列邻接约束）
2. 以 Queen 位置为种子，BFS 生长颜色区域（保证连通且每区域恰含 1 Queen）
3. 移除 Queen，构建谜题棋盘
4. 用求解器求解，获得完整策略批次序列 batches[]
5. 检查求解完整性：若求解器无法完成（需要 Level 4）→ 拒绝，回到步骤 1 或 2
6. 统计策略步骤总数 = batches.length
7. 若 |batches.length - targetSteps| ≤ tolerance → 输出关卡
8. 若 batches.length < targetSteps → 调整区域以增加推理链长度，回到步骤 2
9. 若 batches.length > targetSteps → 调整区域以简化推理链，回到步骤 2
```

**调整区域的策略（影响推理链长度）：**

- **增加步骤**：让更多区域的候选跨越多个行/列（触发 L2）；制造候选格相邻聚集（触发 L3）
- **减少步骤**：让区域候选更集中在单行/单列内（纯 L1 可解）；减少区域之间的候选重叠
- **区域复杂度参数**：区域跨度（rowSpan/colSpan）、区域间重叠度、候选相邻密度

**生成器保证：**
- 每个生成的关卡有且仅有唯一解。
- 关卡可使用 Level 1-3 策略求解，不需要 Level 4（猜测）。
- 策略步骤总数在 targetSteps 的误差容忍范围内。

**关于策略序列控制（未来）：**
- MVP 阶段以策略步骤总数为目标。生成器记录每个关卡的实际策略类型序列（`StrategyType[]`）。
- Level 数据中预留 `strategySequence` 字段，存储最优解的策略类型序列。
- 未来可扩展：指定必须包含的策略类型（如 "必须含 L2_Lock2"），或指定精确的策略类型序列。
- 策略序列控制是一个组合难度极高的问题，MVP 阶段通过生成大量候选 + 过滤的方式间接逼近。

### 4.2 求解器

求解器是生成器的验证工具，也是玩家的辅助工具。

**功能：**
- 给定一个棋盘（颜色区域布局），自动求解 Queen 位置。
- 实现 Level 1-3 全部 7 种策略类型，按策略等级优先级顺序执行。
- 输出完整的 `SolverResult`（含 `batches` 数组、`totalSteps`、`strategyTypesUsed`、`highestLevel`）。
- 支持以可视化方式展示求解过程（逐批次展示 X 消除和 Queen 确认）。

**批次合同（Solver Batching Contract）——生成器依赖此合同，必须严格遵守，不可自行变更：**

```text
规则 1 — 无产出不记录：
  某策略执行后，若既没有消除任何 X，也没有确认任何 Queen，
  则该策略不产生 SolverBatch。直接跳到下一个策略。

规则 2 — 一次调用一个批次：
  L1_Direct 对所有已确认 Queen 传播的所有 X 合并为一个批次。
  L1_Unique 本轮确认的所有 Queen 合并为一个批次。
  L2_Lock1/L2_Lock2/L2_Lock3 各自独立，每次调用最多产出一个批次。
  L3_Projection/L3_Capacity 各自独立，每次调用最多产出一个批次。

规则 3 — 批次内不连锁：
  同一批次中确认的 Queen，不在该批次内触发 L1_Direct 传播。
  新 Queen 的传播在下一轮 L1 循环中处理。

规则 4 — index 严格递增：
  SolverBatch.index 从 1 开始，每个产出批次递增 1，不跳号。
```

**求解器主循环：**

```text
每次标出新 X → 立即回到 Level 1 从头开始

Level 1:
  L1_Direct:  对每个已确认 Queen，标记同行/同列/同区域/相邻格为 X
  L1_Unique:  检查所有行/列/区域，若只剩 1 个候选则确认为 Queen
  循环交替执行直到无新产出
    ↓ 无新 X
Level 2:
  L2_Lock1: 单单位锁定（k=1）
  L2_Lock2: 双单位对子（k=2）
  L2_Lock3: 三单位占位（k=3）
  任意一个产出新 X → 立即回到 Level 1
    ↓ 无新 X
Level 3:
  L3_Projection: 候选集合共同相邻投影（含单步致死检查）
  L3_Capacity:   容量溢出检测
  任意一个产出新 X → 立即回到 Level 1
    ↓ 无新 X
盘面在当前信息下已无进展（若未完成则需 Level 4，MVP 中视为生成失败）
```

**SolverBatch 结构：**

```typescript
type SolverBatch = {
  index: number;                    // 批次序号（从 1 开始）
  strategy: StrategyType;           // 触发本批次的策略类型
  eliminations: Position[];         // 本批次新标记的 X 位置
  queenConfirmed: Position | null;  // 本批次确认的 Queen 位置（如有）
  description: string;              // 人类可读描述
};
```

### 4.3 关卡系统

关卡全部由生成器产生，无手工关卡。

- 玩家通过生成器参数面板选择棋盘大小 n 和目标复杂度（映射为 targetSteps），生成新关卡。
- 生成出的关卡有唯一 ID 和可复现的参数种子。
- 关卡数据可序列化/反序列化，便于存储和分享。
- 不设关卡间渐进关系，玩家随时可以生成任意参数的关卡游玩。

## 5. 表现层

### 5.1 视觉风格

几何动感 + 高对比色块风格。简洁几何形状，清晰边框，明亮撞色。

### 5.2 颜色方案

区域颜色使用以下 10 色调色板（按优先级排列，n 较小时取前几个）：

```
  #E84D5B  红    #F4A261  橙    #F9E076  黄
  #6BCB77  绿    #4ECDC4  青    #45B7D1  蓝
  #8B7FC7  紫    #E8A0BF  粉    #A0C8F0  淡蓝
  #C9B99A  棕
```

每格以色块填充，区域边界使用 1px 略深边框勾勒。相邻同区域格子视觉上自然连成整体（无内部分割线）。

### 5.3 棋盘规格

- 格子尺寸：`min(calc(80vh / n), calc(90vw / n), 64px)`，保证在所有尺寸下棋盘不溢出视口。
- 格子圆角：4px。
- 网格间距：2px（gaps 显示棋盘背景色 #1a1a2e 或深色）。
- 棋盘背景：深色（#1a1a2e），区域色块在其上。

### 5.4 Queen 渲染

使用 ♛ Unicode 字符（U+265B），金色（#FFD700），字号为格子尺寸的 60%。居中放置。带 `text-shadow: 0 0 8px rgba(255,215,0,0.6)` 发光。

### 5.5 X 标记渲染

两条 45° 对角线交叉（CSS `linear-gradient` 实现），白色半透明（rgba(255,255,255,0.5)），线宽 2px。覆盖在区域颜色之上。

### 5.6 单元格交互状态

| 状态 | 视觉 |
|---|---|
| 默认 | 区域色块填充 |
| 桌面端 hover | 亮度提升 10%（CSS filter: brightness(1.1)） |
| Queen 格 | 深色底 + 金色 ♛ + 发光 |
| X 标记格 | 区域色块 + 白色 X 斜线 |
| 唯一候选格 | 边框脉冲动画（金色虚线框，1.5s 循环） |
| 求解器播放高亮格 | 当前步骤涉及的格临时叠加亮色边框 |

### 5.7 字体

- 全局：system font stack（`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`）
- HUD 信息：14px/500
- 按钮文字：13px/500
- 面板标题：16px/600
- 面板正文：13px/400
- 策略类型标签：11px/600，等宽字体（monospace）

### 5.8 求解器面板视觉

7 种策略类型用颜色编码标签：

```
L1_Direct     #4CAF50 绿
L1_Unique     #2196F3 蓝
L2_Lock1      #FF9800 橙
L2_Lock2      #F44336 红
L2_Lock3      #9C27B0 紫
L3_Projection #00BCD4 青
L3_Capacity   #FF5722 深橙
```

批次列表每行：`[序号] [策略类型色标] [描述] · 消除 X 个 X · 确认 Queen: rXcY`

当前播放步骤高亮底色。

### 5.9 状态占位

- **未生成关卡时**：棋盘区域显示提示文字"点击「生成」创建新关卡"，居中灰色文字。
- **生成中**：棋盘区域显示 spinner 或进度条 + "正在生成关卡..."。
- **求解器运行中**：面板内显示进度（已完成步骤/总步骤）。

### 5.10 动效要求

| 交互 | 动效 |
|---|---|
| 点击标记 X | 单元格短暂缩放 + X 斜线淡入（~200ms） |
| 点击确认 Queen | 单元格放大闪烁 + ♛ 弹入（~300ms） |
| Queen 确认后自动传播 X | 连锁波纹扩散（从 Queen 向外，~400ms，可跳过） |
| 唯一候选高亮 | 金色虚线框脉冲（1.5s 循环） |
| 点击错误 | 单元格红色闪烁 + 回弹（~300ms） |
| 撤销 X 标记 | X 淡出（~200ms） |
| 关卡完成 | 全屏短暂闪光（~500ms） |
| 生成关卡 | 区域色块依次填充（错峰，总时长 ~600ms） |

动效原则：清晰 > 华丽。每动效有信息传达目的。不阻塞后续操作。传播动效可通过点击任意位置跳过。

### 5.11 布局适配

- 棋盘占主视口中央，自适应。
- 移动端（≥320px 宽）：格子 ≥36px。求解器/生成器面板从底部滑入，占视口 60% 高度。
- 桌面端：棋盘 ≤80% 视口高度。求解器面板从右侧滑入，宽 360px。

## 6. 用户界面

### 6.1 主界面布局

```text
┌──────────────────────────────────┐
│  [关卡信息]  n×n · 步骤数: XX   │
├──────────────────────────────────┤
│                                  │
│         n×n 棋盘区域              │
│    （颜色区域 + X标记 + Queen）    │
│                                  │
├──────────────────────────────────┤
│  [撤销] [重做] [求解器] [生成]    │
└──────────────────────────────────┘
```

### 6.2 求解器面板

- 显示求解总览：总步骤数、用到的策略类型、最高策略等级。
- 以列表形式展示每个求解批次：
  - 每行显示：批次序号、策略类型标签、消除的 X 数量、确认的 Queen 位置（如有）、可读描述。
- 支持逐步骤播放/暂停/单步前进/后退。
- 当前高亮步骤对应的棋盘变化（棋盘同步显示该步骤完成后的状态）。

### 6.3 生成器面板

- 棋盘大小选择（n=5-10，使用按钮组或滑块）。
- 复杂度选择——对用户展示为直觉标签，内部映射为 targetSteps：
  - 「简单」→ targetSteps 取该 n 的低位区间
  - 「中等」→ targetSteps 取该 n 的中位区间
  - 「困难」→ targetSteps 取该 n 的高位区间
- 高级选项（可折叠）：直接指定 targetSteps 数值。
- 「生成关卡」按钮。
- 生成进度指示器。
- 生成完成后自动加载到棋盘，显示实际策略步骤总数。

## 7. 技术方案

### 7.1 技术栈

- Vite + React + TypeScript
- 状态管理：zustand（轻量、无 boilerplate、支持脱离 React 测试 store 逻辑）
- 测试：Vitest
- 渲染：CSS/DOM（第一版不使用 Canvas）
- 动效：CSS transitions + animations

### 7.2 推荐项目结构

```text
src/
  game/
    types.ts          # 所有类型定义
    rules.ts          # 纯规则函数（邻接检查、区域有效性、候选计算）
    solver.ts         # 求解器（7 种策略类型，Level 1-3 循环）
    generator.ts      # 关卡生成器（Queen 布局 + 区域生长 + 求解验证）
    random.ts         # 种子化 PRNG（mulberry32），生成器和测试共用
    store.ts          # zustand store，持有游戏状态
  ui/
    Board.tsx         # 棋盘渲染（CSS Grid）
    Cell.tsx          # 单元格组件
    Hud.tsx           # 顶部信息栏
    Toolbar.tsx       # 底部工具栏
    SolverPanel.tsx   # 求解器面板（步骤列表 + 播放控制）
    GeneratorPanel.tsx # 生成器面板
  App.tsx
  main.tsx
  __tests__/
    rules.test.ts
    solver.test.ts
    generator.test.ts
```

`random.ts` 实现 mulberry32 算法：

```typescript
// 32-bit seeded PRNG. 给定相同 seed 产生相同随机序列。
export function createRNG(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle，使用给定 rng
export function shuffle<T>(arr: T[], rng: () => number): T[] { ... }
```

### 7.3 职责边界

- `types.ts`：所有数据结构定义，无逻辑。
- `rules.ts`：纯函数，给定棋盘和位置，返回是否合法/是否有冲突。不持有状态。
- `solver.ts`：纯函数，给定棋盘（区域布局），返回 `SolverBatch[]` 序列。内部执行策略循环。
- `generator.ts`：纯函数+随机，给定参数和种子，生成合法棋盘。内部调用 solver 验证。
- `store.ts`：持有游戏状态（当前棋盘、玩家操作历史、求解器状态），暴露操作方法。UI 通过 store 读写数据。
- UI 组件：只负责渲染和触发 action，不承载规则判断、求解逻辑或生成逻辑。

## 8. 数据结构

### 8.1 核心类型

```typescript
// 棋盘坐标
type Position = { row: number; col: number };

// 单元格状态
type CellState = {
  regionId: number;
  isQueen: boolean;
  isX: boolean;
};

// 颜色区域
type Region = {
  id: number;
  cells: Position[];
};

// 7 种策略类型
type StrategyType =
  | 'L1_Direct'
  | 'L1_Unique'
  | 'L2_Lock1'
  | 'L2_Lock2'
  | 'L2_Lock3'
  | 'L3_Projection'
  | 'L3_Capacity';

// 求解步骤批次
type SolverBatch = {
  index: number;
  strategy: StrategyType;
  eliminations: Position[];
  queenConfirmed: Position | null;
  description: string;
};

// 求解结果
type SolverResult = {
  complete: boolean;          // 是否完全求解（false = 需要 Level 4）
  batches: SolverBatch[];     // 策略批次序列
  totalSteps: number;         // 策略步骤总数 = batches.length
  strategyTypesUsed: StrategyType[]; // 用到的策略类型（去重）
  highestLevel: number;       // 用到的最高策略等级（1/2/3）
};

// 关卡数据（可序列化）
type Level = {
  id: string;
  n: number;
  regions: Region[];
  seed: number;
  targetSteps: number;           // 生成时的目标策略步骤总数
  actualSteps: number;           // 求解器实测策略步骤总数
  strategySequence: StrategyType[]; // 最优解的策略类型序列
  solverResult: SolverResult;    // 完整求解结果
};

// 生成器参数
type GeneratorParams = {
  n: number;
  targetSteps: number;
  seed?: number;
};

// 玩家棋盘状态
type BoardState = {
  n: number;
  cells: CellState[][];
};
```

## 9. 关卡生成器算法概要

### 9.1 Queen 位置生成

```text
输入: n, seed
输出: n 个满足行列邻接约束的 Queen 位置

算法: 带随机化的回溯搜索
1. 随机排列行顺序
2. 按行依次尝试随机排列的列
3. 剪枝: 同列冲突 / 对已放置 Queen 的 8 邻域冲突
4. 回溯直到找到完整解
```

### 9.2 区域生成

```text
输入: n, queenPositions, complexity (0.0-1.0), rng
输出: 每个格子所属 regionId，每个区域连通且恰含 1 个初始 Queen

算法: 多源 BFS 竞争生长
1. 初始化 n 个区域，各以对应 Queen 位置为种子。regionId = 区域索引。
   所有种子格加入 FIFO 队列 Q，标记已分配。
2. 循环直到 Q 为空：
   a. 从 Q 头部取出格子 (r, c)，其 regionId 为 rid
   b. 获取 (r, c) 的 4 邻域（上下左右）中未分配的格子
   c. 对每个未分配邻格 nbr：
      - 以概率 (1 - complexity) 选择是否偏好同向扩展：
        偏好模式：若 nbr 与种子 Queen 同行或同列，优先级×3
        随机模式：所有邻格等权重
      - 加权随机选择一个邻格，分配 regionId = rid，入队 Q
   d. 将未选中的邻格放回未分配池（后续轮次可能被其他区域扩展）
3. 若存在未分配格子（孤立的离散格）：
   对每个未分配格子，找到相邻的已分配区域中 size 最小的，并入该区域。
4. 连通性验证：对每个区域做 BFS，若不连通：
   将不连通的子块合并到相邻的另一个区域，交换等量格子以保持面积平衡。
   若仍无法修复 → 重新生成（概率极低）。
```

complexity 的作用方式：
- complexity=0.0：严格偏好同行/同列扩展 → 区域呈条状，大部分候选在同一行/列 → L1 链即可求解
- complexity=0.5：同行/列偏好与随机方向各半 → 区域跨 2-3 行/列 → 需要 L2
- complexity=1.0：完全随机方向 → 区域高度不规则，候选紧密相邻 → 需要 L3

### 9.3 策略步骤控制

```text
输入: n, targetSteps, tolerance, maxRetries (默认 30)
输出: 策略步骤总数匹配 targetSteps 的关卡

参数:
  tolerance = max(3, floor(targetSteps * 0.10))   // ±3 或 ±10%，取大
  maxRetries = 30
  complexity 范围 0.0-1.0

二分搜索主循环（替代线性增减，防止震荡）:
  lo = 0.0, hi = 1.0
  complexity = targetSteps 在 n 对应范围内的归一化位置作为初始猜测
  例如 n=8, targetSteps=35, range=[18,58] → 初始 complexity = (35-18)/(58-18) ≈ 0.43

  bestLevel = null, bestDiff = Infinity

  for retry in 1..maxRetries:
    1. queenPositions = generateQueenPositions(n, rng)
    2. regions = generateRegions(n, queenPositions, complexity, rng)
    3. board = createEmptyBoard(n, regions)
    4. result = solve(board)

    5. if !result.complete → 跳过（incomplete 棋盘不参与比较）
       若连续 5 次 incomplete → 调整 rng seed 重新生成 Queen 布局

    6. steps = result.totalSteps
       diff = steps - targetSteps

    7. if |diff| ≤ tolerance → 构建 Level 输出，return

    8. if |diff| < bestDiff → 更新 bestLevel, bestDiff

    9. if diff < 0 (steps 太少):
         lo = complexity           // 需要更高复杂度
         complexity = (lo + hi) / 2
       else (steps 太多):
         hi = complexity           // 需要更低复杂度
         complexity = (lo + hi) / 2

    10. if hi - lo < 0.02 → 二分收敛但未达 tolerance
        返回 bestLevel（最接近 targetSteps 的关卡）

  返回 bestLevel 或 null（生成失败）
```

为什么用二分搜索而不是线性增减：
- 线性 `complexity += step` 容易震荡（低→太少，高→太多，低→太少...）
- 二分搜索在每次迭代中缩小区间，最多 log2(1/0.02) ≈ 6 次有效迭代即可收敛
- 不保证一定找到——tolerance 和 bestLevel 回退保证了总能返回最接近的结果

## 10. 不做什么

MVP 阶段明确不做：

- Level 4 策略（假设型消元/反证法）。
- 手工设计关卡。
- 关卡间进度/解锁/星级评分。
- 时间限制、步数限制。
- 道具系统（求解器即提示）。
- 多人竞技、排行榜。
- Canvas/WebGL 渲染。
- 移动端原生 App 壳。
- 主题皮肤。
- 关卡编辑器。
- 策略序列精确指定（MVP 仅记录，不控制）。

## 11. MVP 完成定义

- 关卡生成器可生成 5×5 到 10×10 的合法 Queen 关卡。
- 生成器可通过 targetSteps 参数控制关卡的策略步骤总数。
- 生成的关卡有唯一解，且可用 Level 1-3 策略完全求解。
- 求解器实现全部 7 种策略类型，输出完整策略批次序列。
- 玩家可在棋盘上标记 X 和确认 Queen，规则检查实时生效。
- 求解器面板可逐步骤可视化展示求解过程。
- 生成器面板可调整 n 和复杂度并生成关卡。
- 撤销/重做 X 标记功能正常。
- 视觉表现干净美观，动效清晰。
- 桌面和移动端均可正常使用。
- 核心规则、求解器、生成器有自动化测试。
