/**
 * Reverse Generator V2 — builds puzzles backward through the strategy chain.
 *
 * Each reverse step places a minimal set of grid cells that guarantee a
 * specific solver strategy will fire. Placed cells are frozen (position
 * locked), but the region can still grow during the fill phase — the
 * extra growth creates "spoilers" that earlier strategies must eliminate
 * before the later strategy's geometric constraint becomes visible.
 *
 * Pipeline: Queens → strategy sequence → constraint build → fill → verify
 */

import {
  Position,
  Region,
  Level,
  GeneratorParams,
  GenerationDiagnostics,
  GenerationResult,
  GenerationStatus,
  StrategyType,
} from './types';
import { createEmptyBoard, getQueenPositions } from './rules';
import { solve } from './solver';
import { assembleLevel, generateQueenPositions } from './generatorCore';
import { createRNG, shuffle, randInt } from './random';
import { posKey } from './regionUtils';

const DIRS_4 = [
  { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
  { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
];

function inBounds(r: number, c: number, n: number): boolean {
  return r >= 0 && r < n && c >= 0 && c < n;
}

// ── Constraint builders ───────────────────────────────────────────
// Each builder places a minimal set of cells that satisfies a
// strategy's geometric constraint. Cells are placed into the grid
// and marked frozen. The region can grow beyond these cells later.

function canPlace(key: string, frozen: Set<string>, grid: number[][], rid: number): boolean {
  if (frozen.has(key)) return false;
  const [r, c] = key.split(',').map(Number);
  return grid[r][c] === -1 || grid[r][c] === rid;
}

function claimCell(r: number, c: number, rid: number, grid: number[][], frozen: Set<string>): void {
  grid[r][c] = rid;
  frozen.add(posKey({ row: r, col: c }));
}

/** L2_Lock1: all cells of a region lie on the same row or column */
function buildLock1(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): boolean {
  const q = queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';

  const cells: Position[] = [{ ...q }];
  const taken = new Set<string>([posKey(q)]);

  // Collect free cells along axis
  const axisCells: Position[] = [];
  for (let i = 0; i < n; i++) {
    const p = axis === 'row' ? { row: q.row, col: i } : { row: i, col: q.col };
    const k = posKey(p);
    if (canPlace(k, frozen, grid, qi) && !taken.has(k)) axisCells.push(p);
  }

  const maxSz = Math.min(axisCells.length, n - 1);
  const sz = Math.max(2, Math.min(maxSz, 2 + Math.floor(rng() * 2)));

  const qiAxis = axisCells.findIndex(p => p.row === q.row && p.col === q.col);
  if (qiAxis === -1) return false; // Queen not on axis (shouldn't happen)

  let left = qiAxis, right = qiAxis;
  while (taken.size < sz) {
    const goLeft = left > 0 && (right >= axisCells.length - 1 || rng() < 0.5);
    if (goLeft) {
      left--;
      const k = posKey(axisCells[left]);
      if (!taken.has(k) && canPlace(k, frozen, grid, qi)) {
        taken.add(k); cells.push(axisCells[left]);
      }
    } else if (right < axisCells.length - 1) {
      right++;
      const k = posKey(axisCells[right]);
      if (!taken.has(k) && canPlace(k, frozen, grid, qi)) {
        taken.add(k); cells.push(axisCells[right]);
      }
    } else break;
  }

  for (const { row, col } of cells) claimCell(row, col, qi, grid, frozen);
  return cells.length >= 2;
}

/** L2_Lock2: two regions' cells lie within the same two rows or columns */
function buildLock2(
  n: number, qi0: number, qi1: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): boolean {
  const q0 = queens[qi0], q1 = queens[qi1];
  const dim: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
  const allowed = new Set([dim === 'row' ? q0.row : q0.col, dim === 'row' ? q1.row : q1.col]);

  function grow(seed: Position, rid: number, targetSz: number): Position[] {
    const cells: Position[] = [seed];
    const seen = new Set<string>([posKey(seed)]);
    const frontier: Position[] = [];

    function addFrontier(p: Position) {
      for (const { dr, dc } of DIRS_4) {
        const nr = p.row + dr, nc = p.col + dc;
        const nk = posKey({ row: nr, col: nc });
        const v = dim === 'row' ? nr : nc;
        if (inBounds(nr, nc, n) && allowed.has(v) && !seen.has(nk) && canPlace(nk, frozen, grid, rid)) {
          seen.add(nk);
          frontier.push({ row: nr, col: nc });
        }
      }
    }

    addFrontier(seed);
    while (cells.length < targetSz && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx];
      frontier.splice(idx, 1);
      const k = posKey(p);
      if (canPlace(k, frozen, grid, rid)) {
        cells.push(p);
        addFrontier(p);
      }
    }
    return cells;
  }

  const sz0 = 2 + Math.floor(rng() * 3);
  const sz1 = 2 + Math.floor(rng() * 3);
  const r0cells = grow(q0, qi0, sz0);
  const r1cells = grow(q1, qi1, sz1);

  for (const c of r0cells) claimCell(c.row, c.col, qi0, grid, frozen);
  for (const c of r1cells) claimCell(c.row, c.col, qi1, grid, frozen);
  return r0cells.length >= 2 && r1cells.length >= 2;
}

/** L2_Lock3: three regions' cells lie within the same three rows or columns */
function buildLock3(
  n: number, qis: number[], queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): boolean {
  const dim: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';
  const allowed = new Set(qis.map(i => dim === 'row' ? queens[i].row : queens[i].col));

  function grow(seed: Position, rid: number, targetSz: number): Position[] {
    const cells: Position[] = [seed];
    const seen = new Set<string>([posKey(seed)]);
    const frontier: Position[] = [];

    function addFrontier(p: Position) {
      for (const { dr, dc } of DIRS_4) {
        const nr = p.row + dr, nc = p.col + dc;
        const nk = posKey({ row: nr, col: nc });
        const v = dim === 'row' ? nr : nc;
        if (inBounds(nr, nc, n) && allowed.has(v) && !seen.has(nk) && canPlace(nk, frozen, grid, rid)) {
          seen.add(nk);
          frontier.push({ row: nr, col: nc });
        }
      }
    }

    addFrontier(seed);
    while (cells.length < targetSz && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx];
      frontier.splice(idx, 1);
      if (canPlace(posKey(p), frozen, grid, rid)) {
        cells.push(p);
        addFrontier(p);
      }
    }
    return cells;
  }

  let ok = true;
  for (const qi of qis) {
    const cells = grow(queens[qi], qi, 2 + Math.floor(rng() * 2));
    for (const c of cells) claimCell(c.row, c.col, qi, grid, frozen);
    if (cells.length < 2) ok = false;
  }
  return ok && qis.length === 3;
}

