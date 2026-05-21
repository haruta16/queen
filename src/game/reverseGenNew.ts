/**
 * Reverse dependency generator.
 *
 * The builder starts from fixed Queen positions, creates a reverse step plan,
 * then walks from the last planned step to the first. Each step consumes at
 * least one dependency constraint when available, places a small connected
 * region fragment that matches a reverse strategy, and emits fresh spoiler
 * constraints for earlier steps to consume.
 */

import {
  GenerationDiagnostics,
  GenerationResult,
  GenerationStatus,
  GenerationTrace,
  GenerationTraceFrame,
  GeneratorParams,
  Level,
  Position,
  Region,
  RegionConstraint,
  StrategyType,
  BoardState,
} from './types';
import {
  createEmptyBoard,
  getCandidatesInCol,
  getCandidatesInRegion,
  getCandidatesInRow,
  getRegionIds,
  getAdjacentPositions,
} from './rules';
import { applyBatchesUpTo, solve } from './solver';
import { assembleLevel, generateQueenPositions } from './generatorCore';
import { createRNG, randInt, shuffle } from './random';
import { isConnected, posKey } from './regionUtils';

const DIRS_4 = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

const REVERSE_STRATEGIES: StrategyType[] = [
  'L2_Lock1',
  'L2_Lock2',
  'L2_Lock3',
  'L3_Projection',
  'L3_Contradiction',
];

type ReverseConstraint = {
  pos: Position;
  sourceStep: number;
  kind: 'mustNotBeRegion' | 'preferRegion';
  regionId: number;
};

type StepPlan = {
  step: number;
  dependencies: number[];
  cellBudget: number;
};

type BuildState = {
  n: number;
  queens: Position[];
  grid: number[][];
  placedByStep: number[][];
  constraints: ReverseConstraint[];
  regionConstraints: Map<number, RegionConstraint>;
  validatedStrategyCounts: Map<StrategyType, number>;
  stepLog: { step: number; strategy: StrategyType; queenIndices: number[]; placed: Position[] }[];
};

type BuildAttempt = {
  strategy: StrategyType;
  queenIndices: number[];
  placed: Position[];
  skeletonCells: Position[];
  expectedEliminations: Position[];
  protectedCandidates: Position[];
  constraints: ReverseConstraint[];
} | null;

type StepVerification = {
  strategy: StrategyType;
  skeletonCells: Position[];
  expectedEliminations: Position[];
  expectedConstraints: ReverseConstraint[];
  protectedCandidates: Position[];
  protectedConstraints: ReverseConstraint[];
};

type TraceRecorder = {
  trace: GenerationTrace;
  push: (frame: Omit<GenerationTraceFrame, 'index'>) => void;
};

function inBounds(pos: Position, n: number): boolean {
  return pos.row >= 0 && pos.row < n && pos.col >= 0 && pos.col < n;
}

function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function uniquePositions(positions: Position[]): Position[] {
  const seen = new Set<string>();
  const result: Position[] = [];
  for (const pos of positions) {
    const key = posKey(pos);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...pos });
  }
  return result;
}

function positionSet(positions: Position[]): Set<string> {
  return new Set(positions.map(posKey));
}

function cloneGrid(grid: number[][]): number[][] {
  return grid.map(row => [...row]);
}

function makeTraceRecorder(n: number, seed: number, targetSteps: number, attempt: number, queens: Position[]): TraceRecorder {
  const trace: GenerationTrace = {
    n,
    seed,
    targetSteps,
    attempt,
    queenPositions: queens.map(pos => ({ ...pos })),
    frames: [],
  };
  return {
    trace,
    push(frame) {
      if (trace.frames.length >= 260) return;
      trace.frames.push({
        ...frame,
        index: trace.frames.length,
        grid: cloneGrid(frame.grid),
        placed: frame.placed.map(pos => ({ ...pos })),
        skeleton: frame.skeleton.map(pos => ({ ...pos })),
        expected: frame.expected.map(pos => ({ ...pos })),
        protected: frame.protected.map(pos => ({ ...pos })),
      });
    },
  };
}

function makeDiagnostics(
  status: GenerationStatus,
  args: {
    attempts: number;
    maxAttempts: number;
    startedAt: number;
    seed: number;
    targetSteps: number;
    bestLevel: Level | null;
    bestAttempt: number | null;
    bestAttemptSeed: number | null;
    completeCandidates: number;
    exactCandidates: number;
    allowApproximate: boolean;
  },
): GenerationDiagnostics {
  return {
    status,
    attempts: args.attempts,
    maxAttempts: args.maxAttempts,
    elapsedMs: Date.now() - args.startedAt,
    seed: args.seed,
    targetSteps: args.targetSteps,
    bestActualSteps: args.bestLevel?.actualSteps ?? null,
    bestDiff: args.bestLevel ? args.bestLevel.actualSteps - args.targetSteps : null,
    selectedAttempt: args.bestAttempt,
    selectedAttemptSeed: args.bestAttemptSeed,
    completeCandidates: args.completeCandidates,
    incompleteCandidates: args.attempts - args.completeCandidates,
    exactCandidates: args.exactCandidates,
    allowApproximate: args.allowApproximate,
    anchorStrategy: 'reverse-dependency',
    anchorQueenIndices: null,
    anchorCount: null,
  };
}

function attemptSeed(base: number, attempt: number, targetSteps: number): number {
  return base + attempt * 7919 + targetSteps * 101;
}

function generateDependencyTable(stepCount: number, rng: () => number): StepPlan[] {
  const plans: StepPlan[] = [];
  for (let step = 1; step <= stepCount; step++) {
    const dependencies: number[] = [];
    if (step < stepCount) {
      dependencies.push(step + 1);
      const maxLookahead = Math.min(stepCount, step + 1 + randInt(rng, 0, 3));
      for (let dep = step + 2; dep <= maxLookahead; dep++) {
        if (rng() < 0.45) dependencies.push(dep);
      }
    }
    plans.push({
      step,
      dependencies,
      cellBudget: randInt(rng, 1, 3),
    });
  }
  return plans;
}

