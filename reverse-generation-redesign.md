# 逆向生成算法重构设计

## 1. 背景：关卡生成的核心困难

### 1.1 正向 vs 反向

Queen 解谜的关卡生成是一个反向问题：

- **正向问题（求解器）**：给定区域布局 → 找到 Queen 位置序列 → 输出求解步骤
- **反向问题（生成器）**：给定 Queen 位置 + 期望求解步数 → 反推区域布局

随机生成区域的成功率极低——n≥6 时 <2%。因为随机区域几乎不可能碰巧满足求解器策略所需的几何约束。求解器有 7 种策略类型，每种都对区域形状有特定要求（同行、同列、2×2 块内等），随机区域连第一步都不一定能走。

### 1.2 分支演进历史

分支 `claude/musing-taussig-3397c0-view` 上经历了三个迭代阶段，每次解决前一次的核心痛点：

**迭代 1：参数修补**（commit `f5a02c3`）

问题：n≥6 时求解器的 L3_Projection 候选上限固定为 3，但大棋盘上每行/列的候选数 >3，导致 Projection 永远不触发。区域生成器对大棋盘产生 14-16 格的巨型区域，淹没策略约束。

修复：L3_Projection 候选上限改为 `max(3, ceil(n/2))`；n≥8 禁用 "free" 方向区域；lineScore 按 `n*0.5` 缩放。**本质是参数调优，没改变算法结构。**

**迭代 2：锚点约束**（commit `39190f3`）

问题：随机区域是"概率黑洞"——n≥6 时 <2% 的区域能触发任何策略。

修复：引入 `anchorGenerator.ts`（471 行），两阶段管线：先构造"锚点区域"（通过显式的几何约束保证至少一个策略触发），再 BFS 填充其余区域。锚点区域被 `frozen`，填充不覆盖。5 种策略的锚点构造器：L2_Lock1/Lock2/Lock3、L3_Projection、L3_Capacity。多 Queen 分解：1-4 个锚点 Queen 可组合为子策略组。

验证：480/480 填充+求解运行产生 ≥1 个求解批次。测试 68 个全部通过。

**局限**：锚点只保证"第一步能走"，不保证后续步骤链。锚点区域窄条状，视觉单一。1-4 个 Queen 参与，其余 Queen 随机填充——这是**有意为之**的设计（留自由生长的空间保证多样性），不是 bug。

**迭代 3：逆向生成 + Spoiler**（commit `d04c689`, `4dd7033`, `d7d2532`）

问题：锚点只点火，不管后续。需要能控制完整求解链的生成器。

方案：全新的逆向生成器 `reverseGenNew.ts`（571 行）。核心思路——先确定答案（Queen 位置），再逆向构造策略链，让每个求解步骤都有对应的几何约束存在于棋盘上。

关键创新——Spoiler 机制：在相邻逆向步骤之间，将更晚触发策略的"多余格子"放在更早触发策略的消除区中。正向求解时，早期策略 X 掉这些 spoiler，"揭示"晚期策略的几何约束。

经过两轮优化（`4dd7033` 加入 BuildInfo + 消除区计算 + 基准测试，`d7d2532` 缩小区域、限制约束 Queen 数、动态比率），当前算法能在 n=5-10 范围稳定产出有解关卡。

---

## 2. 当前逆向生成器的完整实现

### 2.1 主流程（7 步）

```
generateReverseLevel(params):
  for attempt in 1..maxAttempts (40-300次):
    ① 随机生成 Queen 位置（generateQueenPositions）
    ② 初始化空棋盘，Queen 格归属对应区域，标记 frozen
    ③ 生成策略序列（pickReverseStrategies）
    ④ 逆向构建约束（buildConstraint → 每个策略放 2-4 格）
    ⑤ 放置 Spoiler（addSpoilers）
    ⑥ BFS 填充剩余空格（fillGrid）
    ⑦ 求解验证（solve）

    精确匹配 targetSteps → 立即返回 exact
    近似匹配 → 记录最佳，继续尝试
    全部失败 → 返回 failed（或 allowApproximate 时返回近似最佳）
```

### 2.2 第③步：策略序列生成（pickReverseStrategies）

```typescript
// 关键参数
const maxConstraintQueens = Math.min(n, 6);  // 最多 6 个 Queen 参与构造
const ratio = n <= 6 ? 0.55 : n <= 8 ? 0.40 : 0.30;
const steps = Math.floor(targetSteps * ratio);  // 只构造 30-55% 的步数

// 策略概率分布（累积概率）
// roll < 0.08 (8%):  L2_Lock3      — 需要 3 Queen，仅 n≥8
// roll < 0.32 (24%): L2_Lock2      — 需要 2 Queen，仅 n≥6
// roll < 0.58 (26%): L2_Lock1      — 需要 1 Queen
// roll < 0.72 (14%): L3_Projection — 需要 1 Queen
// roll < 0.85 (13%): L3_Capacity   — 需要 1 Queen
// roll < 0.93 (8%):  L3_Contradiction — 需要 1 Queen
// else (7%):         L1_Unique     — 需要 1 Queen

// Queen 选择：usageCount 负载均衡
// 每次选使用次数最少的 Queen，防止单个区域过度构造
// MAX_REGION_CELLS = min(5, ceil(n*0.6)) 上限防止过度构造
```

