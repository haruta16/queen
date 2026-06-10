import {
  BoardState, Position, SolverBatch, SolverResult, StrategyType,
  UnitRef, UnitKind, SolverBatchReason,
} from './types';
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

const DIRS_DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

// ============================================================
// 求解器 — 6 种策略扁平循环，任意命中回到第一种重试
// 内部算法已升级为 Hall 定理锁检测 / 多步矛盾 / 公共邻域排除
// ============================================================

// ── 图算法 ────────────────────────────────────────────────────

/** 二分图最大匹配（DFS 增广路，按度贪心排序） */
function maximumMatching(adjacency: number[][]): number[] {
  const m = adjacency.length;
  let maxTarget = 0;
  for (const targets of adjacency) {
    for (const t of targets) {
      if (t > maxTarget) maxTarget = t;
    }
  }
  const n = maxTarget + 1;
  const matchR = Array(n).fill(-1); // target → source
  const matchL = Array(m).fill(-1); // source → target

  const augment = (u: number, seen: Set<number>): boolean => {
    for (const v of adjacency[u]) {
      if (seen.has(v)) continue;
      seen.add(v);
      if (matchR[v] === -1 || augment(matchR[v], seen)) {
        matchR[v] = u;
        matchL[u] = v;
        return true;
      }
    }
    return false;
  };

  const order = Array.from({ length: m }, (_, i) => i).sort(
    (a, b) => adjacency[a].length - adjacency[b].length,
  );
  for (const u of order) augment(u, new Set());
  return matchL;
}

/** Tarjan 强连通分量 */
function stronglyConnectedComponents(graph: number[][]): number[][] {
  const n = graph.length;
  const index = Array(n).fill(-1);
  const lowlink = Array(n).fill(0);
  const onStack = Array(n).fill(false);
  const stack: number[] = [];
  const components: number[][] = [];
  let curIndex = 0;

  const dfs = (v: number) => {
    index[v] = curIndex;
    lowlink[v] = curIndex;
    curIndex++;
    stack.push(v);
    onStack[v] = true;
    for (const w of graph[v]) {
      if (index[w] === -1) {
        dfs(w);
        lowlink[v] = Math.min(lowlink[v], lowlink[w]);
      } else if (onStack[w]) {
        lowlink[v] = Math.min(lowlink[v], index[w]);
      }
    }
    if (lowlink[v] === index[v]) {
      const comp: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      components.push(comp.sort((a, b) => a - b));
    }
  };

  for (let v = 0; v < n; v++) if (index[v] === -1) dfs(v);
  return components;
}

/** Hall 婚姻定理矛盾见证 */
function matchingFailureWitness(
  adjacency: number[][], targetCount: number,
): { sourceWitness: Set<number>; targetWitness: Set<number> } | null {
  const matchL = maximumMatching(adjacency);
  const matchR = Array(targetCount).fill(-1);
  for (let s = 0; s < matchL.length; s++) {
    if (matchL[s] !== -1) matchR[matchL[s]] = s;
  }

  const unmatched = new Set<number>();
  for (let s = 0; s < adjacency.length; s++) {
    if (matchL[s] === -1) unmatched.add(s);
  }
  if (unmatched.size === 0) return null;

  const sourceWitness = new Set(unmatched);
  const targetWitness = new Set<number>();
  const queue = [...unmatched];
  while (queue.length) {
    const s = queue.pop()!;
    for (const t of adjacency[s]) {
      if (matchL[s] === t || targetWitness.has(t)) continue;
      targetWitness.add(t);
      const ms = matchR[t];
      if (ms !== -1 && !sourceWitness.has(ms)) {
        sourceWitness.add(ms);
        queue.push(ms);
      }
    }
  }
  return { sourceWitness, targetWitness };
}

// ── 矛盾检测 ──────────────────────────────────────────────────

