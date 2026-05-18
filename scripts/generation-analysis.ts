/**
 * Systematic analysis of level generation across varying n, anchorCount, and targetSteps.
 *
 * Usage: npx tsx scripts/generation-analysis.ts
 */

import { generateLevelResult, complexityToTargetSteps } from '../src/game/generator';
import { GenerationResult } from '../src/game/types';

interface TestCase {
  n: number;
  targetSteps: number;
  anchorCount: number;
  seed: number;
}

interface TestResult extends TestCase {
  status: string;
  actualSteps: number | null;
  diff: number | null;
  elapsedMs: number;
  attempts: number;
  completeCandidates: number;
  anchorStrategy: string | null;
  exactCandidates: number;
}

function runTestCase(tc: TestCase): TestResult {
  const startedAt = Date.now();
  const result: GenerationResult = generateLevelResult({
    n: tc.n,
    targetSteps: tc.targetSteps,
    seed: tc.seed,
    anchorCount: tc.anchorCount,
    allowApproximate: false,
    maxAttempts: 200,
  });
  const elapsedMs = Date.now() - startedAt;

  return {
    ...tc,
    status: result.status,
    actualSteps: result.level?.actualSteps ?? null,
    diff: result.level ? result.level.actualSteps - tc.targetSteps : null,
    elapsedMs,
    attempts: result.diagnostics.attempts,
    completeCandidates: result.diagnostics.completeCandidates,
    anchorStrategy: result.diagnostics.anchorStrategy,
    exactCandidates: result.diagnostics.exactCandidates,
  };
}

function buildTestCases(): TestCase[] {
  const cases: TestCase[] = [];
  const anchorCounts = [1, 2, 3, 4, 5];

  // n → low/mid/high targetSteps
  const stepRanges: Record<number, { min: number; max: number }> = {
    5: { min: 8, max: 16 },
    6: { min: 10, max: 18 },
    7: { min: 12, max: 20 },
    8: { min: 14, max: 22 },
    9: { min: 16, max: 26 },
    10: { min: 18, max: 30 },
  };

  for (let n = 5; n <= 10; n++) {
    const range = stepRanges[n];
    const targets = [
      range.min,
      Math.floor((range.min + range.max) / 2),
      range.max,
    ];
    const uniqueTargets = [...new Set(targets)].sort((a, b) => a - b);

    for (const targetSteps of uniqueTargets) {
      for (const anchorCount of anchorCounts) {
        if (anchorCount > n) continue;
        cases.push({
          n,
          targetSteps,
          anchorCount,
          seed: 1000 + n * 100 + targetSteps * 10 + anchorCount,
        });
      }
    }
  }

  return cases;
}

function formatRow(r: TestResult): string {
  const diffStr = r.diff === null ? 'N/A' : (r.diff === 0 ? '0' : (r.diff > 0 ? `+${r.diff}` : `${r.diff}`));
  const stepsStr = r.actualSteps === null ? '—' : String(r.actualSteps);
  const statusIcon = r.status === 'exact' ? '✓' : r.status === 'approximate' ? '~' : '✗';
  const anchorShort = r.anchorStrategy ? r.anchorStrategy.replace(/L\d_/g, '').replace(/_/g, '') : '—';
  const msStr = r.elapsedMs < 1000 ? `${r.elapsedMs}ms` : `${(r.elapsedMs / 1000).toFixed(1)}s`;

  return [
    `n=${r.n}`.padEnd(5),
    `steps=${r.targetSteps}`.padEnd(10),
    `anchors=${r.anchorCount}`.padEnd(11),
    statusIcon.padEnd(4),
    `actual=${stepsStr}`.padEnd(12),
    `diff=${diffStr}`.padEnd(8),
    `strategy=${anchorShort}`.padEnd(22),
    `completions=${r.completeCandidates}`.padEnd(15),
    `attempts=${r.attempts}`.padEnd(12),
    msStr.padEnd(10),
  ].join('');
}

// ── Main ────────────────────────────────────────────────────────

console.log('═'.repeat(140));
console.log('  Level Generation Analysis — n × anchorCount × targetSteps');
console.log('═'.repeat(140));
console.log();

const header = [
  'n'.padEnd(5),
  'target'.padEnd(10),
  'anchors'.padEnd(11),
  'st'.padEnd(4),
  'actual'.padEnd(12),
  'diff'.padEnd(8),
  'anchor strategy'.padEnd(22),
  'completions'.padEnd(15),
  'attempts'.padEnd(12),
  'time',
].join('');
console.log(header);
console.log('─'.repeat(140));

const allCases = buildTestCases();
const results: TestResult[] = [];

let done = 0;
for (const tc of allCases) {
  const r = runTestCase(tc);
  results.push(r);
  done++;
  console.log(formatRow(r));
  // Progress update every 10 cases
  if (done % 20 === 0) {
    const exactCount = results.filter(x => x.status === 'exact').length;
    const approxCount = results.filter(x => x.status === 'approximate').length;
    const failCount = results.filter(x => x.status === 'failed').length;
    console.log(`  ... ${done}/${allCases.length} | exact=${exactCount} approx=${approxCount} fail=${failCount}`);
  }
}

