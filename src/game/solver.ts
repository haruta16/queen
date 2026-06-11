import {
  BoardState, Position, SolverBatch, SolverResult, StrategyType,
  UnitRef, UnitKind, SolverBatchReason,
} from './types';
import {
  cloneBoard,
  getCandidatesInRow,
  getCandidatesInCol,
  getCandidatesInRegion,
  applyQueen,
  applyX,
  isBoardComplete,
  getRegionIds,
  formatPos,
} from './rules';

// ============================================================
// 求解器 — 9 种策略扁平循环，任意命中回到第一种重试
// ============================================================

// ── 辅助函数 ──────────────────────────────────────────────────

/** 投影：格子的四方（同行+同列）+ 九宫（8邻域）+ 同色 */
function getProjection(board: BoardState, pos: Position): Position[] {
  const n = board.n;
  const { row, col } = pos;
  const regionId = board.cells[row][col].regionId;
  const seen = new Set<string>();
  const result: Position[] = [];

  const add = (r: number, c: number) => {
    if (r < 0 || r >= n || c < 0 || c >= n) return;
    if (r === row && c === col) return;
    const key = `${r},${c}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ row: r, col: c });
  };

  // 四方：同行
  for (let cc = 0; cc < n; cc++) add(row, cc);
  // 四方：同列
  for (let rr = 0; rr < n; rr++) add(rr, col);
  // 九宫：8邻域
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if (dr !== 0 || dc !== 0)
        add(row + dr, col + dc);
  // 同色
  for (let rr = 0; rr < n; rr++)
    for (let cc = 0; cc < n; cc++)
      if (board.cells[rr][cc].regionId === regionId)
        add(rr, cc);

  return result;
}

/** 过滤：仅保留当前仍是候选的格子（非Q、非X、非Wrong） */
function filterCandidates(board: BoardState, positions: Position[]): Position[] {
  return positions.filter(p => {
    const c = board.cells[p.row][p.col];
    return !c.isQueen && !c.isX && !c.isWrong;
  });
}

/** 应用批次到棋盘（返回新棋盘，不修改原棋盘） */
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

/** 检查是否有行列单位候选归零（且尚未放置Queen） */
function findZeroCandidateRC(board: BoardState): string | null {
  const n = board.n;
  for (let r = 0; r < n; r++) {
    const hasQ = board.cells[r].some(c => c.isQueen);
    if (!hasQ && getCandidatesInRow(board, r).length === 0)
      return `第${r}行没有候选格`;
  }
  for (let c = 0; c < n; c++) {
    let hasQ = false;
    for (let r = 0; r < n; r++) if (board.cells[r][c].isQueen) hasQ = true;
    if (!hasQ && getCandidatesInCol(board, c).length === 0)
      return `第${c}列没有候选格`;
  }
  return null;
}

/** 检查是否有颜色单位候选归零（且尚未放置Queen） */
function findZeroCandidateColor(board: BoardState): string | null {
  for (const rid of getRegionIds(board)) {
    let hasQ = false;
    for (let r = 0; r < board.n; r++)
      for (let c = 0; c < board.n; c++)
        if (board.cells[r][c].isQueen && board.cells[r][c].regionId === rid) hasQ = true;
    if (!hasQ && getCandidatesInRegion(board, rid).length === 0)
      return `区域${rid}没有候选格`;
  }
  return null;
}

/** 获取各区域候选映射 */
function regionCandsMap(board: BoardState): Map<number, Position[]> {
  const map = new Map<number, Position[]>();
  for (const rid of getRegionIds(board)) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length > 0) map.set(rid, cands);
  }
  return map;
}

/** 获取各行候选映射 */
function rowCandsMap(board: BoardState): Map<number, Position[]> {
  const map = new Map<number, Position[]>();
  for (let r = 0; r < board.n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length > 0) map.set(r, cands);
  }
  return map;
}

/** 获取各列候选映射 */
function colCandsMap(board: BoardState): Map<number, Position[]> {
  const map = new Map<number, Position[]>();
  for (let c = 0; c < board.n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length > 0) map.set(c, cands);
  }
  return map;
}

/** 组合数生成器 */
function* combos<T>(arr: T[], k: number, start = 0): Generator<T[]> {
  if (k === 0) { yield []; return; }
  for (let i = start; i <= arr.length - k; i++) {
    for (const rest of combos(arr, k - 1, i + 1)) {
      yield [arr[i], ...rest];
    }
  }
}

/** 格式化单位名称 */
function unitLabel(kind: UnitKind, id: number): string {
  if (kind === 'row') return `第${id}行`;
  if (kind === 'col') return `第${id}列`;
  return `区域${id}`;
}

function makeUnitRef(kind: UnitKind, index: number): UnitRef {
  return { kind, index };
}

// ── ① L1_RC ──────────────────────────────────────────────────

function stepL1_RC(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;

  // 检查行
  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length === 1) {
      return makeL1Batch(board, cands[0], index, 'L1_RC', `行列唯一: ${formatPos(cands[0])}`);
    }
  }
  // 检查列
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length === 1) {
      return makeL1Batch(board, cands[0], index, 'L1_RC', `行列唯一: ${formatPos(cands[0])}`);
    }
  }
  return null;
}

// ── ② L1_Color ───────────────────────────────────────────────

function stepL1_Color(board: BoardState, index: number): SolverBatch | null {
  for (const rid of getRegionIds(board)) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length === 1) {
      return makeL1Batch(board, cands[0], index, 'L1_Color', `颜色唯一: ${formatPos(cands[0])}`);
    }
  }
  return null;
}

function makeL1Batch(
  board: BoardState, target: Position, index: number,
  strategy: StrategyType, desc: string,
): SolverBatch {
  const { newX } = applyQueen(board, target);
  return {
    index, strategy,
    eliminations: newX,
    queenConfirmed: [target],
    description: `${desc}，传播消除 ${newX.length} X`,
    reason: { remainingCandidates: [target] },
  };
}

// ── ③ L2_RC ──────────────────────────────────────────────────

function stepL2_RC(board: BoardState, index: number): SolverBatch | null {
  const regionMap = regionCandsMap(board);
  const regionIds = [...regionMap.keys()];
  if (regionIds.length < 2) return null;

  const n = board.n;
  const maxK = Math.min(regionIds.length - 1, Math.floor(n / 2) + 1);
  let best: { k: number; sourceIds: number[]; targetKind: 'row' | 'col'; targetIds: number[]; elims: Position[] } | null = null;

  // 遍历 k = 1 .. maxK，按 k 从小到大优先，同一 k 内选消除最多的
  for (let k = 1; k <= maxK; k++) {
    let foundK = false;
    for (const combo of combos(regionIds, k)) {
      // 尝试 region→row
      const rowSet = new Set<number>();
      for (const rid of combo) {
        for (const cand of regionMap.get(rid)!) rowSet.add(cand.row);
      }
      if (rowSet.size === k) {
        const elims = collectLockElims_RC(board, combo, [...rowSet], 'row');
        if (elims.length > 0) {
          if (!best || k < best.k || (k === best.k && elims.length > best.elims.length)) {
            best = { k, sourceIds: [...combo], targetKind: 'row', targetIds: [...rowSet], elims };
            foundK = true;
          }
        }
      }

      // 尝试 region→col
      const colSet = new Set<number>();
      for (const rid of combo) {
        for (const cand of regionMap.get(rid)!) colSet.add(cand.col);
      }
      if (colSet.size === k) {
        const elims = collectLockElims_RC(board, combo, [...colSet], 'col');
        if (elims.length > 0) {
          if (!best || k < best.k || (k === best.k && elims.length > best.elims.length)) {
            best = { k, sourceIds: [...combo], targetKind: 'col', targetIds: [...colSet], elims };
            foundK = true;
          }
        }
      }
    }
    if (foundK) break; // 取最小 k
  }

  if (!best) return null;

  const targetKind: UnitKind = best.targetKind;
  const sourceLabels = best.sourceIds.map(id => unitLabel('region', id)).join('、');
  const targetLabels = best.targetIds.map(id => unitLabel(targetKind, id)).join('、');

  return {
    index, strategy: 'L2_RC',
    eliminations: best.elims,
    queenConfirmed: [],
    description: `L2 锁定 ${best.k}组: ${sourceLabels} → ${targetLabels}，消除 ${best.elims.length} X`,
    reason: {
      groupSize: best.k,
      sourceUnits: best.sourceIds.map(id => makeUnitRef('region', id)),
      targetUnits: best.targetIds.map(id => makeUnitRef(targetKind, id)),
      excludedCells: best.elims,
    },
  };
}

/** L2_RC 用：收集目标行/列中非锁定颜色的候选 */
function collectLockElims_RC(
  board: BoardState, lockedRegionIds: number[], targetIds: number[], targetKind: 'row' | 'col',
): Position[] {
  const lockedSet = new Set(lockedRegionIds);
  const result: Position[] = [];
  const seen = new Set<string>();

  for (const tid of targetIds) {
    const cands = targetKind === 'row' ? getCandidatesInRow(board, tid) : getCandidatesInCol(board, tid);
    for (const cand of cands) {
      const rid = board.cells[cand.row][cand.col].regionId;
      if (!lockedSet.has(rid)) {
        const key = `${cand.row},${cand.col}`;
        if (!seen.has(key)) { seen.add(key); result.push(cand); }
      }
    }
  }
  return result;
}

// ── ④ L2_Color ───────────────────────────────────────────────

function stepL2_Color(board: BoardState, index: number): SolverBatch | null {
  const rowMap = rowCandsMap(board);
  const colMap = colCandsMap(board);
  const regionIds = getRegionIds(board);
  const regionSet = new Set(regionIds);
  const n = board.n;

  const maxK = Math.min(n - 1, Math.floor(n / 2) + 1);
  let best: { k: number; sourceKind: 'row' | 'col'; sourceIds: number[]; targetIds: number[]; elims: Position[] } | null = null;

  for (let k = 1; k <= maxK; k++) {
    // rows → colors
    const rowIds = [...rowMap.keys()];
    if (rowIds.length >= k) {
      for (const combo of combos(rowIds, k)) {
        const regionHit = new Set<number>();
        for (const sid of combo) {
          for (const cand of rowMap.get(sid)!) regionHit.add(board.cells[cand.row][cand.col].regionId);
        }
        if (regionHit.size === k && [...regionHit].every(rid => regionSet.has(rid))) {
          const elims = collectLockElims_Color(board, combo, 'row', [...regionHit]);
          if (elims.length > 0) {
            if (!best || k < best.k || (k === best.k && elims.length > best.elims.length)) {
              best = { k, sourceKind: 'row', sourceIds: [...combo], targetIds: [...regionHit], elims };
            }
          }
        }
      }
    }

    // cols → colors (only if no row-lock found at this k)
    if (!best) {
      const colIds = [...colMap.keys()];
      if (colIds.length >= k) {
        for (const combo of combos(colIds, k)) {
          const regionHit = new Set<number>();
          for (const sid of combo) {
            for (const cand of colMap.get(sid)!) regionHit.add(board.cells[cand.row][cand.col].regionId);
          }
          if (regionHit.size === k && [...regionHit].every(rid => regionSet.has(rid))) {
            const elims = collectLockElims_Color(board, combo, 'col', [...regionHit]);
            if (elims.length > 0) {
              if (!best || k < best.k || (k === best.k && elims.length > best.elims.length)) {
                best = { k, sourceKind: 'col', sourceIds: [...combo], targetIds: [...regionHit], elims };
              }
            }
          }
        }
      }
    }

    if (best) break;
  }

  if (!best) return null;

  const sourceKind: UnitKind = best.sourceKind;
  const sourceLabels = best.sourceIds.map(id => unitLabel(sourceKind, id)).join('、');
  const targetLabels = best.targetIds.map(id => unitLabel('region', id)).join('、');

  return {
    index, strategy: 'L2_Color',
    eliminations: best.elims,
    queenConfirmed: [],
    description: `L2 锁定 ${best.k}组: ${sourceLabels} → ${targetLabels}，消除 ${best.elims.length} X`,
    reason: {
      groupSize: best.k,
      sourceUnits: best.sourceIds.map(id => makeUnitRef(sourceKind, id)),
      targetUnits: best.targetIds.map(id => makeUnitRef('region', id)),
      excludedCells: best.elims,
    },
  };
}

/** L2_Color 用：收集锁定颜色中非锁定行/列的候选 */
function collectLockElims_Color(
  board: BoardState, lockedSourceIds: number[], sourceKind: 'row' | 'col',
  lockedRegionIds: number[],
): Position[] {
  const lockedSourceSet = new Set(lockedSourceIds);
  const lockedRegionSet = new Set(lockedRegionIds);
  const result: Position[] = [];
  const seen = new Set<string>();

  for (const rid of lockedRegionIds) {
    const cands = getCandidatesInRegion(board, rid);
    for (const cand of cands) {
      const sid = sourceKind === 'row' ? cand.row : cand.col;
      if (!lockedSourceSet.has(sid)) {
        const key = `${cand.row},${cand.col}`;
        if (!seen.has(key)) { seen.add(key); result.push(cand); }
      }
    }
  }
  return result;
}

// ── ⑤ L3_Projection_Color ────────────────────────────────────

function stepL3_Projection_Color(board: BoardState, index: number): SolverBatch | null {
  const regionMap = regionCandsMap(board);

  let best: { unitKind: UnitKind; unitId: number; cands: Position[]; elims: Position[] } | null = null;

  for (const [rid, cands] of regionMap) {
    if (cands.length < 2) continue;

    const projections = cands.map(c => getProjection(board, c));
    let intersection = new Set(projections[0].map(p => `${p.row},${p.col}`));
    for (let i = 1; i < projections.length; i++) {
      const s = new Set(projections[i].map(p => `${p.row},${p.col}`));
      intersection = new Set([...intersection].filter(x => s.has(x)));
    }
    if (intersection.size === 0) continue;

    const elims = filterCandidates(board, [...intersection].map(k => {
      const [r, c] = k.split(',').map(Number);
      return { row: r, col: c };
    }));

    if (elims.length > 0 && (!best || elims.length > best.elims.length)) {
      best = { unitKind: 'region', unitId: rid, cands, elims };
    }
  }

  if (!best) return null;

  return {
    index, strategy: 'L3_Projection_Color',
    eliminations: best.elims,
    queenConfirmed: [],
    description: `颜色投影交集: ${unitLabel('region', best.unitId)} — 消除 ${best.elims.length} X`,
    reason: {
      sourceUnit: makeUnitRef('region', best.unitId),
      sourceCandidates: best.cands,
      excludedCells: best.elims,
    },
  };
}

// ── ⑥ L3_Projection_RC ───────────────────────────────────────

function stepL3_Projection_RC(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const units: { kind: UnitKind; id: number; cands: Position[] }[] = [];

  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length >= 2) units.push({ kind: 'row', id: r, cands });
  }
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length >= 2) units.push({ kind: 'col', id: c, cands });
  }

  let best: { kind: UnitKind; id: number; cands: Position[]; elims: Position[] } | null = null;

  for (const unit of units) {
    const projections = unit.cands.map(c => getProjection(board, c));
    let intersection = new Set(projections[0].map(p => `${p.row},${p.col}`));
    for (let i = 1; i < projections.length; i++) {
      const s = new Set(projections[i].map(p => `${p.row},${p.col}`));
      intersection = new Set([...intersection].filter(x => s.has(x)));
    }
    if (intersection.size === 0) continue;

    const elims = filterCandidates(board, [...intersection].map(k => {
      const [r, c] = k.split(',').map(Number);
      return { row: r, col: c };
    }));

    if (elims.length > 0 && (!best || elims.length > best.elims.length)) {
      best = { kind: unit.kind, id: unit.id, cands: unit.cands, elims };
    }
  }

  if (!best) return null;

  return {
    index, strategy: 'L3_Projection_RC',
    eliminations: best.elims,
    queenConfirmed: [],
    description: `行列投影交集: ${unitLabel(best.kind, best.id)} — 消除 ${best.elims.length} X`,
    reason: {
      sourceUnit: makeUnitRef(best.kind, best.id),
      sourceCandidates: best.cands,
      excludedCells: best.elims,
    },
  };
}

// ── ⑦ L3_Contra_RC ───────────────────────────────────────────

function stepL3_Contra_RC(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const units: { kind: UnitKind; id: number; cands: Position[] }[] = [];

  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length >= 2) units.push({ kind: 'row', id: r, cands });
  }
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length >= 2) units.push({ kind: 'col', id: c, cands });
  }

  for (const unit of units) {
    for (const cand of unit.cands) {
      const trial = applyQueen(board, cand).board;
      const cont = findZeroCandidateRC(trial);
      if (cont) {
        return {
          index, strategy: 'L3_Contra_RC',
          eliminations: [cand],
          queenConfirmed: [],
          description: `单步反推-行列: 假设 ${formatPos(cand)} 为 Queen → ${cont} → 排除`,
          reason: {
            assumptionCell: cand,
            sourceUnit: makeUnitRef(unit.kind, unit.id),
            contradictionType: 'zero_candidate_rc',
          },
        };
      }
    }
  }
  return null;
}

// ── ⑧ L3_Contra_Color ────────────────────────────────────────

function stepL3_Contra_Color(board: BoardState, index: number): SolverBatch | null {
  const regionMap = regionCandsMap(board);

  for (const [rid, cands] of regionMap) {
    if (cands.length < 2) continue;
    for (const cand of cands) {
      const trial = applyQueen(board, cand).board;
      const cont = findZeroCandidateColor(trial);
      if (cont) {
        return {
          index, strategy: 'L3_Contra_Color',
          eliminations: [cand],
          queenConfirmed: [],
          description: `单步反推-颜色: 假设 ${formatPos(cand)} 为 Queen → ${cont} → 排除`,
          reason: {
            assumptionCell: cand,
            sourceUnit: makeUnitRef('region', rid),
            contradictionType: 'zero_candidate_color',
          },
        };
      }
    }
  }
  return null;
}

// ── ⑨ L4_Contra ──────────────────────────────────────────────

const TRIAL_STRATEGIES: Array<(b: BoardState, idx: number) => SolverBatch | null> = [
  stepL1_RC, stepL1_Color,
  stepL2_RC, stepL2_Color,
  stepL3_Projection_Color, stepL3_Projection_RC,
];

const BRANCH_PROPAGATION_LIMIT = 2;

function stepL4_Contra(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;

  // 收集所有 ≥2 候选的单位中的候选格
  const candsToTry: { cand: Position; unitKind: UnitKind; unitId: number }[] = [];
  const seen = new Set<string>();

  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length >= 2) {
      for (const c of cands) {
        const k = `${c.row},${c.col}`;
        if (!seen.has(k)) { seen.add(k); candsToTry.push({ cand: c, unitKind: 'row', unitId: r }); }
      }
    }
  }
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length >= 2) {
      for (const cd of cands) {
        const k = `${cd.row},${cd.col}`;
        if (!seen.has(k)) { seen.add(k); candsToTry.push({ cand: cd, unitKind: 'col', unitId: c }); }
      }
    }
  }
  for (const rid of getRegionIds(board)) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length >= 2) {
      for (const cd of cands) {
        const k = `${cd.row},${cd.col}`;
        if (!seen.has(k)) { seen.add(k); candsToTry.push({ cand: cd, unitKind: 'region', unitId: rid }); }
      }
    }
  }

  for (const { cand, unitKind, unitId } of candsToTry) {
    let trial = applyQueen(board, cand).board;
    let rounds = 0;

    // 第 0 轮：立即检查
    let cont = findZeroCandidateRC(trial) ?? findZeroCandidateColor(trial);
    if (cont) {
      return {
        index, strategy: 'L4_Contra',
        eliminations: [cand],
        queenConfirmed: [],
        description: `反推2 (${rounds}轮): 假设 ${formatPos(cand)} 为 Queen → ${cont} → 排除`,
        reason: {
          assumptionCell: cand,
          sourceUnit: makeUnitRef(unitKind, unitId),
          contradictionType: 'l4_immediate',
        },
      };
    }

    // 第 1-2 轮：级联推理
    while (rounds < BRANCH_PROPAGATION_LIMIT) {
      let produced = false;
      for (const fn of TRIAL_STRATEGIES) {
        const batch = fn(trial, 0);
        if (batch) {
          trial = applyBatch(trial, batch);
          cont = findZeroCandidateRC(trial) ?? findZeroCandidateColor(trial);
          if (cont) {
            rounds++;
            return {
              index, strategy: 'L4_Contra',
              eliminations: [cand],
              queenConfirmed: [],
              description: `反推2 (${rounds}轮): 假设 ${formatPos(cand)} 为 Queen → ${batch.strategy} → ${cont} → 排除`,
              reason: {
                assumptionCell: cand,
                sourceUnit: makeUnitRef(unitKind, unitId),
                contradictionType: 'l4_cascade',
                propagationDepth: rounds,
              },
            };
          }
          produced = true;
          break;
        }
      }
      if (!produced) break;
      rounds++;
    }
  }

  return null;
}

// ── 主循环 ────────────────────────────────────────────────────

const ALL_STRATEGIES: Array<(b: BoardState, idx: number) => SolverBatch | null> = [
  stepL1_RC,
  stepL1_Color,
  stepL2_RC,
  stepL2_Color,
  stepL3_Projection_Color,
  stepL3_Projection_RC,
  stepL3_Contra_RC,
  stepL3_Contra_Color,
  stepL4_Contra,
];

export function solve(board: BoardState): SolverResult {
  const batches: SolverBatch[] = [];
  let currentBoard = cloneBoard(board);
  let batchIndex = 0;
  const maxIterations = 500;
  let iterations = 0;

  while (iterations++ < maxIterations) {
    if (isBoardComplete(currentBoard)) return buildResult(true, batches);

    let produced = false;
    for (const fn of ALL_STRATEGIES) {
      const batch = fn(currentBoard, batchIndex + 1);
      if (batch) {
        batchIndex++;
        batches.push(batch);
        currentBoard = applyBatch(currentBoard, batch);
        produced = true;
        break;
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

export function applyBatchesUpTo(board: BoardState, batches: SolverBatch[], step: number): BoardState {
  let b = cloneBoard(board);
  for (let i = 0; i < Math.min(step, batches.length); i++) b = applyBatch(b, batches[i]);
  return b;
}