/** 检测棋盘是否包含矛盾 */
function detectContradiction(board: BoardState): { type: string; description: string } | null {
  const n = board.n;
  const regionIds = getRegionIds(board);

  // 1. 某单位多 Queen
  for (let r = 0; r < n; r++) {
    const qs = getCandidatesInRow(board, r).filter(p => !board.cells[p.row][p.col].isQueen);
    // 检查已放置的 Queen 是否同单位冲突
    const rowQueens: Position[] = [];
    for (let c = 0; c < n; c++) if (board.cells[r][c].isQueen) rowQueens.push({ row: r, col: c });
    if (rowQueens.length > 1) return { type: 'multiple_queens_in_row', description: `第${r}行有多个 Queen` };
  }
  for (let c = 0; c < n; c++) {
    const colQueens: Position[] = [];
    for (let r = 0; r < n; r++) if (board.cells[r][c].isQueen) colQueens.push({ row: r, col: c });
    if (colQueens.length > 1) return { type: 'multiple_queens_in_col', description: `第${c}列有多个 Queen` };
  }
  for (const rid of regionIds) {
    const regQueens: Position[] = [];
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (board.cells[r][c].isQueen && board.cells[r][c].regionId === rid) regQueens.push({ row: r, col: c });
    if (regQueens.length > 1) return { type: 'multiple_queens_in_region', description: `区域${rid}有多个 Queen` };
  }

  // 2. 某单位候选归零（无 Queen 且无候选）
  for (let r = 0; r < n; r++) {
    const hasQ = Array.from({ length: n }, (_, c) => board.cells[r][c].isQueen).some(Boolean);
    if (!hasQ && getCandidatesInRow(board, r).length === 0)
      return { type: 'no_candidate_in_row', description: `第${r}行没有候选格` };
  }
  for (let c = 0; c < n; c++) {
    const hasQ = Array.from({ length: n }, (_, r) => board.cells[r][c].isQueen).some(Boolean);
    if (!hasQ && getCandidatesInCol(board, c).length === 0)
      return { type: 'no_candidate_in_col', description: `第${c}列没有候选格` };
  }
  for (const rid of regionIds) {
    const hasQ = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => board.cells[r][c].isQueen && board.cells[r][c].regionId === rid).some(Boolean),
    ).some(Boolean);
    if (!hasQ && getCandidatesInRegion(board, rid).length === 0)
      return { type: 'no_candidate_in_region', description: `区域${rid}没有候选格` };
  }

  // 3. Queen 邻接冲突
  const queens: Position[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (board.cells[r][c].isQueen) queens.push({ row: r, col: c });
  for (let i = 0; i < queens.length; i++)
    for (let j = i + 1; j < queens.length; j++) {
      const dr = Math.abs(queens[i].row - queens[j].row);
      const dc = Math.abs(queens[i].col - queens[j].col);
      if (dr <= 1 && dc <= 1) return { type: 'adjacent_queens', description: '两个 Queen 相邻' };
    }

  // 4. Hall 定理矛盾
  const sourceKinds: UnitKind[] = ['row', 'col', 'region'];
  const targetKinds: UnitKind[] = ['row', 'col', 'region'];
  for (const sk of sourceKinds) {
    for (const tk of targetKinds) {
      if (sk === tk) continue;
      const adj = buildUnitAdjacency(board, sk, tk);
      if (adj.length === 0) continue;
      let maxTarget = 0;
      for (const targets of adj) for (const t of targets) if (t > maxTarget) maxTarget = t;
      const witness = matchingFailureWitness(adj, maxTarget + 1);
      if (witness && witness.sourceWitness.size > witness.targetWitness.size) {
        return {
          type: 'hall_violation',
          description: `${witness.sourceWitness.size}个${unitKindLabel(sk)}的候选只落在${witness.targetWitness.size}个${unitKindLabel(tk)}，无法一一匹配`,
        };
      }
    }
  }

  return null;
}

// ── 单位抽象 ──────────────────────────────────────────────────

const unitKindLabel = (k: UnitKind): string => ({ row: '行', col: '列', region: '区域' }[k]);

function dimVal(board: BoardState, dim: UnitKind, p: Position): number {
  if (dim === 'row') return p.row;
  if (dim === 'col') return p.col;
  return board.cells[p.row][p.col].regionId;
}

function unitIds(board: BoardState, dim: UnitKind): number[] {
  const n = board.n;
  if (dim === 'row') return Array.from({ length: n }, (_, i) => i);
  if (dim === 'col') return Array.from({ length: n }, (_, i) => i);
  return getRegionIds(board);
}

function getCandidates(board: BoardState, dim: UnitKind, id: number): Position[] {
  if (dim === 'row') return getCandidatesInRow(board, id);
  if (dim === 'col') return getCandidatesInCol(board, id);
  return getCandidatesInRegion(board, id);
}

function fmtUnit(board: BoardState, dim: UnitKind, id: number): string {
  if (dim === 'row') return `第${id}行`;
  if (dim === 'col') return `第${id}列`;
  return `区域${id}`;
}

function makeUnitRef(kind: UnitKind, index: number): UnitRef {
  return { kind, index };
}

/** 构建 source→target 二分邻接 */
function buildUnitAdjacency(board: BoardState, fromDim: UnitKind, intoDim: UnitKind): number[][] {
  const sources = unitIds(board, fromDim);
  const targets = unitIds(board, intoDim);
  return sources.map(sid => {
    const cands = getCandidates(board, fromDim, sid);
    const tset = new Set(cands.map(c => dimVal(board, intoDim, c)));
    return [...tset].filter(t => targets.includes(t));
  });
}