/** L3_Projection: 2-3 cells of the same region lie on the same row/col, adjacent */
function buildProjection(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): boolean {
  const q = queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';

  // Collect same-axis cells at distance 1 (guarantees 4-connectivity)
  const cands: Position[] = [];
  for (const sign of [-1, 1]) {
    const p = axis === 'row'
      ? { row: q.row, col: q.col + sign }
      : { row: q.row + sign, col: q.col };
    if (inBounds(p.row, p.col, n) && canPlace(posKey(p), frozen, grid, qi)) {
      cands.push(p);
    }
  }

  // Fisher-Yates shuffle
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }

  const targetSz = 2 + Math.floor(rng() * 2); // 2-3 total (including Queen)
  claimCell(q.row, q.col, qi, grid, frozen);
  let placed = 1;
  for (const p of cands) {
    if (placed >= targetSz) break;
    claimCell(p.row, p.col, qi, grid, frozen);
    placed++;
  }
  return placed >= 2;
}

/** L3_Capacity: 2-3 cells of a region are within a single 2x2 block */
function buildCapacity(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): boolean {
  const q = queens[qi];
  const taken = new Set<string>([posKey(q)]);

  // Find 2x2 blocks containing the Queen
  const blocks: Position[][] = [];
  for (const dr of [0, -1]) {
    for (const dc of [0, -1]) {
      const r = q.row + dr, c = q.col + dc;
      if (!inBounds(r, c, n) || !inBounds(r + 1, c + 1, n)) continue;
      const free: Position[] = [];
      for (const br of [r, r + 1]) {
        for (const bc of [c, c + 1]) {
          const k = posKey({ row: br, col: bc });
          if (!taken.has(k) && canPlace(k, frozen, grid, qi)) free.push({ row: br, col: bc });
        }
      }
      if (free.length >= 1) blocks.push(free);
    }
  }

  if (blocks.length === 0) return false;

  const block = blocks[Math.floor(rng() * blocks.length)];
  for (let i = block.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [block[i], block[j]] = [block[j], block[i]];
  }

  claimCell(q.row, q.col, qi, grid, frozen);
  let placed = 1;
  for (const p of block) {
    if (placed >= 3) break;
    claimCell(p.row, p.col, qi, grid, frozen);
    placed++;
  }
  return placed >= 2;
}

