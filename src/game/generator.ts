import { Position, Region, Level, GeneratorParams } from './types';
import { createEmptyBoard, getQueenPositions } from './rules';
import { applyBatchesUpTo, solve } from './solver';
import { createRNG, shuffle, randInt } from './random';

// ============================================================
// Queen Puzzle Generator
// ============================================================

/** Generate n non-adjacent Queen positions via randomized backtracking */
export function generateQueenPositions(n: number, rng: () => number): Position[] {
  const positionRows = shuffle(Array.from({ length: n }, (_, i) => i), rng);

  const solution: Position[] = [];

  function backtrack(rowIndex: number): boolean {
    if (rowIndex >= n) return true;

    const row = positionRows[rowIndex];
    const cols = shuffle(Array.from({ length: n }, (_, i) => i), rng);

    for (const col of cols) {
      // Check column conflict
      if (solution.some(q => q.col === col)) continue;

      // Check adjacency conflict (8-neighbourhood)
      const adj = solution.some(q => {
        const dr = Math.abs(q.row - row);
        const dc = Math.abs(q.col - col);
        return dr <= 1 && dc <= 1;
      });
      if (adj) continue;

      solution.push({ row, col });
      if (backtrack(rowIndex + 1)) return true;
      solution.pop();
    }

    return false;
  }

  if (!backtrack(0)) {
    throw new Error(`Failed to generate ${n} non-adjacent Queen positions`);
  }

  return solution;
}

/** Multi-source BFS competitive region growth with variable region sizes */
export function generateRegions(
  n: number,
  queenPositions: Position[],
  complexity: number,
  rng: () => number,
): Region[] {
  const numRegions = queenPositions.length;
  const regionId: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  const regionSeeds: Position[] = [];

  for (let i = 0; i < queenPositions.length; i++) {
    const { row, col } = queenPositions[i];
    regionId[row][col] = i;
    regionSeeds.push({ row, col });
  }

  // Target sizes are intentionally varied. Low complexity keeps more small
  // foothold regions; high complexity spreads candidates across larger regions.
  const targetSizes: number[] = Array(numRegions).fill(1);
  const totalCells = n * n;

  const shuffledIndices = shuffle(Array.from({ length: numRegions }, (_, i) => i), rng);
  const smallCount = Math.max(1, Math.min(numRegions - 1, Math.round(numRegions * (0.45 - complexity * 0.25))));
  const lockedSmall = new Set<number>(shuffledIndices.slice(0, Math.max(1, Math.floor(smallCount / 2))));

  for (let i = 0; i < smallCount; i++) {
    targetSizes[shuffledIndices[i]] = lockedSmall.has(shuffledIndices[i])
      ? 1
      : 2 + Math.floor(rng() * 2);
  }

  let remainingCells = totalCells - targetSizes.reduce((a, b) => a + b, 0);
  while (remainingCells > 0) {
    const weights = shuffledIndices.map((rid, order) => {
      const base = 1 + complexity * 3 + rng() * 2;
      const smallPenalty = order < smallCount ? 0.25 : 1;
      return { rid, weight: base * smallPenalty };
    });
    const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
    let roll = rng() * totalWeight;
    for (const item of weights) {
      roll -= item.weight;
      if (roll <= 0) {
        targetSizes[item.rid]++;
        remainingCells--;
        break;
      }
    }
  }

  // Track current region sizes
  const currentSizes: number[] = Array(numRegions).fill(1); // seeds already placed
  const dirs = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
    { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
  ];

  function getNeighbors(pos: Position): Position[] {
    const result: Position[] = [];
    for (const { dr, dc } of dirs) {
      const nr = pos.row + dr, nc = pos.col + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionId[nr][nc] === -1) {
        result.push({ row: nr, col: nc });
      }
    }
    return result;
  }

  // BFS: prioritize regions that haven't reached their target size
  let queue = queenPositions.map((p, i) => ({ pos: p, rid: i }));
  let unassigned = totalCells - numRegions;

  while (unassigned > 0 && queue.length > 0) {
    // Shuffle queue order for randomness
    queue = shuffle(queue, rng);

    // Sort: regions below target size first
    queue.sort((a, b) => {
      const aUnder = currentSizes[a.rid] < targetSizes[a.rid] ? 0 : 1;
      const bUnder = currentSizes[b.rid] < targetSizes[b.rid] ? 0 : 1;
      if (aUnder !== bUnder) return aUnder - bUnder;
      return 0;
    });

    const nextQueue: { pos: Position; rid: number }[] = [];
    const assignedToday = new Set<string>();

    for (const { pos, rid } of queue) {
      if (currentSizes[rid] >= targetSizes[rid]) {
        nextQueue.push({ pos, rid });
        continue; // region is full, skip expansion
      }

      const avail = getNeighbors(pos);
      if (avail.length === 0) continue;

      // Filter already assigned in this round
      const free = avail.filter(n => !assignedToday.has(`${n.row},${n.col}`));
      if (free.length === 0) continue;

      // Choose neighbor
      const seed = regionSeeds[rid];
      let chosen: Position;

      if (rng() < complexity) {
        chosen = free[randInt(rng, 0, free.length - 1)];
      } else {
        const sameRowCol = free.filter(n => n.row === seed.row || n.col === seed.col);
        if (sameRowCol.length > 0) {
          chosen = sameRowCol[randInt(rng, 0, sameRowCol.length - 1)];
        } else {
          chosen = free[randInt(rng, 0, free.length - 1)];
        }
      }

      const key = `${chosen.row},${chosen.col}`;
      assignedToday.add(key);
      regionId[chosen.row][chosen.col] = rid;
      currentSizes[rid]++;
      unassigned--;

      // Add the new cell as a frontier
      nextQueue.push({ pos: chosen, rid });

      // Keep current pos in queue if it still has neighbors and region isn't full
      const remaining = getNeighbors(pos).filter(n =>
        regionId[n.row][n.col] === -1 && !assignedToday.has(`${n.row},${n.col}`)
      );
      if (remaining.length > 0 && currentSizes[rid] < targetSizes[rid]) {
        nextQueue.push({ pos, rid });
      }
    }

    queue = nextQueue;

    // If no expansion happened, all regions have reached targets or are blocked
    if (assignedToday.size === 0) break;
  }

  // Fill any remaining unassigned cells (regions may not fill perfectly)
  let filledThisPass = true;
  while (filledThisPass) {
    filledThisPass = false;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (regionId[r][c] !== -1) continue;

        const adjacentRegions = new Set<number>();
        for (const { dr, dc } of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionId[nr][nc] !== -1) {
            adjacentRegions.add(regionId[nr][nc]);
          }
        }
        if (adjacentRegions.size === 0) continue;

        const flexibleAdjacent = Array.from(adjacentRegions).filter(rid => !lockedSmall.has(rid));
        const candidateRegions = flexibleAdjacent.length > 0 ? flexibleAdjacent : Array.from(adjacentRegions);
        let bestRid = -1, bestSize = Infinity;
        for (const rid of candidateRegions) {
          if (currentSizes[rid] < bestSize) {
            bestSize = currentSizes[rid];
            bestRid = rid;
          }
        }
        regionId[r][c] = bestRid;
        currentSizes[bestRid]++;
        filledThisPass = true;
      }
    }
  }

  // Safety fallback: assign any isolated leftover to the nearest non-locked region.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regionId[r][c] !== -1) continue;
      let bestRid = 0;
      let bestDist = Infinity;
      for (let rr = 0; rr < n; rr++) {
        for (let cc = 0; cc < n; cc++) {
          const rid = regionId[rr][cc];
          if (rid === -1 || lockedSmall.has(rid)) continue;
          const dist = Math.abs(rr - r) + Math.abs(cc - c);
          if (dist < bestDist) {
            bestDist = dist;
            bestRid = rid;
          }
        }
      }
      regionId[r][c] = bestRid;
      currentSizes[bestRid]++;
    }
  }

  // Build Region objects
  const regionMap = new Map<number, Position[]>();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const rid = regionId[r][c];
      if (!regionMap.has(rid)) regionMap.set(rid, []);
      regionMap.get(rid)!.push({ row: r, col: c });
    }
  }

  return Array.from(regionMap.entries()).map(([id, cells]) => ({ id, cells }));
}

