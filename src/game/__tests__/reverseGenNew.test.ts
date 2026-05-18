import { describe, it, expect } from 'vitest';
import { generateReverseLevel } from '../reverseGenNew';

describe('reverseGenNew', () => {
  it('generates solvable 5x5 levels for multiple targets', () => {
    for (const target of [8, 10, 12, 14]) {
      let found = false;
      for (const seed of [42, 100, 200, 300, 500]) {
        const r = generateReverseLevel({ n: 5, targetSteps: target, seed, maxAttempts: 40, allowApproximate: true });
        if (r.level) {
          expect(r.level.solverResult.complete).toBe(true);
          expect(r.level.n).toBe(5);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }, 90000);

  it('generates solvable 6x6 levels', () => {
    for (const target of [12, 15]) {
      let found = false;
      for (const seed of [50, 150, 250, 350, 450]) {
        const r = generateReverseLevel({ n: 6, targetSteps: target, seed, maxAttempts: 50, allowApproximate: true });
        if (r.level) {
          expect(r.level.solverResult.complete).toBe(true);
          expect(r.level.n).toBe(6);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }, 90000);

  it('generates solvable 7x7 levels (approximate ok)', () => {
    const combos = [
      { target: 15, seeds: [77, 177, 277, 377, 477, 577, 677] },
      { target: 18, seeds: [88, 188, 288, 388, 488, 588, 688] },
      { target: 20, seeds: [99, 199, 299, 399, 499, 599, 699] },
    ];
    for (const { target, seeds } of combos) {
      let found = false;
      for (const seed of seeds) {
        const r = generateReverseLevel({ n: 7, targetSteps: target, seed, maxAttempts: 60, allowApproximate: true });
        if (r.level && r.level.solverResult.complete) {
          expect(r.level.n).toBe(7);
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  }, 180000);

  it('is deterministic with same seed', () => {
    const r1 = generateReverseLevel({ n: 5, targetSteps: 12, seed: 42, maxAttempts: 30, allowApproximate: true });
    const r2 = generateReverseLevel({ n: 5, targetSteps: 12, seed: 42, maxAttempts: 30, allowApproximate: true });
    if (r1.level && r2.level) {
      expect(r1.level.actualSteps).toBe(r2.level.actualSteps);
    }
  }, 60000);
});
