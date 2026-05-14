# Queen 解谜游戏原型

> 一个关卡制 Queen 消元解谜游戏。通过标记不可能格（X）缩小候选范围，逐层消元直到确认所有 Queen。

## 快速开始

```bash
npm install
npm run dev      # 启动开发服务器
npm test         # 运行测试
npm run build    # 构建
```

## 玩法

Queen 是一个逻辑解谜游戏。n×n 棋盘上，每行、每列、每个颜色区域恰好放置 1 个 Queen，且 Queen 之间不能相邻（8 方向）。

通过标记不可能格（X）逐步缩小候选范围，当某行/列/区域只剩唯一候选时，即可确认 Queen。

求解器实现了从 Level 1（约束传播）到 Level 3（相邻投影与容量溢出）的 7 种策略类型。

## 文档导航

| 文档 | 用途 |
|---|---|
| `CLAUDE.md` | Claude Code 专用执行入口 |
| `AGENTS.md` | 通用 AI Agent 项目约束 |
| `Queen解谜游戏原型设计.md` | 玩法设计真相来源 |
| `LinkedIn-Queens-solving-strategies.md` | 策略体系详细分析 |
| `AI_DEVELOPMENT_FRAMEWORK.md` | AI 开发框架与护栏 |
| `AI_IMPLEMENTATION_PLAN.md` | 分 Phase 实现计划 |
| `AI_TASK_BACKLOG.md` | 具体任务 backlog |
| `ACCEPTANCE_CRITERIA.md` | 验收标准 |

## 技术栈

- Vite + React + TypeScript
- Vitest
- CSS/DOM 渲染

## 项目结构

```text
src/
  game/
    types.ts        # 所有类型定义（含 SolverBatch、SolverResult）
    rules.ts        # 纯规则函数
    solver.ts       # 求解器（7 种策略类型，Level 1→2→3 循环）
    generator.ts    # 关卡生成器（n + targetSteps 二分搜索控制）
    random.ts       # 种子化 PRNG（mulberry32）
    store.ts        # zustand store
    __tests__/      # 测试文件
  ui/
    Board.tsx       # 棋盘组件
    Cell.tsx        # 单元格组件
    Hud.tsx         # 顶部信息栏
    Toolbar.tsx     # 底部工具栏
    SolverPanel.tsx # 求解器面板（步骤列表 + 播放控制）
    GeneratorPanel.tsx # 生成器面板
    useInput.ts     # 输入处理 hook
  App.tsx
  main.tsx
```

## MVP 范围

- 关卡生成器：n=5-10，targetSteps 控制关卡推理复杂度
- 求解器：全部 7 种策略类型，完整 SolverBatch[] 序列输出
- 可交互棋盘：标记 X、确认 Queen、撤销/重做
- 求解器可视化面板：逐步骤播放
- 生成器面板：n + 复杂度选择
- 几何动感视觉表现 + 交互动效
- 桌面端 + 移动端适配

## License

MIT