// ============================================================

function generateFallbackRegions(n: number, queenPositions: Position[]): Region[] {
  const singletonQueens = queenPositions.slice(0, Math.max(1, n - 1));
  const singletonKeys = new Set(singletonQueens.map(p => `${p.row},${p.col}`));
  const regions: Region[] = singletonQueens.map((pos, id) => ({ id, cells: [pos] }));
  const finalRegion: Region = { id: regions.length, cells: [] };

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!singletonKeys.has(`${row},${col}`)) {
        finalRegion.cells.push({ row, col });
      }
    }
  }

  return [...regions, finalRegion];
}

function generateScaffoldRegions(
  n: number,
  queenPositions: Position[],
  singletonCount: number,
): Region[] {
  const lockedCount = Math.max(0, Math.min(singletonCount, n - 1));
  const lockedKeys = new Set(queenPositions.slice(0, lockedCount).map(p => `${p.row},${p.col}`));
  const regionCells: Position[][] = Array.from({ length: n }, () => []);

  for (let rid = 0; rid < lockedCount; rid++) {
    regionCells[rid].push(queenPositions[rid]);
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const key = `${row},${col}`;
      if (lockedKeys.has(key)) continue;

      let bestRid = lockedCount;
      let bestDist = Infinity;
      for (let rid = lockedCount; rid < n; rid++) {
        const seed = queenPositions[rid];
        const dist = Math.abs(seed.row - row) + Math.abs(seed.col - col);
        if (dist < bestDist) {
          bestDist = dist;
          bestRid = rid;
        }
      }
      regionCells[bestRid].push({ row, col });
    }
  }

  return regionCells.map((cells, id) => ({ id, cells }));
}

