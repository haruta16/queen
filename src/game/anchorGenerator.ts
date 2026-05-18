/**
 * Anchor Generator — builds regions with guaranteed strategy triggers.
 *
 * Constraint-construction mapping:
 *
 *   Strategy             | Queens | Constraint                              | Guarantee
 *   L2_Lock1 (R→Row/Col) | 1      | All cells in Q's row OR all in Q's col  | ABSOLUTE
 *   L2_Lock2 (2R→2Row)   | 2      | R0,R1 cells ⊆ {Q0.row, Q1.row}          | ABSOLUTE
 *   L2_Lock2 (2R→2Col)   | 2      | R0,R1 cells ⊆ {Q0.col, Q1.col}          | ABSOLUTE
 *   L2_Lock3 (3R→3Row)   | 3      | R0,R1,R2 cells ⊆ {r0, r1, r2}           | ABSOLUTE
 *   L3_Projection        | 1      | 2-3 cells share a row or col             | HIGH
 *   L3_Capacity          | 1      | R occupies 2 cells of a 2×2 block        | ABSOLUTE
 *
 * Multi-Queen decomposition (anchorCount > 1):
 *   Queens are partitioned into sub-groups, each executing its own sub-strategy.
 *   e.g. anchorCount=4 → [L2_Lock2, L2_Lock1, L2_Lock1] or [L2_Lock2, L2_Lock2]
 */

import { Position, Region, StrategyType } from './types';
import { posKey, isConnected } from './regionUtils';

const DIRS_4 = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

function inBounds(r: number, c: number, n: number): boolean {
  return r >= 0 && r < n && c >= 0 && c < n;
}

// ─── Constraint builders ─────────────────────────────────────

/**
 * L2_Lock1 (Region→Row or Region→Col).
 *
 * Constraint: all cells share Queen.row (axis='row') or Queen.col (axis='col').
 * Proper subset: size capped at n-1, leaving ≥1 cell per axis for other regions.
 */
function buildLock1(
  n: number, queen: Position, axis: 'row' | 'col',
  blocked: Set<string>, rng: () => number,
): Position[] {
  const cells: Position[] = [queen];
  const taken = new Set<string>([posKey(queen)]);

  // Available cells along the axis, excluding blocked ones
  const axisCells: Position[] = [];
  for (let i = 0; i < n; i++) {
    const p = axis === 'row' ? { row: queen.row, col: i } : { row: i, col: queen.col };
    if (!blocked.has(posKey(p))) axisCells.push(p);
  }

  // Choose size: 2 to min(n-1, axisCells.length), biased small
  const maxSz = Math.min(axisCells.length, n - 1);
  const sz = Math.max(2, Math.min(maxSz, 2 + Math.floor(rng() * 2))); // 2-4

  // Take a contiguous segment around Queen
  const qi = axisCells.findIndex(p => p.row === queen.row && p.col === queen.col);
  let left = qi, right = qi;
  while (taken.size < sz) {
    const goLeft = left > 0 && (right >= axisCells.length - 1 || rng() < 0.5);
    if (goLeft) {
      left--;
      const p = axisCells[left];
      const k = posKey(p);
      if (!taken.has(k)) { taken.add(k); cells.push(p); }
    } else if (right < axisCells.length - 1) {
      right++;
      const p = axisCells[right];
      const k = posKey(p);
      if (!taken.has(k)) { taken.add(k); cells.push(p); }
    } else break;
  }

  return cells;
}

/**
 * L2_Lock2 (2Region→2Row) or L2_Lock2 (2Region→2Col).
 *
 * Constraint: both regions' cells lie within the two specified rows (or cols).
 * 'dimension' determines whether we constrain rows or columns.
 */
