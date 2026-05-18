/**
 * Reverse Generator — constructs solvable puzzles by searching over
 * Queen layouts, using anchor constraints + binary search on shapeBias
 * to approach the target step count.
 *
 * Pipeline: Queen layout → anchor specs → anchor regions → fill → solve → refine
 */

import {
  Position,
  Level,
  GeneratorParams,
  GenerationDiagnostics,
  GenerationResult,
  GenerationStatus,
} from './types';
import { createEmptyBoard } from './rules';
import { solve } from './solver';
import { createRNG } from './random';
import { generateQueenPositions, generateRegions, assembleLevel } from './generatorCore';
import { buildAnchorRegions, pickAnchorSpecs } from './anchorGenerator';
import { tryMutateRegions } from './regionUtils';

// ── Seed derivation ──────────────────────────────────────────────
// Distinct prime multipliers prevent RNG sequence collisions across
// orthogonal search dimensions:
//   7919 → Queen layout index    7777 → anchor spec index
//   137  → shapeBias iteration   101  → targetSteps isolation
// The large powers-of-10 multipliers separate dimension subspaces.

function layoutSeed(base: number, layoutIdx: number, targetSteps: number): number {
  return base + layoutIdx * 7919 + targetSteps * 101;
}

function anchorSeed(layoutBase: number, ai: number): number {
  return layoutBase * 10000 + ai * 7777 + 1;
}

function fillSeed(layoutBase: number, ai: number, sub: number): number {
  return layoutBase * 100000 + ai * 7777 + sub * 137 + 1;
}

function refineSeed(layoutBase: number, ai: number, sub: number): number {
  return layoutBase * 1000000 + ai * 7777 + sub * 137 + 1;
}

// ── Local search ─────────────────────────────────────────────────

/**
 * Refine region boundaries via random cell migration to tune step count.
 * Accepts improvements greedily; 8% chance of sideways moves to escape
 * local optima. Frozen regions (anchors) are never mutated.
 */
export function refineLevel(
  level: Level,
  queenPositions: Position[],
  targetSteps: number,
  rng: () => number,
  budget: number,
  frozenRegionIds?: Set<number>,
): Level {
  let current = level;
  let best = level;
  for (let i = 0; i < budget; i++) {
    const mutated = tryMutateRegions(level.n, current.regions, queenPositions, rng, frozenRegionIds);
    if (!mutated) continue;
    const board = createEmptyBoard(level.n, mutated);
    const result = solve(board);
    if (!result.complete) continue;
    const candidate = assembleLevel(level.n, mutated, level.seed, targetSteps, `${level.id}-r${i}`, result);
    const cDiff = Math.abs(candidate.actualSteps - targetSteps);
    const bDiff = Math.abs(best.actualSteps - targetSteps);
    if (cDiff < bDiff || (targetSteps > best.actualSteps && candidate.actualSteps > best.actualSteps)) {
      best = candidate;
      current = candidate;
      if (cDiff === 0) return candidate;
      continue;
    }
    if (cDiff <= Math.abs(current.actualSteps - targetSteps) || rng() < 0.08) {
      current = candidate;
    }
  }
  return best;
}

// ── Main pipeline ────────────────────────────────────────────────

