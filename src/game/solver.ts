import { BoardState, Position, SolverBatch, SolverResult, StrategyType } from './types';
import {
  cloneBoard,
  getCandidatesInRow,
  getCandidatesInCol,
  getCandidatesInRegion,
  findUniqueCandidates,
  applyQueen,
  applyX,
  isBoardComplete,
  getRegionIds,
  getAdjacentPositions,
  formatPos,
} from './rules';

function posKey(p: Position): string { return `${p.row},${p.col}`; }

// ============================================================
// 求解器 — 6 种策略扁平循环，任意命中回到第一种重试
// ============================================================

/** 将一个批次的产出应用到棋盘上 */
function applyBatch(board: BoardState, batch: SolverBatch): BoardState {
  let b = cloneBoard(board);
  for (const x of batch.eliminations) b = applyX(b, x);
  for (const q of batch.queenConfirmed) {
    const cell = b.cells[q.row][q.col];
    cell.isQueen = true;
    cell.isX = false;
    cell.isWrong = false;
  }
  return b;
}

// ── L1 直接确认 + 唯一候选 ──────────────────────────────────────

function stepL1(board: BoardState, index: number): SolverBatch | null {
  const uniq = findUniqueCandidates(board);
  if (uniq.length === 0) return null;

  // 每次只处理一个 Queen — applyQueen 原子化搞定放置和传播
  const target = uniq[0];
  const { newX } = applyQueen(board, target);

  return {
    index,
    strategy: 'L1',
    eliminations: newX,
    queenConfirmed: [target],
    description: `确认 Queen ${formatPos(target)}，传播消除 ${newX.length} X`,
  };
}

// ── L2 锁定 — 广义鸽巢原理（k 个单位 → k 个资源） ──────────────

type LockDim = 'row' | 'col' | 'region';

/** 枚举 arr 中所有 k 组合 */
function* combosK<T>(arr: T[], k: number, start = 0, current: T[] = []): Generator<T[]> {
  if (current.length === k) { yield [...current]; return; }
  for (let i = start; i <= arr.length - (k - current.length); i++) {
    current.push(arr[i]);
    yield* combosK(arr, k, i + 1, current);
    current.pop();
  }
}

/**
 * 广义鸽巢原理消除。
 *
 * 如果 k 个 from 维度单位（行/列/区域）的所有候选格局限在恰好 k 个 into 维度单位中，
 * 则这 k 个 into 维度单位被"锁定"——这些单位中的外来候选可被消除。
 */
function lockK(
  board: BoardState,
  k: number,
  fromDim: LockDim,
  intoDim: LockDim,
  index: number,
): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);

  const strategy = ([, 'L2_Lock1', 'L2_Lock2', 'L2_Lock3'] as const)[k];
  const cnLabel = ['', '单', '双', '三'][k];

  const unitIds = (dim: LockDim): number[] =>
    dim === 'region' ? regionIds : Array.from({ length: n }, (_, i) => i);

  const getCands = (dim: LockDim, id: number): Position[] => {
    if (dim === 'row') return getCandidatesInRow(board, id);
    if (dim === 'col') return getCandidatesInCol(board, id);
    return getCandidatesInRegion(board, id);
  };

  const dimVal = (dim: LockDim, p: Position): number => {
    if (dim === 'row') return p.row;
    if (dim === 'col') return p.col;
    return board.cells[p.row][p.col].regionId;
  };

  const fmtUnit = (dim: LockDim, id: number): string => {
    if (dim === 'row') return `第${id}行`;
    if (dim === 'col') return `第${id}列`;
    return `区域${id}`;
  };

  const ids = unitIds(fromDim);

  for (const combo of combosK(ids, k)) {
    // 收集 k 个 from 维度单位的所有候选
    const allCands: Position[] = [];
    for (const id of combo) allCands.push(...getCands(fromDim, id));
    if (allCands.length < k) continue;

    // 检查是否局限在恰好 k 个 into 维度单位
    const intoVals = new Set(allCands.map(c => dimVal(intoDim, c)));
    if (intoVals.size !== k) continue;

    // k 个 from 单位 → k 个 into 单位 — 消除外部候选
    const eliminations: Position[] = [];
    const elimSet = new Set<string>();
    const fromSet = new Set(combo);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = board.cells[r][c];
        if (cell.isQueen || cell.isX || cell.isWrong) continue;
        if (!intoVals.has(dimVal(intoDim, { row: r, col: c }))) continue;
        if (fromSet.has(dimVal(fromDim, { row: r, col: c }))) continue;
        const key = `${r},${c}`;
        if (!elimSet.has(key)) { elimSet.add(key); eliminations.push({ row: r, col: c }); }
      }
    }

    if (eliminations.length > 0) {
      const fromDesc = combo.map(id => fmtUnit(fromDim, id)).join('、');
      const intoDesc = Array.from(intoVals).map(v => fmtUnit(intoDim, v)).join('、');
      return {
        index,
        strategy: strategy as StrategyType,
        eliminations,
        queenConfirmed: [],
        description: `L2 ${cnLabel}锁定 (${fromDim}→${intoDim}): ${fromDesc}独占 ${intoDesc} — 消除 ${eliminations.length} X`,
      };
    }
  }

  return null;
}