/**
 * L3_Contradiction: place a candidate C such that if C were Queen,
 * it would starve a specific row, column, or region of all candidates.
 * This is probabilistic — we position C to threaten a narrow unit.
 */
function buildContradiction(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): boolean {
  const q = queens[qi];

  // Place the "threatening" candidate near the Queen but in a narrow unit
  const dir = DIRS_4[Math.floor(rng() * 4)];
  const p = { row: q.row + dir.dr, col: q.col + dir.dc };
  if (!inBounds(p.row, p.col, n)) return false;
  const k = posKey(p);
  if (!canPlace(k, frozen, grid, qi)) return false;

  claimCell(q.row, q.col, qi, grid, frozen);
  claimCell(p.row, p.col, qi, grid, frozen);
  return true;
}

/**
 * L1_Unique: place only the Queen cell for a region. After fill adds
 * extra cells and earlier strategies X them out, the Queen becomes the
 * sole candidate → L1_Unique fires.
 */
function buildUnique(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, _rng: () => number,
): boolean {
  const q = queens[qi];
  claimCell(q.row, q.col, qi, grid, frozen);
  return true;
}

// ── Builder dispatch ─────────────────────────────────────────────

function buildConstraint(
  strategy: StrategyType,
  queenIndices: number[],
  queens: Position[],
  grid: number[][],
  frozen: Set<string>,
  n: number,
  rng: () => number,
): boolean {
  switch (strategy) {
    case 'L2_Lock1': return buildLock1(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L2_Lock2': return buildLock2(n, queenIndices[0], queenIndices[1], queens, grid, frozen, rng);
    case 'L2_Lock3': return buildLock3(n, queenIndices, queens, grid, frozen, rng);
    case 'L3_Projection': return buildProjection(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L3_Contradiction': return buildContradiction(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L3_Capacity': return buildCapacity(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L1_Unique': return buildUnique(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L1_Direct': return false; // natural consequence, not built
  }
}

// ── Strategy sequence ────────────────────────────────────────────

function pickReverseStrategies(
  n: number,
  targetSteps: number,
  rng: () => number,
): { strategy: StrategyType; queenIndices: number[] }[] {
  const sequence: { strategy: StrategyType; queenIndices: number[] }[] = [];
  const usageCount = new Array(n).fill(0);

  // Constraint-building steps ≈ 50-60% of target (L1_Direct/Unique fill the rest naturally)
  const steps = Math.max(3, Math.min(n * 2 + 2, Math.floor(targetSteps * 0.58)));

  for (let step = 0; step < steps; step++) {
    const roll = rng();
    let strategy: StrategyType;
    let needed: number;

    if (n >= 8 && roll < 0.12)      { strategy = 'L2_Lock3'; needed = 3; }
    else if (n >= 6 && roll < 0.40) { strategy = 'L2_Lock2'; needed = 2; }
    else if (roll < 0.62)           { strategy = 'L2_Lock1'; needed = 1; }
    else if (roll < 0.76)           { strategy = 'L3_Projection'; needed = 1; }
    else if (roll < 0.88)           { strategy = 'L3_Capacity'; needed = 1; }
    else if (roll < 0.94)           { strategy = 'L3_Contradiction'; needed = 1; }
    else                            { strategy = 'L1_Unique'; needed = 1; }

    // Pick Queens with lowest usage first
    const ranked = Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => usageCount[a] - usageCount[b]);
    const shuffled = shuffle(ranked.slice(0, Math.max(needed * 3, n)), rng);
    const chosen = shuffled.slice(0, needed);

    if (chosen.length < needed) continue;

    sequence.push({ strategy, queenIndices: chosen });
    for (const qi of chosen) usageCount[qi]++;
  }

  return sequence;
}

// ── Grid fill ─────────────────────────────────────────────────────

function gridToRegions(grid: number[][], n: number): Region[] {
  const map = new Map<number, Position[]>();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const rid = grid[r][c];
      if (rid >= 0) {
        if (!map.has(rid)) map.set(rid, []);
        map.get(rid)!.push({ row: r, col: c });
      }
    }
  }
  return Array.from(map.entries()).map(([id, cells]) => ({ id, cells }));
}