function initState(n: number, queens: Position[]): BuildState {
  const grid = Array.from({ length: n }, () => Array(n).fill(-1));
  const placedByStep = Array.from({ length: n }, () => Array(n).fill(0));
  for (let rid = 0; rid < queens.length; rid++) {
    const q = queens[rid];
    grid[q.row][q.col] = rid;
    placedByStep[q.row][q.col] = Number.MAX_SAFE_INTEGER;
  }
  return {
    n,
    queens,
    grid,
    placedByStep,
    constraints: [],
    regionConstraints: new Map(),
    validatedStrategyCounts: new Map(),
    stepLog: [],
  };
}

function cloneState(state: BuildState): BuildState {
  return {
    n: state.n,
    queens: state.queens,
    grid: state.grid.map(row => [...row]),
    placedByStep: state.placedByStep.map(row => [...row]),
    constraints: state.constraints.map(c => ({ ...c, pos: { ...c.pos } })),
    regionConstraints: new Map(state.regionConstraints),
    validatedStrategyCounts: new Map(state.validatedStrategyCounts),
    stepLog: state.stepLog.map(s => ({
      step: s.step,
      strategy: s.strategy,
      queenIndices: [...s.queenIndices],
      placed: s.placed.map(p => ({ ...p })),
    })),
  };
}

function satisfiesRegionConstraint(state: BuildState, pos: Position, rid: number): boolean {
  const constraint = state.regionConstraints.get(rid);
  if (!constraint || constraint.type === 'free') return true;
  if (constraint.type === 'axis') {
    return constraint.axis === 'row' ? pos.row === constraint.value : pos.col === constraint.value;
  }
  if (constraint.type === 'axes') {
    const value = constraint.axis === 'row' ? pos.row : pos.col;
    return constraint.values.includes(value);
  }
  if (constraint.type === 'block') {
    return pos.row >= constraint.corner.row &&
      pos.row <= constraint.corner.row + 1 &&
      pos.col >= constraint.corner.col &&
      pos.col <= constraint.corner.col + 1;
  }
  return true;
}

function mergeRegionConstraint(state: BuildState, rid: number, next: RegionConstraint): boolean {
  const current = state.regionConstraints.get(rid);
  if (!current || current.type === 'free') {
    state.regionConstraints.set(rid, next);
    return true;
  }
  if (next.type === 'free') return true;

  if (current.type === 'axis' && next.type === 'axis') {
    if (current.axis === next.axis && current.value === next.value) return true;
    return false;
  }
  if (current.type === 'axes' && next.type === 'axes' && current.axis === next.axis) {
    const values = current.values.filter(v => next.values.includes(v));
    if (values.length === 0) return false;
    state.regionConstraints.set(rid, values.length === 1
      ? { type: 'axis', axis: current.axis, value: values[0] }
      : { type: 'axes', axis: current.axis, values });
    return true;
  }
  if (current.type === 'axis' && next.type === 'axes' && current.axis === next.axis) {
    return next.values.includes(current.value);
  }
  if (current.type === 'axes' && next.type === 'axis' && current.axis === next.axis) {
    if (!current.values.includes(next.value)) return false;
    state.regionConstraints.set(rid, next);
    return true;
  }

  return false;
}

function hasRegionNeighbor(state: BuildState, pos: Position, rid: number): boolean {
  if (samePos(pos, state.queens[rid])) return true;
  return DIRS_4.some(({ dr, dc }) => {
    const next = { row: pos.row + dr, col: pos.col + dc };
    return inBounds(next, state.n) && state.grid[next.row][next.col] === rid;
  });
}

function isQueenCell(state: BuildState, pos: Position): boolean {
  return state.queens.some(q => samePos(q, pos));
}

function canClaim(state: BuildState, pos: Position, rid: number): boolean {
  if (!inBounds(pos, state.n)) return false;
  const current = state.grid[pos.row][pos.col];
  if (current !== -1 && current !== rid) return false;
  if (current === -1 && isQueenCell(state, pos)) return false;
  if (!satisfiesRegionConstraint(state, pos, rid)) return false;
  return hasRegionNeighbor(state, pos, rid);
}

function claim(state: BuildState, pos: Position, rid: number, step: number, placed: Position[]): boolean {
  if (!canClaim(state, pos, rid)) return false;
  if (state.grid[pos.row][pos.col] === -1) {
    state.grid[pos.row][pos.col] = rid;
    state.placedByStep[pos.row][pos.col] = step;
    placed.push({ ...pos });
  }
  return true;
}

function occupiedByLaterStep(state: BuildState, pos: Position, currentStep: number, allowedRegions: Set<number>): boolean {
  const rid = state.grid[pos.row][pos.col];
  if (rid < 0 || allowedRegions.has(rid)) return false;
  return state.placedByStep[pos.row][pos.col] > currentStep;
}

function axisCells(n: number, axis: 'row' | 'col', value: number): Position[] {
  return Array.from({ length: n }, (_, i) => axis === 'row'
    ? { row: value, col: i }
    : { row: i, col: value });
}

function addAxisSpoilers(
  state: BuildState,
  step: number,
  axis: 'row' | 'col',
  value: number,
  protectedRegions: number[],
): ReverseConstraint[] | null {
  const protectedSet = new Set(protectedRegions);
  const constraints: ReverseConstraint[] = [];
  for (const pos of axisCells(state.n, axis, value)) {
    const rid = state.grid[pos.row][pos.col];
    if (rid === -1) {
      constraints.push({
        pos,
        sourceStep: step,
        kind: 'mustNotBeRegion',
        regionId: protectedRegions[0],
      });
      continue;
    }
    if (occupiedByLaterStep(state, pos, step, protectedSet)) return null;
  }
  return constraints;
}

