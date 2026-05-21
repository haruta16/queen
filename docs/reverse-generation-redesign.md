# 逆向生成算法重构设计

## 1. 核心思维转换

求解器的工作方式是**状态转移**：每一步根据当前候选状态，选择一个策略，改变候选状态。

逆向生成的正确思路是：**从终态开始，逆向推导每一步的前置状态应该是什么，然后构造区域使这些状态连续成立。**

这要求工作在**求解器的动态状态层**，而非区域形状层。区域形状是静态的，求解器行为是动态的（取决于候选状态随消除的演变）。同一个棋盘，不同消除顺序产生不同策略序列。逆向生成要控制的正是这个顺序。

---

## 2. "阻挡格"框架（核心机制，替代 Spoiler）

### 2.1 基本概念

每个正向策略步骤只有在**特定前置条件满足**时才能触发。反过来，如果在棋盘上放置一个**违反前置条件的格子**，该策略就被"阻挡"了。

**阻挡格**：使某策略无法触发的格子。

| 策略 | 触发条件 | 被什么阻挡 |
|------|---------|-----------|
| L2_Lock1(region R, row v) | 区域 R 的全部候选在同一行 v | 区域 R 存在**不在 row v** 的格子 |
| L2_Lock2(regions R1,R2, rows {a,b}) | 两区域候选限制在 2 行内 | 区域 R1 或 R2 存在**不在 {a,b} 行**的格子 |
| L2_Lock3 | 同理 | 同理 |
| L3_Projection(region R, row v) | 区域 R 有 ≥2 候选同行且紧邻，投影交集非空 | 区域 R 存在**不在 row v** 的候选；或候选不紧邻 |
| L3_Contradiction(cell c) | c 若为 Queen 会导致另一 unit 饥饿 | c 的投影集不覆盖任何 unit 的全部候选 |
| L1_Unique(Queen q, region R) | 区域 R 只有 q 一个候选 | 区域 R 存在**除 q 之外的候选** |

### 2.2 阻挡格的清除

阻挡格不是永久的。当阻挡格位于某个**更早正向步骤的消除路径**上时，那个步骤触发时会把它 X 掉。

```
step_j 先触发（正向）→ X 掉 step_i 的阻挡格 → step_i 可以触发
```

正向求解中，每个步骤的消除产出（X 掉哪些格子）成为后续步骤的前置条件。**前面的步骤为后面的步骤"扫清障碍"。**

阻挡格框架就是**主动利用这个因果关系**：在逆向构造时，step_{i+1} 为自己的策略放置阻挡格，并把这些阻挡格精确放在 step_i 的消除路径上。正向求解时 step_i 清除它们，step_{i+1} 得以触发。

### 2.3 具体例子

```
正向顺序: step_1 (L2_Lock1, Q1, row=1) → step_2 (L2_Lock1, Q3, row=3)

逆向构造:
  先构造 step_2（正向后触发）:
    核心约束格: Q3 区域在 row 3 上的格子 (3,1)(3,3)(3,5)
    阻挡格: Q3 区域在 row 5 上的格子 (5,3)
            → 区域 Q3 有格子不在 row 3 → Lock1(Q3, row=3) 被阻挡
            → (5,3) 放在 row 1 的消除路径上是不可能的，因为 row 1 ≠ row 5
            → 但 step_1 的消除产出包括了... 等等，step_1 是 Lock1(Q1, row=1)，消除的是 row 1 上非 Q1 候选
            → (5,3) 不在 row 1，不会被 step_1 消除

  问题！需要把阻挡格放在 step_1 的消除路径上。

  调整: 阻挡格 (5,3) 必须放在 step_1 的消除路径 = row 1 上
        但阻挡格也是 Q3 区域的格子，必须满足 Q3 的区域约束
        → 如果 Q3 有 axes 约束 (row 3 或 row 5)，那 (1,3) 在 row 1，不符合
        → 所以策略选择需要协调：step_1 的消除路径要能覆盖 step_2 的阻挡格所在位置
```

这个例子暴露了一个关键约束：**阻挡格必须同时满足两个条件**——(a) 属于被阻挡策略的区域，(b) 位于更早步骤的消除路径上。这要求策略序列设计时就要考虑消除路径的空间覆盖。

### 2.4 与旧 Spoiler 的对比

