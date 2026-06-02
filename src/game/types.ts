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

/** 6 种具体策略类型 */
export type StrategyType =
  | 'L1'
  | 'L2_Lock1'
  | 'L2_Lock2'
  | 'L2_Lock3'
  | 'L3_Projection'
  | 'L3_Contradiction';

/** 求解器的一个批次 — 单次策略执行的产出 */
export type SolverBatch = {
  index: number;
  strategy: StrategyType;
  eliminations: Position[];
  queenConfirmed: Position[];
  description: string;
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
  solution: Position[];
  seed: number;
  targetSteps: number;
  actualSteps: number;
  strategySequence: StrategyType[];
  solverResult: SolverResult;
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
