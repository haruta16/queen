/**
 * Reverse Generator V2 — builds puzzles backward through the strategy chain.
 *
 * Each reverse step places minimal grid cells ensuring a specific solver strategy
 * fires. Placed cells are frozen (position locked); regions continue to grow
 * during fill. Extra growth creates "spoilers" — earlier strategies in forward
 * solve order X-out these spoilers, revealing later strategies' constraints.
 *
 * Strategic spoiler placement: between adjacent reverse steps, the EARLIER
 * (forward-order) strategy's elimination zone provides positions for spoiler
 * cells belonging to the LATER strategy's regions.
 */

import {
  Position, Region, Level,
  GeneratorParams, GenerationDiagnostics, GenerationResult, GenerationStatus,
  StrategyType,
} from './types';
import { createEmptyBoard } from './rules';
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

function canPlace(key: string, frozen: Set<string>, grid: number[][], rid: number): boolean {
  if (frozen.has(key)) return false;
  const [r, c] = key.split(',').map(Number);
  return grid[r][c] === -1 || grid[r][c] === rid;
}

function claimCell(r: number, c: number, rid: number, grid: number[][], frozen: Set<string>): void {
  grid[r][c] = rid;
  frozen.add(posKey({ row: r, col: c }));
}

// ── BuildInfo — constraint metadata for spoiler placement ─────────

type BuildInfo = {
  strategy: StrategyType;
  queenIndices: number[];
  axis: 'row' | 'col';
  values: number[];  // constrained rows or cols
};

// ── Constraint builders ───────────────────────────────────────────
// Each places 2-4 cells per region. Fewer cells = more room for
// later reverse steps and spoiler placement.

function buildLock1(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildInfo | null {
  const q = queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';

  const cells: Position[] = [{ ...q }];
  const taken = new Set<string>([posKey(q)]);

  // Collect free cells along axis, sorted by distance from Queen
  const candidates: Position[] = [];
  for (let i = 0; i < n; i++) {
    const p = axis === 'row' ? { row: q.row, col: i } : { row: i, col: q.col };
    if (canPlace(posKey(p), frozen, grid, qi) && !taken.has(posKey(p))) candidates.push(p);
  }
  candidates.sort((a, b) => {
    const da = Math.abs((axis === 'row' ? a.col : a.row) - (axis === 'row' ? q.col : q.row));
    const db = Math.abs((axis === 'row' ? b.col : b.row) - (axis === 'row' ? q.col : q.row));
    return da - db;
  });

  // 2-4 cells total, preferring closest to Queen
  const sz = Math.max(2, Math.min(4, 2 + Math.floor(rng() * 2) + 1));
  for (const p of candidates) {
    if (cells.length >= sz) break;
    cells.push(p);
  }

  for (const { row, col } of cells) claimCell(row, col, qi, grid, frozen);
  return cells.length >= 2
    ? { strategy: 'L2_Lock1', queenIndices: [qi], axis, values: [axis === 'row' ? q.row : q.col] }
    : null;
}

function buildLock2(
  n: number, qi0: number, qi1: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildInfo | null {
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
          seen.add(nk); frontier.push({ row: nr, col: nc });
        }
      }
    }
    addFrontier(seed);
    while (cells.length < targetSz && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx]; frontier.splice(idx, 1);
      if (canPlace(posKey(p), frozen, grid, rid)) { cells.push(p); addFrontier(p); }
    }
    return cells;
  }

  const sz0 = 2 + Math.floor(rng() * 2); // 2-3
  const sz1 = 2 + Math.floor(rng() * 2);
  const r0cells = grow(q0, qi0, sz0);
  const r1cells = grow(q1, qi1, sz1);

  for (const c of r0cells) claimCell(c.row, c.col, qi0, grid, frozen);
  for (const c of r1cells) claimCell(c.row, c.col, qi1, grid, frozen);

  return r0cells.length >= 2 && r1cells.length >= 2
    ? { strategy: 'L2_Lock2', queenIndices: [qi0, qi1], axis: dim, values: [...allowed] }
    : null;
}