**设计意图**：
- `maxConstraintQueens=6`：因为每区域 2-4 格 × 多步骤 = 棋盘空间不够。这是空间妥协，不是设计意图。
- `ratio=30-55%`：因为 L1_Direct 不能被单独构造（它是 Queen 确认后的连锁反应）。ratio 是对"L1_Direct 大约占多少比例"的盲猜。
- `usageCount`：负载均衡器。防止某区域因过度构造而超出 `MAX_REGION_CELLS` 上限，导致策略链断裂。

### 2.3 第④步：约束构造器详解

每个构造器的任务：**在棋盘上放 2-4 个格子，使得这些格子满足特定策略的几何约束。** 放的格子被标记为 `frozen`——后续 BFS 填充不会覆盖。

所有构造器返回 `BuildInfo | null`：

```typescript
type BuildInfo = {
  strategy: StrategyType;      // 哪种策略
  queenIndices: number[];      // 涉及哪些区域（=区域ID=Queen索引）
  axis: 'row' | 'col';         // 约束方向
  values: number[];            // 约束的行号/列号
};
```

#### 2.3.1 buildLock1 — "Region→Row 或 Region→Col"

```
输入: Queen q 在 (2,4)，axis 随机选 'row'，n=8

步骤:
  1. 收集 row 2 上所有可放置格（未被 frozen 占用、不冲突）
     candidates = [(2,0)(2,1)(2,3)(2,5)(2,6)(2,7)]  // Queen (2,4) 已在
  2. 按距 Queen 的曼哈顿距离排序（近的优先）
     (2,3) d=1, (2,5) d=1, (2,2) d=2, (2,6) d=2, ...
  3. 取 sz = 2-4 格（随机），claimCell 到区域 qi

实际效果 (sz=3):
  row 2: [ ][ ][R][R][Q][R][ ][ ]
  这些格子是区域 qi 的"骨架"——全在同一行

BuildInfo: { strategy:'L2_Lock1', queenIndices:[qi], axis:'row', values:[2] }
```

**落子特点**：单向条带，2-4 格。不填满整行——只放最少的格子满足约束。**这就是"骨架"的含义。**

#### 2.3.2 buildLock2 — "2个区域 ∈ 2行/列"

```
输入: Queen0 在 (1,3)，Queen1 在 (5,2)，dim 随机选 'row'
allowed rows = {1, 5}

对每个区域独立 BFS 扩展 (2-3 格):
  grow(seed=Queen, rid, targetSz=2-3):
    - 从 Queen 出发
    - BFS 的每一步检查: 邻居所在行 ∈ {1,5}？
    - 是 → 可加入；否 → 跳过
    - 直到收集够 targetSz 格

实际效果 (sz0=2, sz1=3):
  区域 0: (1,3)(1,4) → 2 格全在 row 1
  区域 1: (5,2)(5,1)(1,2) → 3 格，在 row 1 和 row 5 上

BuildInfo: { strategy:'L2_Lock2', queenIndices:[0,1], axis:'row', values:[1,5] }
```

**落子特点**：BFS 但只在 allowed 行/列内走。两个区域各 2-3 格。BFS 保证 4-连通。allowed 约束保证几何条件。

#### 2.3.3 buildLock3 — "3个区域 ∈ 3行/列"

与 Lock2 完全相同逻辑，3 个 Queen、3 个 allowed 值。每区域 BFS 扩展 2-3 格。

```
BuildInfo: { strategy:'L2_Lock3', queenIndices:[qi0,qi1,qi2], axis:'row', values:[r0,r1,r2] }
```

#### 2.3.4 buildProjection — "同区域 2-3 格同行/列且紧邻"

```
输入: Queen q 在 (3,3)，axis 随机选 'row'

步骤:
  1. 取紧邻格（距离 = 1）: (3,2) 和 (3,4)
  2. 随机打乱
  3. 取 1-2 个紧邻 + Queen = 总共 2-3 格

实际效果:
  row 3: [ ][ ][ ][Q][R][ ]  ← Queen + 1 个紧邻

BuildInfo: { strategy:'L3_Projection', queenIndices:[qi], axis:'row', values:[3] }
```

**落子特点**：只取距离 1 的紧邻（不取距离 2），保证 4-连通。总共 2-3 格。与 Lock1 的关键区别：Projection 的格子也全在同一行，但它只取紧邻；两者的求解器行为不同——Lock1 消除该行所有非本区域候选；Projection 通过投影交集消除公共格。

#### 2.3.5 buildCapacity — "同区域 2-3 格在同一 2×2 块内"

```
输入: Queen q 在 (2,3)

步骤:
  1. 找到包含 Queen 的所有 2×2 块（最多 4 个顶点偏移）:
     dr=0, dc=0:  顶点 (2,3): (2,3)(2,4)(3,3)(3,4)
     dr=0, dc=-1: 顶点 (2,2): (2,2)(2,3)(3,2)(3,3)
     dr=-1,dc=0:  顶点 (1,3): (1,3)(1,4)(2,3)(2,4)
     dr=-1,dc=-1: 顶点 (1,2): (1,2)(1,3)(2,2)(2,3)
  2. 随机选一个 2×2 块
  3. 在块内取 Queen + 1-2 个未占用格 = 总共 2-3 格

实际效果 (选了 dr=0,dc=-1，取了 (3,2)):
  (2,2)(2,3)  ← 区域 qi
  (3,2)(3,3)  ← (3,2) 也属于 qi，(3,3) 未分配

BuildInfo: { strategy:'L3_Capacity', queenIndices:[qi], axis:'row', values:[2,3] }
  // values[0]=Queen.row, values[1]=Queen.col
```