function lineValue(pos: Position, axis: 'row' | 'col'): number {
  return axis === 'row' ? pos.row : pos.col;
}

function pickExpectedConstraints(constraints: ReverseConstraint[], rng: () => number, maxCount = 2): ReverseConstraint[] {
  return shuffle(constraints, rng).slice(0, Math.max(1, Math.min(maxCount, constraints.length)));
}

function buildLock1(state: BuildState, step: number, qi: number, budget: number, rng: () => number): BuildAttempt {
  const draft = cloneState(state);
  const q = draft.queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
  const value = lineValue(q, axis);
  if (!mergeRegionConstraint(draft, qi, { type: 'axis', axis, value })) return null;
  const placed: Position[] = [];
  const cells = shuffle(axisCells(draft.n, axis, value), rng)
    .sort((a, b) => Math.abs(a.row - q.row) + Math.abs(a.col - q.col) - Math.abs(b.row - q.row) - Math.abs(b.col - q.col));

  for (const pos of cells) {
    if (placed.length >= budget + 1) break;
    claim(draft, pos, qi, step, placed);
  }
  if (placed.length < Math.min(2, budget + 1)) return null;
  const constraints = addAxisSpoilers(draft, step, axis, value, [qi]);
  if (!constraints || constraints.length === 0) return null;
  const expected = pickExpectedConstraints(constraints, rng);
  Object.assign(state, draft);
  return {
    strategy: 'L2_Lock1',
    queenIndices: [qi],
    placed,
    skeletonCells: uniquePositions([draft.queens[qi], ...placed]),
    expectedEliminations: uniquePositions(expected.map(c => c.pos)),
    protectedCandidates: [],
    constraints,
  };
}

function buildLockN(
  state: BuildState,
  step: number,
  qis: number[],
  strategy: 'L2_Lock2' | 'L2_Lock3',
  budget: number,
  rng: () => number,
): BuildAttempt {
  const draft = cloneState(state);
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
  const values = [...new Set(qis.map(qi => lineValue(draft.queens[qi], axis)))];
  if (values.length !== qis.length) return null;
  for (const qi of qis) {
    if (!mergeRegionConstraint(draft, qi, { type: 'axes', axis, values })) return null;
  }

  const placed: Position[] = [];
  for (const qi of qis) {
    const q = draft.queens[qi];
    const options: Position[] = [];
    for (const value of values) options.push(...axisCells(draft.n, axis, value));
    const sorted = shuffle(options, rng)
      .sort((a, b) => Math.abs(a.row - q.row) + Math.abs(a.col - q.col) - Math.abs(b.row - q.row) - Math.abs(b.col - q.col));
    let local = 0;
    for (const pos of sorted) {
      if (local >= Math.max(1, Math.ceil(budget / qis.length))) break;
      if (claim(draft, pos, qi, step, placed)) local++;
    }
    if (local === 0) return null;
  }

  const constraints: ReverseConstraint[] = [];
  for (const value of values) {
    const part = addAxisSpoilers(draft, step, axis, value, qis);
    if (!part) return null;
    constraints.push(...part);
  }
  if (constraints.length === 0) return null;
  const expected = pickExpectedConstraints(constraints, rng);
  Object.assign(state, draft);
  return {
    strategy,
    queenIndices: qis,
    placed,
    skeletonCells: uniquePositions([...qis.map(qi => draft.queens[qi]), ...placed]),
    expectedEliminations: uniquePositions(expected.map(c => c.pos)),
    protectedCandidates: [],
    constraints,
  };
}

function buildProjection(state: BuildState, step: number, qi: number, budget: number, rng: () => number): BuildAttempt {
  const draft = cloneState(state);
  const q = draft.queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
  if (!mergeRegionConstraint(draft, qi, { type: 'axis', axis, value: lineValue(q, axis) })) return null;
  const placed: Position[] = [];
  const around = shuffle([-1, 1, -2, 2].map(delta => axis === 'row'
    ? { row: q.row, col: q.col + delta }
    : { row: q.row + delta, col: q.col }), rng);

  for (const pos of around) {
    if (placed.length >= budget) break;
    claim(draft, pos, qi, step, placed);
  }
  if (placed.length === 0) return null;

  const constraints: ReverseConstraint[] = [];
  for (const p of [q, ...placed]) {
    for (const { dr, dc } of DIRS_4) {
      const pos = { row: p.row + dr, col: p.col + dc };
      if (inBounds(pos, draft.n) && draft.grid[pos.row][pos.col] === -1) {
        constraints.push({ pos, sourceStep: step, kind: 'mustNotBeRegion', regionId: qi });
      }
    }
  }
  const axisCons = addAxisSpoilers(draft, step, axis, lineValue(q, axis), [qi]);
  if (!axisCons) return null;
  constraints.push(...axisCons.slice(0, Math.max(1, budget)));
  const expected = pickExpectedConstraints(constraints, rng);
  Object.assign(state, draft);
  return {
    strategy: 'L3_Projection',
    queenIndices: [qi],
    placed,
    skeletonCells: uniquePositions([q, ...placed]),
    expectedEliminations: uniquePositions(expected.map(c => c.pos)),
    protectedCandidates: [],
    constraints,
  };
}