console.log('═'.repeat(140));
console.log();

// ── Summary tables ──────────────────────────────────────────────

// 1. By n and targetSteps (averaged across anchorCounts)
console.log('## Success Rate by n × targetSteps');
console.log();
console.log(['n'.padEnd(5), 'target'.padEnd(8), 'exact%'.padEnd(8), 'approx%'.padEnd(8), 'fail%'.padEnd(8), 'avg time'.padEnd(10), 'avg diff'].join(''));
console.log('─'.repeat(55));

const byNSteps = new Map<string, TestResult[]>();
for (const r of results) {
  const key = `${r.n}-${r.targetSteps}`;
  if (!byNSteps.has(key)) byNSteps.set(key, []);
  byNSteps.get(key)!.push(r);
}

for (const [key, group] of [...byNSteps.entries()].sort()) {
  const total = group.length;
  const exact = group.filter(r => r.status === 'exact').length;
  const approx = group.filter(r => r.status === 'approximate').length;
  const fail = group.filter(r => r.status === 'failed').length;
  const avgTime = group.reduce((s, r) => s + r.elapsedMs, 0) / total;
  const avgDiff = group.filter(r => r.diff !== null).reduce((s, r) => s + Math.abs(r.diff!), 0) / group.filter(r => r.diff !== null).length || 0;

  console.log([
    `n=${group[0].n}`.padEnd(5),
    `${group[0].targetSteps}`.padEnd(8),
    `${(exact / total * 100).toFixed(0)}%`.padEnd(8),
    `${(approx / total * 100).toFixed(0)}%`.padEnd(8),
    `${(fail / total * 100).toFixed(0)}%`.padEnd(8),
    `${(avgTime / 1000).toFixed(1)}s`.padEnd(10),
    avgDiff.toFixed(1).padEnd(8),
  ].join(''));
}

console.log();

// 2. By anchorCount
console.log('## Success Rate by anchorCount');
console.log();
console.log(['anchors'.padEnd(10), 'exact%'.padEnd(8), 'approx%'.padEnd(8), 'fail%'.padEnd(8), 'avg attempts'.padEnd(14), 'avg time'].join(''));
console.log('─'.repeat(60));

for (const ac of [1, 2, 3, 4]) {
  const group = results.filter(r => r.anchorCount === ac);
  const total = group.length;
  const exact = group.filter(r => r.status === 'exact').length;
  const approx = group.filter(r => r.status === 'approximate').length;
  const fail = group.filter(r => r.status === 'failed').length;
  const avgAttempts = group.reduce((s, r) => s + r.attempts, 0) / total;
  const avgTime = group.reduce((s, r) => s + r.elapsedMs, 0) / total;

  console.log([
    `${ac}`.padEnd(10),
    `${(exact / total * 100).toFixed(0)}%`.padEnd(8),
    `${(approx / total * 100).toFixed(0)}%`.padEnd(8),
    `${(fail / total * 100).toFixed(0)}%`.padEnd(8),
    avgAttempts.toFixed(0).padEnd(14),
    `${(avgTime / 1000).toFixed(1)}s`.padEnd(10),
  ].join(''));
}

console.log();

// 3. By n (averaged across all)
console.log('## Success Rate by Board Size n');
console.log();
console.log(['n'.padEnd(5), 'exact%'.padEnd(8), 'approx%'.padEnd(8), 'fail%'.padEnd(8), 'avg attempts'.padEnd(14), 'avg time'].join(''));
console.log('─'.repeat(50));

for (let n = 5; n <= 10; n++) {
  const group = results.filter(r => r.n === n);
  const total = group.length;
  const exact = group.filter(r => r.status === 'exact').length;
  const approx = group.filter(r => r.status === 'approximate').length;
  const fail = group.filter(r => r.status === 'failed').length;
  const avgAttempts = group.reduce((s, r) => s + r.attempts, 0) / total;
  const avgTime = group.reduce((s, r) => s + r.elapsedMs, 0) / total;

  console.log([
    `${n}`.padEnd(5),
    `${(exact / total * 100).toFixed(0)}%`.padEnd(8),
    `${(approx / total * 100).toFixed(0)}%`.padEnd(8),
    `${(fail / total * 100).toFixed(0)}%`.padEnd(8),
    avgAttempts.toFixed(0).padEnd(14),
    `${(avgTime / 1000).toFixed(1)}s`.padEnd(10),
  ].join(''));
}

console.log();

// 4. Anchor strategy distribution
console.log('## Anchor Strategy Distribution (exact results only)');
console.log();
const exactResults = results.filter(r => r.status === 'exact' && r.anchorStrategy);
const strategyCounts = new Map<string, number>();
for (const r of exactResults) {
  const s = r.anchorStrategy!;
  strategyCounts.set(s, (strategyCounts.get(s) || 0) + 1);
}
for (const [s, c] of [...strategyCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(30)} ${c}`);
}

console.log();
console.log('═'.repeat(140));
console.log(`Total: ${results.length} test cases | Exact: ${results.filter(r=>r.status==='exact').length} | Approx: ${results.filter(r=>r.status==='approximate').length} | Failed: ${results.filter(r=>r.status==='failed').length}`);
