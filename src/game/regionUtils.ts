/**
 * Shared region utilities used by generator, reverseGenerator, and anchorGenerator.
 *
 * Extracted to eliminate duplication of isConnected, cloneRegions, and tryMutateRegions
 * across generator.ts and reverseGenerator.ts.
 */

import { Position, Region } from './types';
import { randInt } from './random';

const DIRS_4 = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

export function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

/** Check if all cells in a region are 4-connected */
export function isConnected(cells: Position[]): boolean {
  if (cells.length <= 1) return true;
  const cellKeys = new Set(cells.map(posKey));
  const queue = [cells[0]];
  const seen = new Set<string>([posKey(cells[0])]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const { dr, dc } of DIRS_4) {
      const key = posKey({ row: current.row + dr, col: current.col + dc });
      if (cellKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push({ row: current.row + dr, col: current.col + dc });
      }
    }
  }
  return seen.size === cells.length;
}

/** Deep-clone an array of regions */
export function cloneRegions(regions: Region[]): Region[] {
  return regions.map(r => ({ id: r.id, cells: r.cells.map(p => ({ ...p })) }));
}

/**
 * Attempt a single random boundary-cell transfer between adjacent regions.
 *
 * A non-Queen cell from one region (size > 2) is moved to an adjacent region,
 * provided the source region remains connected.
 *
 * @param frozenRegionIds - If provided, cells are never moved out of or into
 *   these regions, preserving anchor constraints during refinement.
 */
export function tryMutateRegions(
  n: number,
  regions: Region[],
  queenPositions: Position[],
  rng: () => number,
  frozenRegionIds?: Set<number>,
): Region[] | null {
  const queenKeys = new Set(queenPositions.map(posKey));
  const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
  for (const r of regions) {
    for (const c of r.cells) grid[c.row][c.col] = r.id;
  }

  const movable: { from: number; to: number; pos: Position }[] = [];
  for (const region of regions) {
    if (region.cells.length <= 2) continue;
    if (frozenRegionIds?.has(region.id)) continue;
    for (const pos of region.cells) {
      if (queenKeys.has(posKey(pos))) continue;
      const adj = new Set<number>();
      for (const { dr, dc } of DIRS_4) {
        const nr = pos.row + dr, nc = pos.col + dc;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
        const rid = grid[nr][nc];
        if (rid !== -1 && rid !== region.id) adj.add(rid);
      }
      for (const to of adj) {
        if (frozenRegionIds?.has(to)) continue;
        movable.push({ from: region.id, to, pos });
      }
    }
  }

  if (movable.length === 0) return null;
  const move = movable[randInt(rng, 0, movable.length - 1)];
  const next = cloneRegions(regions);
  const fromCells = next[move.from].cells.filter(
    p => p.row !== move.pos.row || p.col !== move.pos.col,
  );
  if (!isConnected(fromCells)) return null;
  next[move.from].cells = fromCells;
  next[move.to].cells = [...next[move.to].cells, { ...move.pos }];
  return next;
}
