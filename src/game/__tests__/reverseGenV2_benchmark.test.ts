/**
 * Deep benchmark — reverse generator V2 across n=5-10.
 * Measures hit rate, accuracy, strategy diversity, and performance.
 */
import { describe, it } from 'vitest';
import { generateReverseLevel } from '../reverseGenNew';
import { generateLevelResult } from '../generator';

// ── Test matrix ──────────────────────────────────────────────────

interface TestCase {
  n: number;
  target: number;
  label: string;
}

const MATRIX: TestCase[] = [
  // n=5
  { n: 5, target: 9, label: '5-low' },
  { n: 5, target: 12, label: '5-mid' },
  { n: 5, target: 15, label: '5-high' },
  // n=6
  { n: 6, target: 11, label: '6-low' },
  { n: 6, target: 14, label: '6-mid' },
  { n: 6, target: 17, label: '6-high' },
  // n=7
  { n: 7, target: 13, label: '7-low' },
  { n: 7, target: 16, label: '7-mid' },
  { n: 7, target: 19, label: '7-high' },
  // n=8
  { n: 8, target: 16, label: '8-low' },
  { n: 8, target: 20, label: '8-mid' },
  { n: 8, target: 24, label: '8-high' },
  // n=9
  { n: 9, target: 18, label: '9-low' },
  { n: 9, target: 22, label: '9-mid' },
  { n: 9, target: 26, label: '9-high' },
  // n=10
  { n: 10, target: 21, label: '10-low' },
  { n: 10, target: 25, label: '10-mid' },
  { n: 10, target: 29, label: '10-high' },
];

const SEEDS_PER_CASE = 15;
const ATTEMPTS_PER_SEED = 100;

// ── Benchmark runner ─────────────────────────────────────────────

interface ResultRow {
  n: number;
  target: number;
  label: string;
  seeds: number;
  hits: number;
  exactHits: number;
  avgActual: number;
  avgDeviation: number;
  avgTimeMs: number;
  avgSteps: number;
  avgStrategyTypes: number;
  strategiesUsed: Record<string, number>;
}

function runBenchmark(): ResultRow[] {
  const results: ResultRow[] = [];

  for (const { n, target, label } of MATRIX) {
    let hits = 0;
    let exactHits = 0;
    let totalActual = 0;
    let totalDeviation = 0;
    let totalTime = 0;
    let totalSteps = 0;
    let totalStrategyTypes = 0;
    const strategiesUsed: Record<string, number> = {};

    const seeds = Array.from({ length: SEEDS_PER_CASE }, (_, i) => 1000 + n * 1000 + target * 100 + i * 7);

    for (const seed of seeds) {
      const start = Date.now();
      const result = generateReverseLevel({
        n,
        targetSteps: target,
        seed,
        maxAttempts: ATTEMPTS_PER_SEED,
        allowApproximate: true,
      });
      const elapsed = Date.now() - start;

      if (result.level && result.level.solverResult.complete) {
        hits++;
        const actual = result.level.actualSteps;
        totalActual += actual;
        totalDeviation += Math.abs(actual - target);
        totalTime += elapsed;
        totalSteps += actual;
        totalStrategyTypes += result.level.solverResult.strategyTypesUsed.length;

        if (result.status === 'exact') exactHits++;

        for (const s of result.level.strategySequence) {
          strategiesUsed[s] = (strategiesUsed[s] || 0) + 1;
        }
      }
    }

    results.push({
      n, target, label,
      seeds: SEEDS_PER_CASE,
      hits,
      exactHits,
      avgActual: hits > 0 ? Math.round(totalActual / hits) : 0,
      avgDeviation: hits > 0 ? Math.round((totalDeviation / hits) * 10) / 10 : 0,
      avgTimeMs: hits > 0 ? Math.round(totalTime / hits) : 0,
      avgSteps: hits > 0 ? Math.round(totalSteps / hits) : 0,
      avgStrategyTypes: hits > 0 ? Math.round((totalStrategyTypes / hits) * 10) / 10 : 0,
      strategiesUsed,
    });
  }

  return results;
}

// ── Anchor baseline ──────────────────────────────────────────────