**落子特点**：区域的全部格子物理上在一个 2×2 块内。只有 2-3 格。Capacity 策略的核心前提——"某区域的候选全在一个 2×2 块内，所以块内其余格不能是该区域的"。

#### 2.3.6 buildContradiction — "Queen 旁边放同区域格"

```
输入: Queen q 在 (3,3)，随机方向 dir = (0,1)（右）

步骤:
  1. 检查 (3,4) 是否合法且未被占
  2. claimCell (3,3) 和 (3,4) 到区域 qi

实际效果:
  row 3: [ ][ ][ ][Q][R][ ]
  2 格，Queen + 4-邻接

BuildInfo: { strategy:'L3_Contradiction', queenIndices:[qi], axis:'row', values:[3,4] }
  // values = [被放格子的 row, 被放格子的 col]
```

**落子特点**：最简单——Queen + 1 个紧邻。总共 2 格。

#### 2.3.7 buildUnique — "只放 Queen 自己"

```
claimCell(q.row, q.col, qi, grid, frozen);
// 就这一个格子。不构造更多。

BuildInfo: { strategy:'L1_Unique', queenIndices:[qi], axis:'row', values:[q.row, q.col] }
```

**落子特点**：只放 Queen 本身。后续 BFS 填充会给它加格子，Spoiler 机制保证多加的格子被早期策略 X 掉，使该区域最终只剩 Queen → L1_Unique 触发。

### 2.4 第⑤步：Spoiler 机制

#### 2.4.1 为什么需要 Spoiler

构造器只放 2-4 格"骨架"。BFS 填充给区域加了大量额外格子。这些额外格子可能破坏约束：

```
构造后: 区域 3 在 row 4 上有 (4,2)(4,3)(4,4) → Lock1(row=4) 约束成立
BFS 后: 区域 3 长了 (1,5)(2,0)(3,7)(5,1)(6,3) → 这些不在 row 4 → Lock1 被淹没
求解器: "区域 3 的候选不全在 row 4 → Lock1 不触发"
```

Spoiler 的设计思路：**不阻止填充**（因为需要填充来覆盖棋盘），而是**利用正向求解的消除顺序来"净化"约束**。

#### 2.4.2 Spoiler 的核心逻辑

```
逆向构造顺序（先构造的 = 正向求解最后触发的）:
  buildResults[0]: L2_Lock1 (Queen 0, row=3)   ← 正向最后触发
  buildResults[1]: L3_Projection (Queen 1, row=5) ← 正向中间触发
  buildResults[2]: L2_Lock2 (Queen 2+3, rows={1,7}) ← 正向最先触发

正向求解顺序:
  buildResults[2] → buildResults[1] → buildResults[0]

Spoiler 放置 (对每对相邻步骤 i, i-1):
  取 earlier = buildResults[i]（正向更早触发）的消除区
  在消除区中找未分配格子 → 分配给 later = buildResults[i-1] 的区域
```

**用上例具体说明**：

```
对 buildResults[2] 和 buildResults[1]:
  earlier = buildResults[2] (L2_Lock2, 消除 rows 1 和 7)
  later = buildResults[1] (L3_Projection, Queen 1 的区域)

  在 rows 1 和 7 中找到空闲格子 → 分配给 Queen 1 的区域
  → 正向求解时: L2_Lock2 先触发 → X 掉这些 spoiler
  → Queen 1 的区域被"净化" → row 5 上的约束格子露出来
  → L3_Projection 正确识别

对 buildResults[1] 和 buildResults[0]:
  earlier = buildResults[1] (L3_Projection, 消除 row 5)
  later = buildResults[0] (L2_Lock1, Queen 0 的区域)

  在 row 5 上找空闲格子 → 分配给 Queen 0 的区域
  → 正向求解时: L3_Projection 先触发 → X 掉这些 spoiler
  → Queen 0 的区域"净化"后只剩 row 3 上的格子
  → L2_Lock1 正确触发
```

#### 2.4.3 消除区计算（getEliminationZone）

```typescript
// 计算某策略触发后会消除哪些位置的候选
L2_Lock1 / L3_Projection:
  → 约束行/列上全部 n 个格子

L2_Lock2 / L2_Lock3:
  → 2 或 3 个约束行/列上的全部格子

L3_Capacity:
  → Queen 周围所有 2×2 块（最多 16 格）

L3_Contradiction:
  → 被消除格 + 4-邻域（最多 5 格）

L1_Unique:
  → Queen 的行 + 列 + 8-邻域（n*2 + 8 格）
```

#### 2.4.4 Spoiler 的双重角色

仔细分析后，Spoiler 实际做了**两件不同的事**：

| 角色 | 做什么 | 为什么需要 | 是补丁还是设计 |
|------|--------|-----------|--------------|
| **角色 A：约束保护** | 在早期策略的消除区中放 spoiler 格，让早期策略"清理"掉被填充破坏的约束 | 因为 BFS 填充不尊重区域约束，会给 Lock1 区域加约束行之外的格子 | **补丁**——如果填充不破坏约束就不需要 |
| **角色 B：消除时序控制** | 把某区域的非 Queen 格放在早期策略的消除路径上，确保该区域在正确的时机只剩 Queen | 因为 L1_Unique 触发的前提是"区域只剩 Queen 一个候选"——需要控制非 Queen 格在什么时候被 X | **设计**——控制消除时序是逆向生成的核心需求 |

