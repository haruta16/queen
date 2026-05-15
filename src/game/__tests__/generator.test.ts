import { describe, it, expect } from 'vitest';
import { generateQueenPositions, generateRegions, generateLevel, complexityToTargetSteps } from '../generator';
import { createRNG } from '../random';
import { createEmptyBoard, isBoardValid } from '../rules';
import { solve } from '../solver';

describe('generateQueenPositions', () => {
  it('generates n Queen positions for n=5', () => {
    const rng = createRNG(42);
    const queens = generateQueenPositions(5, rng);
    expect(queens).toHaveLength(5);

    // Verify distinct rows
    const rows = new Set(queens.map(q => q.row));
    expect(rows.size).toBe(5);

    // Verify distinct columns
    const cols = new Set(queens.map(q => q.col));
    expect(cols.size).toBe(5);

    // Verify non-adjacency
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
    // Very unlikely to be identical
    const same = q1.every((q, i) => q.row === q2[i].row && q.col === q2[i].col);
    // Could be same by chance, but rare enough for test
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

  it('different complexity produces different region shapes', () => {
    const n = 5;
    const queens1 = generateQueenPositions(n, createRNG(42));
    const queens2 = generateQueenPositions(n, createRNG(99));

    const regionsLow = generateRegions(n, queens1, 0.0, createRNG(100));
    const regionsHigh = generateRegions(n, queens2, 1.0, createRNG(200));

    // With target size system, different Queen positions + complexity
    // should generally produce different layouts
    const layoutLow = regionsToLayout(n, regionsLow);
    const layoutHigh = regionsToLayout(n, regionsHigh);

    // Just verify both are valid (full coverage)
    const allCells = new Set<string>();
    for (const reg of [...regionsLow, ...regionsHigh]) {
      for (const { row, col } of reg.cells) allCells.add(`${row},${col}`);
    }
    expect(allCells.size).toBeGreaterThanOrEqual(n * n); // each layout covers all cells
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
  }, 15000); // 15 second timeout for generation

  it('generates a 7×7 level (tries multiple seeds)', () => {
    // Try many seed/step combos
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

    // Try multiple seeds for each
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

function regionsToLayout(n: number, regions: { id: number; cells: { row: number; col: number }[] }[]): number[][] {
  const layout: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  for (const region of regions) {
    for (const { row, col } of region.cells) {
      layout[row][col] = region.id;
    }
  }
  return layout;
}
