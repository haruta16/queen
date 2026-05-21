import { generateReverseLevel } from '../src/game/reverseGenNew';

const MATRIX = [
  { n: 5, target: 9 }, { n: 5, target: 12 }, { n: 5, target: 15 },
  { n: 6, target: 11 }, { n: 6, target: 14 }, { n: 6, target: 17 },
  { n: 7, target: 13 }, { n: 7, target: 16 }, { n: 7, target: 20 },
  { n: 8, target: 16 }, { n: 8, target: 20 }, { n: 8, target: 24 },
  { n: 9, target: 18 }, { n: 9, target: 22 }, { n: 9, target: 26 },
  { n: 10, target: 21 }, { n: 10, target: 25 }, { n: 10, target: 30 },
];

const SEEDS = 10;
const ATTEMPTS = 50;

console.log('Phase 1 v2 benchmark...\n');

for (const { n, target } of MATRIX) {
  let hits = 0, exact = 0, totalSteps = 0, totalTypes = 0;
  const strats: Record<string, number> = {};

  for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + n * 1000 + target * 100 + s * 7;
    const r = generateReverseLevel({ n, targetSteps: target, seed, maxAttempts: ATTEMPTS, allowApproximate: true });
    if (r.level && r.level.solverResult.complete) {
      hits++;
      if (r.status === 'exact') exact++;
      totalSteps += r.level.actualSteps;
      totalTypes += r.level.solverResult.strategyTypesUsed.length;
      for (const t of r.level.strategySequence) strats[t] = (strats[t] || 0) + 1;
    }
  }

  const avgSteps = hits > 0 ? Math.round(totalSteps / hits) : 0;
  const avgDev = hits > 0 ? Math.round((totalSteps / hits - target) * 10) / 10 : 0;
  const avgTypes = hits > 0 ? Math.round((totalTypes / hits) * 10) / 10 : 0;
  const l1Pct = hits > 0 ? Math.round(((strats['L1'] || 0) / (totalSteps || 1)) * 100) : 0;
  const l21Pct = hits > 0 ? Math.round(((strats['L2_Lock1'] || 0) / (totalSteps || 1)) * 100) : 0;

  console.log(
    `n=${n} t=${String(target).padEnd(3)} hit=${String(Math.round(hits / SEEDS * 100) + '%').padEnd(4)} ` +
    `exact=${String(Math.round(exact / SEEDS * 100) + '%').padEnd(4)} ` +
    `avgSteps=${String(avgSteps).padEnd(3)} dev=${String(avgDev).padEnd(5)} ` +
    `types=${avgTypes} L1=${l1Pct}% L2_L1=${l21Pct}%`
  );
}

const totalHits = MATRIX.reduce((s, m) => {
  let h = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = 1000 + m.n * 1000 + m.target * 100 + i * 7;
    const r = generateReverseLevel({ n: m.n, targetSteps: m.target, seed, maxAttempts: ATTEMPTS, allowApproximate: true });
    if (r.level && r.level.solverResult.complete) h++;
  }
  return s + h;
}, 0);

console.log(`\nOverall: ${totalHits}/${MATRIX.length * SEEDS} = ${Math.round(totalHits / (MATRIX.length * SEEDS) * 100)}%`);