**角色 A 在阶段 1 被删除**（约束化填充使约束天然保持）。**角色 B 在阶段 2 升级为正式机制** `placeCellsForElimination`——从"补丁"升级为"一等公民"。

### 2.5 第⑥步：BFS 填充（fillGrid）

```
fillGrid(grid, n, rng):
  1. 种子收集: 所有已分配格 → 4-邻接未分配格进入 frontier
  2. 随机 BFS: 从 frontier 随机取格 → 分配为邻居区域 → 继续扩展
  3. Fallback: 如果 BFS 后仍有 -1 格 → 分配为曼哈顿距离最近区域
```

**问题 1**：步骤 2 不检查区域约束。Lock1 区域可能被分配到约束行之外。

**问题 2**：步骤 3 的 Fallback 不保证 4-连通性。可能产生"孤岛"格——属于区域 A 但 4-邻接全都不属于区域 A。虽然游戏规则不要求区域 4-连通（规则只有：每行/列/区域一个 Queen，Queen 不邻接），但孤岛在视觉上不好看，也可能引入意外的求解路径。

### 2.6 第⑦步：求解验证

```
regions = gridToRegions(grid)       // 二维数组 → Region[]
board = createEmptyBoard(n, regions)
result = solve(board)               // 运行标准求解器

if result.complete:
  exact 匹配 → 返回成功
  approximate → 记录最佳
```

---

## 3. 当前方案的根本问题

### 3.1 架构层错位：工作在区域形状层，而非求解器状态层

当前算法问的问题是："区域应该长什么样才能触发策略 X？"

正确的问题应该是："**求解器在第 K 步时看到什么候选状态，才会选择执行策略 X？**"

棋盘（regions）是**静态的**。求解器的行为是**动态的**——它取决于"当前的候选状态"，而候选状态随着每一步消除不断变化。

同一个棋盘，求解器在不同消除顺序下可能看到不同的策略触发顺序。逆向生成的目标是**控制这个顺序**，所以必须在求解器的动态状态层工作。

**类比**：
- 区域形状 = 乐谱（静态，所有音符同时存在）
- 求解器执行 = 演奏（动态，每个时刻演奏者看到特定的一组音符）
- 逆向生成要控制的 = 演奏序列（在什么时刻演奏什么音符）

你不能通过改变乐谱上的音符位置来精确控制演奏者第 3 秒弹什么——乐谱上的音符是同时存在的。你需要控制的是"演奏者每一步的视野"。

在求解器中，"视野" = 候选状态（哪些格子还是候选、哪些已被 X、哪些已确认为 Queen）。每一步消除会改变视野。逆向生成需要控制的是：在第 K 步时，求解器看到什么候选状态，从而做出什么决策。

### 3.2 六大具体缺陷

| # | 缺陷 | 根因 | 解决阶段 |
|---|------|------|---------|
| 1 | 约束 Queen 上限 = 6 | 空间不够——全参与会导致每区域格数炸裂。是妥协，不是设计 | 阶段 2 |
| 2 | ratio 估算 | L1_Direct 不能被当前方式构造，只能盲猜占比 | 阶段 3 |
| 3 | BFS 填充破坏约束 | 填充不检查区域几何约束 | 阶段 1 |
| 4 | Spoiler 角色混淆 | 约束保护（补丁）+ 消除时序控制（设计）混在一起 | 阶段 1+2 |
| 5 | 无法控制 L1_Unique 触发时机 | 不知道哪个格子在哪个步骤被 X——只知道消除区的几何形状，不知道时序 | 阶段 2 |
| 6 | 大量盲目重试（n=10: 300次） | 失败时不知道原因，只能随机改变参数重试 | 阶段 3 |

### 3.3 与锚点策略的区分（重要）

锚点策略（`anchorGenerator.ts`）不在本次重构范围内。两者的设计哲学不同：

| | 锚点生成器 | 逆向生成器 |
|---|---|---|
| **设计理念** | 构造"点火器"——保证至少第一步能走 | 构造"因果链"——每一步的前置都来自前一步的产出 |
| **Queen 参与** | 1-4 个（**有意不全纳入**，留空间给多样性） | n 个全部纳入（目标） |
| **构造方式** | 一次性构造锚点形状 | 分步构造策略链 |
| **填充** | BFS 自由填充（锚点被 frozen 保护） | 约束化填充（目标） |
| **成熟度** | 稳定 | 开发中 |

---

## 4. 求解器的关键行为（讨论中涉及的前提知识）

以下规则是在我们讨论中确认的，对理解逆向生成至关重要：

### 4.1 主循环结构

求解器（`solver.ts`）的执行顺序是：

