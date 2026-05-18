/**
 * Reverse Generator V2 — builds puzzles backward through the strategy chain.
 *
 * Each reverse step places minimal grid cells ensuring a specific solver strategy
 * fires. Only placed cells are frozen; regions continue to grow during fill.
 * Extra growth creates "spoilers" — cells that obscure the strategy constraint.
 *
 * Key mechanism — strategic spoiler placement:
 * Between adjacent reverse steps, the EARLIER strategy's elimination zone is
 * used to place spoiler cells for the LATER strategy's regions. In forward
 * solve order, the earlier strategy fires first, X-ing out those spoilers
 * and revealing the later strategy's constraint.
 *
 * Pipeline: Queens → strategy sequence → constraint build + spoilers → fill → verify
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

function buildLock1(
  n: number, qi: number, queens: Position[],
  grid: number[][], frozen: Set<string>, rng: () => number,
): BuildInfo | null {
  const q = queens[qi];
  const axis: 'row' | 'col' = rng() < 0.5 ? 'row' : 'col';

  const cells: Position[] = [{ ...q }];
  const taken = new Set<string>([posKey(q)]);

  const axisCells: Position[] = [];
  for (let i = 0; i < n; i++) {
    const p = axis === 'row' ? { row: q.row, col: i } : { row: i, col: q.col };
    const k = posKey(p);
    if (canPlace(k, frozen, grid, qi) && !taken.has(k)) axisCells.push(p);
  }

  const maxSz = Math.min(axisCells.length, n - 1);
  const sz = Math.max(2, Math.min(maxSz, 3 + Math.floor(rng() * 3))); // 3-5 cells

  const qiAxis = axisCells.findIndex(p => p.row === q.row && p.col === q.col);
  if (qiAxis === -1) return null;

  let left = qiAxis, right = qiAxis;
  while (taken.size < sz) {
    const goLeft = left > 0 && (right >= axisCells.length - 1 || rng() < 0.5);
    if (goLeft) {
      left--;
      const k = posKey(axisCells[left]);
      if (!taken.has(k) && canPlace(k, frozen, grid, qi)) { taken.add(k); cells.push(axisCells[left]); }
    } else if (right < axisCells.length - 1) {
      right++;
      const k = posKey(axisCells[right]);
      if (!taken.has(k) && canPlace(k, frozen, grid, qi)) { taken.add(k); cells.push(axisCells[right]); }
    } else break;
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

  const sz0 = 3 + Math.floor(rng() * 3); // 3-5 cells
  const sz1 = 3 + Math.floor(rng() * 3);
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
    const p = axis === 'row'
      ? { row: q.row, col: q.col + sign }
      : { row: q.row + sign, col: q.col };
    if (inBounds(p.row, p.col, n) && canPlace(posKey(p), frozen, grid, qi)) cands.push(p);
  }

  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }

  const targetSz = 2 + Math.floor(rng() * 2);
  claimCell(q.row, q.col, qi, grid, frozen);
  let placed = 1;
  for (const p of cands) {
    if (placed >= targetSz) break;
    claimCell(p.row, p.col, qi, grid, frozen);
    placed++;
  }
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
  for (const dr of [0, -1]) {
    for (const dc of [0, -1]) {
      const r = q.row + dr, c = q.col + dc;
      if (!inBounds(r, c, n) || !inBounds(r + 1, c + 1, n)) continue;
      const free: Position[] = [];
      for (const br of [r, r + 1]) for (const bc of [c, c + 1]) {
        const k = posKey({ row: br, col: bc });
        if (!taken.has(k) && canPlace(k, frozen, grid, qi)) free.push({ row: br, col: bc });
      }
      if (free.length >= 1) blocks.push(free);
    }
  }
  if (blocks.length === 0) return null;

  const block = blocks[Math.floor(rng() * blocks.length)];
  for (let i = block.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [block[i], block[j]] = [block[j], block[i]]; }

  claimCell(q.row, q.col, qi, grid, frozen);
  let placed = 1;
  for (const p of block) { if (placed >= 3) break; claimCell(p.row, p.col, qi, grid, frozen); placed++; }

  // Capacity elim zone = the 2x2 block — store block corner
  const blockCorner = `${q.row}-${q.col}`;
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
  n: number, qi: number, queens: Position[],
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

// ── Elimination zone computation ──────────────────────────────────

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
      // 2×2 block around the Queen
      const r = info.values[0], c = info.values[1];
      for (const dr of [0, -1]) for (const dc of [0, -1]) {
        const br = r + dr, bc = c + dc;
        if (inBounds(br, bc, n) && inBounds(br + 1, bc + 1, n)) {
          zone.add(`${br},${bc}`); zone.add(`${br},${bc + 1}`);
          zone.add(`${br + 1},${bc}`); zone.add(`${br + 1},${bc + 1}`);
        }
      }
      break;
    }
    case 'L3_Contradiction': {
      // Around the eliminated cell
      const r = info.values[0], c = info.values[1];
      zone.add(`${r},${c}`);
      for (const { dr, dc } of DIRS_4) {
        if (inBounds(r + dr, c + dc, n)) zone.add(`${r + dr},${c + dc}`);
      }
      break;
    }
    case 'L1_Unique': {
      const r = info.values[0], c = info.values[1];
      // Queen's row + col + adjacent (what L1_Direct will X after Unique confirms)
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
  earlier: BuildInfo,  // fires EARLIER in forward solve → its elim zone
  later: BuildInfo,    // fires LATER → its regions need spoilers
  grid: number[][], frozen: Set<string>, n: number, rng: () => number,
): void {
  const zone = getEliminationZone(earlier, n);
  const targetRegions = later.queenIndices;
  if (targetRegions.length === 0) return;

  // Collect unassigned cells in the elimination zone
  const candidates: Position[] = [];
  for (const key of zone) {
    if (frozen.has(key)) continue;
    const [r, c] = key.split(',').map(Number);
    if (r >= 0 && r < n && c >= 0 && c < n && grid[r][c] === -1) {
      candidates.push({ row: r, col: c });
    }
  }
  if (candidates.length === 0) return;

  // Shuffle and take up to 2 spoilers per target region
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let placed = 0;
  const maxSpoilers = 2 * targetRegions.length;
  for (const { row, col } of candidates) {
    if (placed >= maxSpoilers) break;
    const rid = targetRegions[placed % targetRegions.length];
    claimCell(row, col, rid, grid, frozen);
    placed++;
  }
}

// ── Strategy sequence ────────────────────────────────────────────

function pickReverseStrategies(
  n: number, targetSteps: number, rng: () => number,
): { strategy: StrategyType; queenIndices: number[] }[] {
  const sequence: { strategy: StrategyType; queenIndices: number[] }[] = [];
  const usageCount = new Array(n).fill(0);

  const steps = Math.max(3, Math.min(n * 2 + 2, Math.floor(targetSteps * 0.55)));

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

function fillGrid(grid: number[][], n: number, rng: () => number): void {
  const frontier: { row: number; col: number; rid: number }[] = [];

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

  // Fallback: unassigned cells → nearest region
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
    status, attempts, maxAttempts,
    elapsedMs: Date.now() - startedAt,
    seed: actualSeed, targetSteps,
    bestActualSteps: bestLevel?.actualSteps ?? null,
    bestDiff: bestLevel ? bestLevel.actualSteps - targetSteps : null,
    selectedAttempt: bestLevel ? bestAttempt : null,
    selectedAttemptSeed: bestLevel ? actualSeed + (bestAttempt - 1) * 7919 + targetSteps * 101 : null,
    completeCandidates,
    incompleteCandidates: attempts - completeCandidates,
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

    // 2. Init grid
    const grid: number[][] = Array.from({ length: n }, () => Array(n).fill(-1));
    const frozen = new Set<string>();
    for (let i = 0; i < queens.length; i++) {
      grid[queens[i].row][queens[i].col] = i;
      frozen.add(posKey(queens[i]));
    }

    // 3. Strategy sequence
    const seqRng = createRNG(actualSeed + attempt * 7919 + targetSteps * 101 + 777);
    const sequence = pickReverseStrategies(n, targetSteps, seqRng);
    if (sequence.length === 0) continue;

    // 4. Build constraints in reverse order, collecting BuildInfo
    const buildResults: BuildInfo[] = [];
    for (const { strategy, queenIndices } of sequence) {
      const info = buildConstraint(strategy, queenIndices, queens, grid, frozen, n, baseRng);
      if (info) buildResults.push(info);
    }
    if (buildResults.length < 2) continue; // need at least 2 steps for spoiler chain

    // 5. Strategic spoiler placement between adjacent pairs
    // buildResults[0] = LAST to fire (built first)
    // buildResults[k] = fires earlier than buildResults[k-1]
    // So later[k-1] needs spoilers placed in earlier[k]'s elimination zone
    for (let i = 1; i < buildResults.length; i++) {
      const earlier = buildResults[i];    // fires EARLIER in forward order
      const later = buildResults[i - 1];  // fires LATER, needs spoilers
      addSpoilers(earlier, later, grid, frozen, n, baseRng);
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
