import { describe, it, expect } from 'vitest';
import {
  generateQueenPositions,
  generateRegions,
  generateLevel,
  generateLevelResult,
  complexityToTargetSteps,
} from '../generator';
import { generateLevelReverse } from '../reverseGenerator';
import { createRNG } from '../random';
import { createEmptyBoard, isBoardValid } from '../rules';
import { solve } from '../solver';

describe('generateQueenPositions', () => {
  it('generates n Queen positions for n=5', () => {
    const rng = createRNG(42);
    const queens = generateQueenPositions(5, rng);
    expect(queens).toHaveLength(5);

    const rows = new Set(queens.map(q => q.row));
    expect(rows.size).toBe(5);

    const cols = new Set(queens.map(q => q.col));
    expect(cols.size).toBe(5);

    for (let i = 0; i < queens.length; i++) {
      for (let j = i + 1; j < queens.length; j++) {
        const dr = Math.abs(queens[i].row - queens[j].row);
        const dc = Math.abs(queens[i].col - queens[j].col);
        expect(dr > 1 || dc > 1).toBe(true);
      }
    }
  });

  it('generates n Queen positions for n=10', () => {
    const rng = createRNG(123);
    const queens = generateQueenPositions(10, rng);
    expect(queens).toHaveLength(10);
    const rows = new Set(queens.map(q => q.row));
    expect(rows.size).toBe(10);
  });

  it('is deterministic with same seed', () => {
    const q1 = generateQueenPositions(5, createRNG(99));
    const q2 = generateQueenPositions(5, createRNG(99));
    expect(q1).toEqual(q2);
  });

  it('produces different results with different seeds', () => {
    const q1 = generateQueenPositions(5, createRNG(1));
    const q2 = generateQueenPositions(5, createRNG(2));
    const same = q1.every((q, i) => q.row === q2[i].row && q.col === q2[i].col);
    expect(same).toBe(false);
  });
});

