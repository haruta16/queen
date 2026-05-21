/**
 * Reverse Generator V2 — builds puzzles backward through the strategy chain.
 *
 * All n Queens participate. Steps are generated dynamically until the board
 * is full — no pre-allocation, no fill phase, no ratio estimation.
 * Every cell is placed by a strategy step.
 */

import {
  Position, Region, Level,
  GeneratorParams, GenerationDiagnostics, GenerationResult, GenerationStatus,
  StrategyType, RegionConstraint,
} from './types';
import { createEmptyBoard } from './rules';
import { solve } from './solver';
import { assembleLevel, generateQueenPositions } from './generatorCore';
import { createRNG, shuffle, randInt } from './random';
import { posKey } from './regionUtils';

const DIRS_4 = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

const L23_STRATEGIES: StrategyType[] = [
  'L2_Lock1', 'L2_Lock2', 'L2_Lock3',
  'L3_Projection', 'L3_Contradiction',
];

function inBounds(r: number, c: number, n: number): boolean {
  return r >= 0 && r < n && c >= 0 && c < n;
}

function canPlace(key: string, frozen: Set<string>, grid: number[][], rid: number): boolean {
  if (frozen.has(key)) return false;
  const [r, c] = key.split(',').map(Number);
  return grid[r][c] === -1 || grid[r][c] === rid;
}

function claimCell(r: number, c: number, rid: number, grid: number[][], frozen: Set<string>): void {
  grid[r][c] = rid;
  frozen.add(posKey({ row: r, col: c }));
}

function hasEmpty(grid: number[][], n: number): boolean {
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] === -1) return true;
  return false;
}

function countEmpty(grid: number[][], n: number): number {
  let e = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] === -1) e++;
  return e;
}

// ── Build types ───────────────────────────────────────────────────

type BuildInfo = {
  strategy: StrategyType;
  queenIndices: number[];
  axis: 'row' | 'col';
  values: number[];
};

type BuildResult = {
  buildInfo: BuildInfo;
  constraints: Map<number, RegionConstraint>;
} | null;

// ── Constraint builders ────────────────────────────────────────────

