import { describe, it, expect } from 'vitest';
import { buildAnchorRegions, pickAnchorSpec, pickAnchorSpecs, AnchorSpec } from '../anchorGenerator';
import { generateQueenPositions, generateRegions } from '../generatorCore';
import { createRNG } from '../random';
import { createEmptyBoard } from '../rules';
import { solve } from '../solver';

describe('anchorGenerator', () => {
  it('picker returns valid spec', () => {
    for (const n of [5, 6, 7, 8]) {
      const rng = createRNG(n * 100);
      const spec = pickAnchorSpec(n, n, rng);
      expect(spec.queenIndices.length).toBeGreaterThanOrEqual(1);
      expect(spec.queenIndices.length).toBeLessThanOrEqual(n);
      expect(spec.strategy).toBeDefined();
    }
  });

  it('pickAnchorSpecs decomposes anchorCount correctly', () => {
    for (const n of [5, 6, 7, 8]) {
      for (const count of [1, 2, 3, 4]) {
        const rng = createRNG(n * 100 + count * 10);
        const specs = pickAnchorSpecs(n, n, rng, count);
        expect(specs.length).toBeGreaterThanOrEqual(1);
        const totalQueens = specs.reduce((sum, s) => sum + s.queenIndices.length, 0);
        expect(totalQueens).toBe(Math.min(count, n));
        for (const s of specs) {
          expect(s.strategy).toBeDefined();
          expect(s.queenIndices.length).toBeGreaterThanOrEqual(1);
          expect(s.queenIndices.length).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('pickAnchorSpecs for anchorCount=3 enables L2_Lock3 decomposition', () => {
    let sawLock3 = false;
    for (let trial = 0; trial < 40; trial++) {
      const rng = createRNG(7000 + trial * 100);
      const specs = pickAnchorSpecs(10, 10, rng, 3);
      if (specs.some(s => s.strategy === 'L2_Lock3')) sawLock3 = true;
    }
    expect(sawLock3).toBe(true);
  });

  it('pickAnchorSpecs for anchorCount=4 uses pair/triple decomposition', () => {
    const rng = createRNG(8000);
    const specs = pickAnchorSpecs(10, 10, rng, 4);
    const totalQueens = specs.reduce((sum, s) => sum + s.queenIndices.length, 0);
    expect(totalQueens).toBe(4);
    const allIndices = specs.flatMap(s => s.queenIndices);
    expect(new Set(allIndices).size).toBe(4);
  });

  it('buildAnchorRegions accepts array of specs (multi-Queen)', () => {
    const n = 8;
    const rng = createRNG(42);
    const queens = generateQueenPositions(n, rng);
    const specs: AnchorSpec[] = [
      { queenIndices: [0, 1], strategy: 'L2_Lock2' },
      { queenIndices: [2], strategy: 'L2_Lock1' },
      { queenIndices: [3], strategy: 'L3_Projection' },
    ];
    const regions = buildAnchorRegions(n, queens, specs, rng);
    expect(regions.length).toBe(4);
    expect(regions.map(r => r.id).sort()).toEqual([0, 1, 2, 3]);
  });

  it('buildAnchorRegions for L2_Lock1 produces axis-narrow regions', () => {
    const n = 7;
    const rng = createRNG(42);
    const queens = generateQueenPositions(n, rng);
    const cells = buildAnchorRegions(n, queens,
      { queenIndices: [0], strategy: 'L2_Lock1' }, rng);
    expect(cells.length).toBe(1);
    const region = cells[0];
    expect(region.id).toBe(0);
    expect(region.cells.length).toBeGreaterThanOrEqual(1);
    const q = queens[0];
    expect(region.cells.some(c => c.row === q.row && c.col === q.col)).toBe(true);
    const rows = new Set(region.cells.map(c => c.row));
    const cols = new Set(region.cells.map(c => c.col));
    expect(rows.size === 1 || cols.size === 1).toBe(true);
  });

  it('buildAnchorRegions for L2_Lock2 produces two constrained regions', () => {
    const n = 7;
    const rng = createRNG(99);
    const queens = generateQueenPositions(n, rng);
    const cells = buildAnchorRegions(n, queens,
      { queenIndices: [0, 1], strategy: 'L2_Lock2' }, rng);
    expect(cells.length).toBe(2);
    for (const region of cells) {
      const q = queens[region.id];
      expect(region.cells.some(c => c.row === q.row && c.col === q.col)).toBe(true);
    }
  });

  it('buildAnchorRegions for L3_Projection produces small regions', () => {
    const n = 7;
    const rng = createRNG(77);
    const queens = generateQueenPositions(n, rng);
    const cells = buildAnchorRegions(n, queens,
      { queenIndices: [0], strategy: 'L3_Projection' }, rng);
    expect(cells.length).toBe(1);
    expect(cells[0].cells.length).toBeGreaterThanOrEqual(1);
    expect(cells[0].cells.length).toBeLessThanOrEqual(4);
    const q = queens[0];
    expect(cells[0].cells.some(c => c.row === q.row && c.col === q.col)).toBe(true);
  });

  it('does not place anchor cells on other Queens', () => {
    for (let trial = 0; trial < 20; trial++) {
      const n = 6;
      const rng = createRNG(1000 + trial * 100);
      const queens = generateQueenPositions(n, rng);
      const spec = pickAnchorSpec(n, n, rng);
      const anchorRegions = buildAnchorRegions(n, queens, spec, rng);
      const queenKeys = new Set(queens.map(q => `${q.row},${q.col}`));
      for (const region of anchorRegions) {
        for (const cell of region.cells) {
          const key = `${cell.row},${cell.col}`;
          if (!queenKeys.has(key)) continue;
          const queenIdx = queens.findIndex(q => q.row === cell.row && q.col === cell.col);
          expect(region.id).toBe(queenIdx);
        }
      }
    }
  });

  // ─── Trigger guarantee tests ───────────────────────────────

  it('L2_Lock1 anchor: solver ALWAYS produces ≥1 batch after fill', () => {
    for (let trial = 0; trial < 30; trial++) {
      for (const n of [5, 6, 7, 8]) {
        const rng = createRNG(2000 + trial * 100 + n * 1000);
        const queens = generateQueenPositions(n, rng);
        const anchors = buildAnchorRegions(n, queens,
          { queenIndices: [0], strategy: 'L2_Lock1' }, rng);
        const fillRng = createRNG(2000 + trial * 100 + n * 1000 + 777);
        const regions = generateRegions(n, queens, 0.5, fillRng, anchors);
        const board = createEmptyBoard(n, regions);
        const result = solve(board);
        expect(result.batches.length).toBeGreaterThan(0);
      }
    }
  });

  it('L2_Lock2 anchor: solver ALWAYS produces ≥1 batch after fill', () => {
    for (let trial = 0; trial < 30; trial++) {
      for (const n of [6, 7, 8]) {
        const rng = createRNG(3000 + trial * 100 + n * 1000);
        const queens = generateQueenPositions(n, rng);
        const anchors = buildAnchorRegions(n, queens,
          { queenIndices: [0, 1], strategy: 'L2_Lock2' }, rng);
        const fillRng = createRNG(3000 + trial * 100 + n * 1000 + 777);
        const regions = generateRegions(n, queens, 0.5, fillRng, anchors);
        const board = createEmptyBoard(n, regions);
        const result = solve(board);
        expect(result.batches.length).toBeGreaterThan(0);
      }
    }
  });

  it('L3_Projection anchor: solver produces ≥1 batch in ≥80% of fills', () => {
    let success = 0, total = 0;
    for (let trial = 0; trial < 50; trial++) {
      for (const n of [5, 6, 7]) {
        const rng = createRNG(4000 + trial * 100 + n * 1000);
        const queens = generateQueenPositions(n, rng);
        const anchors = buildAnchorRegions(n, queens,
          { queenIndices: [0], strategy: 'L3_Projection' }, rng);
        const fillRng = createRNG(4000 + trial * 100 + n * 1000 + 777);
        const regions = generateRegions(n, queens, 0.5, fillRng, anchors);
        const board = createEmptyBoard(n, regions);
        const result = solve(board);
        total++;
        if (result.batches.length > 0) success++;
      }
    }
    const rate = success / total;
    console.log(`L3_Projection trigger rate: ${(rate * 100).toFixed(1)}% (${success}/${total})`);
    expect(rate).toBeGreaterThan(0.8);
  });

  it('L3_Capacity anchor: solver ALWAYS produces ≥1 batch after fill', () => {
    for (let trial = 0; trial < 30; trial++) {
      for (const n of [5, 6, 7, 8]) {
        const rng = createRNG(5000 + trial * 100 + n * 1000);
        const queens = generateQueenPositions(n, rng);
        const anchors = buildAnchorRegions(n, queens,
          { queenIndices: [0], strategy: 'L3_Capacity' }, rng);
        const fillRng = createRNG(5000 + trial * 100 + n * 1000 + 777);
        const regions = generateRegions(n, queens, 0.5, fillRng, anchors);
        const board = createEmptyBoard(n, regions);
        const result = solve(board);
        expect(result.batches.length).toBeGreaterThan(0);
      }
    }
  });
});