function buildLock3(
  n: number, qis: number[], queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildInfo | null {
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
          seen.add(nk); frontier.push({ row: nr, col: nc });
        }
      }
    }
    addFrontier(seed);
    while (cells.length < targetSz && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const p = frontier[idx]; frontier.splice(idx, 1);
      if (canPlace(posKey(p), frozen, grid, rid)) { cells.push(p); addFrontier(p); }
    }
    return cells;
  }

  let ok = true;
  for (const qi of qis) {
    const cells = grow(queens[qi], qi, 2 + Math.floor(rng() * 2));
    for (const c of cells) claimCell(c.row, c.col, qi, grid, frozen);
    if (cells.length < 2) ok = false;
  }
  return ok && qis.length === 3
    ? { strategy: 'L2_Lock3', queenIndices: qis, axis: dim, values: [...allowed] }
    : null;
}

function buildProjection(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildInfo | null {
  const q = queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';

  const cands: Position[] = [];
  for (const sign of [-1, 1]) {
    const p = axis === 'row' ? { row: q.row, col: q.col + sign } : { row: q.row + sign, col: q.col };
    if (inBounds(p.row, p.col, n) && canPlace(posKey(p), frozen, grid, qi)) cands.push(p);
  }
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }

  const targetSz = 2 + Math.floor(rng() * 2);
  claimCell(q.row, q.col, qi, grid, frozen);
  let placed = 1;
  for (const p of cands) { if (placed >= targetSz) break; claimCell(p.row, p.col, qi, grid, frozen); placed++; }
  return placed >= 2
    ? { strategy: 'L3_Projection', queenIndices: [qi], axis, values: [axis === 'row' ? q.row : q.col] }
    : null;
}

