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
  isWrong: boolean;
};

/** Color region — a connected set of cells sharing one Queen */
export type Region = {
  id: number;
  cells: Position[];
};

/** 6 concrete strategy types. */
export type StrategyType =
  | 'L1'
  | 'L2_Lock1'
  | 'L2_Lock2'
  | 'L2_Lock3'
  | 'L3_Projection'
  | 'L3_Contradiction';

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
};

/** Serializable level data */
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

/** Generator parameters */
export type GeneratorParams = {
  n: number;
  targetSteps: number;
  seed?: number;
  maxAttempts?: number;
  allowApproximate?: boolean;
};

/** Generator search outcome */
export type GenerationStatus = 'exact' | 'approximate' | 'failed';

/** Generator diagnostics surfaced to UI */
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

/** Full generator result */
export type GenerationResult = {
  status: GenerationStatus;
  level: Level | null;
  diagnostics: GenerationDiagnostics;
};

/** Player board state */
export type BoardState = {
  n: number;
  cells: CellState[][];
};

/** Seeded PRNG function type */
export type RNG = () => number;

/** Operation history entry for undo/redo */
export type OpHistoryEntry = {
  pos: Position;
  wasX: boolean;
};
