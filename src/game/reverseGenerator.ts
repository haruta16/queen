/**
 * Optimized Generator
 *
 * Uses the EXACT same region construction as the original generator
 * (proven to produce solvable puzzles), but replaces random shapeBias
 * sampling with binary search for faster convergence to targetSteps.
 *
 * Key improvement: for each Queen layout, binary-search shapeBias to
 * find the step count. This converges in O(log n) iterations per layout
 * instead of random sampling.
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

// ─── Mutation & Refinement ─────────────────────────────────────

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

// ─── Main Entry Point ──────────────────────────────────────────

/**
 * Optimized generator: uses the proven region construction algorithm
 * with binary search on shapeBias for faster convergence.
 *
 * This is the primary generator. It replaces the old brute-force
 * approach (thousands of random attempts) with binary search per
 * Queen layout (tens of attempts).
 */
export function generateLevelReverse(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  // Scale attempts with difficulty. Harder targets need more layouts.
  const maxAttempts = Math.max(8, Math.min(500, params.maxAttempts ?? Math.max(30, n * 5 + targetSteps)));
  const allowApproximate = params.allowApproximate ?? false;

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let attempts = 0;
  let completeCandidates = 0;
  let incompleteCandidates = 0;
  let exactCandidates = 0;

  const makeDiagnostics = (status: GenerationStatus): GenerationDiagnostics => ({
    status, attempts, maxAttempts, elapsedMs: Date.now() - startedAt,
    seed: actualSeed, targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt: bestLevel ? attempts : null,
    selectedAttemptSeed: bestLevel ? actualSeed + (bestLevel ? attempts : 0) * 7919 : null,
    completeCandidates, incompleteCandidates, exactCandidates, allowApproximate, useKeyedRegions: false,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts = attempt + 1;
    const attemptSeed = actualSeed + attempt * 7919 + targetSteps * 101;
    const rng = createRNG(attemptSeed);

    let queenPositions: Position[];
    try {
      queenPositions = generateQueenPositions(n, rng);
    } catch { continue; }

    // Binary search on shapeBias for this Queen layout.
    // Lower shapeBias → more free-form → usually more steps.
    // Higher shapeBias → more axis-aligned → usually fewer steps.
    // We try 8-12 refinements per Queen layout.
    let lo = 0.0;
    let hi = 1.0;

    // Initial guess: normalize targetSteps to the expected range
    const stepRatio = targetSteps / Math.max(2, n * 6);
    let shapeBias = 1.0 - Math.max(0.05, Math.min(0.95, stepRatio));

    const subBudget = 12 + Math.floor(n * 1.2);

    for (let sub = 0; sub < subBudget; sub++) {
      const subRng = createRNG(attemptSeed * 1000 + sub * 137 + 1);

      const regions = generateRegions(n, queenPositions, shapeBias, subRng);
      const board = createEmptyBoard(n, regions);
      const rawResult = solve(board);

      if (!rawResult.complete) { incompleteCandidates++; continue; }

      completeCandidates++;
      const solvedBoard = applyBatchesUpTo(board, rawResult.batches, rawResult.totalSteps);

      let level: Level = {
        id: `L${n}x${n}-opt-${actualSeed}-${attempt}-${sub}`, n, regions,
        solution: getQueenPositions(solvedBoard), seed: actualSeed, targetSteps,
        actualSteps: rawResult.totalSteps,
        strategySequence: rawResult.batches.map(b => b.strategy),
        solverResult: rawResult,
      };

      // Refine
      const baseDiff = Math.abs(rawResult.totalSteps - targetSteps);
      const refineBudget = Math.max(8, Math.min(60, baseDiff * 5));
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
        // Too few steps → need lower bias (more free-form)
        hi = shapeBias;
        shapeBias = (lo + hi) / 2;
      } else {
        // Too many steps → need higher bias (more alignment)
        lo = shapeBias;
        shapeBias = (lo + hi) / 2;
      }

      if (hi - lo < 0.03) break; // converged for this layout
    }
  }

  if (bestLevel && allowApproximate) {
    return { status: 'approximate', level: bestLevel, diagnostics: makeDiagnostics('approximate') };
  }
  return { status: 'failed', level: null, diagnostics: makeDiagnostics('failed') };
}
