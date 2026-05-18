import {
  Position,
  Region,
  Level,
  SolverResult,
} from './types';
import { createEmptyBoard, getQueenPositions } from './rules';
import { applyBatchesUpTo } from './solver';
import { shuffle, randInt } from './random';

// ============================================================
// Shared generator utilities — Queen layout + region fill + Level assembly
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
      if (solution.some(q => q.col === col)) continue;

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

/** Multi-source competitive region growth with optional pre-built anchor cells */
export function generateRegions(
  n: number,
  queenPositions: Position[],
  shapeBias: number,
  rng: () => number,
  anchorRegions?: Region[],
): Region[] {
  const numRegions = queenPositions.length;
  const regionId: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  const regionCells: Position[][] = Array.from({ length: numRegions }, () => []);
  const bias = Math.max(0, Math.min(1, shapeBias));

  const locked = new Set<string>();

  // Place Queens
  for (let i = 0; i < queenPositions.length; i++) {
    const { row, col } = queenPositions[i];
    regionId[row][col] = i;
    regionCells[i].push({ row, col });
    locked.add(`${row},${col}`);
  }

  // Pre-load anchor region cells
  if (anchorRegions) {
    for (const anchor of anchorRegions) {
      for (const cell of anchor.cells) {
        const key = `${cell.row},${cell.col}`;
        if (locked.has(key)) continue;
        regionId[cell.row][cell.col] = anchor.id;
        regionCells[anchor.id].push({ ...cell });
        locked.add(key);
      }
    }
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

  const frozenRegions = new Set<number>();
  if (anchorRegions) {
    for (const anchor of anchorRegions) {
      frozenRegions.add(anchor.id);
    }
  }

  const currentSizes: number[] = regionCells.map(c => c.length);
  const dirs = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
    { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
  ];
  // For n>=8, eliminate "free" orientation to prevent overgrown regions.
  const freeThreshold = n >= 8 ? 0 : 0.2;
  const orientations = Array.from({ length: numRegions }, () => {
    const roll = rng();
    if (roll < freeThreshold) return 'free';
    if (roll < 0.5 + freeThreshold * 0.5) return 'row';
    return 'col';
  });

  function unassignedNeighbors(pos: Position): Position[] {
    const neighbors: Position[] = [];
    for (const { dr, dc } of dirs) {
      const nr = pos.row + dr, nc = pos.col + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && regionId[nr][nc] === -1 && !locked.has(`${nr},${nc}`)) {
        neighbors.push({ row: nr, col: nc });
      }
    }
    return neighbors;
  }

  let unassigned = totalCells - regionCells.reduce((sum, c) => sum + c.length, 0);
  while (unassigned > 0) {
    const options: { rid: number; pos: Position; score: number }[] = [];

    for (let rid = 0; rid < numRegions; rid++) {
      if (frozenRegions.has(rid)) continue;
      if (currentSizes[rid] >= n * 2) continue;
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
          const lineScore = onPreferredLine ? (2 + bias * 7) * Math.max(2, Math.ceil(n * 0.5)) : 0;
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

        const candidateRegions = Array.from(adjacentRegions).filter(rid => !frozenRegions.has(rid));
        if (candidateRegions.length === 0) continue;
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
      let bestRid = -1;
      let bestDist = Infinity;
      for (let rr = 0; rr < n; rr++) {
        for (let cc = 0; cc < n; cc++) {
          const rid = regionId[rr][cc];
          if (rid === -1 || frozenRegions.has(rid)) continue;
          const dist = Math.abs(rr - r) + Math.abs(cc - c);
          if (dist < bestDist) {
            bestDist = dist;
            bestRid = rid;
          }
        }
      }
      if (bestRid === -1) bestRid = 0;
      regionId[r][c] = bestRid;
      currentSizes[bestRid]++;
      regionCells[bestRid].push({ row: r, col: c });
    }
  }

  return regionCells.map((cells, id) => ({ id, cells }));
}

/**
 * Construct a Level from regions and a completed SolverResult.
 * Single place where Level structs are assembled — if Level shape changes,
 * only this function needs updating.
 */
export function assembleLevel(
  n: number,
  regions: Region[],
  seed: number,
  targetSteps: number,
  id: string,
  result: SolverResult,
): Level {
  const board = createEmptyBoard(n, regions);
  const solved = applyBatchesUpTo(board, result.batches, result.totalSteps);
  return {
    id,
    n,
    regions,
    solution: getQueenPositions(solved),
    seed,
    targetSteps,
    actualSteps: result.totalSteps,
    strategySequence: result.batches.map(b => b.strategy),
    solverResult: result,
  };
}