/** 全部 6 组有效的 (fromDim, intoDim) 配对，其中 fromDim ≠ intoDim */
const LOCK_PAIRS: [LockDim, LockDim][] = [
  ['region', 'row'],
  ['region', 'col'],
  ['row',    'region'],
  ['col',    'region'],
  ['row',    'col'],
  ['col',    'row'],
];

function stepL2Lock1(board: BoardState, index: number): SolverBatch | null {
  for (const [fromDim, intoDim] of LOCK_PAIRS) {
    const batch = lockK(board, 1, fromDim, intoDim, index);
    if (batch) return batch;
  }
  return null;
}

function stepL2Lock2(board: BoardState, index: number): SolverBatch | null {
  for (const [fromDim, intoDim] of LOCK_PAIRS) {
    const batch = lockK(board, 2, fromDim, intoDim, index);
    if (batch) return batch;
  }
  return null;
}

function stepL2Lock3(board: BoardState, index: number): SolverBatch | null {
  for (const [fromDim, intoDim] of LOCK_PAIRS) {
    const batch = lockK(board, 3, fromDim, intoDim, index);
    if (batch) return batch;
  }
  return null;
}

// ── L3 投影与矛盾 ──────────────────────────────────────────────

/** 收集所有候选数 ≥2 的行/列/区域 */
function collectCandidateUnits(board: BoardState, n: number): { candidates: Position[]; label: string }[] {
  const regionIds = getRegionIds(board);
  const units: { candidates: Position[]; label: string }[] = [];

  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length >= 2) units.push({ candidates: cands, label: `第${r}行` });
  }
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length >= 2) units.push({ candidates: cands, label: `第${c}列` });
  }
  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length >= 2) units.push({ candidates: cands, label: `区域${rid}` });
  }

  return units;
}

/** 计算将某个候选格确认为 Queen 后会消除的所有格子集合 */
function candidateProjectionSet(board: BoardState, n: number, cand: Position): Set<string> {
  const proj = new Set<string>();
  const rid = board.cells[cand.row][cand.col].regionId;

  for (let cc = 0; cc < n; cc++) if (cc !== cand.col) proj.add(`${cand.row},${cc}`);
  for (let rr = 0; rr < n; rr++) if (rr !== cand.row) proj.add(`${rr},${cand.col}`);
  for (let rr = 0; rr < n; rr++)
    for (let cc = 0; cc < n; cc++)
      if (board.cells[rr][cc].regionId === rid && !(rr === cand.row && cc === cand.col))
        proj.add(`${rr},${cc}`);
  const adj = getAdjacentPositions(cand, n);
  for (const a of adj) proj.add(`${a.row},${a.col}`);

  return proj;
}

/**
 * L3 投影：对某个单位的候选集，取每个候选的投影集合的交集。
 * 交集内的格子无论选哪个候选都会被消除 → 可以安全标 X。
 */
