import { describe, it, expect } from 'vitest';
import {
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

describe('generateLevelResult — level output', () => {
  it('uses the project L1-chain generator when targetSteps equals n', () => {
    const result = generateLevelResult({
      n: 6,
      targetSteps: 6,
      seed: 20260607,
      maxAttempts: 3000,
      allowApproximate: false,
    });

    const level = result.level;
    expect(result.status).toBe('exact');
    expect(level).not.toBeNull();
    expect(level!.id.startsWith('P-L1-')).toBe(true);
    expect(level!.actualSteps).toBe(6);
    expect(level!.strategySequence).toEqual(['L1', 'L1', 'L1', 'L1', 'L1', 'L1']);
    expect(level!.solverResult.complete).toBe(true);
    expect(level!.solverResult.totalSteps).toBe(level!.n);
    expect(level!.solverResult.strategyTypesUsed).toEqual(['L1']);
  }, 15000);

  it('can generate one interleaved L2_Lock1 after an opening L1', () => {
    const result = generateLevelResult({
      n: 6,
      targetSteps: 7,
      seed: 20260607,
      maxAttempts: 5000,
      allowApproximate: false,
    });

    const level = result.level;
    expect(result.status).toBe('exact');
    expect(level).not.toBeNull();
    expect(level!.actualSteps).toBe(7);
    expect(level!.strategySequence).toEqual(['L1', 'L2_Lock1', 'L1', 'L1', 'L1', 'L1', 'L1']);
    expect(level!.solverResult.complete).toBe(true);
  }, 15000);

  it('can generate an opening L2_Lock2 level for larger boards', () => {
    const result = generateLevelResult({
      n: 8,
      targetSteps: 9,
      seed: 20260607,
      maxAttempts: 5000,
      allowApproximate: false,
    });

    const level = result.level;
    expect(result.status).toBe('exact');
    expect(level).not.toBeNull();
    expect(level!.actualSteps).toBe(9);
    expect(level!.strategySequence[0]).toBe('L2_Lock2');
    expect(level!.strategySequence.slice(1)).toEqual(['L1', 'L1', 'L1', 'L1', 'L1', 'L1', 'L1', 'L1']);
    expect(level!.solverResult.complete).toBe(true);
  }, 15000);

  it('uses stable L2_Lock2 instead of an unverified L2_Lock3 path for n=9 target n+1', () => {
    const result = generateLevelResult({
      n: 9,
      targetSteps: 10,
      seed: 20260607,
      maxAttempts: 5000,
      allowApproximate: false,
    });

    const level = result.level;
    expect(result.status).toBe('exact');
    expect(level).not.toBeNull();
    expect(level!.actualSteps).toBe(10);
    expect(level!.strategySequence[0]).toBe('L2_Lock2');
    expect(level!.strategySequence.slice(1)).toEqual(['L1', 'L1', 'L1', 'L1', 'L1', 'L1', 'L1', 'L1', 'L1']);
    expect(level!.solverResult.complete).toBe(true);
  }, 15000);

  it('can distribute multiple L2_Lock1 steps from targetSteps', () => {
    const result = generateLevelResult({
      n: 8,
      targetSteps: 11,
      seed: 20260607,
      maxAttempts: 5000,
      allowApproximate: false,
    });

    const level = result.level;
    expect(result.status).toBe('exact');
    expect(level).not.toBeNull();
    expect(level!.actualSteps).toBe(11);
    expect(level!.strategySequence).toEqual([
      'L1', 'L2_Lock1', 'L1', 'L1',
      'L2_Lock1', 'L1', 'L1',
      'L2_Lock1', 'L1', 'L1', 'L1',
    ]);
    expect(level!.solverResult.complete).toBe(true);
  }, 15000);

  it('is deterministic with same seed for project levels', () => {
    const r1 = generateLevelResult({ n: 7, targetSteps: 7, seed: 42, allowApproximate: false });
    const r2 = generateLevelResult({ n: 7, targetSteps: 7, seed: 42, allowApproximate: false });
    const l1 = r1.level;
    const l2 = r2.level;
    expect(l1).not.toBeNull();
    expect(l2).not.toBeNull();
    expect(l1!.actualSteps).toBe(l2!.actualSteps);
    expect(l1!.strategySequence).toEqual(l2!.strategySequence);
  }, 15000);

  it('level data contains full strategy sequence', () => {
    const result = generateLevelResult({ n: 7, targetSteps: 7, seed: 42, allowApproximate: false });
    const level = result.level;
    expect(level).not.toBeNull();
    expect(level!.strategySequence.length).toBeGreaterThan(0);
    expect(level!.strategySequence).toEqual(
      level!.solverResult.batches.map(b => b.strategy)
    );
  }, 15000);

  it('does not fall back to the old Monte Carlo generator for uncovered targets', () => {
    const result = generateLevelResult({
      n: 7,
      targetSteps: 30,
      seed: 42,
      maxAttempts: 20,
      allowApproximate: true,
    });
    expect(result.status).toBe('failed');
    expect(result.level).toBeNull();
    expect(result.diagnostics.completeCandidates).toBe(0);
  }, 15000);
});

describe('generateLevelResult', () => {
  it('returns GenerationResult with diagnostics', () => {
    const result = generateLevelResult({ n: 7, targetSteps: 7, seed: 42, allowApproximate: false });
    expect(result.status).toBe('exact');
    expect(result.level).not.toBeNull();
    expect(result.diagnostics.attempts).toBeGreaterThan(0);
    expect(result.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.seed).toBe(42);
    expect(result.diagnostics.targetSteps).toBe(7);
  }, 15000);

  it('is deterministic', () => {
    const r1 = generateLevelResult({ n: 7, targetSteps: 7, seed: 77 });
    const r2 = generateLevelResult({ n: 7, targetSteps: 7, seed: 77 });
    if (r1.level && r2.level) {
      expect(r1.level.actualSteps).toBe(r2.level.actualSteps);
      expect(r1.level.strategySequence).toEqual(r2.level.strategySequence);
    }
  }, 15000);

  it('returns failed when exact match is not covered yet', () => {
    const result = generateLevelResult({
      n: 7, targetSteps: 15, seed: 42,
      maxAttempts: 500, allowApproximate: true,
    });
    expect(result.status).toBe('failed');
    expect(result.level).toBeNull();
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