function buildCapacity(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildInfo | null {
  const q = queens[qi];
  const taken = new Set<string>([posKey(q)]);

  const blocks: Position[][] = [];
  for (const dr of [0, -1]) for (const dc of [0, -1]) {
    const r = q.row + dr, c = q.col + dc;
    if (!inBounds(r, c, n) || !inBounds(r + 1, c + 1, n)) continue;
    const free: Position[] = [];
    for (const br of [r, r + 1]) for (const bc of [c, c + 1]) {
      const k = posKey({ row: br, col: bc });
      if (!taken.has(k) && canPlace(k, frozen, grid, qi)) free.push({ row: br, col: bc });
    }
    if (free.length >= 1) blocks.push(free);
  }
  if (blocks.length === 0) return null;
  const block = blocks[Math.floor(rng() * blocks.length)];
  for (let i = block.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [block[i], block[j]] = [block[j], block[i]]; }

  claimCell(q.row, q.col, qi, grid, frozen);
  let placed = 1;
  for (const p of block) { if (placed >= 3) break; claimCell(p.row, p.col, qi, grid, frozen); placed++; }
  return placed >= 2
    ? { strategy: 'L3_Capacity', queenIndices: [qi], axis: 'row', values: [q.row, q.col] }
    : null;
}

function buildContradiction(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildInfo | null {
  const q = queens[qi];
  const dir = DIRS_4[Math.floor(rng() * 4)];
  const p = { row: q.row + dir.dr, col: q.col + dir.dc };
  if (!inBounds(p.row, p.col, n)) return null;
  if (!canPlace(posKey(p), frozen, grid, qi)) return null;
  claimCell(q.row, q.col, qi, grid, frozen);
  claimCell(p.row, p.col, qi, grid, frozen);
  return { strategy: 'L3_Contradiction', queenIndices: [qi], axis: 'row', values: [p.row, p.col] };
}

function buildUnique(
  _n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, _rng: () => number,
): BuildInfo | null {
  const q = queens[qi];
  claimCell(q.row, q.col, qi, grid, frozen);
  return { strategy: 'L1_Unique', queenIndices: [qi], axis: 'row', values: [q.row, q.col] };
}

// ── Builder dispatch ─────────────────────────────────────────────

function buildConstraint(
  strategy: StrategyType, queenIndices: number[], queens: Position[],
  grid: number[][], frozen: Set<string>, n: number, rng: () => number,
): BuildInfo | null {
  switch (strategy) {
    case 'L2_Lock1': return buildLock1(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L2_Lock2': return buildLock2(n, queenIndices[0], queenIndices[1], queens, grid, frozen, rng);
    case 'L2_Lock3': return buildLock3(n, queenIndices, queens, grid, frozen, rng);
    case 'L3_Projection': return buildProjection(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L3_Contradiction': return buildContradiction(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L3_Capacity': return buildCapacity(n, queenIndices[0], queens, grid, frozen, rng);
    case 'L1_Unique': return buildUnique(n, queenIndices[0], queens, grid, frozen, rng);
    default: return null;
  }
}

// ── Elimination zone ─────────────────────────────────────────────

function getEliminationZone(info: BuildInfo, n: number): Set<string> {
  const zone = new Set<string>();

  switch (info.strategy) {
    case 'L2_Lock1':
    case 'L3_Projection': {
      const v = info.values[0];
      for (let i = 0; i < n; i++) {
        if (info.axis === 'row') zone.add(`${v},${i}`);
        else zone.add(`${i},${v}`);
      }
      break;
    }
    case 'L2_Lock2':
    case 'L2_Lock3': {
      for (const v of info.values) {
        for (let i = 0; i < n; i++) {
          if (info.axis === 'row') zone.add(`${v},${i}`);
          else zone.add(`${i},${v}`);
        }
      }
      break;
    }
    case 'L3_Capacity': {
      const r = info.values[0], c = info.values[1];
      for (const dr of [0, -1]) for (const dc of [0, -1]) {
        const br = r + dr, bc = c + dc;
        if (inBounds(br, bc, n) && inBounds(br + 1, bc + 1, n)) {
          for (const rr of [br, br + 1]) for (const cc of [bc, bc + 1]) zone.add(`${rr},${cc}`);
        }
      }
      break;
    }
    case 'L3_Contradiction': {
      const r = info.values[0], c = info.values[1];
      zone.add(`${r},${c}`);
      for (const { dr, dc } of DIRS_4) {
        if (inBounds(r + dr, c + dc, n)) zone.add(`${r + dr},${c + dc}`);
      }
      break;
    }
    case 'L1_Unique': {
      const r = info.values[0], c = info.values[1];
      for (let i = 0; i < n; i++) { zone.add(`${r},${i}`); zone.add(`${i},${c}`); }
      for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) {
        if (dr === 0 && dc === 0) continue;
        if (inBounds(r + dr, c + dc, n)) zone.add(`${r + dr},${c + dc}`);
      }
      break;
    }
  }

  return zone;
}

// ── Spoiler placement ─────────────────────────────────────────────

function addSpoilers(
  earlier: BuildInfo, later: BuildInfo,
  grid: number[][], frozen: Set<string>, n: number, rng: () => number,
): void {
  const zone = getEliminationZone(earlier, n);
  const targetRegions = later.queenIndices;
  if (targetRegions.length === 0) return;

  const candidates: Position[] = [];
  for (const key of zone) {
    if (frozen.has(key)) continue;
    const [r, c] = key.split(',').map(Number);
    if (inBounds(r, c, n) && grid[r][c] === -1) candidates.push({ row: r, col: c });
  }
  if (candidates.length === 0) return;

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let placed = 0;
  const maxSpoilers = 2 * targetRegions.length;
  for (const { row, col } of candidates) {
    if (placed >= maxSpoilers) break;
    claimCell(row, col, targetRegions[placed % targetRegions.length], grid, frozen);
    placed++;
  }
}

// ── Strategy sequence ────────────────────────────────────────────

function pickReverseStrategies(
  n: number, targetSteps: number, rng: () => number,
): { strategy: StrategyType; queenIndices: number[] }[] {
  const sequence: { strategy: StrategyType; queenIndices: number[] }[] = [];
  const usageCount = new Array(n).fill(0);

  // Use at most 6 Queens for constraints — leaves free rows/cols for cells.
  const maxConstraintQueens = Math.min(n, 6);
  const ratio = n <= 6 ? 0.55 : n <= 8 ? 0.40 : 0.30;
  const steps = Math.max(2, Math.min(maxConstraintQueens + 2, Math.floor(targetSteps * ratio)));

  for (let step = 0; step < steps; step++) {
    const roll = rng();
    let strategy: StrategyType;
    let needed: number;

    if (n >= 8 && roll < 0.08)      { strategy = 'L2_Lock3'; needed = 3; }
    else if (n >= 6 && roll < 0.32) { strategy = 'L2_Lock2'; needed = 2; }
    else if (roll < 0.58)           { strategy = 'L2_Lock1'; needed = 1; }
    else if (roll < 0.72)           { strategy = 'L3_Projection'; needed = 1; }
    else if (roll < 0.85)           { strategy = 'L3_Capacity'; needed = 1; }
    else if (roll < 0.93)           { strategy = 'L3_Contradiction'; needed = 1; }
    else                            { strategy = 'L1_Unique'; needed = 1; }

    // Limit Queen pool to maxConstraintQueens
    const ranked = Array.from({ length: maxConstraintQueens }, (_, i) => i)
      .sort((a, b) => usageCount[a] - usageCount[b]);
    const shuffled = shuffle(ranked, rng);
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
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] >= 0) {
        if (!map.has(grid[r][c])) map.set(grid[r][c], []);
        map.get(grid[r][c])!.push({ row: r, col: c });
      }
  return Array.from(map.entries()).map(([id, cells]) => ({ id, cells }));
}

function fillGrid(grid: number[][], n: number, rng: () => number): void {
  const frontier: { row: number; col: number; rid: number }[] = [];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] === -1) continue;
      for (const { dr, dc } of DIRS_4) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc, n) && grid[nr][nc] === -1) {
          frontier.push({ row: nr, col: nc, rid: grid[r][c] });
        }
      }
    }
  }

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

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] !== -1) continue;
      let bestRid = -1, bestDist = Infinity;
      for (let rr = 0; rr < n; rr++) for (let cc = 0; cc < n; cc++) {
        const rid = grid[rr][cc];
        if (rid === -1) continue;
        const d = Math.abs(rr - r) + Math.abs(cc - c);
        if (d < bestDist) { bestDist = d; bestRid = rid; }
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

  // Scale attempts with board size
  const defaultAttempts = n <= 6 ? 40 : n <= 7 ? 60 : n <= 8 ? 100 : n <= 9 ? 150 : 300;
  const maxAttempts = params.maxAttempts ?? defaultAttempts;

  let bestLevel: Level | null = null;
  let bestDiff = Infinity;
  let attempts = 0;
  let bestAttempt = 0;
  let completeCandidates = 0;
  let exactCandidates = 0;

  const makeDiagnostics = (status: GenerationStatus): GenerationDiagnostics => ({
    status, attempts, maxAttempts,
    elapsedMs: Date.now() - startedAt,
    seed: actualSeed, targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt: bestLevel ? bestAttempt : null,
    selectedAttemptSeed: bestLevel ? layoutSeed(actualSeed, bestAttempt - 1, targetSteps) : null,
    completeCandidates, incompleteCandidates: attempts - completeCandidates,
    exactCandidates, allowApproximate,
    anchorStrategy: 'reverseV2', anchorQueenIndices: null, anchorCount: null,
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
    const regionCells = new Array(n).fill(0);
    for (let i = 0; i < queens.length; i++) {
      grid[queens[i].row][queens[i].col] = i;
      frozen.add(posKey(queens[i]));
      regionCells[i] = 1;
    }

    // 3. Strategy sequence
    const seqRng = createRNG(actualSeed + attempt * 7919 + targetSteps * 101 + 777);
    const sequence = pickReverseStrategies(n, targetSteps, seqRng);

    // 4. Build constraints — skip if any involved region is already full
    const buildResults: BuildInfo[] = [];
    const MAX_REGION_CELLS = Math.min(5, Math.ceil(n * 0.6));
    for (const { strategy, queenIndices } of sequence) {
      if (queenIndices.some(qi => regionCells[qi] >= MAX_REGION_CELLS)) continue;
      const info = buildConstraint(strategy, queenIndices, queens, grid, frozen, n, baseRng);
      if (info) {
        buildResults.push(info);
        for (const qi of info.queenIndices) {
          // Count newly claimed cells for this region
          regionCells[qi] = 0;
          for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
            if (grid[r][c] === qi) regionCells[qi]++;
        }
      }
    }

    // 5. Strategic spoiler placement between adjacent pairs
    // buildResults[0] = LAST to fire (built first in reverse)
    // buildResults[i] fires EARLIER than buildResults[i-1] in forward order
    for (let i = 1; i < buildResults.length; i++) {
      addSpoilers(buildResults[i], buildResults[i - 1], grid, frozen, n, baseRng);
    }

    // 6. Fill remaining
    const fillRng = createRNG(actualSeed + attempt * 7919 + targetSteps * 101 + 999);
    fillGrid(grid, n, fillRng);

    // 7. Build regions, solve
    const regions = gridToRegions(grid, n);
    const result = solve(createEmptyBoard(n, regions));
    if (!result.complete) continue;
    completeCandidates++;

    const level = assembleLevel(n, regions, actualSeed, targetSteps,
      `L${n}x${n}-${actualSeed}-rv2-${attempt}`, result);

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

function layoutSeed(base: number, layoutIdx: number, targetSteps: number): number {
  return base + layoutIdx * 7919 + targetSteps * 101;
}
