import {
  Position,
  Region,
  Level,
  GeneratorParams,
  GenerationDiagnostics,
  GenerationResult,
  GenerationStatus,
} from './types';
import { createEmptyBoard, getQueenPositions } from './rules';
import { applyBatchesUpTo, solve } from './solver';
import { createRNG, shuffle, randInt } from './random';
import { generateLevelReverse } from './reverseGenerator';

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

/** Multi-source competitive region growth with no locked singleton scaffolds */
export function generateRegions(
  n: number,
  queenPositions: Position[],
  shapeBias: number,
  rng: () => number,
): Region[] {
  const numRegions = queenPositions.length;
  const regionId: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  const regionCells: Position[][] = Array.from({ length: numRegions }, () => []);
  const bias = Math.max(0, Math.min(1, shapeBias));

  for (let i = 0; i < queenPositions.length; i++) {
    const { row, col } = queenPositions[i];
    regionId[row][col] = i;
    regionCells[i].push({ row, col });
  }

  const minRegionSize = 2;
  const totalCells = n * n;
  const targetSizes: number[] = Array(numRegions).fill(minRegionSize);
  let remainingCells = totalCells - minRegionSize * numRegions;

  const weights = Array.from({ length: numRegions }, () => {
    const variance = 0.45 + bias * 2.2;
    return 0.4 + Math.pow(rng(), variance) * (1.8 + bias * 3.2);
  });
  while (remainingCells > 0) {
    const totalWeight = weights.reduce((sum, weight, rid) => {
      const sizeDampener = targetSizes[rid] > n * 1.75 ? 0.22 : 1;
      return sum + weight * sizeDampener;
    }, 0);
    let roll = rng() * totalWeight;
    for (let rid = 0; rid < numRegions; rid++) {
      const sizeDampener = targetSizes[rid] > n * 1.75 ? 0.22 : 1;
      roll -= weights[rid] * sizeDampener;
      if (roll <= 0) {
        targetSizes[rid]++;
        remainingCells--;
        break;
      }
    }
  }

  const currentSizes: number[] = Array(numRegions).fill(1);
  const dirs = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
    { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
  ];
  const orientations = Array.from({ length: numRegions }, () => {
    const roll = rng();
    if (roll < 0.4) return 'row';
    if (roll < 0.8) return 'col';
    return 'free';
  });

  function unassignedNeighbors(pos: Position): Position[] {
    const neighbors: Position[] = [];
    for (const { dr, dc } of dirs) {
      const nr = pos.row + dr, nc = pos.col + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionId[nr][nc] === -1) {
        neighbors.push({ row: nr, col: nc });
      }
    }
    return neighbors;
  }

  let unassigned = totalCells - numRegions;
  while (unassigned > 0) {
    const options: { rid: number; pos: Position; score: number }[] = [];

    for (let rid = 0; rid < numRegions; rid++) {
      const canOverflow = currentSizes.every((size, index) => size >= targetSizes[index]);
      if (!canOverflow && currentSizes[rid] >= targetSizes[rid]) continue;

      const seen = new Set<string>();
      for (const cell of regionCells[rid]) {
        for (const pos of unassignedNeighbors(cell)) {
          const key = `${pos.row},${pos.col}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const seed = queenPositions[rid];
          const orientation = orientations[rid];
          const onPreferredLine =
            (orientation === 'row' && pos.row === seed.row) ||
            (orientation === 'col' && pos.col === seed.col);
          const underTarget = Math.max(0, targetSizes[rid] - currentSizes[rid]);
          const bootstrap = currentSizes[rid] < minRegionSize ? 40 : 0;
          const lineScore = onPreferredLine ? 2 + bias * 7 : 0;
          const sizeScore = underTarget * (1.1 + bias * 1.2);
          options.push({
            rid,
            pos,
            score: bootstrap + lineScore + sizeScore + rng() * 1.8,
          });
        }
      }
    }

    if (options.length === 0) break;
    options.sort((a, b) => b.score - a.score);
    const window = options.slice(0, Math.max(1, Math.min(options.length, 4 + Math.floor(bias * 8))));
    const chosen = window[randInt(rng, 0, window.length - 1)];
    regionId[chosen.pos.row][chosen.pos.col] = chosen.rid;
    regionCells[chosen.rid].push(chosen.pos);
    currentSizes[chosen.rid]++;
    unassigned--;
  }

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

        const candidateRegions = Array.from(adjacentRegions);
        let bestRid = -1, bestSize = Infinity;
        for (const rid of candidateRegions) {
          if (currentSizes[rid] < bestSize) {
            bestSize = currentSizes[rid];
            bestRid = rid;
          }
        }
        regionId[r][c] = bestRid;
        currentSizes[bestRid]++;
        regionCells[bestRid].push({ row: r, col: c });
        filledThisPass = true;
      }
    }
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regionId[r][c] !== -1) continue;
      let bestRid = 0;
      let bestDist = Infinity;
      for (let rr = 0; rr < n; rr++) {
        for (let cc = 0; cc < n; cc++) {
          const rid = regionId[rr][cc];
          if (rid === -1) continue;
          const dist = Math.abs(rr - r) + Math.abs(cc - c);
          if (dist < bestDist) {
            bestDist = dist;
            bestRid = rid;
          }
        }
      }
      regionId[r][c] = bestRid;
      currentSizes[bestRid]++;
      regionCells[bestRid].push({ row: r, col: c });
    }
  }

  return regionCells.map((cells, id) => ({ id, cells }));
}

// ============================================================

function generateKeyedRegions(
  n: number,
  queenPositions: Position[],
  requestedKeyCount: number,
  rng: () => number,
): Region[] | null {
  const numRegions = queenPositions.length;
  const regionId: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  const regionCells: Position[][] = Array.from({ length: numRegions }, () => []);
  const occupied = new Set<string>();
  const lockedRegions = new Set<number>();
  const dirs = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
    { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
  ];

  const put = (rid: number, pos: Position) => {
    regionId[pos.row][pos.col] = rid;
    regionCells[rid].push(pos);
    occupied.add(`${pos.row},${pos.col}`);
  };

  for (let rid = 0; rid < numRegions; rid++) {
    put(rid, queenPositions[rid]);
  }

  const queenKeys = new Set(queenPositions.map(p => `${p.row},${p.col}`));
  const order = shuffle(Array.from({ length: numRegions }, (_, i) => i), rng);
  const keyLimit = Math.max(0, Math.min(requestedKeyCount, numRegions - 1));

  for (const rid of order) {
    if (lockedRegions.size >= keyLimit) break;
    const q = queenPositions[rid];
    const mates = shuffle(dirs.map(({ dr, dc }) => ({ row: q.row + dr, col: q.col + dc })), rng)
      .filter(pos =>
        pos.row >= 0 && pos.row < n &&
        pos.col >= 0 && pos.col < n &&
        !queenKeys.has(`${pos.row},${pos.col}`) &&
        !occupied.has(`${pos.row},${pos.col}`),
      );
    if (mates.length === 0) continue;
    put(rid, mates[0]);
    lockedRegions.add(rid);
  }

  if (lockedRegions.size === 0) return null;

  const activeRegions = Array.from({ length: numRegions }, (_, i) => i)
    .filter(rid => !lockedRegions.has(rid));
  if (activeRegions.length === 0) return null;

  let unassigned = n * n - occupied.size;

  function unassignedNeighbors(pos: Position): Position[] {
    const neighbors: Position[] = [];
    for (const { dr, dc } of dirs) {
      const nr = pos.row + dr, nc = pos.col + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionId[nr][nc] === -1) {
        neighbors.push({ row: nr, col: nc });
      }
    }
    return neighbors;
  }

  while (unassigned > 0) {
    const options: { rid: number; pos: Position; score: number }[] = [];
    for (const rid of activeRegions) {
      const seen = new Set<string>();
      for (const cell of regionCells[rid]) {
        for (const pos of unassignedNeighbors(cell)) {
          const key = `${pos.row},${pos.col}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const seed = queenPositions[rid];
          const lineBias = pos.row === seed.row || pos.col === seed.col ? 1.7 : 0;
          const sizeBalance = 1 / Math.max(1, regionCells[rid].length);
          options.push({ rid, pos, score: lineBias + sizeBalance * 5 + rng() });
        }
      }
    }

    if (options.length === 0) break;
    options.sort((a, b) => b.score - a.score);
    const chosen = options[randInt(rng, 0, Math.min(5, options.length - 1))];
    put(chosen.rid, chosen.pos);
    unassigned--;
  }

  let filledThisPass = true;
  while (filledThisPass) {
    filledThisPass = false;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (regionId[row][col] !== -1) continue;
        const adjacent = new Set<number>();
        for (const { dr, dc } of dirs) {
          const nr = row + dr, nc = col + dc;
          if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionId[nr][nc] !== -1) {
            const rid = regionId[nr][nc];
            if (!lockedRegions.has(rid)) adjacent.add(rid);
          }
        }
        if (adjacent.size === 0) continue;
        const rid = Array.from(adjacent).sort((a, b) => regionCells[a].length - regionCells[b].length)[0];
        put(rid, { row, col });
        filledThisPass = true;
      }
    }
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (regionId[row][col] !== -1) continue;
      let bestRid = activeRegions[0];
      let bestDist = Infinity;
      for (const rid of activeRegions) {
        for (const cell of regionCells[rid]) {
          const dist = Math.abs(row - cell.row) + Math.abs(col - cell.col);
          if (dist < bestDist) {
            bestDist = dist;
            bestRid = rid;
          }
        }
      }
      put(bestRid, { row, col });
    }
  }

  return regionCells.map((cells, id) => ({ id, cells }));
}

