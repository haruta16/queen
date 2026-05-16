/**
 * Reverse Generator — constructs a solvable puzzle by searching over
 * Queen layouts, using binary search on shapeBias and region refinement
 * to approach the target step count.
 */

import {
  Position,
  Region,
  Level,
  GeneratorParams,
  GenerationDiagnostics,
  GenerationResult,
  GenerationStatus,
} from './types';
import { createEmptyBoard, getQueenPositions } from './rules';
import { solve, applyBatchesUpTo } from './solver';
import { createRNG, shuffle, randInt } from './random';
import { generateQueenPositions, generateRegions } from './generator';

const DIRS_4 = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

function posKey(p: Position): string { return `${p.row},${p.col}`; }
function inBounds(r: number, c: number, n: number): boolean {
  return r >= 0 && r < n && c >= 0 && c < n;
}
function isConnected(cells: Position[]): boolean {
  if (cells.length <= 1) return true;
  const cellKeys = new Set(cells.map(posKey));
  const queue = [cells[0]];
  const seen = new Set<string>([posKey(cells[0])]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const { dr, dc } of DIRS_4) {
      const key = posKey({ row: cur.row + dr, col: cur.col + dc });
      if (cellKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push({ row: cur.row + dr, col: cur.col + dc });
      }
    }
  }
  return seen.size === cells.length;
}
function cloneRegions(regions: Region[]): Region[] {
  return regions.map(r => ({ id: r.id, cells: r.cells.map(p => ({ ...p })) }));
}

function tryMutateRegions(
  n: number,
  regions: Region[],
  queenPositions: Position[],
  rng: () => number,
): Region[] | null {
  const queenKeys = new Set(queenPositions.map(posKey));
  const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  for (const r of regions) for (const c of r.cells) grid[c.row][c.col] = r.id;

  const movable: { from: number; to: number; pos: Position }[] = [];
  for (const region of regions) {
    if (region.cells.length <= 2) continue;
    for (const pos of region.cells) {
      if (queenKeys.has(posKey(pos))) continue;
      const adj = new Set<number>();
      for (const { dr, dc } of DIRS_4) {
        const nr = pos.row + dr, nc = pos.col + dc;
        if (inBounds(nr, nc, n)) {
          const rid = grid[nr][nc];
          if (rid !== -1 && rid !== region.id) adj.add(rid);
        }
      }
      for (const to of adj) movable.push({ from: region.id, to, pos });
    }
  }

  if (movable.length === 0) return null;
  const move = movable[randInt(rng, 0, movable.length - 1)];
  const next = cloneRegions(regions);
  const fromCells = next[move.from].cells.filter(
    p => p.row !== move.pos.row || p.col !== move.pos.col,
  );
  if (!isConnected(fromCells)) return null;
  next[move.from].cells = fromCells;
  next[move.to].cells = [...next[move.to].cells, { ...move.pos }];
  return next;
}

function refineLevel(
  level: Level,
  queenPositions: Position[],
  targetSteps: number,
  rng: () => number,
  budget: number,
): Level {
  let current = level, best = level;
  for (let i = 0; i < budget; i++) {
    const mutated = tryMutateRegions(level.n, current.regions, queenPositions, rng);
    if (!mutated) continue;
    const board = createEmptyBoard(level.n, mutated);
    const result = solve(board);
    if (!result.complete) continue;
    const solvedBoard = applyBatchesUpTo(board, result.batches, result.totalSteps);
    const candidate: Level = {
      id: `${level.id}-r${i}`, n: level.n, regions: mutated,
      solution: getQueenPositions(solvedBoard), seed: level.seed, targetSteps,
      actualSteps: result.totalSteps,
      strategySequence: result.batches.map(b => b.strategy),
      solverResult: result,
    };
    const cDiff = Math.abs(candidate.actualSteps - targetSteps);
    const bDiff = Math.abs(best.actualSteps - targetSteps);
    if (cDiff < bDiff || (targetSteps > best.actualSteps && candidate.actualSteps > best.actualSteps)) {
      best = candidate; current = candidate;
      if (cDiff === 0) return candidate;
      continue;
    }
    if (cDiff <= Math.abs(current.actualSteps - targetSteps) || rng() < 0.08) current = candidate;
  }
  return best;
}

