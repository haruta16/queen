import {
  Level,
  Position,
  GeneratorParams,
  GenerationDiagnostics,
  GenerationResult,
  GenerationStatus,
} from './types';
import { shuffle } from './random';
import { generateProjectLevel } from './projectGenerator';

// ============================================================
// Queen 布局 — 随机化回溯算法
// ============================================================

export function generateQueenPositions(n: number, rng: () => number): Position[] {
  const positionRows = shuffle(Array.from({ length: n }, (_, i) => i), rng);

  const solution: Position[] = [];

  function backtrack(rowIndex: number): boolean {
    if (rowIndex >= n) return true;

    const row = positionRows[rowIndex];
    const cols = shuffle(Array.from({ length: n }, (_, i) => i), rng);

    for (const col of cols) {
      if (solution.some(q => q.col === col)) continue;

      const adj = solution.some(q => {
        const dr = Math.abs(q.row - row);
        const dc = Math.abs(q.col - col);
        return dr <= 1 && dc <= 1;
      });
      if (adj) continue;

      solution.push({ row, col });
      if (backtrack(rowIndex + 1)) return true;
      solution.pop();
    }

    return false;
  }

  if (!backtrack(0)) {
    throw new Error(`无法生成 ${n} 个互不邻接的 Queen 坐标`);
  }

  return solution;
}

// ============================================================
// 诊断信息
// ============================================================

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
    exactCandidates: args.bestLevel && args.bestLevel.actualSteps === args.targetSteps ? 1 : 0,
    allowApproximate: args.allowApproximate,
  };
}

// ============================================================
// 主生成器
// ============================================================

/** 生成一个项目算法关卡。未覆盖的参数直接返回 failed。 */
export function generateLevelResult(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const allowApproximate = params.allowApproximate ?? true;
  const maxAttempts = params.maxAttempts ?? 200;

  const projectLevel = generateProjectLevel({
    n,
    targetSteps,
    seed: actualSeed,
    maxAttempts,
  });
  if (projectLevel.level) {
    return {
      status: 'exact',
      level: projectLevel.level,
      diagnostics: makeDiagnostics('exact', {
        attempts: projectLevel.attempts,
        maxAttempts,
        startedAt,
        seed: actualSeed,
        targetSteps,
        bestLevel: projectLevel.level,
        bestAttempt: projectLevel.attempts,
        bestAttemptSeed: actualSeed,
        completeCandidates: 1,
        allowApproximate,
      }),
    };
  }

  return {
    status: 'failed',
    level: null,
    diagnostics: makeDiagnostics('failed', {
      attempts: maxAttempts, maxAttempts, startedAt, seed: actualSeed, targetSteps,
      bestLevel: null,
      bestAttempt: null,
      bestAttemptSeed: null,
      completeCandidates: 0,
      allowApproximate,
    }),
  };
}