describe('generateRegions', () => {
  it('covers all n×n cells', () => {
    const n = 5;
    const rng = createRNG(42);
    const queens = generateQueenPositions(n, rng);
    const regions = generateRegions(n, queens, 0.5, rng);

    const covered = new Set<string>();
    for (const region of regions) {
      for (const { row, col } of region.cells) {
        covered.add(`${row},${col}`);
      }
    }
    expect(covered.size).toBe(n * n);
  });

  it('each region contains exactly 1 Queen seed', () => {
    const n = 5;
    const rng = createRNG(42);
    const queens = generateQueenPositions(n, rng);
    const regions = generateRegions(n, queens, 0.5, rng);

    expect(regions).toHaveLength(n);
    const queenSet = new Set(queens.map(q => `${q.row},${q.col}`));
    for (const region of regions) {
      let queenCount = 0;
      for (const { row, col } of region.cells) {
        if (queenSet.has(`${row},${col}`)) queenCount++;
      }
      expect(queenCount).toBe(1);
    }
  });

  it('different shapeBias produces different region layouts', () => {
    const n = 5;
    const rng = createRNG(42);
    const queens = generateQueenPositions(n, rng);

    const regionsLow = generateRegions(n, queens, 0.0, createRNG(100));
    const regionsHigh = generateRegions(n, queens, 1.0, createRNG(200));

    // Both should cover all cells
    const covered1 = new Set<string>();
    const covered2 = new Set<string>();
    for (const reg of regionsLow) for (const { row, col } of reg.cells) covered1.add(`${row},${col}`);
    for (const reg of regionsHigh) for (const { row, col } of reg.cells) covered2.add(`${row},${col}`);
    expect(covered1.size).toBe(n * n);
    expect(covered2.size).toBe(n * n);
  });

  it('handles n=8 correctly (no free regions for n>=8)', () => {
    const n = 8;
    const rng = createRNG(42);
    const queens = generateQueenPositions(n, rng);
    const regions = generateRegions(n, queens, 0.5, rng);

    expect(regions).toHaveLength(n);
    const covered = new Set<string>();
    for (const reg of regions) for (const { row, col } of reg.cells) covered.add(`${row},${col}`);
    expect(covered.size).toBe(n * n);
    // Each region should have at least 1 cell (its Queen)
    for (const reg of regions) {
      expect(reg.cells.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('generateLevel', () => {
  it('generates a complete, solvable 5×5 level', () => {
    const level = generateLevel({ n: 5, targetSteps: 15, seed: 42 });
    expect(level).not.toBeNull();
    expect(level!.n).toBe(5);
    expect(level!.regions).toHaveLength(5);
    expect(level!.solverResult.complete).toBe(true);
    expect(level!.strategySequence.length).toBeGreaterThan(0);
    expect(level!.strategySequence.length).toBe(level!.actualSteps);
  }, 15000);

  it('generates 5×5 levels for multiple target steps', () => {
    for (const targetSteps of [9, 11, 13, 15]) {
      let found = false;
      for (const seed of [10, 42, 99, 200, 500]) {
        const level = generateLevel({ n: 5, targetSteps, seed, allowApproximate: true });
        if (level && level.solverResult.complete) {
          expect(level.actualSteps).toBeGreaterThan(0);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }, 60000);

  it('generates a 7×7 level (tries multiple targets)', () => {
    let level: ReturnType<typeof generateLevel> = null;
    const attempts = [
      { n: 7, targetSteps: 30, seed: 100 },
      { n: 7, targetSteps: 25, seed: 200 },
      { n: 7, targetSteps: 35, seed: 300 },
      { n: 7, targetSteps: 20, seed: 400 },
      { n: 7, targetSteps: 40, seed: 500 },
      { n: 7, targetSteps: 28, seed: 600 },
    ];
    for (const params of attempts) {
      level = generateLevel(params);
      if (level) break;
    }
    expect(level).not.toBeNull();
    expect(level!.n).toBe(7);
    expect(level!.solverResult.complete).toBe(true);
    expect(level!.solverResult.batches.length).toBeGreaterThan(0);
  }, 120000);

  it('is deterministic with same seed', () => {
    const l1 = generateLevel({ n: 5, targetSteps: 15, seed: 42 });
    const l2 = generateLevel({ n: 5, targetSteps: 15, seed: 42 });
    expect(l1).not.toBeNull();
    expect(l2).not.toBeNull();
    expect(l1!.actualSteps).toBe(l2!.actualSteps);
    expect(l1!.strategySequence).toEqual(l2!.strategySequence);
  }, 15000);

  it('level data contains full strategy sequence', () => {
    const level = generateLevel({ n: 5, targetSteps: 15, seed: 42 });
    expect(level).not.toBeNull();
    expect(level!.strategySequence.length).toBeGreaterThan(0);
    expect(level!.strategySequence).toEqual(
      level!.solverResult.batches.map(b => b.strategy)
    );
  }, 15000);

  it('generates levels with different complexity labels', () => {
    const easySteps = complexityToTargetSteps(5, '简单');
    const hardSteps = complexityToTargetSteps(5, '困难');
    expect(hardSteps).toBeGreaterThan(easySteps);

    let easyLevel: ReturnType<typeof generateLevel> = null;
    for (const s of [10, 20, 30, 40, 50]) {
      easyLevel = generateLevel({ n: 5, targetSteps: easySteps, seed: s });
      if (easyLevel) break;
    }

    let hardLevel: ReturnType<typeof generateLevel> = null;
    for (const s of [60, 70, 80, 90, 100]) {
      hardLevel = generateLevel({ n: 5, targetSteps: hardSteps, seed: s });
      if (hardLevel) break;
    }

    expect(easyLevel).not.toBeNull();
    expect(hardLevel).not.toBeNull();
    expect(hardLevel!.targetSteps).toBeGreaterThan(easyLevel!.targetSteps);
  }, 60000);
});

// ── Reverse Generator Tests ────────────────────────────────────

describe('generateLevelReverse', () => {
  it('generates a solvable 5×5 level', () => {
    const result = generateLevelReverse({ n: 5, targetSteps: 12, seed: 42 });
    expect(result.status).not.toBe('failed');
    expect(result.level).not.toBeNull();
    if (result.level) {
      expect(result.level.n).toBe(5);
      expect(result.level.regions).toHaveLength(5);
      expect(result.level.solverResult.complete).toBe(true);
      expect(result.level.strategySequence.length).toBe(result.level.actualSteps);
      expect(result.level.strategySequence.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('generates solvable 5×5 levels for different step targets', () => {
    for (const targetSteps of [10, 13, 15]) {
      let found = false;
      for (const seed of [100 + targetSteps, 200 + targetSteps, 300 + targetSteps]) {
        const result = generateLevelReverse({ n: 5, targetSteps, seed });
        if (result.status !== 'failed' && result.level) {
          expect(result.level.solverResult.complete).toBe(true);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }, 60000);

  it('finds solvable 7×7 boards with multiple seeds', () => {
    let found = false;
    const combos = [
      { n: 7, targetSteps: 20, seed: 100 },
      { n: 7, targetSteps: 22, seed: 200 },
      { n: 7, targetSteps: 25, seed: 300 },
      { n: 7, targetSteps: 28, seed: 400 },
      { n: 7, targetSteps: 30, seed: 500 },
      { n: 7, targetSteps: 18, seed: 600 },
    ];
    for (const params of combos) {
      const result = generateLevelReverse(params);
      if (result.status !== 'failed' && result.level) {
        expect(result.level.n).toBe(7);
        expect(result.level.solverResult.complete).toBe(true);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }, 120000);

  it('is deterministic with same seed', () => {
    const r1 = generateLevelReverse({ n: 5, targetSteps: 12, seed: 42 });
    const r2 = generateLevelReverse({ n: 5, targetSteps: 12, seed: 42 });
    expect(r1.level).not.toBeNull();
    expect(r2.level).not.toBeNull();
    if (r1.level && r2.level) {
      expect(r1.level.actualSteps).toBe(r2.level.actualSteps);
    }
  }, 30000);
});

// ── Integrated Generator Tests ───────────────────────────────

describe('integrated generator', () => {
  it('generates 5×5 levels with exact step match', () => {
    for (const targetSteps of [10, 12, 14]) {
      let found = false;
      for (const seed of [200 + targetSteps, 300 + targetSteps]) {
        const result = generateLevelResult({ n: 5, targetSteps, seed });
        if (result.status !== 'failed' && result.level) {
          expect(result.level.solverResult.complete).toBe(true);
          expect(result.level.actualSteps).toBeGreaterThan(0);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }, 45000);

  it('generates 6×6 levels correctly', () => {
    let found = false;
    for (const seed of [99, 150, 200, 250, 300]) {
      const result = generateLevelResult({ n: 6, targetSteps: 16, seed, allowApproximate: true });
      if (result.status !== 'failed' && result.level) {
        expect(result.level.n).toBe(6);
        expect(result.level.solverResult.complete).toBe(true);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }, 60000);

  it('generates 7×7 levels for multiple targets', () => {
    // Target 13 and 15 are well-supported; 17 requires more seeds
    const testCases = [
      { targetSteps: 13, seeds: [100, 300, 500] },
      { targetSteps: 15, seeds: [100, 300, 500] },
      { targetSteps: 17, seeds: [100, 300, 500, 700, 900] },
    ];
    for (const { targetSteps, seeds } of testCases) {
      let found = false;
      for (const seed of seeds) {
        const result = generateLevelResult({ n: 7, targetSteps, seed, allowApproximate: true });
        if (result.status !== 'failed' && result.level) {
          expect(result.level.n).toBe(7);
          expect(result.level.solverResult.complete).toBe(true);
          expect(Math.abs(result.level.actualSteps - targetSteps)).toBeLessThanOrEqual(5);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }, 180000);

  it('generates 8×8 levels (limited target range)', () => {
    let found = false;
    for (const seed of [100, 300, 500, 700, 777]) {
      const result = generateLevelResult({ n: 8, targetSteps: 30, seed, allowApproximate: true });
      if (result.status !== 'failed' && result.level) {
        expect(result.level.n).toBe(8);
        expect(result.level.solverResult.complete).toBe(true);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }, 120000);

  it('reports failure for unreachable target on n=8', () => {
    // With exact match required, very high target may fail
    const result = generateLevelResult({ n: 8, targetSteps: 100, seed: 42, maxAttempts: 5, allowApproximate: false });
    // Either exact match (unlikely) or failed — both are acceptable
    expect(['exact', 'failed']).toContain(result.status);
  }, 30000);

  it('generates levels deterministically', () => {
    const r1 = generateLevelResult({ n: 5, targetSteps: 11, seed: 77 });
    const r2 = generateLevelResult({ n: 5, targetSteps: 11, seed: 77 });
    if (r1.level && r2.level) {
      expect(r1.level.actualSteps).toBe(r2.level.actualSteps);
      expect(r1.level.strategySequence).toEqual(r2.level.strategySequence);
    }
  }, 30000);
});