function buildLock2(
  n: number, q0: Position, q1: Position,
  dimension: 'row' | 'col',
  blocked: Set<string>, rng: () => number,
): { r0cells: Position[]; r1cells: Position[] } {
  const v0 = dimension === 'row' ? q0.row : q0.col;
  const v1 = dimension === 'row' ? q1.row : q1.col;
  const allowed = new Set([v0, v1]);

  const r0: Position[] = [q0];
  const r1: Position[] = [q1];
  const taken = new Set([posKey(q0), posKey(q1)]);

  function grow(cells: Position[], targetSz: number) {
    const seen = new Set(cells.map(posKey));
    const frontier: Position[] = [];

    function addFrontier(p: Position) {
      for (const { dr, dc } of DIRS_4) {
        const nr = p.row + dr, nc = p.col + dc;
        const nk = posKey({ row: nr, col: nc });
        const v = dimension === 'row' ? nr : nc;
        if (inBounds(nr, nc, n) && allowed.has(v) &&
            !blocked.has(nk) && !taken.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          frontier.push({ row: nr, col: nc });
        }
      }
    }

    for (const c of cells) addFrontier(c);

    while (cells.length < targetSz && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx];
      frontier.splice(idx, 1);
      const k = posKey(p);
      if (!taken.has(k)) {
        taken.add(k);
        cells.push(p);
        addFrontier(p);
      }
    }
  }

  const sz0 = 2 + Math.floor(rng() * 3);
  const sz1 = 2 + Math.floor(rng() * 3);
  grow(r0, sz0);
  grow(r1, sz1);

  return { r0cells: r0, r1cells: r1 };
}

/**
 * L2_Lock3 (3Region→3Row).
 *
 * Constraint: three regions' cells lie within three rows.
 */
function buildLock3(
  n: number, queens: Position[],
  dimension: 'row' | 'col',
  blocked: Set<string>, rng: () => number,
): Position[][] {
  const result: Position[][] = queens.map(q => [q]);
  const taken = new Set(queens.map(posKey));
  const allowed = new Set(queens.map(q => dimension === 'row' ? q.row : q.col));

  function grow(cells: Position[], targetSz: number) {
    const seen = new Set(cells.map(posKey));
    const frontier: Position[] = [];

    function addFrontier(p: Position) {
      for (const { dr, dc } of DIRS_4) {
        const nr = p.row + dr, nc = p.col + dc;
        const nk = posKey({ row: nr, col: nc });
        const v = dimension === 'row' ? nr : nc;
        if (inBounds(nr, nc, n) && allowed.has(v) &&
            !blocked.has(nk) && !taken.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          frontier.push({ row: nr, col: nc });
        }
      }
    }

    for (const c of cells) addFrontier(c);

    while (cells.length < targetSz && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx];
      frontier.splice(idx, 1);
      const k = posKey(p);
      if (!taken.has(k)) {
        taken.add(k);
        cells.push(p);
        addFrontier(p);
      }
    }
  }

  for (let i = 0; i < 3; i++) {
    grow(result[i], 2 + Math.floor(rng() * 2));
  }

  return result;
}

/**
 * L3_Projection anchor.
 *
 * Constraint: the anchor's 2-3 cells all lie in the same row or same col.
 * Only distance-1 cells are taken so the region is always 4-connected.
 */
function buildProjection(
  n: number, queen: Position,
  blocked: Set<string>, rng: () => number,
): Position[] {
  const cells: Position[] = [queen];
  const taken = new Set([posKey(queen)]);
  const axis = rng() < 0.5 ? 'row' : 'col';

  // Collect same-axis neighbours at distance 1 only (guarantees adjacency to Queen)
  const cands: Position[] = [];
  for (const sign of [-1, 1]) {
    const p = axis === 'row'
      ? { row: queen.row, col: queen.col + sign }
      : { row: queen.row + sign, col: queen.col };
    const k = posKey(p);
    if (inBounds(p.row, p.col, n) && !blocked.has(k) && !taken.has(k)) {
      cands.push(p);
    }
  }

  // Shuffle and take 1-2 (target 2-3 cells total incl. Queen)
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  const targetSz = 2 + Math.floor(rng() * 2); // 2-3
  for (const p of cands) {
    if (cells.length >= targetSz) break;
    const k = posKey(p);
    if (!taken.has(k)) { taken.add(k); cells.push(p); }
  }

  return cells;
}