// ============================================================

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

function cloneRegions(regions: Region[]): Region[] {
  return regions.map(region => ({
    id: region.id,
    cells: region.cells.map(pos => ({ ...pos })),
  }));
}

function isConnected(cells: Position[]): boolean {
  if (cells.length <= 1) return true;
  const cellKeys = new Set(cells.map(pos => `${pos.row},${pos.col}`));
  const queue = [cells[0]];
  const seen = new Set<string>([`${cells[0].row},${cells[0].col}`]);
  const dirs = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
    { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const { dr, dc } of dirs) {
      const next = { row: current.row + dr, col: current.col + dc };
      const key = `${next.row},${next.col}`;
      if (!cellKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }

  return seen.size === cells.length;
}

function tryMutateRegions(
  n: number,
  regions: Region[],
  queenPositions: Position[],
  rng: () => number,
): Region[] | null {
  const queenKeys = new Set(queenPositions.map(pos => `${pos.row},${pos.col}`));
  const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  for (const region of regions) {
    for (const cell of region.cells) {
      grid[cell.row][cell.col] = region.id;
    }
  }

  const dirs = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
    { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
  ];
  const movable: { from: number; to: number; pos: Position }[] = [];

  for (const region of regions) {
    if (region.cells.length <= 2) continue;
    for (const pos of region.cells) {
      if (queenKeys.has(`${pos.row},${pos.col}`)) continue;
      const adjacentRegions = new Set<number>();
      for (const { dr, dc } of dirs) {
        const nr = pos.row + dr, nc = pos.col + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
        const rid = grid[nr][nc];
        if (rid !== -1 && rid !== region.id) adjacentRegions.add(rid);
      }
      for (const to of adjacentRegions) {
        movable.push({ from: region.id, to, pos });
      }
    }
  }

  if (movable.length === 0) return null;
  const move = movable[randInt(rng, 0, movable.length - 1)];
  const next = cloneRegions(regions);
  const from = next[move.from];
  const to = next[move.to];
  const fromCells = from.cells.filter(pos => pos.row !== move.pos.row || pos.col !== move.pos.col);
  if (!isConnected(fromCells)) return null;

  from.cells = fromCells;
  to.cells = [...to.cells, move.pos];
  return next;
}

function refineLevel(
  level: Level,
  queenPositions: Position[],
  targetSteps: number,
  rng: () => number,
  budget: number,
): Level {
  let current = level;
  let best = level;

  for (let i = 0; i < budget; i++) {
    const mutated = tryMutateRegions(level.n, current.regions, queenPositions, rng);
    if (!mutated) continue;

    const candidate = buildLevel(
      level.n,
      mutated,
      queenPositions,
      level.seed,
      targetSteps,
      Number(`${Math.abs(level.seed % 1000)}${i}`),
    );
    if (!candidate) continue;

    const candidateDiff = Math.abs(candidate.actualSteps - targetSteps);
    const bestDiff = Math.abs(best.actualSteps - targetSteps);
    const betterForHighTarget = targetSteps > best.actualSteps && candidate.actualSteps > best.actualSteps;
    const acceptAsWalk = candidateDiff <= Math.abs(current.actualSteps - targetSteps) || rng() < 0.08;

    if (candidateDiff < bestDiff || betterForHighTarget) {
      best = candidate;
      current = candidate;
      if (candidateDiff === 0) return candidate;
      continue;
    }

    if (acceptAsWalk) {
      current = candidate;
    }
  }

  return best;
}

/**
 * Generate a complete, solvable Level with diagnostics.
 * This function never fabricates a fallback level: exact, approximate, and
 * failed searches are reported explicitly.
 */
export function generateLevelResult(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const allowApproximate = params.allowApproximate ?? false;
  const useKeyedRegions = params.useKeyedRegions ?? false;

  // Phase 1: Try reverse generator (fast, constraint-aware)
  const reverseResult = generateLevelReverse({
    ...params,
    seed: actualSeed,
    allowApproximate: false,
  });
  if (reverseResult.status === 'exact') {
    reverseResult.diagnostics.elapsedMs = Date.now() - startedAt;
    reverseResult.diagnostics.allowApproximate = allowApproximate;
    reverseResult.diagnostics.useKeyedRegions = useKeyedRegions;
    return reverseResult;
  }

  // Phase 2: Fall back to reverse with approximate if allowed
  if (allowApproximate && reverseResult.level) {
    const diag = reverseResult.diagnostics;
    diag.allowApproximate = allowApproximate;
    diag.useKeyedRegions = useKeyedRegions;
    diag.elapsedMs = Date.now() - startedAt;
    return { status: 'approximate', level: reverseResult.level, diagnostics: diag };
  }

  // Phase 3: Fall back to original brute-force generator for hard cases
  const maxAttempts = Math.max(1, Math.min(100_000, Math.round(
    params.maxAttempts ?? Math.max(600, Math.min(6000, n * targetSteps * 35)),
  )));

  let bestLevel: Level | null = reverseResult.level;
  let bestDiff = reverseResult.level
    ? Math.abs(reverseResult.level.actualSteps - targetSteps)
    : Infinity;
  let selectedAttempt: number | null = null;
  let selectedAttemptSeed: number | null = null;
  let attempts = 0;
  let completeCandidates = reverseResult.diagnostics.completeCandidates;
  let incompleteCandidates = reverseResult.diagnostics.incompleteCandidates;
  let exactCandidates = reverseResult.diagnostics.exactCandidates;

  const makeDiagnostics = (status: GenerationStatus): GenerationDiagnostics => ({
    status,
    attempts,
    maxAttempts,
    elapsedMs: Date.now() - startedAt,
    seed: actualSeed,
    targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt,
    selectedAttemptSeed,
    completeCandidates,
    incompleteCandidates,
    exactCandidates,
    allowApproximate,
    useKeyedRegions,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts = attempt + 1;
    const attemptSeed = actualSeed + attempt * 7919 + targetSteps * 101;
    const retryRng = createRNG(attemptSeed);

    let queenPositions: Position[];
    try {
      queenPositions = generateQueenPositions(n, retryRng);
    } catch {
      continue;
    }

    const targetRatio = Math.max(0, Math.min(1, targetSteps / Math.max(1, n * 4)));
    const profileCycle = (attempt % 13) / 12;
    const shapeBias = Math.max(0, Math.min(1, targetRatio * 0.55 + profileCycle * 0.45));
    const keySpan = Math.max(1, n - 2);
    const keyCount = Math.min(n - 1, 2 + ((attempt + Math.floor(targetSteps / 3)) % keySpan));
    const keyed = useKeyedRegions && attempt % 2 === 0
      ? generateKeyedRegions(n, queenPositions, keyCount, retryRng)
      : null;
    const regions = keyed ?? generateRegions(n, queenPositions, shapeBias, retryRng);
    const rawLevel = buildLevel(n, regions, queenPositions, actualSeed, targetSteps, attempt);
    const level = rawLevel
      ? refineLevel(rawLevel, queenPositions, targetSteps, retryRng, targetSteps > n * 2 ? 45 : 18)
      : null;
    if (!level) {
      incompleteCandidates++;
      continue;
    }

    completeCandidates++;
    const diff = level.actualSteps - targetSteps;
    if (diff === 0) {
      exactCandidates++;
      bestLevel = level;
      selectedAttempt = attempt;
      selectedAttemptSeed = attemptSeed;
      return {
        status: 'exact',
        level,
        diagnostics: makeDiagnostics('exact'),
      };
    }

    if (Math.abs(diff) < bestDiff) {
      bestDiff = Math.abs(diff);
      bestLevel = level;
      selectedAttempt = attempt;
      selectedAttemptSeed = attemptSeed;
    }
  }

  if (bestLevel && allowApproximate) {
    return {
      status: 'approximate',
      level: bestLevel,
      diagnostics: makeDiagnostics('approximate'),
    };
  }

  return {
    status: 'failed',
    level: null,
    diagnostics: makeDiagnostics('failed'),
  };
}

/**
 * Backward-compatible helper for tests and pure callers that only need a Level.
 */
export function generateLevel(params: GeneratorParams): Level | null {
  return generateLevelResult({
    ...params,
    allowApproximate: params.allowApproximate ?? true,
  }).level;
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