function fillGrid(
  grid: number[][],
  queens: Position[],
  n: number,
  rng: () => number,
): void {
  const frontier: { row: number; col: number; rid: number }[] = [];

  // Seed frontier from assigned cells
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] === -1) continue;
      const rid = grid[r][c];
      for (const { dr, dc } of DIRS_4) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc, n) && grid[nr][nc] === -1) {
          frontier.push({ row: nr, col: nc, rid });
        }
      }
    }
  }

  // Random BFS fill
  while (frontier.length > 0) {
    const idx = randInt(rng, 0, frontier.length - 1);
    const { row, col, rid } = frontier[idx];
    frontier.splice(idx, 1);

    if (grid[row][col] !== -1) continue;
    grid[row][col] = rid;

    for (const { dr, dc } of DIRS_4) {
      const nr = row + dr, nc = col + dc;
      if (inBounds(nr, nc, n) && grid[nr][nc] === -1) {
        frontier.push({ row: nr, col: nc, rid });
      }
    }
  }

  // Any remaining unassigned cells → nearest region
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] !== -1) continue;
      let bestRid = -1, bestDist = Infinity;
      for (let rr = 0; rr < n; rr++) {
        for (let cc = 0; cc < n; cc++) {
          const rid = grid[rr][cc];
          if (rid === -1) continue;
          const dist = Math.abs(rr - r) + Math.abs(cc - c);
          if (dist < bestDist) { bestDist = dist; bestRid = rid; }
        }
      }
      grid[r][c] = bestRid >= 0 ? bestRid : 0;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────

export function generateReverseLevel(params: GeneratorParams): GenerationResult {
  const { n, targetSteps, seed } = params;
  const actualSeed = seed ?? Date.now();
  const startedAt = Date.now();
  const allowApproximate = params.allowApproximate ?? false;
  const maxAttempts = params.maxAttempts ?? Math.max(30, n * 5 + targetSteps * 2);

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let attempts = 0;
  let bestAttempt = 0;
  let completeCandidates = 0;
  let exactCandidates = 0;

  const makeDiagnostics = (status: GenerationStatus): GenerationDiagnostics => ({
    status,
    attempts,
    maxAttempts,
    elapsedMs: Date.now() - startedAt,
    seed: actualSeed,
    targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt: bestLevel ? bestAttempt : null,
    selectedAttemptSeed: bestLevel ? actualSeed + (bestAttempt - 1) * 7919 + targetSteps * 101 : null,
    completeCandidates,
    incompleteCandidates: attempts - completeCandidates,
    exactCandidates,
    allowApproximate,
    anchorStrategy: 'reverseV2',
    anchorQueenIndices: null,
    anchorCount: null,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts = attempt + 1;
    const baseRng = createRNG(actualSeed + attempt * 7919 + targetSteps * 101);

    // 1. Queen positions
    let queens: Position[];
    try { queens = generateQueenPositions(n, baseRng); }
    catch { continue; }

    // 2. Init grid — Queens claim their cells
    const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
    const frozen = new Set<string>();
    for (let i = 0; i < queens.length; i++) {
      grid[queens[i].row][queens[i].col] = i;
      frozen.add(posKey(queens[i]));
    }

    // 3. Strategy sequence
    const seqRng = createRNG(actualSeed + attempt * 7919 + targetSteps * 101 + 777);
    const sequence = pickReverseStrategies(n, targetSteps, seqRng);

    // 4. Build constraints in reverse order
    for (const { strategy, queenIndices } of sequence) {
      buildConstraint(strategy, queenIndices, queens, grid, frozen, n, baseRng);
    }

    // 5. Fill remaining
    const fillRng = createRNG(actualSeed + attempt * 7919 + targetSteps * 101 + 999);
    fillGrid(grid, queens, n, fillRng);

    // 6. Build regions, solve
    const regions = gridToRegions(grid, n);
    const board = createEmptyBoard(n, regions);
    const result = solve(board);
    if (!result.complete) continue;
    completeCandidates++;

    const solvedBoard = createEmptyBoard(n, regions);
    const finalResult = solve(solvedBoard);
    const level = assembleLevel(n, regions, actualSeed, targetSteps,
      `L${n}x${n}-${actualSeed}-rv2-${attempt}`, finalResult);

    const diff = Math.abs(level.actualSteps - targetSteps);
    if (diff === 0) {
      exactCandidates++;
      bestAttempt = attempt;
      return { status: 'exact', level, diagnostics: makeDiagnostics('exact') };
    }
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level;
      bestAttempt = attempt;
    }
  }

  if (bestLevel && allowApproximate) {
    return { status: 'approximate', level: bestLevel, diagnostics: makeDiagnostics('approximate') };
  }
  return { status: 'failed', level: bestLevel ?? null, diagnostics: makeDiagnostics('failed') };
}
