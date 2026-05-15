import { BoardState, Position, Region, Level, GeneratorParams, SolverResult, StrategyType } from './types';
import { createEmptyBoard, cloneBoard, getAdjacentPositions } from './rules';
import { solve } from './solver';
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

  // Target sizes: ensure some regions are small (2-3 cells) for solver foothold,
  // and distribute remaining cells fairly among the rest
  const targetSizes: number[] = Array(numRegions).fill(0);
  const totalCells = n * n;

  const shuffledIndices = shuffle(Array.from({ length: numRegions }, (_, i) => i), rng);

  // Always have at least 2 small regions (2 cells each) and 1 medium (3-4 cells)
  const smallCount = Math.min(numRegions - 1, 2);
  const mediumCount = Math.min(numRegions - smallCount, 1);

  for (let i = 0; i < smallCount; i++) {
    targetSizes[shuffledIndices[i]] = 2;
  }
  for (let i = smallCount; i < smallCount + mediumCount; i++) {
    targetSizes[shuffledIndices[i]] = 3 + Math.floor(rng() * 2); // 3-4
  }

  // Distribute remaining cells among remaining regions
  const remainingCells = totalCells - targetSizes.reduce((a, b) => a + b, 0);
  const remainingRegions = numRegions - smallCount - mediumCount;
  if (remainingRegions > 0) {
    const baseSize = Math.floor(remainingCells / remainingRegions);
    for (let i = smallCount + mediumCount; i < numRegions; i++) {
      targetSizes[shuffledIndices[i]] = baseSize;
    }
    let remainder = remainingCells - baseSize * remainingRegions;
    for (let i = smallCount + mediumCount; i < numRegions && remainder > 0; i++) {
      targetSizes[shuffledIndices[i]]++;
      remainder--;
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
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regionId[r][c] === -1) {
        const adjacentRegions = new Set<number>();
        const pos: Position = { row: r, col: c };
        for (const { dr, dc } of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionId[nr][nc] !== -1) {
            adjacentRegions.add(regionId[nr][nc]);
          }
        }
        if (adjacentRegions.size > 0) {
          let bestRid = -1, bestSize = Infinity;
          for (const rid of adjacentRegions) {
            if (currentSizes[rid] < bestSize) {
              bestSize = currentSizes[rid];
              bestRid = rid;
            }
          }
          regionId[r][c] = bestRid;
          currentSizes[bestRid]++;
        }
      }
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

/**
 * Generate a complete, solvable Level.
 *
 * Uses binary search on `complexity` to match targetSteps.
 */
export function generateLevel(params: GeneratorParams): Level | null {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const rng = createRNG(actualSeed);

  // Estimated step range for this n (rough, solver will give exact numbers)
  const minStepsEst = n * 2 + 2;     // min: ~simple L1 chain
  const maxStepsEst = n * 6 + 6;     // max: ~complex with L3

  const tolerance = Math.max(3, Math.floor(targetSteps * 0.1));
  const maxRetries = 40;

  // Initial complexity guess
  let lo = 0.0;
  let hi = 1.0;
  let complexity = Math.max(0, Math.min(1, (targetSteps - minStepsEst) / (maxStepsEst - minStepsEst)));

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let consecutiveIncomplete = 0;

  for (let retry = 0; retry < maxRetries; retry++) {
    // Use a fresh RNG branch for each retry to get different Queen+Region combos
    const retryRng = createRNG(actualSeed + retry * 7919);

    let queenPositions: Position[];
    try {
      queenPositions = generateQueenPositions(n, retryRng);
    } catch {
      consecutiveIncomplete++;
      if (consecutiveIncomplete > 10) return bestLevel;
      continue;
    }

    const regions = generateRegions(n, queenPositions, complexity, retryRng);
    const board = createEmptyBoard(n, regions);
    const result = solve(board);

    if (!result.complete) {
      consecutiveIncomplete++;
      if (consecutiveIncomplete > 10) return bestLevel;
      continue;
    }

    consecutiveIncomplete = 0;
    const steps = result.totalSteps;
    const diff = steps - targetSteps;

    // Build level with full solver result
    const level: Level = {
      id: `L${n}x${n}-${actualSeed}-${retry}`,
      n,
      regions,
      seed: actualSeed,
      targetSteps,
      actualSteps: steps,
      strategySequence: result.batches.map(b => b.strategy),
      solverResult: result,
    };

    // Exact match or within tolerance
    if (Math.abs(diff) <= tolerance) return level;

    // Track best
    if (Math.abs(diff) < bestDiff) {
      bestDiff = Math.abs(diff);
      bestLevel = level;
    }

    // Binary search adjustment
    if (diff < 0) {
      // Too few steps → need more complexity
      lo = complexity;
    } else {
      // Too many steps → need less complexity
      hi = complexity;
    }

    complexity = (lo + hi) / 2;

    // Binary search converged
    if (hi - lo < 0.03) {
      return bestLevel; // return closest match
    }
  }

  return bestLevel;
}

/**
 * Map user-friendly complexity labels to targetSteps range for a given n.
 */
export function complexityToTargetSteps(n: number, label: '简单' | '中等' | '困难'): number {
  const ranges: Record<number, { min: number; max: number }> = {
    5: { min: 10, max: 35 },
    6: { min: 14, max: 42 },
    7: { min: 16, max: 52 },
    8: { min: 18, max: 58 },
    9: { min: 20, max: 65 },
    10: { min: 22, max: 72 },
  };

  const range = ranges[n] ?? { min: 10, max: 50 };
  switch (label) {
    case '简单': return Math.floor(range.min + (range.max - range.min) * 0.2);
    case '中等': return Math.floor(range.min + (range.max - range.min) * 0.5);
    case '困难': return Math.floor(range.min + (range.max - range.min) * 0.8);
  }
}