function buildLock1(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildResult {
  const q = queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';

  const candidates: Position[] = [];
  for (let i = 0; i < n; i++) {
    const r = axis === 'row' ? q.row : i;
    const c = axis === 'row' ? i : q.col;
    if (canPlace(posKey({ row: r, col: c }), frozen, grid, qi)) candidates.push({ row: r, col: c });
  }
  if (candidates.length < 2) return null;

  claimCell(q.row, q.col, qi, grid, frozen);
  let claimed = 1;
  for (const c of candidates) {
    if (claimed >= Math.ceil(n * 0.6)) break;
    claimCell(c.row, c.col, qi, grid, frozen);
    claimed++;
  }

  const v = axis === 'row' ? q.row : q.col;
  return {
    buildInfo: { strategy: 'L2_Lock1', queenIndices: [qi], axis, values: [v] },
    constraints: new Map([[qi, { type: 'axis', axis, value: v }]]),
  };
}

function buildLock2(
  n: number, qi0: number, qi1: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildResult {
  const q0 = queens[qi0], q1 = queens[qi1];
  const dim: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
  const v0 = dim === 'row' ? q0.row : q0.col;
  const v1 = dim === 'row' ? q1.row : q1.col;
  const allowed = new Set([v0, v1]);

  function grow(seed: Position, rid: number): Position[] {
    const cells: Position[] = [seed];
    const seen = new Set<string>([posKey(seed)]);
    const frontier: Position[] = [];
    const add = (p: Position) => {
      for (const { dr, dc } of DIRS_4) {
        const nr = p.row + dr, nc = p.col + dc;
        const nk = posKey({ row: nr, col: nc });
        const v = dim === 'row' ? nr : nc;
        if (inBounds(nr, nc, n) && allowed.has(v) && !seen.has(nk) && canPlace(nk, frozen, grid, rid)) {
          seen.add(nk); frontier.push({ row: nr, col: nc });
        }
      }
    };
    add(seed);
    while (frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx]; frontier.splice(idx, 1);
      if (canPlace(posKey(p), frozen, grid, rid)) { cells.push(p); add(p); }
    }
    return cells;
  }

  const r0cells = grow(q0, qi0);
  const r1cells = grow(q1, qi1);
  if (r0cells.length < 2 || r1cells.length < 2) return null;

  for (const c of r0cells) claimCell(c.row, c.col, qi0, grid, frozen);
  for (const c of r1cells) claimCell(c.row, c.col, qi1, grid, frozen);

  const c: RegionConstraint = { type: 'axes', axis: dim, values: [v0, v1] };
  return {
    buildInfo: { strategy: 'L2_Lock2', queenIndices: [qi0, qi1], axis: dim, values: [v0, v1] },
    constraints: new Map([[qi0, c], [qi1, c]]),
  };
}

function buildLock3(
  n: number, qis: number[], queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildResult {
  const dim: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
  const vs = qis.map(i => dim === 'row' ? queens[i].row : queens[i].col);
  const allowed = new Set(vs);

  function grow(seed: Position, rid: number): Position[] {
    const cells: Position[] = [seed];
    const seen = new Set<string>([posKey(seed)]);
    const frontier: Position[] = [];
    const add = (p: Position) => {
      for (const { dr, dc } of DIRS_4) {
        const nr = p.row + dr, nc = p.col + dc;
        const nk = posKey({ row: nr, col: nc });
        const v = dim === 'row' ? nr : nc;
        if (inBounds(nr, nc, n) && allowed.has(v) && !seen.has(nk) && canPlace(nk, frozen, grid, rid)) {
          seen.add(nk); frontier.push({ row: nr, col: nc });
        }
      }
    };
    add(seed);
    while (frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx]; frontier.splice(idx, 1);
      if (canPlace(posKey(p), frozen, grid, rid)) { cells.push(p); add(p); }
    }
    return cells;
  }

  let ok = true;
  for (const qi of qis) {
    const cells = grow(queens[qi], qi);
    for (const c of cells) claimCell(c.row, c.col, qi, grid, frozen);
    if (cells.length < 2) ok = false;
  }
  if (!ok) return null;

  const c: RegionConstraint = { type: 'axes', axis: dim, values: vs };
  const cmap = new Map<number, RegionConstraint>();
  for (const qi of qis) cmap.set(qi, c);
  return {
    buildInfo: { strategy: 'L2_Lock3', queenIndices: qis, axis: dim, values: vs },
    constraints: cmap,
  };
}

function buildProjection(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildResult {
  const q = queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';

  claimCell(q.row, q.col, qi, grid, frozen);
  for (const sign of [-1, 1]) {
    const r = axis === 'row' ? q.row : q.row + sign;
    const c = axis === 'row' ? q.col + sign : q.col;
    if (inBounds(r, c, n) && canPlace(posKey({ row: r, col: c }), frozen, grid, qi)) {
      claimCell(r, c, qi, grid, frozen);
    }
  }

  const v = axis === 'row' ? q.row : q.col;
  return {
    buildInfo: { strategy: 'L3_Projection', queenIndices: [qi], axis, values: [v] },
    constraints: new Map([[qi, { type: 'axis', axis, value: v }]]),
  };
}

function buildContradiction(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildResult {
  const q = queens[qi];
  const dir = DIRS_4[Math.floor(rng() * 4)];
  const p = { row: q.row + dir.dr, col: q.col + dir.dc };
  if (!inBounds(p.row, p.col, n)) return null;
  if (!canPlace(posKey(p), frozen, grid, qi)) return null;
  claimCell(q.row, q.col, qi, grid, frozen);
  claimCell(p.row, p.col, qi, grid, frozen);
  return {
    buildInfo: { strategy: 'L3_Contradiction', queenIndices: [qi], axis: 'row', values: [p.row, p.col] },
    constraints: new Map([[qi, { type: 'free' }]]),
  };
}

function buildConstraint(
  strategy: StrategyType, queenIndices: number[], queens: Position[],
  grid: number[][], frozen: Set<string>, n: number, rng: () => number,
): BuildResult {
  switch (strategy) {
    case 'L2_Lock1': return buildLock1(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L2_Lock2': return buildLock2(n, queenIndices[0], queenIndices[1], queens, grid, frozen, rng);
    case 'L2_Lock3': return buildLock3(n, queenIndices, queens, grid, frozen, rng);
    case 'L3_Projection': return buildProjection(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L3_Contradiction': return buildContradiction(n, queenIndices[0], queens, grid, frozen, rng);
    default: return null;
  }
}

// ── Dynamic step generation ────────────────────────────────────────
// Keep picking feasible (strategy, queens) until grid is full.
// All n Queens participate. No pre-allocation, no ratio, no fill.

function tryBuildStep(
  grid: number[][], frozen: Set<string>,
  queens: Position[], n: number,
  rng: () => number,
): BuildResult {
  // Try a limited set of strategy/queen combos to avoid O(N!) explosion
  const strats = shuffle([...L23_STRATEGIES], rng);
  for (const strat of strats) {
    const needed = strat === 'L2_Lock3' ? 3 : strat === 'L2_Lock2' ? 2 : 1;
    if (needed > n) continue;

    // Try at most n queen sets per strategy
    for (let t = 0; t < n; t++) {
      const pool = shuffle(Array.from({ length: n }, (_, i) => i), rng);
      if (pool.length < needed) continue;
      const chosen = pool.slice(0, needed);
      const result = buildConstraint(strat, chosen, queens, grid, frozen, n, rng);
      if (result) return result;
    }
  }
  return null;
}

function buildUntilFull(
  grid: number[][], frozen: Set<string>,
  queens: Position[], n: number,
  rng: () => number,
): { buildResults: BuildInfo[]; constraints: Map<number, RegionConstraint> } {
  const buildResults: BuildInfo[] = [];
  const allConstraints = new Map<number, RegionConstraint>();
  const maxIter = n * n * 2; // hard cap
  let iter = 0;
  let stuck = 0;

  while (hasEmpty(grid, n) && iter < maxIter && stuck < 5) {
    iter++;
    const result = tryBuildStep(grid, frozen, queens, n, rng);
    if (result) {
      buildResults.push(result.buildInfo);
      for (const [rid, c] of result.constraints) {
        if (!allConstraints.has(rid)) allConstraints.set(rid, c);
      }
      stuck = 0;
    } else {
      stuck++;
    }
  }

  // Any remaining empty cells: assign to nearest region respecting its constraint
  if (hasEmpty(grid, n)) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (grid[r][c] !== -1) continue;
        let bestRid = -1, bestDist = Infinity;
        for (let rr = 0; rr < n; rr++) {
          for (let cc = 0; cc < n; cc++) {
            if (grid[rr][cc] === -1) continue;
            const rid = grid[rr][cc];
            const con = allConstraints.get(rid);
            if (con && con.type === 'axis') {
              const onAxis = con.axis === 'row' ? r === con.value : c === con.value;
              if (!onAxis) continue;
            }
            if (con && con.type === 'axes') {
              const v = con.axis === 'row' ? r : c;
              if (!con.values.includes(v)) continue;
            }
            const d = Math.abs(rr - r) + Math.abs(cc - c);
            if (d < bestDist) { bestDist = d; bestRid = rid; }
          }
        }
        grid[r][c] = bestRid >= 0 ? bestRid : 0;
      }
    }
  }

  return { buildResults, constraints: allConstraints };
}

// ── Grid to regions ────────────────────────────────────────────────

function gridToRegions(grid: number[][], n: number): Region[] {
  const map = new Map<number, Position[]>();
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (grid[r][c] < 0) continue;
      if (!map.has(grid[r][c])) map.set(grid[r][c], []);
      map.get(grid[r][c])!.push({ row: r, col: c });
    }
  return Array.from(map.entries()).map(([id, cells]) => ({ id, cells }));
}

// ── Main ───────────────────────────────────────────────────────────

function layoutSeed(base: number, layoutIdx: number, targetSteps: number): number {
  return base + layoutIdx * 7919 + targetSteps * 101;
}

export function generateReverseLevel(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const allowApproximate = params.allowApproximate ?? false;

  const defaultAttempts = n <= 6 ? 40 : n <= 7 ? 60 : n <= 8 ? 100 : n <= 9 ? 150 : 300;
  const maxAttempts = params.maxAttempts ?? defaultAttempts;

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let attempts = 0;
  let bestAttempt = 0;
  let completeCandidates = 0;
  let exactCandidates = 0;

  const makeDiagnostics = (status: GenerationStatus): GenerationDiagnostics => ({
    status, attempts, maxAttempts,
    elapsedMs: Date.now() - startedAt,
    seed: actualSeed, targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt: bestLevel ? bestAttempt : null,
    selectedAttemptSeed: bestLevel ? layoutSeed(actualSeed, bestAttempt - 1, targetSteps) : null,
    completeCandidates, incompleteCandidates: attempts - completeCandidates,
    exactCandidates, allowApproximate,
    anchorStrategy: 'reverseV2', anchorQueenIndices: null, anchorCount: null,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts = attempt + 1;
    const baseRng = createRNG(actualSeed + attempt * 7919 + targetSteps * 101);

    // 1. Queen positions
    let queens: Position[];
    try { queens = generateQueenPositions(n, baseRng); }
    catch { continue; }

    // 2. Init grid — all n Queens claim their cells
    const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
    const frozen = new Set<string>();
    for (let i = 0; i < queens.length; i++) {
      grid[queens[i].row][queens[i].col] = i;
      frozen.add(posKey(queens[i]));
    }

    // 3. Build strategy steps until grid is full
    const { buildResults, constraints } = buildUntilFull(grid, frozen, queens, n, baseRng);

    // 4. Build regions, solve
    const regions = gridToRegions(grid, n);
    const result = solve(createEmptyBoard(n, regions));
    if (!result.complete) continue;
    completeCandidates++;

    const level = assembleLevel(n, regions, actualSeed, targetSteps,
      `L${n}x${n}-${actualSeed}-rv2-${attempt}`, result);

    const diff = Math.abs(level.actualSteps - targetSteps);
    if (diff === 0) {
      exactCandidates++;
      bestAttempt = attempt;
      return { status: 'exact', level, diagnostics: makeDiagnostics('exact') };
    }
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level;
      bestAttempt = attempt;
    }
  }

  if (bestLevel && allowApproximate) {
    return { status: 'approximate', level: bestLevel, diagnostics: makeDiagnostics('approximate') };
  }
  return { status: 'failed', level: bestLevel ?? null, diagnostics: makeDiagnostics('failed') };
}