function buildLevel(
  n: number,
  regions: Region[],
  queenPositions: Position[],
  seed: number,
  targetSteps: number,
  retry: number,
): Level | null {
  const board = createEmptyBoard(n, regions);
  const result = solve(board);
  if (!result.complete) return null;
  const solvedBoard = applyBatchesUpTo(board, result.batches, result.totalSteps);
  const solution = getQueenPositions(solvedBoard);

  return {
    id: `L${n}x${n}-${seed}-${retry}`,
    n,
    regions,
    solution,
    seed,
    targetSteps,
    actualSteps: result.totalSteps,
    strategySequence: result.batches.map(b => b.strategy),
    solverResult: result,
  };
}

/**
 * Generate a complete, solvable Level.
 *
 * Uses binary search on `complexity` to match targetSteps.
 */
export function generateLevel(params: GeneratorParams): Level | null {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();

  // Estimated step range for this n (calibrated for solver that records L1_Direct batches)
  const minStepsEst = n * 2;           // min: all queens confirmed in sequence with L1 propagation
  const maxStepsEst = n * 4 + 4;       // max: complex with L2/L3 interleaved

  const maxRetries = Math.min(900, Math.max(220, n * 55 + targetSteps * 10));

  // Initial complexity guess
  let lo = 0.0;
  let hi = 1.0;
  let complexity = Math.max(0, Math.min(1, (targetSteps - minStepsEst) / (maxStepsEst - minStepsEst)));

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;

  const considerLevel = (level: Level | null): Level | null => {
    if (!level) return null;
    const diff = level.actualSteps - targetSteps;
    if (diff === 0) return level;
    if (Math.abs(diff) < bestDiff) {
      bestDiff = Math.abs(diff);
      bestLevel = level;
    }
    return null;
  };

  // Constructive pass: on large boards, deterministic scaffold regions are far
  // more reliable than pure random growth. They create a real opening while
  // preserving enough region variation for the solver-loop step count to differ.
  const scaffoldRng = createRNG(actualSeed + 31_337);
  for (let attempt = 0; attempt < Math.max(8, n * 2); attempt++) {
    let queenPositions: Position[];
    try {
      queenPositions = generateQueenPositions(n, scaffoldRng);
    } catch {
      continue;
    }
    const order = shuffle(queenPositions, scaffoldRng);
    const counts = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const preferred = Math.round(n * 0.55 + (targetSteps / Math.max(1, n * 3)) * n * 0.35);
      return Math.abs(a - preferred) - Math.abs(b - preferred);
    });
    for (const singletonCount of counts) {
      const scaffold = generateScaffoldRegions(n, order, singletonCount);
      const exact = considerLevel(buildLevel(n, scaffold, order, actualSeed, targetSteps, -1000 - attempt * 20 - singletonCount));
      if (exact) return exact;
    }
  }

  for (let retry = 0; retry < maxRetries; retry++) {
    // Use a fresh RNG branch for each retry to get different Queen+Region combos
    const retryRng = createRNG(actualSeed + retry * 7919);

    let queenPositions: Position[];
    try {
      queenPositions = generateQueenPositions(n, retryRng);
    } catch {
      continue;
    }

    const regions = generateRegions(n, queenPositions, complexity, retryRng);
    const level = buildLevel(n, regions, queenPositions, actualSeed, targetSteps, retry);
    if (!level) {
      continue;
    }

    const steps = level.actualSteps;
    const diff = steps - targetSteps;

    // Exact target hit. Non-unique boards are allowed; solver-loop step count is the contract.
    const exact = considerLevel(level);
    if (exact) return exact;

    // Binary search adjustment
    if (diff < 0) {
      lo = complexity;
    } else {
      hi = complexity;
    }

    const wobble = ((retry % 9) - 4) * 0.035;
    complexity = Math.max(0, Math.min(1, (lo + hi) / 2 + wobble));

    // Binary search converged — reset search with fresh seed direction
    if (hi - lo < 0.03) {
      lo = 0.0;
      hi = 1.0;
      complexity = Math.max(0, Math.min(1, (targetSteps - minStepsEst + (retry % 7) * 2) / (maxStepsEst - minStepsEst)));
    }
  }

  if (bestLevel) return bestLevel;

  const fallbackRng = createRNG(actualSeed + 97_531);
  const fallbackQueens = generateQueenPositions(n, fallbackRng);
  const fallbackRegions = generateFallbackRegions(n, fallbackQueens);
  return buildLevel(n, fallbackRegions, fallbackQueens, actualSeed, targetSteps, maxRetries);
}

/**
 * Map user-friendly complexity labels to targetSteps range for a given n.
 */
export function complexityToTargetSteps(n: number, label: '简单' | '中等' | '困难'): number {
  const ranges: Record<number, { min: number; max: number }> = {
    5: { min: 8, max: 13 },
    6: { min: 10, max: 16 },
    7: { min: 12, max: 19 },
    8: { min: 14, max: 22 },
    9: { min: 16, max: 26 },
    10: { min: 18, max: 30 },
  };

  const range = ranges[n] ?? { min: 10, max: 50 };
  switch (label) {
    case '简单': return Math.floor(range.min + (range.max - range.min) * 0.2);
    case '中等': return Math.floor(range.min + (range.max - range.min) * 0.5);
    case '困难': return Math.floor(range.min + (range.max - range.min) * 0.8);
  }
}
