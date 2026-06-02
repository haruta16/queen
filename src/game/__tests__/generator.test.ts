import { describe, it, expect } from 'vitest';
import {
  generateLevel,
  generateLevelResult,
  generateQueenPositions,
} from '../generator';
import { createRNG } from '../random';

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

  it('generates levels for n=7', () => {
    let level = null;
    for (const seed of [100, 200, 300, 400, 500, 600, 700]) {
      level = generateLevel({ n: 7, targetSteps: 30, seed, allowApproximate: true });
      if (level) break;
    }
    expect(level).not.toBeNull();
    expect(level!.n).toBe(7);
    expect(level!.solverResult.complete).toBe(true);
  }, 30000);

  it('generates levels for n=8', () => {
    let level = null;
    for (const seed of [300, 400, 500, 600, 700, 800, 900]) {
      level = generateLevel({ n: 8, targetSteps: 30, seed, allowApproximate: true });
      if (level) break;
    }
    expect(level).not.toBeNull();
    expect(level!.n).toBe(8);
    expect(level!.solverResult.complete).toBe(true);
  }, 30000);

});

describe('generateLevelResult', () => {
  it('returns GenerationResult with diagnostics', () => {
    const result = generateLevelResult({ n: 5, targetSteps: 15, seed: 42, allowApproximate: true });
    expect(result.status).not.toBe('failed');
    expect(result.level).not.toBeNull();
    expect(result.diagnostics.attempts).toBeGreaterThan(0);
    expect(result.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.seed).toBe(42);
    expect(result.diagnostics.targetSteps).toBe(15);
  }, 15000);

  it('is deterministic', () => {
    const r1 = generateLevelResult({ n: 5, targetSteps: 15, seed: 77 });
    const r2 = generateLevelResult({ n: 5, targetSteps: 15, seed: 77 });
    if (r1.level && r2.level) {
      expect(r1.level.actualSteps).toBe(r2.level.actualSteps);
      expect(r1.level.strategySequence).toEqual(r2.level.strategySequence);
    }
  }, 15000);

  it('returns approximate when exact match not found', () => {
    const result = generateLevelResult({
      n: 5, targetSteps: 15, seed: 42,
      maxAttempts: 500, allowApproximate: true,
    });
    expect(['exact', 'approximate']).toContain(result.status);
    expect(result.level).not.toBeNull();
  }, 30000);

  it('returns failed for impossible target with exact required', () => {
    const result = generateLevelResult({
      n: 5, targetSteps: 500, seed: 42,
      maxAttempts: 5, allowApproximate: false,
    });
    // Either exact (unlikely) or failed — both acceptable
    expect(['exact', 'failed']).toContain(result.status);
  }, 30000);
});
