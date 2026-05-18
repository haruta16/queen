import {
  Level,
  GeneratorParams,
  GenerationDiagnostics,
  GenerationResult,
} from './types';
import { generateLevelReverse } from './reverseGenerator';

// ============================================================
// Generator facade — public API for level generation
// ============================================================

/**
 * Generate a complete, solvable Level with diagnostics.
 * Delegates to the reverse generator (anchor → fill → binary search).
 */
export function generateLevelResult(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const allowApproximate = params.allowApproximate ?? false;
  const maxAttempts = params.maxAttempts;
  const anchorCount = params.anchorCount;

  const result = generateLevelReverse({
    n,
    targetSteps,
    seed: actualSeed,
    maxAttempts,
    allowApproximate,
    anchorCount,
  });

  result.diagnostics.elapsedMs = Date.now() - startedAt;
  return result;
}

/**
 * Convenience wrapper that returns Level | null.
 * Defaults allowApproximate to true for backward compatibility.
 */
export function generateLevel(params: GeneratorParams): Level | null {
  return generateLevelResult({
    ...params,
    allowApproximate: params.allowApproximate ?? true,
  }).level;
}

/**
 * Map user-facing complexity labels to targetSteps for a given board size.
 * Ranges are empirical — recalibrate when generator algorithm changes significantly.
 */
export function complexityToTargetSteps(n: number, label: '简单' | '中等' | '困难'): number {
  const ranges: Record<number, { min: number; max: number }> = {
    5: { min: 8, max: 16 },
    6: { min: 10, max: 18 },
    7: { min: 12, max: 20 },
    8: { min: 14, max: 22 },
    9: { min: 16, max: 26 },
    10: { min: 18, max: 30 },
  };

  const range = ranges[n] ?? { min: 10, max: 50 };
  switch (label) {
    case '简单': return Math.floor(range.min + (range.max - range.min) * 0.2);
    case '中等': return Math.floor(range.min + (range.max - range.min) * 0.5);
    case '困难': return Math.floor(range.min + (range.max - range.min) * 0.8);
  }
}