```
1. L1 循环（持续到无产出）:
   - 尝试 L1_Direct（已确认 Queen 的消除传播）
   - 尝试 L1_Unique（区域唯一候选确认）
   - 两者交替，直到都无产出才退出 L1 循环

2. 如果所有 Queen 已确认 → 求解成功

3. L2（取第一个有产出的，然后回到步骤 1）:
   - L2_Lock1 → L2_Lock2 → L2_Lock3
   - 第一个有产出的立即返回，回到 L1 循环

4. L3（取第一个有产出的，然后回到步骤 1）:
   - L3_Projection → L3_Contradiction → L3_Capacity
   - 第一个有产出的立即返回，回到 L1 循环

5. 全部策略无产出 → 求解失败
```

**关键规则**：
- **策略优先级**：L1_Direct > L1_Unique > L2_Lock1 > L2_Lock2 > L2_Lock3 > L3_Projection > L3_Contradiction > L3_Capacity
- **L2/L3 单次触发**：每次 L2/L3 循环只取第一个有产出的策略，然后立即回到 L1
- **批次合同**（设计文档 §4.2）：无产出不记录；一次调用一个批次；批次内不连锁

### 4.2 L1_Direct 和 L1_Unique 的关系

L1_Unique 确认 Queen 时**不消除任何东西**（遵守批次合同）。确认的 Queen 的消除传播由**下一轮** L1_Direct 完成。

这意味着求解序列中 L1_Unique 和 L1_Direct 成对出现：Unique 确认 → Direct 传播 → Unique 再确认 → Direct 再传播 → ...

### 4.3 消除路径

每种 L2/L3 策略触发后，消除的范围是确定的：

- **L2_Lock1(row=v)**：row v 上全部非本区域候选
- **L2_Lock2(rows={a,b})**：rows a,b 上全部非约束区域候选
- **L2_Lock3(rows={a,b,c})**：rows a,b,c 上全部非约束区域候选
- **L3_Capacity(corner, region=r)**：该 2×2 块内非 r 的候选
- **L3_Projection**：动态计算（取决于求解器内的投影交集），难以静态预测
- **L3_Contradiction**：单个格
- **L1_Direct(Queen q)**：q.row 全部 + q.col 全部 + 8-邻域

---

## 5. 新方案：基于求解器状态的逆向生成

### 5.1 核心思维转换

```
┌─────────────────────────────────────────────────────────────┐
│  旧：逆向构造区域形状 → BFS 填充 → Spoiler 补丁 → 碰运气       │
│                                                             │
│  新：逆向推导求解器状态序列 → 从状态约束反推区域 → 精确匹配     │
└─────────────────────────────────────────────────────────────┘
```

求解器的工作方式是**状态转移**：每一步根据当前候选状态，选择一个策略，改变候选状态。

逆向生成的正确思路是：**从终态开始，逆向推导每一步的前置状态应该是什么，然后构造区域使这些状态连续成立。**

### 5.2 关键概念：求解器状态（SolverState）

求解器每一步看到的是候选状态，不是区域形状：

```
SolverState {
  cellState[r][c]: 'candidate' | 'x' | 'queen' | 'wrong'
  // 每个格子在当前步骤的状态
  regionId[r][c]: number
  // 每个格子的区域归属（静态，从 State_0 确定后不变）
}
```

每一步策略是一个状态转移：`State_{i-1} → S_i → State_i`。

### 5.3 关键概念：消除依赖图（Elimination Dependency Graph）

**消除依赖**：每一步的产出（消除/确认）成为后续步骤的前置条件。

```
具体例子 (n=5):

Step 1 (L2_Lock1, Queen1, row=1):
  产出: X 掉 row 1 上非区域 1 的候选 → cell(1,0)(1,2)(1,3)(1,4) 被消除

Step 3 (L1_Unique, Queen2):
  前置: 区域 2 的非 Queen 格必须已被消除
  区域 2 的格子: Queen 在 (2,4)，非 Queen 格在 (1,2) 和 (3,0)
  cell(1,2) 在 row 1 → 被 Step 1 消除 ✓
  cell(3,0) 不在 row 1 → 不被 Step 1 消除 ✗
  → 所以 cell(3,0) 必须被 Step 2 或其他步骤消除

Step 2 (L2_Lock1, Queen3, col=3):
  产出: X 掉 col 3 上非区域 3 的候选 → cell(0,3)(2,3)(4,3) 被消除
  cell(3,0) 不在 col 3 → 仍未被消除 ✗
  → 问题！区域 2 的 cell(3,0) 没有被任何 L2/L3 步骤的消除路径覆盖
  → 策略序列不可行 → 需要重新设计
```

**消除依赖图** = 一张有向无环图：节点是策略步骤，边 S_i → S_j 表示 S_i 的消除产出是 S_j 能触发的前置条件之一。

**闭合的消除依赖图**：每个 L1_Unique 步骤的非 Queen 格都能被之前的 L2/L3 步骤的消除路径覆盖。如果覆盖不了，序列不可行 → 重新设计序列。

### 5.4 新算法的五个阶段