/**
 * L3_Capacity anchor.
 *
 * Constraint: build a region of 2-3 cells inside a single 2×2 block.
 * We pick one 2×2 block containing the Queen, then take 1-2 free cells
 * from that same block. After fill assigns the block's remaining cells
 * to other regions, the solver finds this region trapped → L3_Capacity fires.
 */
function buildCapacity(
  n: number, queen: Position,
  blocked: Set<string>, rng: () => number,
): Position[] {
  const cells: Position[] = [queen];
  const taken = new Set([posKey(queen)]);

  // Collect free cells for each candidate 2×2 block separately
  const blocks: Position[][] = [];
  for (const dr of [0, -1]) {
    for (const dc of [0, -1]) {
      const r = queen.row + dr, c = queen.col + dc;
      if (!inBounds(r, c, n) || !inBounds(r + 1, c + 1, n)) continue;
      const freeInBlock: Position[] = [];
      for (const br of [r, r + 1]) {
        for (const bc of [c, c + 1]) {
          const k = posKey({ row: br, col: bc });
          if (!blocked.has(k) && !taken.has(k)) {
            freeInBlock.push({ row: br, col: bc });
          }
        }
      }
      if (freeInBlock.length >= 1) {
        blocks.push(freeInBlock);
      }
    }
  }

  if (blocks.length === 0) return cells;

  // Pick one block and take 1-2 free cells from it
  const block = blocks[Math.floor(rng() * blocks.length)];
  for (let i = block.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [block[i], block[j]] = [block[j], block[i]];
  }
  for (const p of block) {
    if (cells.length >= 3) break;
    const k = posKey(p);
    if (!taken.has(k)) { taken.add(k); cells.push(p); }
  }

  return cells;
}

// ─── Public API ──────────────────────────────────────────────

export type AnchorSpec = {
  queenIndices: number[];
  strategy: StrategyType;
};

/**
 * Build anchor regions from one or more AnchorSpecs.
 * All anchors are built together (blocked from each other) and frozen.
 */
export function buildAnchorRegions(
  n: number,
  queenPositions: Position[],
  specs: AnchorSpec | AnchorSpec[],
  rng: () => number,
): Region[] {
  const specList = Array.isArray(specs) ? specs : [specs];
  const allRegions: Region[] = [];
  const blocked = new Set<string>();

  // Collect ALL anchor Queen indices across all specs
  const allAnchorIndices = new Set<number>();
  for (const spec of specList) {
    for (const qi of spec.queenIndices) allAnchorIndices.add(qi);
  }

  // Block all non-anchor Queens
  for (let i = 0; i < queenPositions.length; i++) {
    if (!allAnchorIndices.has(i)) blocked.add(posKey(queenPositions[i]));
  }

  // Build each sub-spec's anchors
  for (const spec of specList) {
    const idx = spec.queenIndices;

    switch (spec.strategy) {
      case 'L2_Lock1': {
        const q = queenPositions[idx[0]];
        const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
        allRegions.push({ id: idx[0], cells: buildLock1(n, q, axis, blocked, rng) });
        break;
      }
      case 'L2_Lock2': {
        const q0 = queenPositions[idx[0]], q1 = queenPositions[idx[1]];
        const dim: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
        const { r0cells, r1cells } = buildLock2(n, q0, q1, dim, blocked, rng);
        allRegions.push({ id: idx[0], cells: r0cells });
        allRegions.push({ id: idx[1], cells: r1cells });
        break;
      }
      case 'L2_Lock3': {
        const qs = idx.map(i => queenPositions[i]);
        const dim: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
        const result = buildLock3(n, qs, dim, blocked, rng);
        for (let i = 0; i < idx.length; i++) {
          allRegions.push({ id: idx[i], cells: result[i] });
        }
        break;
      }
      case 'L3_Projection': {
        const q = queenPositions[idx[0]];
        allRegions.push({ id: idx[0], cells: buildProjection(n, q, blocked, rng) });
        break;
      }
      case 'L3_Capacity': {
        const q = queenPositions[idx[0]];
        allRegions.push({ id: idx[0], cells: buildCapacity(n, q, blocked, rng) });
        break;
      }
      default: {
        const q = queenPositions[idx[0]];
        allRegions.push({ id: idx[0], cells: buildLock1(n, q, rng() < 0.5 ? 'row' : 'col', blocked, rng) });
      }
    }

    // Update blocked set: anchor cells block subsequent anchors
    const lastRegion = allRegions[allRegions.length - 1];
    for (const cell of lastRegion.cells) blocked.add(posKey(cell));
  }

  // Post-validate each region
  for (const region of allRegions) {
    const q = queenPositions[region.id];
    if (!region.cells.some(c => c.row === q.row && c.col === q.col)) {
      region.cells.push({ ...q });
    }
    if (!isConnected(region.cells)) {
      region.cells = [{ ...q }];
    }
  }

  return allRegions;
}

