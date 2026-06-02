import { BoardState, Position, SolverBatch, SolverResult, StrategyType } from './types';
import {
  cloneBoard,
  getCandidatesInRow,
  getCandidatesInCol,
  getCandidatesInRegion,
  findUniqueCandidates,
  applyQueen,
  placeQueen,
  applyX,
  isBoardComplete,
  getQueenPositions,
  getRegionIds,
  getAdjacentPositions,
  formatPos,
} from './rules';
function posKey(p: Position): string { return `${p.row},${p.col}`; }

// ============================================================
// Solver — 6 strategy types, tried in order, any hit restarts from first.
// ============================================================

function posSet(ps: Position[]): Set<string> {
  return new Set(ps.map(posKey));
}

function applyBatch(board: BoardState, batch: SolverBatch): BoardState {
  let b = cloneBoard(board);
  for (const x of batch.eliminations) b = applyX(b, x);
  for (const q of batch.queenConfirmed) b = placeQueen(b, q);
  return b;
}

// ── L1 (Direct + Unique) ──────────────────────────────────────────

function stepL1(board: BoardState, index: number): SolverBatch | null {
  const uniq = findUniqueCandidates(board);
  if (uniq.length === 0) return null;

  const n = board.n;

  // Confirm new Queens on a simulation board
  let sim = cloneBoard(board);
  const confirmed: Position[] = [];
  for (const u of uniq) {
    if (sim.cells[u.row][u.col].isQueen) continue;
    sim = placeQueen(sim, u);
    confirmed.push(u);
  }
  if (confirmed.length === 0) return null;

  // Propagate X from ALL Queens (old + new) and dedup
  const allQueens = getQueenPositions(sim);
  const elimSet = new Set<string>();
  const eliminations: Position[] = [];

  for (const q of allQueens) {
    const result = applyQueen(sim, q);
    sim = result.board;
    for (const x of result.newX) {
      const key = posKey(x);
      if (!elimSet.has(key)) {
        elimSet.add(key);
        eliminations.push(x);
      }
    }
  }

  return {
    index,
    strategy: 'L1',
    eliminations,
    queenConfirmed: confirmed,
    description: `确认 ${confirmed.length} Queen，传播消除 ${eliminations.length} X`,
  };
}

// ── L2 Lock ───────────────────────────────────────────────────────

function stepL2Lock1(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);

  const mk = (eliminations: Position[], reason: string): SolverBatch | null => {
    if (eliminations.length === 0) return null;
    return { index, strategy: 'L2_Lock1', eliminations, queenConfirmed: [], description: `L2 单锁定: ${reason} — 消除 ${eliminations.length} X` };
  };

  // Region → Row
  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length < 2) continue;
    const rows = new Set(cands.map(c => c.row));
    if (rows.size === 1) {
      const row = cands[0].row;
      const elim: Position[] = [];
      for (let c = 0; c < n; c++) {
        const cell = board.cells[row][c];
        if (cell.regionId !== rid && !cell.isQueen && !cell.isX) elim.push({ row, col: c });
      }
      const b = mk(elim, `区域${rid}候选全在第${row}行 → 锁定该行`);
      if (b) return b;
    }
  }

  // Region → Column
  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length < 2) continue;
    const cols = new Set(cands.map(c => c.col));
    if (cols.size === 1) {
      const col = cands[0].col;
      const elim: Position[] = [];
      for (let r = 0; r < n; r++) {
        const cell = board.cells[r][col];
        if (cell.regionId !== rid && !cell.isQueen && !cell.isX) elim.push({ row: r, col });
      }
      const b = mk(elim, `区域${rid}候选全在第${col}列 → 锁定该列`);
      if (b) return b;
    }
  }

  // Row → Region
  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length < 2) continue;
    const rids = new Set(cands.map(c => board.cells[c.row][c.col].regionId));
    if (rids.size === 1) {
      const rid = rids.values().next().value as number;
      const elim: Position[] = [];
      for (let rr = 0; rr < n; rr++)
        for (let cc = 0; cc < n; cc++) {
          const cell = board.cells[rr][cc];
          if (cell.regionId === rid && rr !== r && !cell.isQueen && !cell.isX) elim.push({ row: rr, col: cc });
        }
      const b = mk(elim, `第${r}行候选全在区域${rid} → 锁定该区域`);
      if (b) return b;
    }
  }

  // Column → Region
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length < 2) continue;
    const rids = new Set(cands.map(p => board.cells[p.row][p.col].regionId));
    if (rids.size === 1) {
      const rid = rids.values().next().value as number;
      const elim: Position[] = [];
      for (let rr = 0; rr < n; rr++)
        for (let cc = 0; cc < n; cc++) {
          const cell = board.cells[rr][cc];
          if (cell.regionId === rid && cc !== c && !cell.isQueen && !cell.isX) elim.push({ row: rr, col: cc });
        }
      const b = mk(elim, `第${c}列候选全在区域${rid} → 锁定该区域`);
      if (b) return b;
    }
  }

  return null;
}