// ── Hall 定理锁检测 — 替代 combosK 枚举 ───────────────────────

interface LockDeduction {
  groupSize: number;
  sourceKind: UnitKind;
  targetKind: UnitKind;
  sourceIds: number[];
  targetIds: number[];
  sourceCandidates: Position[];
  excludedCells: Position[];
}

const LOCK_PAIRS: [UnitKind, UnitKind][] = [
  ['region', 'row'], ['region', 'col'],
  ['row', 'region'], ['col', 'region'],
  ['row', 'col'], ['col', 'row'],
];

function hallLockDeductions(board: BoardState): LockDeduction[] {
  const n = board.n;
  const deductions: LockDeduction[] = [];

  for (const [sourceKind, targetKind] of LOCK_PAIRS) {
    const sourceUnits = unitIds(board, sourceKind);
    const targetUnits = unitIds(board, targetKind);
    if (sourceUnits.length === 0 || targetUnits.length === 0) continue;

    const adjacency = buildUnitAdjacency(board, sourceKind, targetKind);
    if (adjacency.some(a => a.length === 0)) continue;

    const matchL = maximumMatching(adjacency);
    if (matchL.some(v => v === -1)) continue; // 找不到完美匹配 → 应由矛盾检测报告

    // 构建交错图：source s → match_target[t] (对每个 t ∈ adjacency[s])
    const altGraph: number[][] = Array.from({ length: adjacency.length }, () => []);
    const matchR = Array(targetUnits.length).fill(-1);
    for (let s = 0; s < matchL.length; s++) {
      if (matchL[s] !== -1) matchR[matchL[s]] = s;
    }
    for (let s = 0; s < adjacency.length; s++) {
      for (const t of adjacency[s]) {
        if (matchR[t] !== -1) altGraph[s].push(matchR[t]);
      }
    }

    const components = stronglyConnectedComponents(altGraph);
    const compOf = Array(adjacency.length).fill(-1);
    for (let ci = 0; ci < components.length; ci++) {
      for (const v of components[ci]) compOf[v] = ci;
    }

    // 分量 DAG
    const compGraph: Set<number>[] = Array.from({ length: components.length }, () => new Set());
    for (let s = 0; s < altGraph.length; s++) {
      for (const w of altGraph[s]) {
        if (compOf[s] !== compOf[w]) compGraph[compOf[s]].add(compOf[w]);
      }
    }

    const seenGroups = new Set<string>();
    for (let start = 0; start < components.length; start++) {
      const closure = new Set<number>();
      const stack = [start];
      while (stack.length) {
        const c = stack.pop()!;
        if (closure.has(c)) continue;
        closure.add(c);
        for (const nxt of compGraph[c]) stack.push(nxt);
      }
      const sourceIdx = [...closure].flatMap(c => components[c]).sort((a, b) => a - b);
      if (sourceIdx.length === 0 || sourceIdx.length === sourceUnits.length) continue;

      const groupKey = sourceIdx.join(',');
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);

      const targetIdx = sourceIdx.map(s => matchL[s]).filter(t => t !== -1).sort((a, b) => a - b);
      const neighborTargets = new Set(sourceIdx.flatMap(s => adjacency[s]));
      if (neighborTargets.size !== new Set(targetIdx).size) continue;

      // 收集 source 候选
      const srcCands: Position[] = [];
      for (const sid of sourceIdx) srcCands.push(...getCandidates(board, sourceKind, sid));

      // 计算可排除格：在 target 单位中、不在 source 单位中
      const excluded: Position[] = [];
      const exclSet = new Set<string>();
      const srcCellSet = new Set<string>();
      for (const sid of sourceIdx) {
        for (let r = 0; r < n; r++)
          for (let c = 0; c < n; c++)
            if (dimVal(board, sourceKind, { row: r, col: c }) === sid) srcCellSet.add(`${r},${c}`);
      }
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const cell = board.cells[r][c];
          if (cell.isQueen || cell.isX || cell.isWrong) continue;
          const tv = dimVal(board, targetKind, { row: r, col: c });
          if (!targetIdx.includes(tv)) continue;
          if (srcCellSet.has(`${r},${c}`)) continue;
          const key = `${r},${c}`;
          if (!exclSet.has(key)) { exclSet.add(key); excluded.push({ row: r, col: c }); }
        }
      }

      if (excluded.length === 0) continue;

      deductions.push({
        groupSize: sourceIdx.length,
        sourceKind, targetKind,
        sourceIds: sourceIdx,
        targetIds: targetIdx,
        sourceCandidates: srcCands,
        excludedCells: excluded,
      });
    }
  }

  // 排序：越小 group 越简单，消去越多越好
  deductions.sort((a, b) => {
    if (a.groupSize !== b.groupSize) return a.groupSize - b.groupSize;
    if (b.excludedCells.length !== a.excludedCells.length) return b.excludedCells.length - a.excludedCells.length;
    return 0;
  });

  return deductions;
}