export function generateLevelReverse(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed, anchorCount: requestedAnchorCount } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();

  // Scale search effort with board size and target complexity
  const maxLayouts = Math.max(20, Math.min(500,
    params.maxAttempts ?? Math.max(60, n * 8 + targetSteps * 3)));
  const subBudget = 12 + Math.floor(n * 1.5);
  const anchorSpecsPerLayout = 2 + Math.floor(n / 4);
  const allowApproximate = params.allowApproximate ?? false;

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let attempts = 0;
  let bestAttempt = 0;
  let completeCandidates = 0;
  let incompleteCandidates = 0;
  let exactCandidates = 0;
  let bestAnchorStrategy: string | null = null;
  let bestAnchorIndices: number[] | null = null;
  let effectiveAnchorCount: number | null = null;

  const makeDiagnostics = (status: GenerationStatus): GenerationDiagnostics => ({
    status,
    attempts,
    maxAttempts: maxLayouts,
    elapsedMs: Date.now() - startedAt,
    seed: actualSeed,
    targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt: bestLevel ? bestAttempt : null,
    selectedAttemptSeed: bestLevel ? layoutSeed(actualSeed, bestAttempt - 1, targetSteps) : null,
    completeCandidates,
    incompleteCandidates,
    exactCandidates,
    allowApproximate,
    anchorStrategy: bestAnchorStrategy,
    anchorQueenIndices: bestAnchorIndices,
    anchorCount: effectiveAnchorCount,
  });

  for (let layoutIdx = 0; layoutIdx < maxLayouts; layoutIdx++) {
    attempts = layoutIdx + 1;
    const rng = createRNG(layoutSeed(actualSeed, layoutIdx, targetSteps));

    let queenPositions: Position[];
    try {
      queenPositions = generateQueenPositions(n, rng);
    } catch { continue; }

    // Try multiple anchor specs per Queen layout
    for (let ai = 0; ai < anchorSpecsPerLayout; ai++) {
      const lSeed = layoutSeed(actualSeed, layoutIdx, targetSteps);
      const anchorRng = createRNG(anchorSeed(lSeed, ai));
      const specs = pickAnchorSpecs(n, queenPositions.length, anchorRng, requestedAnchorCount);
      const anchors = buildAnchorRegions(n, queenPositions, specs, anchorRng);

      const allAnchorIndices = specs.flatMap(s => s.queenIndices);
      const frozenRegionIds = new Set(allAnchorIndices);
      const strategyLabels = specs.map(s => s.strategy).join('+');

      // Binary search on shapeBias — higher bias → more linear regions → more steps
      let lo = 0.0;
      let hi = 1.0;
      const stepRatio = targetSteps / Math.max(2, n * 6);
      let shapeBias = 1.0 - Math.max(0.05, Math.min(0.95, stepRatio));

      for (let sub = 0; sub < subBudget; sub++) {
        const fillRng = createRNG(fillSeed(lSeed, ai, sub));
        const regions = generateRegions(n, queenPositions, shapeBias, fillRng, anchors);
        const rawResult = solve(createEmptyBoard(n, regions));

        if (!rawResult.complete) {
          incompleteCandidates++;
          continue;
        }

        completeCandidates++;
        let level = assembleLevel(
          n, regions, actualSeed, targetSteps,
          `L${n}x${n}-${actualSeed}-${layoutIdx}-${ai}-${sub}`,
          rawResult,
        );

        // Refine region boundaries to tune step count
        const baseDiff = Math.abs(rawResult.totalSteps - targetSteps);
        const refineBudget = Math.max(10, Math.min(80, baseDiff * 6));
        const refineRng = createRNG(refineSeed(lSeed, ai, sub));
        level = refineLevel(level, queenPositions, targetSteps, refineRng, refineBudget, frozenRegionIds);

        const diff = level.actualSteps - targetSteps;
        if (diff === 0) {
          exactCandidates++;
          bestAttempt = attempts;
          bestAnchorStrategy = strategyLabels;
          bestAnchorIndices = allAnchorIndices;
          effectiveAnchorCount = allAnchorIndices.length;
          return { status: 'exact', level, diagnostics: makeDiagnostics('exact') };
        }

        if (Math.abs(diff) < bestDiff) {
          bestDiff = Math.abs(diff);
          bestLevel = level;
          bestAttempt = attempts;
          bestAnchorStrategy = strategyLabels;
          bestAnchorIndices = allAnchorIndices;
          effectiveAnchorCount = allAnchorIndices.length;
        }

        // actual < target → need more steps → raise bias (more linear regions)
        if (diff < 0) { hi = shapeBias; shapeBias = (lo + hi) / 2; }
        else          { lo = shapeBias; shapeBias = (lo + hi) / 2; }

        if (hi - lo < 0.02) break;
      }
    }
  }

  if (bestLevel && allowApproximate) {
    return { status: 'approximate', level: bestLevel, diagnostics: makeDiagnostics('approximate') };
  }

  return {
    status: 'failed',
    level: bestLevel ?? null,
    diagnostics: makeDiagnostics('failed'),
  };
}