| | 旧 Spoiler | 阻挡格框架 |
|---|----------|----------|
| **谁放格子** | BFS 填充（随机）+ Spoiler（补救） | step_{i+1} 构造时主动放置 |
| **因果方向** | 被动修复——填充破坏了约束，Spoiler 修复它 | 主动创建——前面步骤为后面步骤扫清障碍 |
| **格子性质** | 随机挑选的"多余格" | 有明确定义的"阻挡格"——违反某策略前置条件的格子 |
| **放置位置** | 随机在消除区中选 | 精确放在消除路径上，保证被特定步骤清除 |
| **可控性** | 低（随机） | 高（精确） |

---

## 3. 步骤间依赖关系

### 3.1 依赖可以是多源的

step_i 的前置条件可以由 {step_{i-1}, step_{i-2}, ...} 的消除产出共同满足。依赖图是一个 DAG，不是链表。

### 3.2 强制依赖 step_{i-1}

虽然理论上 step_i 可以不依赖 step_{i-1}（比如两者操作在不同区域），但**必须强制 step_i 至少依赖 step_{i-1}**——否则求解器可能以不同顺序执行，导致步数偏差。

实现方式：在构造依赖链时，保证 step_i 的**至少一个阻挡格**位于 step_{i-1} 的消除路径上。这不是在 step 内部硬编码，而是在构造过程中检查并保证。

```
构造 step_i 时:
  计算 step_i 的阻挡格集合
  确保: 阻挡格 ∩ step_{i-1} 的消除路径 ≠ ∅
  如果不满足 → 调整阻挡格的放置位置或 step_{i-1} 的策略参数
```

### 3.3 逆向构造顺序的优势

逆向构造顺序（step_{i+1} 先于 step_i 构造）使得：

- step_{i+1}（正向后触发）先构造 → 它可以为 step_i 放置阻挡格
- step_i（正向先触发）后构造 → 它可以看到 step_{i+1} 已经放了什么，从而调整自己的消除路径来覆盖它们

因果在构造时是反的：被依赖者后构造，依赖者先构造。

---

## 4. 具体优化决策

### 4.1 删除所有魔法数字

以下全部删除，由约束和当前棋盘状态动态决定：

| 魔法数字 | 当前作用 | 删除后如何处理 |
|---------|--------|-------------|
| 2-4 格/每步 | 限制每步放置的格子数 | 放多少由约束声明决定，不是预先指定 |
| `MAX_REGION_CELLS = min(5, ceil(n*0.6))` | 防止区域过度构造 | 区域大小由约束和棋盘空间自然决定。真实关卡中区域可以很大 |
| `maxConstraintQueens = 6` | 空间妥协 | 约束化填充解决空间问题后移除（阶段 2） |
| `ratio = 30-55%` | 盲估 L1 步数占比 | 用消除依赖图精确控制（阶段 3） |
| 距 Queen 距离排序 | 无理由的偏向 | Lock1 只要求同行，不需要距离优先。格子选择由约束满足统一处理 |

### 4.2 删除 L3_Capacity

从所有相关文件中删除。理由：
- 7 种策略中最不优雅、最不通用
- 最难精确逆向构造（2×2 块的约束太紧）
- 求解优先级最低（L3 末尾，常被前面策略抢走）
- 删除后 6 种策略足够覆盖所有推理路径

**删除范围**：
- `solver.ts`：删除 `stepL3Capacity` 函数，从 L3 循环中移除
- `types.ts`：从 `StrategyType` 联合类型中移除 `'L3_Capacity'`
- `reverseGenNew.ts`：删除 `buildCapacity` 函数
- `anchorGenerator.ts`：删除 Capacity 锚点构造器
- 测试文件：删除相关测试用例

### 4.3 策略选择改为动态构造

**当前做法**：`pickReverseStrategies` 一次性随机生成整个策略序列（策略类型 + Queen + 参数），然后构建验证。失败则整个序列重试。

**改为**：每步基于当前棋盘状态动态决策。

```
在 step i 时:
  分析当前状态: 哪些格子已放置、哪些区域已有约束、哪些约束还可满足
  从可用选项中智能选择: 策略类型 + Queen + 参数
  放置核心约束格 + 阻挡格
  更新状态
  继续 step i+1
```

优势：
- 不会产生"不可行序列"——每一步都基于当前可行性
- 不需要盲目重试 300 次
- 对边界情况更鲁棒（空间不够时自然选择空间充裕的策略）

### 4.4 L1_Unique + L1_Direct 在设计模型中合并

求解器代码中保留两者的拆分（可视化粒度：确认 Queen vs 传播消除），但逆向生成的设计模型中视为一个原子操作。