function buildContradiction(state: BuildState, step: number, qi: number, _budget: number, rng: () => number): BuildAttempt {
  const draft = cloneState(state);
  const q = draft.queens[qi];
  const placed: Position[] = [];
  const dirs = shuffle(DIRS_4, rng);
  for (const { dr, dc } of dirs) {
    const pos = { row: q.row + dr, col: q.col + dc };
    if (claim(draft, pos, qi, step, placed)) break;
  }
  if (placed.length === 0) return null;

  const constraints: ReverseConstraint[] = [];
  for (const { dr, dc } of DIRS_4) {
    const pos = { row: placed[0].row + dr, col: placed[0].col + dc };
    if (inBounds(pos, draft.n) && draft.grid[pos.row][pos.col] === -1) {
      constraints.push({ pos, sourceStep: step, kind: 'mustNotBeRegion', regionId: qi });
    }
  }
  if (constraints.length === 0) return null;
  const expected = pickExpectedConstraints(constraints, rng, 1);
  Object.assign(state, draft);
  return {
    strategy: 'L3_Contradiction',
    queenIndices: [qi],
    placed,
    skeletonCells: uniquePositions([q, ...placed]),
    expectedEliminations: uniquePositions(expected.map(c => c.pos)),
    protectedCandidates: [],
    constraints,
  };
}

function consumeDependencyConstraint(
  state: BuildState,
  step: number,
  dependencies: number[],
  rng: () => number,
): Position[] {
  const depSet = new Set(dependencies);
  const options = shuffle(state.constraints.filter(c => depSet.has(c.sourceStep)), rng);
  const placed: Position[] = [];

  for (const c of options) {
    if (state.grid[c.pos.row][c.pos.col] !== -1) continue;
    const candidateRegions = shuffle(Array.from({ length: state.n }, (_, i) => i), rng)
      .filter(rid => c.kind === 'preferRegion' ? rid === c.regionId : rid !== c.regionId)
      .filter(rid => hasRegionNeighbor(state, c.pos, rid));
    if (candidateRegions.length === 0) continue;
    claim(state, c.pos, candidateRegions[0], step, placed);
    break;
  }

  return placed;
}

function createProbeBoard(state: BuildState, verification: StepVerification): BoardState {
  const expectedRegionOverride = new Map(verification.expectedConstraints.map(c => [
    posKey(c.pos),
    c.kind === 'preferRegion' ? c.regionId : (c.regionId + 1) % state.n,
  ]));
  const protectedRegionOverride = new Map(verification.protectedConstraints.map(c => [
    posKey(c.pos),
    c.kind === 'preferRegion' ? c.regionId : (c.regionId + 1) % state.n,
  ]));
  const open = positionSet([
    ...verification.skeletonCells,
    ...verification.expectedEliminations,
    ...verification.protectedCandidates,
  ]);
  const expected = positionSet(verification.expectedEliminations);
  const protectedSet = positionSet(verification.protectedCandidates);

  return {
    n: state.n,
    cells: Array.from({ length: state.n }, (_, row) =>
      Array.from({ length: state.n }, (_, col) => {
        const key = `${row},${col}`;
        const rid = state.grid[row][col];
        const overrideRid = expectedRegionOverride.get(key) ?? protectedRegionOverride.get(key);
        return {
          regionId: overrideRid ?? (rid >= 0 ? rid : 0),
          isQueen: false,
          isX: !open.has(key),
          isWrong: false,
          __expected: expected.has(key),
          __protected: protectedSet.has(key),
        };
      }).map(({ __expected: _e, __protected: _p, ...cell }) => cell)
    ),
  };
}

function localLock1Eliminations(board: BoardState): Position[] {
  const n = board.n;
  const regionIds = getRegionIds(board);

  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length < 2) continue;
    const rows = new Set(cands.map(c => c.row));
    if (rows.size === 1) {
      const row = cands[0].row;
      return Array.from({ length: n }, (_, col) => ({ row, col }))
        .filter(pos => board.cells[pos.row][pos.col].regionId !== rid && !board.cells[pos.row][pos.col].isX);
    }
    const cols = new Set(cands.map(c => c.col));
    if (cols.size === 1) {
      const col = cands[0].col;
      return Array.from({ length: n }, (_, row) => ({ row, col }))
        .filter(pos => board.cells[pos.row][pos.col].regionId !== rid && !board.cells[pos.row][pos.col].isX);
    }
  }

  return [];
}

function localLock2Eliminations(board: BoardState): Position[] {
  const n = board.n;
  const regionIds = getRegionIds(board);

  const mkRowsToCols = (r1: number, r2: number): Position[] => {
    const cands1 = getCandidatesInRow(board, r1);
    const cands2 = getCandidatesInRow(board, r2);
    if (cands1.length === 0 || cands2.length === 0) return [];
    const cols = [...new Set([...cands1, ...cands2].map(c => c.col))];
    if (cols.length !== 2) return [];
    const elim: Position[] = [];
    for (let row = 0; row < n; row++) {
      if (row === r1 || row === r2) continue;
      for (const col of cols) {
        const cell = board.cells[row][col];
        if (!cell.isX && !cell.isQueen && !cell.isWrong) elim.push({ row, col });
      }
    }
    return elim;
  };

  const mkColsToRows = (c1: number, c2: number): Position[] => {
    const cands1 = getCandidatesInCol(board, c1);
    const cands2 = getCandidatesInCol(board, c2);
    if (cands1.length === 0 || cands2.length === 0) return [];
    const rows = [...new Set([...cands1, ...cands2].map(c => c.row))];
    if (rows.length !== 2) return [];
    const elim: Position[] = [];
    for (let col = 0; col < n; col++) {
      if (col === c1 || col === c2) continue;
      for (const row of rows) {
        const cell = board.cells[row][col];
        if (!cell.isX && !cell.isQueen && !cell.isWrong) elim.push({ row, col });
      }
    }
    return elim;
  };

  const mkRegionsToRows = (rid1: number, rid2: number): Position[] => {
    const cands1 = getCandidatesInRegion(board, rid1);
    const cands2 = getCandidatesInRegion(board, rid2);
    if (cands1.length === 0 || cands2.length === 0) return [];
    const rows = [...new Set([...cands1, ...cands2].map(c => c.row))];
    if (rows.length !== 2) return [];
    const elim: Position[] = [];
    for (const row of rows) {
      for (let col = 0; col < n; col++) {
        const cell = board.cells[row][col];
        if (cell.regionId !== rid1 && cell.regionId !== rid2 && !cell.isX && !cell.isQueen && !cell.isWrong) {
          elim.push({ row, col });
        }
      }
    }
    return elim;
  };

  const mkRegionsToCols = (rid1: number, rid2: number): Position[] => {
    const cands1 = getCandidatesInRegion(board, rid1);
    const cands2 = getCandidatesInRegion(board, rid2);
    if (cands1.length === 0 || cands2.length === 0) return [];
    const cols = [...new Set([...cands1, ...cands2].map(c => c.col))];
    if (cols.length !== 2) return [];
    const elim: Position[] = [];
    for (const col of cols) {
      for (let row = 0; row < n; row++) {
        const cell = board.cells[row][col];
        if (cell.regionId !== rid1 && cell.regionId !== rid2 && !cell.isX && !cell.isQueen && !cell.isWrong) {
          elim.push({ row, col });
        }
      }
    }
    return elim;
  };

  for (let r1 = 0; r1 < n; r1++) {
    for (let r2 = r1 + 1; r2 < n; r2++) {
      const elim = mkRowsToCols(r1, r2);
      if (elim.length > 0) return elim;
    }
  }
  for (let c1 = 0; c1 < n; c1++) {
    for (let c2 = c1 + 1; c2 < n; c2++) {
      const elim = mkColsToRows(c1, c2);
      if (elim.length > 0) return elim;
    }
  }
  for (let i = 0; i < regionIds.length; i++) {
    for (let j = i + 1; j < regionIds.length; j++) {
      const rowsElim = mkRegionsToRows(regionIds[i], regionIds[j]);
      if (rowsElim.length > 0) return rowsElim;
      const colsElim = mkRegionsToCols(regionIds[i], regionIds[j]);
      if (colsElim.length > 0) return colsElim;
    }
  }

  return [];
}