export function generateLevelReverse(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const isLargeN = n >= 8;

  // Scale attempts with n and targetSteps
  const maxLayouts = Math.max(20, Math.min(500,
    params.maxAttempts ?? Math.max(60, n * 8 + targetSteps * 3)));
  const subBudget = 12 + Math.floor(n * 1.5);
  const allowApproximate = params.allowApproximate ?? false;

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let attempts = 0;
  let completeCandidates = 0;
  let incompleteCandidates = 0;
  let exactCandidates = 0;

  const makeDiagnostics = (status: GenerationStatus): GenerationDiagnostics => ({
    status, attempts, maxAttempts: maxLayouts,
    elapsedMs: Date.now() - startedAt,
    seed: actualSeed, targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt: bestLevel ? attempts : null,
    selectedAttemptSeed: bestLevel ? actualSeed + (bestLevel ? attempts : 0) * 7919 : null,
    completeCandidates, incompleteCandidates, exactCandidates,
    allowApproximate, useKeyedRegions: false,
  });

  for (let layoutIdx = 0; layoutIdx < maxLayouts; layoutIdx++) {
    attempts = layoutIdx + 1;
    const layoutSeed = actualSeed + layoutIdx * 7919 + targetSteps * 101;
    const rng = createRNG(layoutSeed);

    let queenPositions: Position[];
    try {
      queenPositions = generateQueenPositions(n, rng);
    } catch { continue; }

    // Binary search on shapeBias for this Queen layout.
    // Lower bias → less axis alignment → more free-form → potentially more steps.
    // Higher bias → more axis alignment → more structured → potentially fewer steps.
    let lo = 0.0;
    let hi = 1.0;

    // Initial guess: normalize targetSteps to expected range
    const stepRatio = targetSteps / Math.max(2, n * 6);
    let shapeBias = 1.0 - Math.max(0.05, Math.min(0.95, stepRatio));

    for (let sub = 0; sub < subBudget; sub++) {
      const subRng = createRNG(layoutSeed * 1000 + sub * 137 + 1);

      const regions = generateRegions(n, queenPositions, shapeBias, subRng);
      const board = createEmptyBoard(n, regions);
      const rawResult = solve(board);

      if (!rawResult.complete) { incompleteCandidates++; continue; }

      completeCandidates++;
      const solvedBoard = applyBatchesUpTo(board, rawResult.batches, rawResult.totalSteps);

      let level: Level = {
        id: `L${n}x${n}-opt-${actualSeed}-${layoutIdx}-${sub}`, n, regions,
        solution: getQueenPositions(solvedBoard), seed: actualSeed, targetSteps,
        actualSteps: rawResult.totalSteps,
        strategySequence: rawResult.batches.map(b => b.strategy),
        solverResult: rawResult,
      };

      // Refine
      const baseDiff = Math.abs(rawResult.totalSteps - targetSteps);
      const refineBudget = Math.max(10, Math.min(80, baseDiff * 6));
      level = refineLevel(level, queenPositions, targetSteps, subRng, refineBudget);

      const diff = level.actualSteps - targetSteps;

      if (diff === 0) {
        exactCandidates++;
        bestLevel = level;
        return { status: 'exact', level, diagnostics: makeDiagnostics('exact') };
      }

      if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); bestLevel = level; }

      // Binary search update
      if (diff < 0) {
        // Too few steps → try lower bias (more free-form, potentially more steps)
        hi = shapeBias;
        shapeBias = (lo + hi) / 2;
      } else {
        // Too many steps → try higher bias (more structured, potentially fewer steps)
        lo = shapeBias;
        shapeBias = (lo + hi) / 2;
      }

      if (hi - lo < 0.02) break; // converged
    }
  }

  if (bestLevel && allowApproximate) {
    return { status: 'approximate', level: bestLevel, diagnostics: makeDiagnostics('approximate') };
  }
  return { status: 'failed', level: null, diagnostics: makeDiagnostics('failed') };
}