/**
 * Decompose `anchorCount` Queens into sub-strategies.
 *
 * Returns an array of AnchorSpec, each covering 1-3 Queens.
 * Strategies are chosen to maximize coverage of available strategies:
 *   - Single Queens: L2_Lock1, L3_Projection, L3_Capacity
 *   - Queen pairs: L2_Lock2
 *   - Queen triples: L2_Lock3
 *
 * Decomposition examples for anchorCount=4:
 *   [L2_Lock2, L2_Lock2]  — two pairs
 *   [L2_Lock3, L2_Lock1]  — one triple + one single
 *   [L2_Lock1, L2_Lock1, L2_Lock1, L2_Lock1] — four singles
 */
export function pickAnchorSpecs(
  n: number,
  numRegions: number,
  rng: () => number,
  requestedCount?: number,
): AnchorSpec[] {
  const maxCount = Math.min(4, numRegions);
  const anchorCount = requestedCount != null
    ? Math.max(1, Math.min(requestedCount, maxCount))
    : (n <= 6 ? 1 : n <= 8 ? (rng() < 0.4 ? 2 : 1) : (rng() < 0.3 ? 3 : rng() < 0.6 ? 2 : 1));

  // Shuffle Queen indices
  const indices = Array.from({ length: numRegions }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const chosen = indices.slice(0, anchorCount);
  const specs: AnchorSpec[] = [];
  let pos = 0;

  // Greedy decomposition: prefer larger groupings first
  while (pos < anchorCount) {
    const remaining = anchorCount - pos;

    // Try L2_Lock3 (3 Queens)
    if (remaining >= 3 && n >= 8 && rng() < 0.4) {
      specs.push({ queenIndices: [chosen[pos], chosen[pos + 1], chosen[pos + 2]], strategy: 'L2_Lock3' });
      pos += 3;
      continue;
    }

    // Try L2_Lock2 (2 Queens)
    if (remaining >= 2 && n >= 6 && rng() < 0.6) {
      specs.push({ queenIndices: [chosen[pos], chosen[pos + 1]], strategy: 'L2_Lock2' });
      pos += 2;
      continue;
    }

    // Single Queen: pick best 1-Queen strategy
    if (remaining >= 1) {
      const roll = rng();
      let strategy: StrategyType;
      if (roll < 0.35) strategy = 'L2_Lock1';
      else if (roll < 0.6) strategy = 'L3_Projection';
      else if (roll < 0.85) strategy = 'L3_Capacity';
      else strategy = 'L2_Lock1';
      specs.push({ queenIndices: [chosen[pos]], strategy });
      pos += 1;
    }
  }

  return specs;
}

// Keep backward-compatible single-spec picker for callers that just need one
export function pickAnchorSpec(
  n: number,
  numRegions: number,
  rng: () => number,
): AnchorSpec {
  return pickAnchorSpecs(n, numRegions, rng, 1)[0];
}
