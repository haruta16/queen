// ============================================================
// Queen 消元解谜 — 核心类型定义
// ============================================================

/** 棋盘坐标 */
export type Position = { row: number; col: number };

/** 单格状态 */
export type CellState = {
  regionId: number;
  isQueen: boolean;
  isX: boolean;
  isWrong: boolean;
};

/** 颜色区域 — 共享一个 Queen 的连通格子集合 */
export type Region = {
  id: number;
  cells: Position[];
};

/** 9 种策略类型 */
export type StrategyType =
  // L1: 唯一候选确认 → Queen + 投影传播
  | 'L1_RC'                   // ① 行列唯一
  | 'L1_Color'                // ② 颜色唯一
  // L2: 锁定（鸽巢原理，不限 k）
  | 'L2_RC'                   // ③ 锁定行列：k个颜色的候选全在k行/列 → 排除行/列中其他候选
  | 'L2_Color'                // ④ 锁定颜色：k行/列的候选全是k个颜色 → 排除颜色中其他候选
  // L3: 投影交集 & 单步反推
  | 'L3_Projection_Color'     // ⑤ 颜色投影交集
  | 'L3_Projection_RC'        // ⑥ 行列投影交集
  | 'L3_Contra_RC'            // ⑦ 单步反推-行列
  | 'L3_Contra_Color'         // ⑧ 单步反推-颜色
  // L4: 多步反推
  | 'L4_Contra';              // ⑨ 反推2

/** 约束单位类型 */
export type UnitKind = 'row' | 'col' | 'region';

/** 约束单位引用 — 用于推理可视化 */
export type UnitRef = {
  kind: UnitKind;
  index: number;
};

export type SolverTraceMark = {
  pos: Position;
  mark: 'assumption' | 'temp-queen' | 'temp-x';
  rule?: string;
  ruleZh?: string;
  actionZh?: string;
};

export type SolverContradiction = {
  type: string;
  typeZh?: string;
  description: string;
  unit?: UnitRef;
  sourceUnits?: UnitRef[];
  targetUnits?: UnitRef[];
  cells?: Position[];
  candidateCells?: Position[];
};

export type SolverBranch = {
  assumption?: Position;
  status: 'contradiction' | 'survives';
  statusZh?: string;
  propagationDepth?: number;
  derivedActionCount?: number;
  contradiction?: SolverContradiction | null;
  trace?: SolverTraceMark[];
};

/** 求解器一个批次的推理元数据 — 用于前端渲染推理可视化 */
export type SolverBatchReason = {
  unit?: UnitRef;
  sourceUnit?: UnitRef;
  sourceUnits?: UnitRef[];
  targetUnit?: UnitRef;
  targetUnits?: UnitRef[];
  sourceCandidates?: Position[];
  remainingCandidates?: Position[];
  excludedCells?: Position[];
  assumptionCell?: Position;
  assumptionCells?: Position[];
  rejectedAssumptions?: Position[];
  commonExcludedCells?: Position[];
  commonConfirmedCells?: Position[];
  contradictionType?: string;
  contradiction?: SolverContradiction;
  groupSize?: number;
  branchCount?: number;
  survivingBranchCount?: number;
  contradictoryBranchCount?: number;
  propagationDepth?: number;
  derivedActionCount?: number;
  trace?: SolverTraceMark[];
  branches?: SolverBranch[];
  explanation?: string;
};

/** 求解器的一个批次 — 单次策略执行的产出 */
export type SolverBatch = {
  index: number;
  strategy: StrategyType;
  rule?: string;
  ruleZh?: string;
  difficulty?: string;
  difficultyZh?: string;
  eliminations: Position[];
  queenConfirmed: Position[];
  description: string;
  reason?: SolverBatchReason;
};

/** 求解器完整输出 */
export type SolverResult = {
  complete: boolean;
  batches: SolverBatch[];
  totalSteps: number;
  strategyTypesUsed: StrategyType[];
};

/** 可序列化的关卡数据 */
export type Level = {
  id: string;
  n: number;
  regions: Region[];
  paletteRgb?: number[][];
  solution: Position[];
  seed: number;
  targetSteps: number;
  actualSteps: number;
  strategySequence: StrategyType[];
  solverResult: SolverResult;
  source?: 'generated' | 'imported-json' | 'imported-image';
  validation?: {
    uniqueSolution?: boolean;
    solutionCount?: number;
    allRegionsConnected?: boolean;
  };
};

/** 生成器参数 */
export type GeneratorParams = {
  n: number;
  targetSteps: number;
  seed?: number;
  maxAttempts?: number;
  allowApproximate?: boolean;
};

/** 生成器搜索结论 */
export type GenerationStatus = 'exact' | 'approximate' | 'failed';

/** 生成器诊断信息，展示到 UI */
export type GenerationDiagnostics = {
  status: GenerationStatus;
  attempts: number;
  maxAttempts: number;
  elapsedMs: number;
  seed: number;
  targetSteps: number;
  bestActualSteps: number | null;
  bestDiff: number | null;
  selectedAttempt: number | null;
  selectedAttemptSeed: number | null;
  completeCandidates: number;
  incompleteCandidates: number;
  exactCandidates: number;
  allowApproximate: boolean;
};

/** 生成器完整结果 */
export type GenerationResult = {
  status: GenerationStatus;
  level: Level | null;
  diagnostics: GenerationDiagnostics;
};

/** 玩家棋盘状态 */
export type BoardState = {
  n: number;
  cells: CellState[][];
};

/** 种子化伪随机数生成器函数类型 */
export type RNG = () => number;

/** 操作历史条目，用于撤销/重做 */
export type OpHistoryEntry = {
  pos: Position;
  wasX: boolean;
};