// ── 公共邻域排除 ──────────────────────────────────────────────

function commonDiagonalExclusion(board: BoardState): { eliminations: Position[]; unit: UnitRef; candidates: Position[] } | null {
  const n = board.n;

  const collectUnits = (): { kind: UnitKind; id: number; candidates: Position[] }[] => {
    const result: { kind: UnitKind; id: number; candidates: Position[] }[] = [];
    for (const kind of ['row', 'col', 'region'] as UnitKind[]) {
      for (const id of unitIds(board, kind)) {
        const cands = getCandidates(board, kind, id);
        if (cands.length >= 2) result.push({ kind, id, candidates: cands });
      }
    }
    return result;
  };

  for (const unit of collectUnits()) {
    const cands = unit.candidates;
    if (cands.length < 2) continue;

    const firstNeighbors = new Set<string>();
    for (const [dr, dc] of DIRS_DIAG) {
      const nr = cands[0].row + dr, nc = cands[0].col + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n) firstNeighbors.add(`${nr},${nc}`);
    }
    let common: Set<string> = firstNeighbors;

    for (let i = 1; i < cands.length && common.size > 0; i++) {
      const cand = cands[i];
      const neighbors = new Set<string>();
      for (const [dr, dc] of DIRS_DIAG) {
        const nr = cand.row + dr, nc = cand.col + dc;
        if (nr >= 0 && nr < n && nc >= 0 && nc < n) neighbors.add(`${nr},${nc}`);
      }
      common = new Set([...common].filter((x: string) => neighbors.has(x)));
    }

    if (common.size === 0) continue;

    const elims: Position[] = [];
    for (const key of common) {
      const [r, c] = key.split(',').map(Number);
      const cell = board.cells[r][c];
      if (!cell.isQueen && !cell.isX && !cell.isWrong) elims.push({ row: r, col: c });
    }
    if (elims.length > 0) {
      return {
        eliminations: elims,
        unit: makeUnitRef(unit.kind, unit.id),
        candidates: unit.candidates,
      };
    }
  }

  return null;
}

// ── 应用批次 ──────────────────────────────────────────────────

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

// ── L1 唯一候选确认 ───────────────────────────────────────────

function stepL1(board: BoardState, index: number): SolverBatch | null {
  const uniq = findUniqueCandidates(board);
  if (uniq.length === 0) return null;

  const target = uniq[0];
  const { newX } = applyQueen(board, target);

  const reason: SolverBatchReason = {
    remainingCandidates: [target],
  };

  return {
    index, strategy: 'L1',
    eliminations: newX,
    queenConfirmed: [target],
    description: `确认 Queen ${formatPos(target)}，传播消除 ${newX.length} X`,
    reason,
  };
}

// ── L2 锁定 — Hall 定理检测 ───────────────────────────────────

function stepL2LockK(board: BoardState, k: number, index: number): SolverBatch | null {
  const ded = hallLockDeductions(board).find(d => d.groupSize === k);
  if (!ded) return null;

  const strategy = ([, 'L2_Lock1', 'L2_Lock2', 'L2_Lock3'] as const)[k];
  const cnLabel = ['', '单', '双', '三'][k];

  const reason: SolverBatchReason = {
    groupSize: k,
    sourceUnits: ded.sourceIds.map(id => makeUnitRef(ded.sourceKind, id)),
    targetUnits: ded.targetIds.map(id => makeUnitRef(ded.targetKind, id)),
    sourceCandidates: ded.sourceCandidates,
    excludedCells: ded.excludedCells,
  };

  return {
    index, strategy: strategy as StrategyType,
    eliminations: ded.excludedCells, queenConfirmed: [],
    description: `L2 ${cnLabel}锁定 (${unitKindLabel(ded.sourceKind)}→${unitKindLabel(ded.targetKind)}): ` +
      `${ded.sourceIds.map(id => fmtUnit(board, ded.sourceKind, id)).join('、')}` +
      `独占 ${ded.targetIds.map(id => fmtUnit(board, ded.targetKind, id)).join('、')}` +
      ` — 消除 ${ded.excludedCells.length} X`,
    reason,
  };
}