function localLock3Eliminations(board: BoardState): Position[] {
  const n = board.n;
  const values = Array.from({ length: n }, (_, i) => i);

  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      for (let k = j + 1; k < values.length; k++) {
        const [r1, r2, r3] = [values[i], values[j], values[k]];
        const cands1 = getCandidatesInRow(board, r1);
        const cands2 = getCandidatesInRow(board, r2);
        const cands3 = getCandidatesInRow(board, r3);
        if (cands1.length === 0 || cands2.length === 0 || cands3.length === 0) continue;
        const cols = [...new Set([...cands1, ...cands2, ...cands3].map(c => c.col))];
        if (cols.length !== 3) continue;
        const elim: Position[] = [];
        for (let row = 0; row < n; row++) {
          if (row === r1 || row === r2 || row === r3) continue;
          for (const col of cols) {
            const cell = board.cells[row][col];
            if (!cell.isX && !cell.isQueen && !cell.isWrong) elim.push({ row, col });
          }
        }
        if (elim.length > 0) return elim;
      }
    }
  }

  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      for (let k = j + 1; k < values.length; k++) {
        const [c1, c2, c3] = [values[i], values[j], values[k]];
        const cands1 = getCandidatesInCol(board, c1);
        const cands2 = getCandidatesInCol(board, c2);
        const cands3 = getCandidatesInCol(board, c3);
        if (cands1.length === 0 || cands2.length === 0 || cands3.length === 0) continue;
        const rows = [...new Set([...cands1, ...cands2, ...cands3].map(c => c.row))];
        if (rows.length !== 3) continue;
        const elim: Position[] = [];
        for (let col = 0; col < n; col++) {
          if (col === c1 || col === c2 || col === c3) continue;
          for (const row of rows) {
            const cell = board.cells[row][col];
            if (!cell.isX && !cell.isQueen && !cell.isWrong) elim.push({ row, col });
          }
        }
        if (elim.length > 0) return elim;
      }
    }
  }

  return [];
}

function localProjectionEliminations(board: BoardState): Position[] {
  const n = board.n;
  const units: Position[][] = [];
  for (let row = 0; row < n; row++) {
    const cands = getCandidatesInRow(board, row);
    if (cands.length >= 2) units.push(cands);
  }
  for (let col = 0; col < n; col++) {
    const cands = getCandidatesInCol(board, col);
    if (cands.length >= 2) units.push(cands);
  }
  for (const rid of getRegionIds(board)) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length >= 2) units.push(cands);
  }

  const projectionSet = (cand: Position): Set<string> => {
    const rid = board.cells[cand.row][cand.col].regionId;
    const keys = new Set<string>();
    for (let col = 0; col < n; col++) if (col !== cand.col) keys.add(`${cand.row},${col}`);
    for (let row = 0; row < n; row++) if (row !== cand.row) keys.add(`${row},${cand.col}`);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (board.cells[row][col].regionId === rid && !(row === cand.row && col === cand.col)) keys.add(`${row},${col}`);
      }
    }
    for (const adj of getAdjacentPositions(cand, n)) keys.add(posKey(adj));
    return keys;
  };

  for (const cands of units) {
    let intersection = projectionSet(cands[0]);
    for (let i = 1; i < cands.length; i++) {
      const next = projectionSet(cands[i]);
      intersection = new Set([...intersection].filter(key => next.has(key)));
    }
    const eliminations = [...intersection]
      .map(key => {
        const [row, col] = key.split(',').map(Number);
        return { row, col };
      })
      .filter(pos => !board.cells[pos.row][pos.col].isX);
    if (eliminations.length > 0) return eliminations;
  }

  return [];
}

function localStrategyEliminations(board: BoardState, strategy: StrategyType): Position[] {
  if (strategy === 'L2_Lock1') return localLock1Eliminations(board);
  if (strategy === 'L2_Lock2') return localLock2Eliminations(board);
  if (strategy === 'L2_Lock3') return localLock3Eliminations(board);
  if (strategy === 'L3_Projection') return localProjectionEliminations(board);
  if (strategy === 'L3_Contradiction') return localProjectionEliminations(board);
  return [];
}