```
输入: n, targetSteps, seed
输出: Level (区域布局 + 求解序列恰好 targetSteps 步)

┌─ Phase A: 设计策略序列 ─────────────────────────────────────┐
│                                                              │
│ 目标: 设计一个长度为 targetSteps 的因果一致的策略序列。        │
│                                                              │
│ 核心约束（从我们的讨论中确认）:                                 │
│   1. 每个 L1_Unique(q) 的非 Queen 格，必须位于某个更早         │
│      L2/L3 步骤的消除路径上                                   │
│   2. 每个 L2/L3 的消除产出，必须包含后续步骤需要消除的格子      │
│   3. L1_Direct 不独立构造——它紧跟在 L1_Unique 之后自动触发     │
│   4. 所有 n 个 Queen 都需要在序列中完成 L1_Unique 确认         │
│                                                              │
│ 序列结构（从求解器行为推导）:                                   │
│   [L2/L3]* → [L1_Unique + L1_Direct] → [L2/L3]* → ...       │
│   即 L2/L3 消除步骤和 L1 确认步骤交替出现                      │
│                                                              │
│ 此阶段的核心挑战:                                              │
│   - 如何选择 L2/L3 的策略类型和涉及的 Queen，使消除路径        │
│     覆盖后续 L1_Unique 所需的格子                              │
│   - 具体的序列设计算法需要在实现中确定                          │
│                                                              │
├─ Phase B: 逆向状态推导 ─────────────────────────────────────┤
│                                                              │
│ 目标: 从终态 (State_K) 逆向推导每个 State_{i-1} 必须满足的条件  │
│                                                              │
│ 从我们的讨论中确认的推导原则:                                   │
│                                                              │
│   对于每个步骤 S_i（从 K 到 1 逆向）:                          │
│                                                              │
│   若 S_i = L1_Direct:                                        │
│     此步由前面的 L1_Unique 自动触发                            │
│     逆向: 将被消除的格从 x 状态恢复为 candidate                 │
│                                                              │
│   若 S_i = L1_Unique (确认 Queen q):                         │
│     前置: 区域(q) 在 State_{i-1} 时只有 q 一个候选              │
│     → 区域(q) 的非 Queen 格必须在此步骤前被 X 掉               │
│     → 这些非 Queen 格必须位于 S[1..i-1] 的消除路径并集中       │
│     → 导出 C₂ 约束（消除时序约束）                             │
│                                                              │
│   若 S_i ∈ {L2_Lock1, L2_Lock2, L2_Lock3}:                  │
│     前置: 涉及的区域候选在指定行/列上                           │
│     → 这些区域的格子必须满足行/列约束                           │
│     → 导出 RegionConstraint（几何约束）                        │
│                                                              │
│   若 S_i = L3_Capacity:                                      │
│     前置: 某区域候选全在 2×2 块内                               │
│     → 导出 RegionConstraint { type: 'block' }                │
│                                                              │
├─ Phase C: 区域约束满足与格子分配 ────────────────────────────┤
│                                                              │
│ 目标: 将 Phase B 的约束转化为具体的格子→区域分配                │
│                                                              │
│ 从我们的讨论中确认的约束类型:                                   │
│                                                              │
│   C₁ 约束 (几何约束): cell(r,c) 必须属于区域 rid              │
│     - 由 L2/L3 步骤的 BuildInfo 导出                         │
│     - 形式: RegionConstraint                                 │
│                                                              │
│   C₂ 约束 (消除时序约束): cell(r,c) 必须在 State_t 已被消除    │
│     - 由 L1_Unique 步骤的前置条件导出                          │
│     - 要求: cell 位于某个更早步骤的消除路径上                   │
│                                                              │
│ RegionConstraint 类型（讨论确认）:                             │
│   - free:   无限制，填充可自由分配                             │
│   - axis:   格子必须在指定行/列 (Lock1, Projection)           │
│   - axes:   格子限定在 2-3 行/列内 (Lock2, Lock3)             │
│   - block:  格子在指定 2×2 块内 (Capacity)                    │
│                                                              │
│ 映射关系（讨论确认）:                                          │
│   L2_Lock1 / L3_Projection → axis                            │
│   L2_Lock2 → axes (2 个值)                                   │
│   L2_Lock3 → axes (3 个值)                                   │
│   L3_Capacity → block                                        │
│   L3_Contradiction / L1_Unique / 无策略 → free               │
│                                                              │
│ 此阶段的核心挑战:                                              │
│   - 当两个区域都想占用同一格子时如何解决冲突                    │
│   - C₂ 约束要求格子放在消除路径上，但消除路径可能空间不足       │
│   - 具体算法需要在实现中确定                                   │
│                                                              │
├─ Phase D: 约束化填充 ────────────────────────────────────────┤
│                                                              │
│ 目标: 填充棋盘上 Phase C 之后剩余的空格，同时不破坏任何约束      │
│                                                              │
│ 核心思想（讨论确认）:                                          │
│   - 替代旧的 BFS 随机填充（旧填充不检查约束=需要 Spoiler）      │
│   - 填充时检查: 将格子分配给区域 r 前，确认 r 的约束允许此格    │
│   - 如果所有邻居区域都拒绝此格 → 分配给最近的 free 区域         │
│                                                              │
│ 约束检查逻辑（讨论确认）:                                      │
│   for each 空格 (r,c):                                       │
│     for each 4-邻接区域 rid:                                  │
│       检查 constraints[rid]:                                  │
│         free → 可分配                                        │
│         axis(row=v) → 可分配当 r == v                        │
│         axes(rows={a,b}) → 可分配当 r ∈ {a,b}               │
│         block(corner) → 可分配当在 2×2 块内                  │
│     如果多个允许 → 随机选                                     │
│     如果零个允许 → 找最近的 free 区域                          │
│                                                              │
│ 此阶段使 Spoiler 角色 A 不再需要:                              │
│   旧: 构造约束 → 填充破坏约束 → Spoiler 修复约束              │
│   新: 构造约束 + 记录 RegionConstraint → 约束化填充(不破坏)    │
│                                                              │
│ 4-连通性（讨论确认的额外约束）:                                 │
│   - 分配格子前检查是否 4-邻接到目标区域的已有格子               │
│   - 优先保持连通，极端情况可接受视觉瑕疵                        │
│                                                              │
├─ Phase E: 验证 ──────────────────────────────────────────────┤
│                                                              │
│ 目标: 正向求解，验证实际结果与设计一致                           │
│                                                              │
│ 验证项:                                                       │
│   1. 求解器完整求解 (result.complete == true)                 │
│   2. 实际步数 = targetSteps                                  │
│   3. L2/L3 策略序列匹配（L1_Direct/Unique 的合并需容忍）       │
│                                                              │
│ 与旧方案的关键区别:                                            │
│   旧: 验证失败 → 盲目重试（300 次）                             │
│   新: 验证失败 → 定位不满足的依赖 → 定向调整序列 → 重试少量次   │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. 核心设计原理

### 6.1 为什么要在求解器状态层工作

区域形状是静态的，求解器行为是动态的（取决于当前候选状态）。同一个棋盘，不同消除顺序可能产生不同策略序列。逆向生成要控制的是这个顺序——所以必须在求解器的动态状态层工作。

在求解器中，"视野" = 候选状态。每一步消除改变视野。逆向生成控制的是：在第 K 步时求解器看到什么，从而做出什么决策。

### 6.2 约束化填充 vs 旧 BFS 填充

```
旧 BFS 填充:
  for each 空格 (r,c):
    随机分配给 4-邻接区域之一
    问题: 不考虑区域约束 → Lock1 区域可能被分到约束行之外
    后果: 需要 Spoiler（角色 A）修复

