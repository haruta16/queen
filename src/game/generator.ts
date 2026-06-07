import {
  Level, Position, Region,
  GeneratorParams, GenerationDiagnostics, GenerationResult, GenerationStatus,
} from './types';
import { createEmptyBoard, getQueenPositions } from './rules';
import { applyBatchesUpTo, solve } from './solver';
import { createRNG, shuffle } from './random';

// ============================================================
// Queen 布局 — 随机化回溯算法
// ============================================================

export function generateQueenPositions(n: number, rng: () => number): Position[] {
  const rows = shuffle(Array.from({ length: n }, (_, i) => i), rng);
  const solution: Position[] = [];

  function backtrack(rowIndex: number): boolean {
    if (rowIndex >= n) return true;
    const row = rows[rowIndex];
    const cols = shuffle(Array.from({ length: n }, (_, i) => i), rng);
    for (const col of cols) {
      if (solution.some(q => q.col === col)) continue;
      if (solution.some(q => {
        const dr = Math.abs(q.row - row);
        const dc = Math.abs(q.col - col);
        return dr <= 1 && dc <= 1;
      })) continue;
      solution.push({ row, col });
      if (backtrack(rowIndex + 1)) return true;
      solution.pop();
    }
    return false;
  }
  if (!backtrack(0)) throw new Error(`无法生成 ${n} 个互不邻接的 Queen 坐标`);
  return solution;
}

// ============================================================
// BFS 区域生长
// ============================================================

const DIRS_4 = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

function ib(r: number, c: number, n: number): boolean {
  return r >= 0 && r < n && c >= 0 && c < n;
}

function growRegions(n: number, queens: Position[], rng: () => number): Region[] {
  const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  const regions: Position[][] = Array.from({ length: n }, () => []);
  const queues: Position[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < queens.length; i++) {
    const { row, col } = queens[i];
    grid[row][col] = i;
    regions[i].push({ row, col });
    queues[i].push({ row, col });
  }

  const order = shuffle(Array.from({ length: n }, (_, i) => i), rng);
  let unassigned = n * n - n;

  while (unassigned > 0 && order.some(i => queues[i].length > 0)) {
    for (const rid of order) {
      if (queues[rid].length === 0) continue;
      const cells = queues[rid];
      const idx = rng() < 0.3 ? Math.floor(rng() * cells.length) : 0;
      const cur = cells.splice(idx, 1)[0];
      const dirs = shuffle([...DIRS_4], rng);
      for (const { dr, dc } of dirs) {
        const nr = cur.row + dr, nc = cur.col + dc;
        if (ib(nr, nc, n) && grid[nr][nc] === -1) {
          grid[nr][nc] = rid;
          regions[rid].push({ row: nr, col: nc });
          queues[rid].push({ row: nr, col: nc });
          unassigned--;
          break;
        }
      }
    }
  }

  return regions.map((cells, id) => ({ id, cells }));
}

// ============================================================
// 诊断 & 生成
// ============================================================

function makeDiagnostics(
  status: GenerationStatus,
  args: {
    attempts: number; maxAttempts: number; startedAt: number; seed: number;
    targetSteps: number; bestLevel: Level | null;
    bestAttempt: number | null; bestAttemptSeed: number | null;
    completeCandidates: number; allowApproximate: boolean;
  },
): GenerationDiagnostics {
  return {
    status, attempts: args.attempts, maxAttempts: args.maxAttempts,
    elapsedMs: Date.now() - args.startedAt, seed: args.seed,
    targetSteps: args.targetSteps,
    bestActualSteps: args.bestLevel?.actualSteps ?? null,
    bestDiff: args.bestLevel ? args.bestLevel.actualSteps - args.targetSteps : null,
    selectedAttempt: args.bestAttempt,
    selectedAttemptSeed: args.bestAttemptSeed,
    completeCandidates: args.completeCandidates,
    incompleteCandidates: args.attempts - args.completeCandidates,
    exactCandidates: args.bestLevel && args.bestLevel.actualSteps === args.targetSteps ? 1 : 0,
    allowApproximate: args.allowApproximate,
  };
}

export function generateLevelResult(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const allowApproximate = params.allowApproximate ?? true;
  const maxAttempts = params.maxAttempts ?? 200;

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let bestAttempt: number | null = null;
  let bestAttemptSeed: number | null = null;
  let completeCandidates = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRNG(actualSeed + attempt * 7919);

    let queens: Position[];
    try { queens = generateQueenPositions(n, rng); } catch { continue; }

    const regions = growRegions(n, queens, rng);
    const board = createEmptyBoard(n, regions);
    const solverResult = solve(board);

    if (!solverResult.complete) continue;
    completeCandidates++;

    const solved = applyBatchesUpTo(board, solverResult.batches, solverResult.totalSteps);
    const actualSteps = solverResult.totalSteps;
    const actualSeq = solverResult.batches.map(b => b.strategy);

    const level: Level = {
      id: `L${n}x${n}-${actualSeed}-${attempt}`,
      n, regions, solution: getQueenPositions(solved),
      seed: actualSeed, targetSteps, actualSteps,
      strategySequence: actualSeq, solverResult,
    };

    const diff = Math.abs(actualSteps - targetSteps);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level;
      bestAttempt = attempt + 1;
      bestAttemptSeed = actualSeed + attempt * 7919;
    }

    if (diff === 0) {
      return {
        status: 'exact', level,
        diagnostics: makeDiagnostics('exact', {
          attempts: attempt + 1, maxAttempts, startedAt, seed: actualSeed,
          targetSteps, bestLevel: level, bestAttempt: attempt + 1,
          bestAttemptSeed: actualSeed + attempt * 7919,
          completeCandidates, allowApproximate,
        }),
      };
    }
  }

  if (bestLevel && allowApproximate) {
    return {
      status: 'approximate', level: bestLevel,
      diagnostics: makeDiagnostics('approximate', {
        attempts: maxAttempts, maxAttempts, startedAt, seed: actualSeed,
        targetSteps, bestLevel, bestAttempt, bestAttemptSeed,
        completeCandidates, allowApproximate,
      }),
    };
  }

  return {
    status: 'failed', level: null,
    diagnostics: makeDiagnostics('failed', {
      attempts: maxAttempts, maxAttempts, startedAt, seed: actualSeed,
      targetSteps, bestLevel: null, bestAttempt: null, bestAttemptSeed: null,
      completeCandidates: 0, allowApproximate,
    }),
  };
}