function makePaddingConstraints(state: BuildState, verification: StepVerification): ReverseConstraint[] {
  const blocked = positionSet([
    ...verification.skeletonCells,
    ...verification.expectedEliminations,
    ...verification.protectedCandidates,
  ]);
  const expectedRows = new Set(verification.expectedEliminations.map(p => p.row));
  const expectedCols = new Set(verification.expectedEliminations.map(p => p.col));
  const padding: ReverseConstraint[] = [];

  const addPadding = (source: ReverseConstraint, preferSameCol: boolean): boolean => {
    const overrideRid = source.kind === 'preferRegion'
      ? source.regionId
      : (source.regionId + 1) % state.n;
    const candidates: Position[] = [];
    if (preferSameCol) {
      for (let row = 0; row < state.n; row++) candidates.push({ row, col: source.pos.col });
    } else {
      for (let row = 0; row < state.n; row++) {
        for (let col = 0; col < state.n; col++) candidates.push({ row, col });
      }
    }

    for (const pos of candidates) {
      const key = posKey(pos);
      if (blocked.has(key)) continue;
      if (expectedRows.has(pos.row) || expectedCols.has(pos.col)) continue;
      if (state.grid[pos.row][pos.col] >= 0 && state.grid[pos.row][pos.col] !== overrideRid) continue;
      padding.push({
        pos,
        sourceStep: source.sourceStep,
        kind: 'preferRegion',
        regionId: overrideRid,
      });
      blocked.add(key);
      return true;
    }
    return false;
  };

  for (const expected of verification.expectedConstraints) {
    addPadding(expected, true);
    addPadding(expected, false);
  }

  return padding;
}

function probeStepProducesIndependentBatch(state: BuildState, verification: StepVerification): boolean {
  if (verification.expectedEliminations.length === 0) return false;

  const padding = makePaddingConstraints(state, verification);
  const paddedVerification: StepVerification = {
    ...verification,
    protectedCandidates: uniquePositions([...verification.protectedCandidates, ...padding.map(p => p.pos)]),
    protectedConstraints: [...verification.protectedConstraints, ...padding],
  };

  const board = createProbeBoard(state, paddedVerification);
  const expectedKeys = positionSet(verification.expectedEliminations);
  const protectedKeys = positionSet(paddedVerification.protectedCandidates);
  const eliminated = positionSet(localStrategyEliminations(board, verification.strategy));
  if ([...protectedKeys].some(key => eliminated.has(key))) return false;
  return [...expectedKeys].every(key => eliminated.has(key));
}

function tryBuildPlannedStep(state: BuildState, plan: StepPlan, rng: () => number, recorder?: TraceRecorder): boolean {
  const before = cloneState(state);
  const consumed = plan.dependencies.length > 0
    ? consumeDependencyConstraint(state, plan.step, plan.dependencies, rng)
    : [];

  const strategies = shuffle([...REVERSE_STRATEGIES], rng);
  const queenPool = shuffle(Array.from({ length: state.n }, (_, i) => i), rng);
  for (const strategy of strategies) {
    const needed = strategy === 'L2_Lock3' ? 3 : strategy === 'L2_Lock2' ? 2 : 1;
    if (needed > state.n) continue;
    for (let offset = 0; offset < queenPool.length; offset++) {
      const qis = Array.from({ length: needed }, (_, i) => queenPool[(offset + i) % queenPool.length]);
      if (new Set(qis).size !== needed) continue;
      const attemptState = cloneState(state);
      const built = strategy === 'L2_Lock1'
        ? buildLock1(attemptState, plan.step, qis[0], plan.cellBudget, rng)
        : strategy === 'L2_Lock2'
          ? buildLockN(attemptState, plan.step, qis, 'L2_Lock2', plan.cellBudget + 1, rng)
          : strategy === 'L2_Lock3'
            ? buildLockN(attemptState, plan.step, qis, 'L2_Lock3', plan.cellBudget + 2, rng)
            : strategy === 'L3_Projection'
              ? buildProjection(attemptState, plan.step, qis[0], plan.cellBudget, rng)
              : buildContradiction(attemptState, plan.step, qis[0], plan.cellBudget, rng);
      if (!built) {
        recorder?.push({
          attempt: recorder.trace.attempt,
          step: plan.step,
          phase: 'reject',
          strategy,
          accepted: false,
          reason: 'builder could not place a valid connected reverse pattern',
          grid: attemptState.grid,
          placed: consumed,
          skeleton: [],
          expected: [],
          protected: consumed,
        });
        continue;
      }
      const verification: StepVerification = {
        strategy: built.strategy,
        skeletonCells: built.skeletonCells,
        expectedEliminations: built.expectedEliminations,
        expectedConstraints: built.constraints.filter(c => positionSet(built.expectedEliminations).has(posKey(c.pos))),
        protectedCandidates: uniquePositions([...built.protectedCandidates, ...consumed]),
        protectedConstraints: consumed.map(pos => ({
          pos,
          sourceStep: plan.step,
          kind: 'preferRegion',
          regionId: attemptState.grid[pos.row][pos.col],
        })).filter(c => c.regionId >= 0) as ReverseConstraint[],
      };
      recorder?.push({
        attempt: recorder.trace.attempt,
        step: plan.step,
        phase: 'try',
        strategy: built.strategy,
        accepted: false,
        reason: 'probing declared step unit',
        grid: attemptState.grid,
        placed: [...consumed, ...built.placed],
        skeleton: built.skeletonCells,
        expected: built.expectedEliminations,
        protected: verification.protectedCandidates,
      });
      if (!probeStepProducesIndependentBatch(attemptState, verification)) {
        recorder?.push({
          attempt: recorder.trace.attempt,
          step: plan.step,
          phase: 'reject',
          strategy: built.strategy,
          accepted: false,
          reason: 'local probe failed: expected eliminations were not produced safely',
          grid: attemptState.grid,
          placed: [...consumed, ...built.placed],
          skeleton: built.skeletonCells,
          expected: built.expectedEliminations,
          protected: verification.protectedCandidates,
        });
        continue;
      }

      Object.assign(state, attemptState);
      state.constraints.push(...built.constraints);
      state.validatedStrategyCounts.set(
        built.strategy,
        (state.validatedStrategyCounts.get(built.strategy) ?? 0) + 1,
      );
      state.stepLog.push({
        step: plan.step,
        strategy: built.strategy,
        queenIndices: built.queenIndices,
        placed: [...consumed, ...built.placed],
      });
      recorder?.push({
        attempt: recorder.trace.attempt,
        step: plan.step,
        phase: 'accept',
        strategy: built.strategy,
        accepted: true,
        reason: 'accepted: local strategy probe produced the declared eliminations',
        grid: state.grid,
        placed: [...consumed, ...built.placed],
        skeleton: built.skeletonCells,
        expected: built.expectedEliminations,
        protected: verification.protectedCandidates,
      });
      return true;
    }
  }

  Object.assign(state, before);
  return false;
}

