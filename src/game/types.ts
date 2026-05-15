// ============================================================
// Core types for Queen Elimination Puzzle
// ============================================================

/** Board coordinate */
export type Position = { row: number; col: number };

/** Single cell state */
export type CellState = {
  regionId: number;
  isQueen: boolean;
  isX: boolean;
};

/** Color region — a connected set of cells sharing one Queen */
export type Region = {
  id: number;
  cells: Position[];
};

/** 7 concrete strategy types */
export type StrategyType =
  | 'L1_Direct'
  | 'L1_Unique'
  | 'L2_Lock1'
  | 'L2_Lock2'
  | 'L2_Lock3'
  | 'L3_Projection'
  | 'L3_Capacity';

/** One solver batch — a single strategy execution step */
export type SolverBatch = {
  index: number;
  strategy: StrategyType;
  eliminations: Position[];
  queenConfirmed: Position[];
  description: string;
};

/** Complete solver output */
export type SolverResult = {
  complete: boolean;
  batches: SolverBatch[];
  totalSteps: number;
  strategyTypesUsed: StrategyType[];
  highestLevel: number;
};

/** Serializable level data */
export type Level = {
  id: string;
  n: number;
  regions: Region[];
  seed: number;
  targetSteps: number;
  actualSteps: number;
  strategySequence: StrategyType[];
  solverResult: SolverResult;
};

/** Generator parameters */
export type GeneratorParams = {
  n: number;
  targetSteps: number;
  seed?: number;
};

/** Player board state */
export type BoardState = {
  n: number;
  cells: CellState[][];
};

/** Seeded PRNG function type */
export type RNG = () => number;

/** Complexity label exposed to users */
export type ComplexityLabel = '简单' | '中等' | '困难';

/** Operation history entry for undo/redo */
export type OpHistoryEntry = {
  pos: Position;
  wasX: boolean;
};