function stepL2Lock2(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);

  const mk = (eliminations: Position[], reason: string): SolverBatch | null => {
    if (eliminations.length === 0) return null;
    return { index, strategy: 'L2_Lock2', eliminations, queenConfirmed: [], description: `L2 双锁定: ${reason} — 消除 ${eliminations.length} X` };
  };

  // 2 Rows → 2 Cols
  for (let r1 = 0; r1 < n; r1++) {
    for (let r2 = r1 + 1; r2 < n; r2++) {
      const cands1 = getCandidatesInRow(board, r1);
      const cands2 = getCandidatesInRow(board, r2);
      if (cands1.length === 0 || cands2.length === 0) continue;
      const cols = new Set([...cands1, ...cands2].map(c => c.col));
      if (cols.size === 2) {
        const colArr = Array.from(cols);
        const elim: Position[] = [];
        for (let r = 0; r < n; r++) {
          if (r === r1 || r === r2) continue;
          for (const col of colArr) {
            const cell = board.cells[r][col];
            if (!cell.isQueen && !cell.isX) elim.push({ row: r, col });
          }
        }
        const b = mk(elim, `第${r1}、${r2}行候选仅占${colArr.join(',')}列`);
        if (b) return b;
      }
    }
  }

  // 2 Cols → 2 Rows
  for (let c1 = 0; c1 < n; c1++) {
    for (let c2 = c1 + 1; c2 < n; c2++) {
      const cands1 = getCandidatesInCol(board, c1);
      const cands2 = getCandidatesInCol(board, c2);
      if (cands1.length === 0 || cands2.length === 0) continue;
      const rows = new Set([...cands1, ...cands2].map(c => c.row));
      if (rows.size === 2) {
        const rowArr = Array.from(rows);
        const elim: Position[] = [];
        for (let c = 0; c < n; c++) {
          if (c === c1 || c === c2) continue;
          for (const row of rowArr) {
            const cell = board.cells[row][c];
            if (!cell.isQueen && !cell.isX) elim.push({ row, col: c });
          }
        }
        const b = mk(elim, `第${c1}、${c2}列候选仅占${rowArr.join(',')}行`);
        if (b) return b;
      }
    }
  }

  // 2 Regions → 2 Rows
  for (let i = 0; i < regionIds.length; i++) {
    for (let j = i + 1; j < regionIds.length; j++) {
      const rid1 = regionIds[i], rid2 = regionIds[j];
      const cands1 = getCandidatesInRegion(board, rid1);
      const cands2 = getCandidatesInRegion(board, rid2);
      if (cands1.length === 0 || cands2.length === 0) continue;
      const rows = new Set([...cands1, ...cands2].map(c => c.row));
      if (rows.size === 2) {
        const rowArr = Array.from(rows);
        const elim: Position[] = [];
        for (const row of rowArr) {
          for (let c = 0; c < n; c++) {
            const cell = board.cells[row][c];
            if (cell.regionId !== rid1 && cell.regionId !== rid2 && !cell.isQueen && !cell.isX) elim.push({ row, col: c });
          }
        }
        const b = mk(elim, `区域${rid1}、${rid2}候选仅占${rowArr.join(',')}行`);
        if (b) return b;
      }
    }
  }

  // 2 Regions → 2 Cols
  for (let i = 0; i < regionIds.length; i++) {
    for (let j = i + 1; j < regionIds.length; j++) {
      const rid1 = regionIds[i], rid2 = regionIds[j];
      const cands1 = getCandidatesInRegion(board, rid1);
      const cands2 = getCandidatesInRegion(board, rid2);
      if (cands1.length === 0 || cands2.length === 0) continue;
      const cols = new Set([...cands1, ...cands2].map(c => c.col));
      if (cols.size === 2) {
        const colArr = Array.from(cols);
        const elim: Position[] = [];
        for (const col of colArr) {
          for (let r = 0; r < n; r++) {
            const cell = board.cells[r][col];
            if (cell.regionId !== rid1 && cell.regionId !== rid2 && !cell.isQueen && !cell.isX) elim.push({ row: r, col });
          }
        }
        const b = mk(elim, `区域${rid1}、${rid2}候选仅占${colArr.join(',')}列`);
        if (b) return b;
      }
    }
  }

  return null;
}