function growFillEmptyCells(state: BuildState, step: number, rng: () => number): void {
  let progress = true;
  let guard = 0;
  while (progress) {
    if (guard++ > state.n * state.n) break;
    progress = false;
    const empty = shuffle(allEmptyCells(state), rng);
    for (const pos of empty) {
      const rids = shuffle(Array.from({ length: state.n }, (_, i) => i), rng)
        .filter(rid => hasRegionNeighbor(state, pos, rid));
      if (rids.length === 0) continue;
      const placed: Position[] = [];
      claim(state, pos, rids[0], step, placed);
      progress = true;
    }
  }

  // Last pass keeps the board serializable and connected. These cells are
  // intentionally not frozen strategy skeleton cells; solver validation decides
  // whether the resulting noise is acceptable.
  progress = true;
  guard = 0;
  while (allEmptyCells(state).length > 0 && progress && guard++ <= state.n * state.n) {
    progress = false;
    for (const pos of shuffle(allEmptyCells(state), rng)) {
      const rids = shuffle(Array.from({ length: state.n }, (_, i) => i), rng)
        .filter(rid => hasRegionNeighbor(state, pos, rid));
      if (rids.length === 0) continue;
      state.grid[pos.row][pos.col] = rids[0];
      state.placedByStep[pos.row][pos.col] = step;
      progress = true;
    }
  }
}

function allEmptyCells(state: BuildState): Position[] {
  const cells: Position[] = [];
  for (let r = 0; r < state.n; r++) {
    for (let c = 0; c < state.n; c++) {
      if (state.grid[r][c] === -1) cells.push({ row: r, col: c });
    }
  }
  return cells;
}

function gridToRegions(state: BuildState): Region[] | null {
  const regions = Array.from({ length: state.n }, (_, id): Region => ({ id, cells: [] }));
  for (let r = 0; r < state.n; r++) {
    for (let c = 0; c < state.n; c++) {
      const rid = state.grid[r][c];
      if (rid < 0 || rid >= state.n) return null;
      regions[rid].cells.push({ row: r, col: c });
    }
  }
  if (regions.some(region => region.cells.length === 0 || !isConnected(region.cells))) return null;
  return regions;
}

function regionsToGrid(n: number, regions: Region[]): number[][] {
  const grid = Array.from({ length: n }, () => Array(n).fill(-1));
  for (const region of regions) {
    for (const cell of region.cells) grid[cell.row][cell.col] = region.id;
  }
  return grid;
}

function cloneRegionsLocal(regions: Region[]): Region[] {
  return regions.map(region => ({
    id: region.id,
    cells: region.cells.map(cell => ({ ...cell })),
  }));
}

function findAdjacentRegionIds(n: number, grid: number[][], pos: Position, ownRid: number): number[] {
  const ids = new Set<number>();
  for (const { dr, dc } of DIRS_4) {
    const next = { row: pos.row + dr, col: pos.col + dc };
    if (!inBounds(next, n)) continue;
    const rid = grid[next.row][next.col];
    if (rid >= 0 && rid !== ownRid) ids.add(rid);
  }
  return [...ids];
}

function tryMoveCell(n: number, regions: Region[], pos: Position, fromRid: number, targetOrder: number[]): boolean {
  const source = regions[fromRid];
  if (source.cells.length <= 1) return false;
  const remaining = source.cells.filter(cell => !samePos(cell, pos));
  if (!isConnected(remaining)) return false;

  for (const toRid of targetOrder) {
    const target = regions[toRid];
    const nextTarget = [...target.cells, { ...pos }];
    if (!isConnected(nextTarget)) continue;
    source.cells = remaining;
    target.cells = nextTarget;
    return true;
  }
  return false;
}