function runAnchorBaseline(): ResultRow[] {
  const results: ResultRow[] = [];

  // Only test representative cases for comparison (anchor gen is slow)
  const CASES = [
    { n: 5, target: 12 }, { n: 6, target: 14 }, { n: 7, target: 16 },
    { n: 8, target: 20 }, { n: 9, target: 22 }, { n: 10, target: 25 },
  ];

  for (const { n, target } of CASES) {
    let hits = 0, exactHits = 0, totalActual = 0, totalTime = 0;
    const seeds = Array.from({ length: 8 }, (_, i) => 1000 + n * 1000 + i * 7);

    for (const seed of seeds) {
      const start = Date.now();
      const result = generateLevelResult({
        n, targetSteps: target, seed,
        maxAttempts: 80, allowApproximate: true, mode: 'anchor',
      });
      const elapsed = Date.now() - start;

      if (result.level) {
        hits++;
        totalActual += result.level.actualSteps;
        totalTime += elapsed;
        if (result.status === 'exact') exactHits++;
      }
    }

    results.push({
      n, target, label: `${n}-anchor`,
      seeds: 8, hits, exactHits,
      avgActual: hits > 0 ? Math.round(totalActual / hits) : 0,
      avgDeviation: hits > 0 ? Math.round((totalActual / hits - target) * 10) / 10 : 0,
      avgTimeMs: hits > 0 ? Math.round(totalTime / hits) : 0,
      avgSteps: 0, avgStrategyTypes: 0, strategiesUsed: {},
    });
  }

  return results;
}

// ── Test ─────────────────────────────────────────────────────────

describe('ReverseGenV2 Benchmark', () => {
  it('comprehensive benchmark n=5-10', () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('ReverseGenV2 Benchmark — n=5-10, 15 seeds × 100 attempts');
    console.log('═══════════════════════════════════════════════════════════\n');

    const results = runBenchmark();

    // Print table
    console.log(' n  | target | label  | hit% | exact% | avgΔ  | avgMs | #types | top strategies');
    console.log('────┼────────┼────────┼──────┼────────┼───────┼───────┼────────┼───────────────');

    for (const r of results) {
      const hitPct = Math.round((r.hits / r.seeds) * 100);
      const exactPct = Math.round((r.exactHits / r.seeds) * 100);
      const topStrats = Object.entries(r.strategiesUsed)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([s, c]) => `${s.replace('L', '')}(${c})`)
        .join(' ');

      console.log(
        ` ${r.n}  | ${String(r.target).padEnd(6)} | ${r.label.padEnd(6)} | ` +
        `${String(hitPct + '%').padEnd(4)} | ${String(exactPct + '%').padEnd(6)} | ` +
        `${String(r.avgDeviation).padEnd(5)} | ${String(r.avgTimeMs).padEnd(5)} | ` +
        `${String(r.avgStrategyTypes).padEnd(6)} | ${topStrats}`,
      );
    }

    // Summary
    const overallHitRate = Math.round(
      (results.reduce((s, r) => s + r.hits, 0) /
        results.reduce((s, r) => s + r.seeds, 0)) * 100,
    );
    const overallExactRate = Math.round(
      (results.reduce((s, r) => s + r.exactHits, 0) /
        results.reduce((s, r) => s + r.seeds, 0)) * 100,
    );
    const avgDev = Math.round(
      results.filter(r => r.hits > 0).reduce((s, r) => s + r.avgDeviation, 0) /
        results.filter(r => r.hits > 0).length * 10,
    ) / 10;

    console.log(`\n── Overall ────────────────────────────────────────────────`);
    console.log(`  Hit rate: ${overallHitRate}%  |  Exact rate: ${overallExactRate}%  |  Avg deviation: ${avgDev}`);
    console.log(`  Total seeds: ${results.reduce((s, r) => s + r.seeds, 0)}  |  Total hits: ${results.reduce((s, r) => s + r.hits, 0)}`);
  }, 600000);

  it('anchor baseline comparison', () => {
    console.log('\n── Anchor Baseline ───────────────────────────────────────');
    const anchor = runAnchorBaseline();

    console.log(' n  | target | hit% | exact% | avgMs');
    console.log('────┼────────┼──────┼────────┼───────');
    for (const r of anchor) {
      console.log(
        ` ${r.n}  | ${String(r.target).padEnd(6)} | ` +
        `${String(Math.round(r.hits / r.seeds * 100) + '%').padEnd(4)} | ` +
        `${String(Math.round(r.exactHits / r.seeds * 100) + '%').padEnd(6)} | ` +
        `${r.avgTimeMs}`,
      );
    }
  }, 300000);
});