function stepL2Lock3(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;

  const mk = (eliminations: Position[], reason: string): SolverBatch | null => {
    if (eliminations.length === 0) return null;
    return { index, strategy: 'L2_Lock3', eliminations, queenConfirmed: [], description: `L2 三锁定: ${reason} — 消除 ${eliminations.length} X` };
  };

  function* combos3<T>(arr: T[]): Generator<T[]> {
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++)
        for (let k = j + 1; k < arr.length; k++)
          yield [arr[i], arr[j], arr[k]];
  }

  // 3 Rows → 3 Cols
  const rows = Array.from({ length: n }, (_, i) => i);
  for (const [r1, r2, r3] of combos3(rows)) {
    const cands1 = getCandidatesInRow(board, r1);
    const cands2 = getCandidatesInRow(board, r2);
    const cands3 = getCandidatesInRow(board, r3);
    if (cands1.length === 0 || cands2.length === 0 || cands3.length === 0) continue;
    const cols = new Set([...cands1, ...cands2, ...cands3].map(c => c.col));
    if (cols.size === 3) {
      const colArr = Array.from(cols);
      const elim: Position[] = [];
      for (let r = 0; r < n; r++) {
        if (r === r1 || r === r2 || r === r3) continue;
        for (const col of colArr) {
          const cell = board.cells[r][col];
          if (!cell.isQueen && !cell.isX) elim.push({ row: r, col });
        }
      }
      const b = mk(elim, `第${r1}、${r2}、${r3}行候选仅占${colArr.length}列`);
      if (b) return b;
    }
  }

  // 3 Cols → 3 Rows
  const cols = Array.from({ length: n }, (_, i) => i);
  for (const [c1, c2, c3] of combos3(cols)) {
    const cands1 = getCandidatesInCol(board, c1);
    const cands2 = getCandidatesInCol(board, c2);
    const cands3 = getCandidatesInCol(board, c3);
    if (cands1.length === 0 || cands2.length === 0 || cands3.length === 0) continue;
    const rowsSet = new Set([...cands1, ...cands2, ...cands3].map(c => c.row));
    if (rowsSet.size === 3) {
      const rowArr = Array.from(rowsSet);
      const elim: Position[] = [];
      for (let c = 0; c < n; c++) {
        if (c === c1 || c === c2 || c === c3) continue;
        for (const row of rowArr) {
          const cell = board.cells[row][c];
          if (!cell.isQueen && !cell.isX) elim.push({ row, col: c });
        }
      }
      const b = mk(elim, `第${c1}、${c2}、${c3}列候选仅占${rowArr.length}行`);
      if (b) return b;
    }
  }

  return null;
}

// ── L3 Projection & Contradiction ─────────────────────────────────

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

// ── Main solver ───────────────────────────────────────────────────

const STRATEGIES = [
  stepL1,
  stepL2Lock1,
  stepL2Lock2,
  stepL2Lock3,
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