这意味着在策略序列设计中，不单独构造 L1_Direct 步骤——它自动跟在 L1_Unique 之后。步数计算中 L1_Unique 和 L1_Direct 各占 1 步。

### 4.5 长期目标：全部格子通过策略步骤放置

最终消除随机填充阶段。棋盘上每个格子都由某个策略步骤放置——要么是核心约束格，要么是阻挡格。约束化填充作为过渡方案，在 Phase C 的约束满足阶段使用。

---

## 5. 阶段 1 实现计划

### 5.1 目标

用约束化填充消除"填充破坏约束"的问题，删除 Spoiler 角色 A。修复 4-连通性。

### 5.2 RegionConstraint 类型

```typescript
// 放入 src/game/types.ts
export type RegionConstraint =
  | { type: 'free' }
  | { type: 'axis'; axis: 'row' | 'col'; value: number }
  | { type: 'axes'; axis: 'row' | 'col'; values: number[] }
  | { type: 'block'; corner: Position };
```

### 5.3 约束映射

| 策略 | RegionConstraint |
|------|-----------------|
| L2_Lock1 | `{ type: 'axis', axis, value }` |
| L3_Projection | `{ type: 'axis', axis, value }` |
| L2_Lock2 | `{ type: 'axes', axis, values: [v1, v2] }` |
| L2_Lock3 | `{ type: 'axes', axis, values: [v1, v2, v3] }` |
| L3_Contradiction | `{ type: 'free' }` |
| L1_Unique | `{ type: 'free' }` |
| 无策略（自然填充 Queen） | `{ type: 'free' }` |

### 5.4 constrainedFill 逻辑

```
function constrainedFill(grid, constraints, n, rng):
  // 从所有已分配格子 BFS 扩展
  for each 4-邻接空格 (r,c):
    // 收集允许此格的邻居区域
    allowed = []
    for each 4-邻接区域 rid:
      c = constraints.get(rid) ?? { type: 'free' }
      if c.type == 'free': allowed.push(rid)
      elif c.type == 'axis' and 满足轴条件: allowed.push(rid)
      elif c.type == 'axes' and 满足轴集合: allowed.push(rid)
      elif c.type == 'block' and 在块内: allowed.push(rid)
    
    if allowed 非空: 随机选一个分配
    else: 找最近的 free 区域分配
  
  // 4-连通性: 分配前检查是否 4-邻接到目标区域已有格子
```

### 5.5 改动清单

| 文件 | 操作 | 内容 |
|------|------|------|
| `types.ts` | **新增** | `RegionConstraint` 类型 |
| `types.ts` | **删除** | `'L3_Capacity'` 从 `StrategyType` |
| `solver.ts` | **删除** | `stepL3Capacity` 函数 + L3 循环中的调用 |
| `reverseGenNew.ts` | **新增** | `constrainedFill()` |
| `reverseGenNew.ts` | **修改** | 6 个 `build*` 函数（不含 buildCapacity）→ 返回值携带 `constraints: Map<number, RegionConstraint>` |
| `reverseGenNew.ts` | **删除** | `buildCapacity()` 函数 |
| `reverseGenNew.ts` | **删除** | `getEliminationZone()` 函数（~55 行） |
| `reverseGenNew.ts` | **删除** | `addSpoilers()` 函数（~28 行） |
| `reverseGenNew.ts` | **修改** | 主循环：收集 constraints → 调用 `constrainedFill` 替代 `fillGrid` → 移除 spoiler 步骤 |
| `reverseGenNew.test.ts` | **新增/修改** | 约束化填充测试 + 删除 Capacity 相关测试 |
| `anchorGenerator.ts` | **删除** | Capacity 锚点构造器 |

### 5.6 不在阶段 1 改动的内容

- `maxConstraintQueens=6`（阶段 2 移除）
- `ratio` 估算（阶段 3 移除）
- `pickReverseStrategies` 预分配逻辑（阶段 2 改为动态）
- `usageCount` 负载均衡（阶段 2 改为动态选择）

---

## 6. 修改原则

1. **核心逻辑与 UI 分离**：所有改动在 `reverseGenNew.ts`、`solver.ts`、`types.ts` 内
2. **渐进替换**：阶段 1 完成后独立验证，再进入阶段 2
3. **接口兼容**：`generateReverseLevel(params) → GenerationResult` 签名不变
4. **测试驱动**：每阶段修改对应测试
5. **确定性**：所有随机通过 `rng` 参数控制
6. **文档诚实**：不包含对话未讨论的技术细节