function stepL2Lock1(board: BoardState, index: number) { return stepL2LockK(board, 1, index); }
function stepL2Lock2(board: BoardState, index: number) { return stepL2LockK(board, 2, index); }
function stepL2Lock3(board: BoardState, index: number) { return stepL2LockK(board, 3, index); }

// ── L3 公共邻域 & 投影 & 矛盾 ─────────────────────────────────

function stepL3Diagonal(board: BoardState, index: number): SolverBatch | null {
  const result = commonDiagonalExclusion(board);
  if (!result) return null;

  const reason: SolverBatchReason = {
    sourceUnit: result.unit,
    sourceCandidates: result.candidates,
    excludedCells: result.eliminations,
  };

  return {
    index, strategy: 'L3_Projection',
    eliminations: result.eliminations, queenConfirmed: [],
    description: `公共邻域排除: ${fmtUnit(board, result.unit.kind, result.unit.index)} — 消除 ${result.eliminations.length} X`,
    reason,
  };
}

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

function stepL3Projection(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;

  for (const kind of ['row', 'col', 'region'] as UnitKind[]) {
    for (const id of unitIds(board, kind)) {
      const cands = getCandidates(board, kind, id);
      if (cands.length < 2) continue;

      const projections = cands.map(c => candidateProjectionSet(board, n, c));
      let intersection: Set<string> = projections[0];
      for (let i = 1; i < projections.length; i++) {
        intersection = new Set([...intersection].filter((x: string) => projections[i].has(x)));
      }
      if (intersection.size === 0) continue;

      const elims: Position[] = [];
      for (const key of intersection) {
        const [r, c] = key.split(',').map(Number);
        const cell = board.cells[r][c];
        if (!cell.isQueen && !cell.isX && !cell.isWrong) elims.push({ row: r, col: c });
      }
      if (elims.length === 0) continue;

      const reason: SolverBatchReason = {
        sourceUnit: makeUnitRef(kind, id),
        sourceCandidates: cands,
        excludedCells: elims,
      };

      return {
        index, strategy: 'L3_Projection',
        eliminations: elims, queenConfirmed: [],
        description: `L3 投影: ${fmtUnit(board, kind, id)} 候选投影交集 — 排除 ${elims.length} 公共格`,
        reason,
      };
    }
  }
  return null;
}

// ── 多步矛盾（升级版 L3_Contradiction） ────────────────────────

const BRANCH_PROPAGATION_LIMIT = 3;

function trialBoardAfterQueen(board: BoardState, cand: Position): BoardState {
  return applyQueen(board, cand).board;
}

function trialStep(board: BoardState): BoardState | null {
  const l1 = stepL1(board, 0);
  if (l1) return applyBatch(board, l1);

  for (const ded of hallLockDeductions(board)) {
    if (ded.excludedCells.length > 0) {
      let b = cloneBoard(board);
      for (const e of ded.excludedCells) b = applyX(b, e);
      return b;
    }
  }

  const diag = commonDiagonalExclusion(board);
  if (diag) {
    let b = cloneBoard(board);
    for (const e of diag.eliminations) b = applyX(b, e);
    return b;
  }

  return null;
}

function stepL3Contradiction(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;

  for (const kind of ['row', 'col', 'region'] as UnitKind[]) {
    for (const id of unitIds(board, kind)) {
      const cands = getCandidates(board, kind, id);
      if (cands.length < 2) continue;

      for (const cand of cands) {
        let trial = trialBoardAfterQueen(board, cand);
        let contradiction = detectContradiction(trial);
        let rounds = 0;

        while (!contradiction && rounds < BRANCH_PROPAGATION_LIMIT) {
          const next = trialStep(trial);
          if (!next) break;
          trial = next;
          rounds++;
          contradiction = detectContradiction(trial);
        }

        if (contradiction) {
          const reason: SolverBatchReason = {
            assumptionCell: cand,
            sourceUnit: makeUnitRef(kind, id),
            contradictionType: contradiction.type,
          };

          return {
            index, strategy: 'L3_Contradiction',
            eliminations: [cand], queenConfirmed: [],
            description: `L3 矛盾(${rounds}轮): ${formatPos(cand)} 假设为 Queen → ${contradiction.description} → 排除`,
            reason,
          };
        }
      }
    }
  }
  return null;
}

// ── 主循环 ──────────────────────────────────────────────────────

const STRATEGIES = [
  stepL1,
  stepL2Lock1,
  stepL2Lock2,
  stepL2Lock3,
  stepL3Diagonal,
  stepL3Projection,
  stepL3Contradiction,
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
    for (const fn of STRATEGIES) {
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