新 约束化填充:
  for each 空格 (r,c):
    for each 4-邻接区域 rid:
      检查 constraints[rid]:
        free → 可分配
        axis(row=v) → 可分配仅当 r==v
        axes(rows={a,b}) → 可分配仅当 r∈{a,b}
        block(corner) → 可分配仅当在 2×2 块内
    如果多个允许 → 随机选一个
    如果零个允许 → 找最近的 free 区域
```

**约束化填充使 Spoiler 角色 A 不再需要**：填充不会在约束之外加格子 → 约束天然成立 → 不需要"修复"。

### 6.3 消除感知的格子放置（阶段 2）

L1_Unique(q) 触发的前提：区域(q) 的非 Queen 格必须在步骤 t 之前被 X 掉。这意味着这些格子的位置必须被之前的 L2/L3 消除路径覆盖。

逻辑：
```
对于区域 r，其 L1_Unique 在步骤 t 触发:
  计算步骤 1..t-1 的消除路径并集
  将区域 r 的非 Queen 格放置在该并集的空闲位置上
  如果空间不够 → 策略序列不可行 → 回到 Phase A 调整
```

这与当前 Spoiler 角色 B 做的事情本质相同——区别在于，角色 B 是事后补丁（填充完了再放 spoiler），而这种做法是在构造阶段就精确控制非 Queen 格的位置。**消除路径并集的大小决定了能放多少非 Queen 格。** 如果区域需要 3 个非 Queen 格但消除路径并集只有 2 个空位，序列不可行。

### 6.4 精确步数匹配 vs ratio 估算

ratio 估算的本质是承认"我们不知道 L1 会有几步"。

精确步数匹配的理念不同——不预测 L1 步数，而是通过消除依赖图控制每个 Queen 的 L1_Unique 触发位置：

```
1. 构造 K 个 L2/L3 步骤
2. 每个 Queen 在消除依赖图中自然找到其 L1_Unique 的触发时机
   → 取决于该 Queen 的非 Queen 格何时被 X 完
3. 每个 L1_Unique 后自动跟 1 个 L1_Direct
4. 总步数 = K + (L1_Unique 步数) + (L1_Direct 步数)
5. 调整 K 使总数逼近 targetSteps
```

极限情况（targetSteps 较小）：多个 L1_Unique 可能在一次 L1 循环中连续触发（求解器在一次 L1 循环中确认多个 Queen），此时 L1_Direct 也合并——实际步数 < K + 2n。这种情况通过 Phase E 的验证来精确确认，并据此调整 K。

### 6.5 关键类型定义（讨论确认）

**RegionConstraint**（放入 `src/game/types.ts`）:

```typescript
export type RegionConstraint =
  | { type: 'free' }
  | { type: 'axis'; axis: 'row' | 'col'; value: number }
  | { type: 'axes'; axis: 'row' | 'col'; values: number[] }
  | { type: 'block'; corner: Position };
