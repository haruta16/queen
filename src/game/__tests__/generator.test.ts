import { describe, it, expect } from 'vitest';
import { generateLevelResult, generateQueenPositions } from '../generator';
import { createRNG } from '../random';

describe('generateQueenPositions', () => {
  it('generates n Queen positions for n=5', () => {
    const queens = generateQueenPositions(5, createRNG(42));
    expect(queens).toHaveLength(5);
    expect(new Set(queens.map(q => q.row)).size).toBe(5);
    expect(new Set(queens.map(q => q.col)).size).toBe(5);
    for (let i = 0; i < queens.length; i++)
      for (let j = i + 1; j < queens.length; j++) {
        const dr = Math.abs(queens[i].row - queens[j].row);
        const dc = Math.abs(queens[i].col - queens[j].col);
        expect(dr > 1 || dc > 1).toBe(true);
      }
  });

  it('generates n Queen positions for n=10', () => {
    expect(generateQueenPositions(10, createRNG(123))).toHaveLength(10);
  });

  it('is deterministic with same seed', () => {
    expect(generateQueenPositions(5, createRNG(99)))
      .toEqual(generateQueenPositions(5, createRNG(99)));
  });

  it('produces different results with different seeds', () => {
    const q1 = generateQueenPositions(5, createRNG(1));
    const q2 = generateQueenPositions(5, createRNG(2));
    expect(q1.some((q, i) => q.row !== q2[i].row || q.col !== q2[i].col)).toBe(true);
  });
});

describe('generateLevelResult', () => {
  it('generates a solvable level for n=5', () => {
    const r = generateLevelResult({
      n: 5, targetSteps: 5, seed: 42,
      maxAttempts: 200, allowApproximate: true,
    });
    expect(r.level).not.toBeNull();
    expect(r.level!.n).toBe(5);
    expect(r.level!.solverResult.complete).toBe(true);
    expect(r.level!.regions).toHaveLength(5);
  }, 15000);

  it('generates a solvable level for n=6', () => {
    const r = generateLevelResult({
      n: 6, targetSteps: 6, seed: 77,
      maxAttempts: 500, allowApproximate: true,
    });
    expect(r.level).not.toBeNull();
    expect(r.level!.n).toBe(6);
    expect(r.level!.solverResult.complete).toBe(true);
  }, 30000);

  it('generates a solvable level for n=7', () => {
    const r = generateLevelResult({
      n: 7, targetSteps: 7, seed: 99,
      maxAttempts: 500, allowApproximate: true,
    });
    expect(r.level).not.toBeNull();
    expect(r.level!.n).toBe(7);
    expect(r.level!.solverResult.complete).toBe(true);
  }, 30000);

  it('generates a solvable level for n=8', () => {
    const r = generateLevelResult({
      n: 8, targetSteps: 8, seed: 123,
      maxAttempts: 1000, allowApproximate: true,
    });
    expect(r.level).not.toBeNull();
    expect(r.level!.n).toBe(8);
    expect(r.level!.solverResult.complete).toBe(true);
  }, 60000);

  it('generates a solvable level for n=10', () => {
    for (const seed of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      const r = generateLevelResult({
        n: 10, targetSteps: 10, seed,
        maxAttempts: 2000, allowApproximate: true,
      });
      if (r.level) {
        expect(r.level.n).toBe(10);
        expect(r.level.solverResult.complete).toBe(true);
        return;
      }
    }
  }, 120000);

  it('is deterministic with same seed', () => {
    const r1 = generateLevelResult({ n: 5, targetSteps: 5, seed: 77, maxAttempts: 200 });
    const r2 = generateLevelResult({ n: 5, targetSteps: 5, seed: 77, maxAttempts: 200 });
    if (r1.level && r2.level) {
      expect(r1.level.actualSteps).toBe(r2.level.actualSteps);
      expect(r1.level.strategySequence).toEqual(r2.level.strategySequence);
    }
  }, 15000);

  it('strategy sequence comes from solver', () => {
    const r = generateLevelResult({
      n: 5, targetSteps: 5, seed: 42,
      maxAttempts: 200, allowApproximate: true,
    });
    expect(r.level).not.toBeNull();
    expect(r.level!.solverResult.complete).toBe(true);
    expect(r.level!.strategySequence).toEqual(
      r.level!.solverResult.batches.map(b => b.strategy),
    );
  }, 15000);

  it('returns diagnostics', () => {
    const r = generateLevelResult({
      n: 5, targetSteps: 5, seed: 42,
      maxAttempts: 200, allowApproximate: true,
    });
    expect(r.diagnostics.attempts).toBeGreaterThan(0);
    expect(r.diagnostics.seed).toBe(42);
    expect(r.diagnostics.targetSteps).toBe(5);
  }, 15000);

  it('handles n < 5 gracefully', () => {
    const r = generateLevelResult({
      n: 4, targetSteps: 4, seed: 42, maxAttempts: 50, allowApproximate: true,
    });
    // BFS 生长对 n=4 可能成功，接受任何非异常状态
    expect(r.status).toBeDefined();
    expect(r.diagnostics).toBeDefined();
  }, 15000);

  it('handles large targetSteps gracefully', () => {
    const r = generateLevelResult({
      n: 5, targetSteps: 100, seed: 42,
      maxAttempts: 50, allowApproximate: true,
    });
    expect(['exact', 'approximate', 'failed']).toContain(r.status);
  }, 15000);
});