function repairForSolverCompletion(
  n: number,
  regions: Region[],
  queens: Position[],
  rng: () => number,
  recorder?: TraceRecorder,
): Region[] | null {
  const repaired = cloneRegionsLocal(regions);
  const queenKeys = new Set(queens.map(posKey));

  for (let round = 0; round < n * n; round++) {
    const startBoard = createEmptyBoard(n, repaired);
    const result = solve(startBoard);
    if (result.complete) return repaired;

    const progressed = applyBatchesUpTo(startBoard, result.batches, result.totalSteps);
    const grid = regionsToGrid(n, repaired);
    let moved = false;

    for (const rid of shuffle(Array.from({ length: n }, (_, i) => i), rng)) {
      const queen = queens[rid];
      if (progressed.cells[queen.row][queen.col].isQueen) continue;

      const candidates = shuffle(repaired[rid].cells.filter(cell => {
        const key = posKey(cell);
        if (queenKeys.has(key)) return false;
        const boardCell = progressed.cells[cell.row][cell.col];
        return !boardCell.isX && !boardCell.isQueen && !boardCell.isWrong;
      }), rng);

      for (const cell of candidates) {
        const targets = shuffle(findAdjacentRegionIds(n, grid, cell, rid), rng);
        if (tryMoveCell(n, repaired, cell, rid, targets)) {
          recorder?.push({
            attempt: recorder.trace.attempt,
            step: null,
            phase: 'repair',
            strategy: null,
            accepted: true,
            reason: `moved r${cell.row}c${cell.col} out of unresolved region ${rid}`,
            grid: regionsToGrid(n, repaired),
            placed: [cell],
            skeleton: [],
            expected: [],
            protected: [queens[rid]],
          });
          moved = true;
          break;
        }
      }
      if (moved) break;
    }

    if (!moved) return null;
  }

  const finalResult = solve(createEmptyBoard(n, repaired));
  return finalResult.complete ? repaired : null;
}

function buildCandidate(
  n: number,
  targetSteps: number,
  seed: number,
  attempt: number,
): { regions: Region[]; queens: Position[]; planLength: number; stepLogLength: number; trace: GenerationTrace } | null {
  const rng = createRNG(attemptSeed(seed, attempt, targetSteps));
  let queens: Position[];
  try {
    queens = generateQueenPositions(n, rng);
  } catch {
    return null;
  }

  const state = initState(n, queens);
  const recorder = makeTraceRecorder(n, seed, targetSteps, attempt + 1, queens);
  recorder.push({
    attempt: attempt + 1,
    step: null,
    phase: 'init',
    strategy: null,
    accepted: true,
    reason: 'placed queen seeds; all other cells are unknown',
    grid: state.grid,
    placed: queens,
    skeleton: queens,
    expected: [],
    protected: queens,
  });
  const planLength = Math.max(2, Math.min(n * n - n, Math.round(targetSteps * (0.65 + rng() * 0.7))));
  const plans = generateDependencyTable(planLength, rng);

  for (let i = plans.length - 1; i >= 0; i--) {
    const ok = tryBuildPlannedStep(state, plans[i], rng, recorder);
    if (!ok && i === plans.length - 1) return null;
  }

  if (allEmptyCells(state).length > 0) {
    growFillEmptyCells(state, 0, rng);
    recorder.push({
      attempt: attempt + 1,
      step: null,
      phase: 'fill',
      strategy: null,
      accepted: true,
      reason: 'filled remaining unknown cells into adjacent regions',
      grid: state.grid,
      placed: [],
      skeleton: [],
      expected: [],
      protected: [],
    });
  }

  let regions = gridToRegions(state);
  if (!regions) return null;
  regions = repairForSolverCompletion(n, regions, queens, rng, recorder);
  if (!regions) return null;
  recorder.push({
    attempt: attempt + 1,
    step: null,
    phase: 'final',
    strategy: null,
    accepted: true,
    reason: 'candidate survived final solver completion repair',
    grid: regionsToGrid(n, regions),
    placed: [],
    skeleton: [],
    expected: [],
    protected: queens,
  });
  return { regions, queens, planLength, stepLogLength: state.stepLog.length, trace: recorder.trace };
}

export function generateReverseLevel(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const allowApproximate = params.allowApproximate ?? false;
  const maxAttempts = params.maxAttempts ?? (n <= 5 ? 500 : n <= 8 ? 120 : 220);

  let attempts = 0;
  let bestLevel: Level | null = null;
  let bestTrace: GenerationTrace | undefined;
  let bestDiff = Infinity;
  let bestAttempt: number | null = null;
  let bestAttemptSeed: number | null = null;
  let completeCandidates = 0;
  let exactCandidates = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts = attempt + 1;
    const candidate = buildCandidate(n, targetSteps, actualSeed, attempt);
    if (!candidate) continue;

    const result = solve(createEmptyBoard(n, candidate.regions));
    if (!result.complete) continue;
    completeCandidates++;

    const level = assembleLevel(
      n,
      candidate.regions,
      actualSeed,
      targetSteps,
      `L${n}x${n}-${actualSeed}-rd-${attempt}`,
      result,
    );

    const diff = Math.abs(level.actualSteps - targetSteps);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level;
      bestTrace = candidate.trace;
      bestAttempt = attempts;
      bestAttemptSeed = attemptSeed(actualSeed, attempt, targetSteps);
    }

    if (diff === 0) {
      exactCandidates++;
      return {
        status: 'exact',
        level,
        trace: candidate.trace,
        diagnostics: makeDiagnostics('exact', {
          attempts,
          maxAttempts,
          startedAt,
          seed: actualSeed,
          targetSteps,
          bestLevel: level,
          bestAttempt: attempts,
          bestAttemptSeed: attemptSeed(actualSeed, attempt, targetSteps),
          completeCandidates,
          exactCandidates,
          allowApproximate,
        }),
      };
    }
  }

  if (bestLevel && allowApproximate) {
    return {
      status: 'approximate',
      level: bestLevel,
      trace: bestTrace,
      diagnostics: makeDiagnostics('approximate', {
        attempts,
        maxAttempts,
        startedAt,
        seed: actualSeed,
        targetSteps,
        bestLevel,
        bestAttempt,
        bestAttemptSeed,
        completeCandidates,
        exactCandidates,
        allowApproximate,
      }),
    };
  }

  return {
    status: 'failed',
    level: bestLevel,
    trace: bestTrace,
    diagnostics: makeDiagnostics('failed', {
      attempts,
      maxAttempts,
      startedAt,
      seed: actualSeed,
      targetSteps,
      bestLevel,
      bestAttempt,
      bestAttemptSeed,
      completeCandidates,
      exactCandidates,
      allowApproximate,
    }),
  };
}