function stepL3Projection(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;

  for (const unit of collectCandidateUnits(board, n)) {
    const cands = unit.candidates;
    if (cands.length < 2) continue;

    const projections = cands.map(c => candidateProjectionSet(board, n, c));
    let intersection = projections[0];
    for (let i = 1; i < projections.length; i++)
      intersection = new Set([...intersection].filter(x => projections[i].has(x)));

    const eliminations: Position[] = [];
    const elimSet = new Set<string>();
    for (const key of intersection) {
      if (elimSet.has(key)) continue;
      const [r, c] = key.split(',').map(Number);
      const cell = board.cells[r][c];
      if (!cell.isQueen && !cell.isX && !cell.isWrong) {
        elimSet.add(key);
        eliminations.push({ row: r, col: c });
      }
    }

    if (eliminations.length > 0) {
      return { index, strategy: 'L3_Projection', eliminations, queenConfirmed: [], description: `L3 投影: ${unit.label} 排除 ${eliminations.length} 公共格` };
    }
  }

  return null;
}

/**
 * L3 矛盾法：假设某个候选是 Queen → 单步投影 → 检查是否有行/列/区域候选归零。
 * 如果归零 → 矛盾 → 该候选一定不是 Queen → 标 X。
 */
function stepL3Contradiction(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);

  for (const unit of collectCandidateUnits(board, n)) {
    const cands = unit.candidates;
    if (cands.length < 2) continue;

    for (const cand of cands) {
      const rid = board.cells[cand.row][cand.col].regionId;
      const tempX = candidateProjectionSet(board, n, cand);

      for (let r = 0; r < n; r++) {
        if (r === cand.row) continue;
        const rowCands = getCandidatesInRow(board, r);
        if (rowCands.length > 0 && rowCands.every(rc => tempX.has(posKey(rc)))) {
          return { index, strategy: 'L3_Contradiction', eliminations: [cand], queenConfirmed: [], description: `L3 矛盾: ${formatPos(cand)} 若为 Queen 使第${r}行无候选 → 排除` };
        }
      }

      for (let c = 0; c < n; c++) {
        if (c === cand.col) continue;
        const colCands = getCandidatesInCol(board, c);
        if (colCands.length > 0 && colCands.every(cc => tempX.has(posKey(cc)))) {
          return { index, strategy: 'L3_Contradiction', eliminations: [cand], queenConfirmed: [], description: `L3 矛盾: ${formatPos(cand)} 若为 Queen 使第${c}列无候选 → 排除` };
        }
      }

      for (const rid2 of regionIds) {
        if (rid2 === rid) continue;
        const regCands = getCandidatesInRegion(board, rid2);
        if (regCands.length > 0 && regCands.every(rc => tempX.has(posKey(rc)))) {
          return { index, strategy: 'L3_Contradiction', eliminations: [cand], queenConfirmed: [], description: `L3 矛盾: ${formatPos(cand)} 若为 Queen 使区域${rid2}无候选 → 排除` };
        }
      }
    }
  }

  return null;
}

// ── 主循环 ──────────────────────────────────────────────────────

/** 策略列表，按尝试顺序排列 */
const STRATEGIES = [
  stepL1,
  stepL2Lock1,
  stepL2Lock2,
  stepL2Lock3,
  stepL3Projection,
  stepL3Contradiction,
];

/** 求解主入口：返回完整 SolverResult */
export function solve(board: BoardState): SolverResult {
  const batches: SolverBatch[] = [];
  let currentBoard = cloneBoard(board);
  let batchIndex = 0;
  const maxIterations = 500;
  let iterations = 0;

  while (iterations++ < maxIterations) {
    if (isBoardComplete(currentBoard)) return buildResult(true, batches);

    let produced = false;
    for (const fn of STRATEGIES) {
      const batch = fn(currentBoard, batchIndex + 1);
      if (batch) {
        batchIndex++;
        batches.push(batch);
        currentBoard = applyBatch(currentBoard, batch);
        produced = true;
        break;  // 任意命中，回到第一种策略重新开始
      }
    }

    if (!produced) break;
  }

  if (isBoardComplete(currentBoard)) return buildResult(true, batches);
  return buildResult(false, batches);
}

function buildResult(complete: boolean, batches: SolverBatch[]): SolverResult {
  return {
    complete,
    batches,
    totalSteps: batches.length,
    strategyTypesUsed: [...new Set(batches.map(b => b.strategy))],
  };
}

/** 将批次序列应用到指定步骤，返回中间棋盘状态 */
export function applyBatchesUpTo(board: BoardState, batches: SolverBatch[], step: number): BoardState {
  let b = cloneBoard(board);
  for (let i = 0; i < Math.min(step, batches.length); i++) b = applyBatch(b, batches[i]);
  return b;
}