```

**约束构造器的新返回类型**:

构造步骤结束后，每个构造步骤需要同时输出两样东西：
- `BuildInfo`（已有）：策略元数据，描述该步骤是什么策略、涉及哪些区域
- `constraints: Map<regionId, RegionConstraint>`（新增）：每个涉及区域的几何约束

一个构造步骤可能涉及多个区域（如 Lock2 涉及 2 个区域），所以 constraints 是 Map。

---

## 7. 实现计划

### 7.1 阶段 1：约束化填充 + 去 Spoiler 补丁

**目标**：用约束化填充消除"填充破坏约束"的问题，删除 Spoiler 的约束保护角色。同时修复 4-连通性。

**改什么**：

| 文件 | 操作 | 内容 |
|------|------|------|
| `types.ts` | **新增** | `RegionConstraint` 类型（见 §6.5） |
| `reverseGenNew.ts` | **新增** | `constrainedFill()` — 替代 `fillGrid`，填充时检查 RegionConstraint |
| `reverseGenNew.ts` | **修改** | 7 个 `build*` 函数 → 返回值从 `BuildInfo \| null` 扩展为同时携带 `constraints: Map<number, RegionConstraint>` |
| `reverseGenNew.ts` | **删除** | `getEliminationZone()` 函数（~55 行）— 消除区计算不再需要 |
| `reverseGenNew.ts` | **删除** | `addSpoilers()` 函数（~28 行）— 约束化填充自然保护约束 |
| `reverseGenNew.ts` | **修改** | `generateReverseLevel` 主循环：收集所有步骤的 constraints → 传给 `constrainedFill` → 移除 spoiler 放置步骤 |
| `reverseGenNew.test.ts` | **新增** | 约束化填充 + 4-连通性的单元测试 |

**不改的内容**：
- `maxConstraintQueens=6` 保留（阶段 2 移除）
- `ratio` 估算保留（阶段 3 移除）
- `pickReverseStrategies` 不改（阶段 2 重写）
- `usageCount` 保留

**阶段 1 后的 Spoiler 状态**：

| Spoiler 角色 | 状态 |
|-------------|------|
| 角色 A（约束保护） | **已删除** — 约束化填充使约束天然保持 |
| 角色 B（消除时序控制） | **功能暂时退化** — `addSpoilers` 被删除，L1_Unique 触发时机回归不可控。阶段 2 由 `placeCellsForElimination` 补回并升级 |

**预期**：代码净减少 ~60 行。约束保持更可靠。整体成功率与当前持平或略低（少了 Spoiler 对 L1_Unique 的辅助）。

### 7.2 阶段 2：全 Queen 参与 + 消除感知放置

**目标**：所有 n 个 Queen 参与策略构造；L1_Unique 触发时机可控。

**改什么**：

| 文件 | 操作 | 内容 |
|------|------|------|
| `reverseGenNew.ts` | **重写** | `pickReverseStrategies()` — 改为基于消除依赖的设计，所有 Queen 纳入策略序列 |
| `reverseGenNew.ts` | **删除** | `maxConstraintQueens = 6` 限制 |
| `reverseGenNew.ts` | **新增** | `placeCellsForElimination()` — 在消除路径上放置非 Queen 格。这是 Spoiler 角色 B 的升级版 |
| `reverseGenNew.ts` | **新增** | 消除路径计算函数 — 预计算每个 L2/L3 步骤消除哪些位置的候选 |
| `reverseGenNew.ts` | **删除** | `buildUnique()` — L1_Unique 不独立构造，其触发由消除依赖推导 |
| `reverseGenNew.ts` | **修改** | 主循环 → 加入消除感知放置步骤 |

### 7.3 阶段 3：精确步数匹配 + 依赖图验证

**目标**：消除 ratio 估算；验证失败时能精确定位不满足的依赖；大幅减少尝试次数。

**改什么**：

| 文件 | 操作 | 内容 |
|------|------|------|
| `reverseGenNew.ts` | **新增** | 依赖图验证函数 — 检查每个步骤的前置条件是否被前置步骤的产出覆盖 |
| `reverseGenNew.ts` | **删除** | `ratio` 估算逻辑 |
| `reverseGenNew.ts` | **修改** | 主循环：从"盲目重试 300 次"→"验证失败 → 报告具体不满足的依赖 → 定向调整序列 → 少量重试" |

---

## 8. 边界条件与约束

### 8.1 4-连通性

虽然 Queen 解谜的游戏规则不要求区域 4-连通（规则只有：每行/列/区域一个 Queen，Queen 互不邻接），但良好设计应避免视觉上的孤岛。

约束化填充中通过以下方式保证：
- BFS 阶段的每个新格子 4-邻接到已有格子（天然连通）
- 非 BFS 阶段的分配优先选择 4-邻接的方案
- 极端情况（棋盘中央空格被不同约束区域包围）→ 接受可能的视觉瑕疵

### 8.2 n 范围

n=5-10。算法复杂度不超过 O(n² × steps)。100 个格子 × ≤30 步骤。计算量可控。

### 8.3 与锚点生成器的共存

锚点生成器（`anchorGenerator.ts`）保留不动。它适用于"快速生成多样化关卡，不要求精确步数"的场景。逆向生成器适用于"精确控制求解体验"的场景。两者通过 `mode` 参数切换。

---

## 9. 修改原则

1. **核心逻辑与 UI 分离**：所有算法改动在 `reverseGenNew.ts` 和 `types.ts` 内，不涉及 React 组件
2. **渐进替换**：阶段 1 完成后可独立验证效果，再进入阶段 2
3. **保留接口**：`generateReverseLevel(params) → GenerationResult` 对外签名不变
4. **测试驱动**：每个阶段新增或修改对应的测试文件
5. **确定性**：所有随机性通过 `rng` 参数控制，给定 seed 产生相同结果
6. **不引入新依赖**：纯 TypeScript 实现，不依赖外部 CSP 库
