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
  posEqual,
  formatPos,
} from './rules';

// ============================================================
// Solver — 7 strategy types, Level 1→2→3 loop
// Strict batch contract (design doc §4.2)
// ============================================================

function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

function posSet(ps: Position[]): Set<string> {
  return new Set(ps.map(posKey));
}

/** Apply one batch to the board, returning new board */
function applyBatch(board: BoardState, batch: SolverBatch): BoardState {
  let b = cloneBoard(board);
  for (const x of batch.eliminations) {
    b = applyX(b, x);
  }
  // Place queens only — X propagation is deferred to next L1_Direct step
  for (const q of batch.queenConfirmed) {
    b = placeQueen(b, q);
  }
  return b;
}

// ---- Level 1 ----

function stepL1Direct(board: BoardState, index: number): SolverBatch | null {
  const queens = getQueenPositions(board);
  if (queens.length === 0) return null;

  const allNewX: Position[] = [];
  let b = cloneBoard(board);

  for (const q of queens) {
    const result = applyQueen(b, q);
    b = result.board;
    for (const x of result.newX) allNewX.push(x);
  }

  if (allNewX.length === 0) return null;

  return {
    index,
    strategy: 'L1_Direct',
    eliminations: allNewX,
    queenConfirmed: [],
    description: `从 ${queens.length} 个 Queen 传播，消除 ${allNewX.length} 个 X`,
  };
}

function stepL1Unique(board: BoardState, index: number): SolverBatch | null {
  const uniq = findUniqueCandidates(board);
  if (uniq.length === 0) return null;

  const confirmed = uniq.find(u => !board.cells[u.row][u.col].isQueen);
  if (!confirmed) return null;

  return {
    index,
    strategy: 'L1_Unique',
    eliminations: [], // rule 3: no eliminations in this batch
    queenConfirmed: [confirmed],
    description: `唯一候选确认 Queen: ${formatPos(confirmed)}`,
  };
}

// ---- Level 2 ----

function stepL2Lock1(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);
  const eliminations: Position[] = [];
  const elimSet = new Set<string>();
  const reasons: string[] = [];

  // Region → Row
  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length < 2) continue;
    const rows = new Set(cands.map(c => c.row));
    if (rows.size === 1) {
      const row = cands[0].row;
      for (let c = 0; c < n; c++) {
        const cell = board.cells[row][c];
        if (cell.regionId !== rid && !cell.isQueen && !cell.isX) {
          const key = `${row},${c}`;
          if (!elimSet.has(key)) {
            elimSet.add(key);
            eliminations.push({ row, col: c });
          }
        }
      }
      reasons.push(`区域${rid}候选全在第${row}行 → 锁定该行`);
    }
  }

  // Region → Column
  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length < 2) continue;
    const cols = new Set(cands.map(c => c.col));
    if (cols.size === 1) {
      const col = cands[0].col;
      for (let r = 0; r < n; r++) {
        const cell = board.cells[r][col];
        if (cell.regionId !== rid && !cell.isQueen && !cell.isX) {
          const key = `${r},${col}`;
          if (!elimSet.has(key)) {
            elimSet.add(key);
            eliminations.push({ row: r, col });
          }
        }
      }
      reasons.push(`区域${rid}候选全在第${col}列 → 锁定该列`);
    }
  }

  // Row → Region
  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length < 2) continue;
    const rids = new Set(cands.map(c => board.cells[c.row][c.col].regionId));
    if (rids.size === 1) {
      const rid = rids.values().next().value as number;
      for (let rr = 0; rr < n; rr++) {
        for (let cc = 0; cc < n; cc++) {
          const cell = board.cells[rr][cc];
          if (cell.regionId === rid && rr !== r && !cell.isQueen && !cell.isX) {
            const key = `${rr},${cc}`;
            if (!elimSet.has(key)) {
              elimSet.add(key);
              eliminations.push({ row: rr, col: cc });
            }
          }
        }
      }
      reasons.push(`第${r}行候选全在区域${rid} → 锁定该区域`);
    }
  }

  // Column → Region
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length < 2) continue;
    const rids = new Set(cands.map(p => board.cells[p.row][p.col].regionId));
    if (rids.size === 1) {
      const rid = rids.values().next().value as number;
      for (let rr = 0; rr < n; rr++) {
        for (let cc = 0; cc < n; cc++) {
          const cell = board.cells[rr][cc];
          if (cell.regionId === rid && cc !== c && !cell.isQueen && !cell.isX) {
            const key = `${rr},${cc}`;
            if (!elimSet.has(key)) {
              elimSet.add(key);
              eliminations.push({ row: rr, col: cc });
            }
          }
        }
      }
      reasons.push(`第${c}列候选全在区域${rid} → 锁定该区域`);
    }
  }

  if (eliminations.length === 0) return null;

  return {
    index,
    strategy: 'L2_Lock1',
    eliminations,
    queenConfirmed: [],
    description: `L2 单锁定: ${reasons.join('; ')} — 消除 ${eliminations.length} 个 X`,
  };
}

function stepL2Lock2(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);
  const eliminations: Position[] = [];
  const elimSet = new Set<string>();
  const reasons: string[] = [];

  // 2 Rows → 2 Cols
  for (let r1 = 0; r1 < n; r1++) {
    for (let r2 = r1 + 1; r2 < n; r2++) {
      const cands1 = getCandidatesInRow(board, r1);
      const cands2 = getCandidatesInRow(board, r2);
      if (cands1.length === 0 || cands2.length === 0) continue;
      const cols = new Set([...cands1, ...cands2].map(c => c.col));
      if (cols.size === 2) {
        const colArr = Array.from(cols);
        for (let r = 0; r < n; r++) {
          if (r === r1 || r === r2) continue;
          for (const col of colArr) {
            const cell = board.cells[r][col];
            if (!cell.isQueen && !cell.isX) {
              const key = `${r},${col}`;
              if (!elimSet.has(key)) { elimSet.add(key); eliminations.push({ row: r, col }); }
            }
          }
        }
        reasons.push(`第${r1}、${r2}行候选仅占${colArr.join(',')}列`);
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
        for (let c = 0; c < n; c++) {
          if (c === c1 || c === c2) continue;
          for (const row of rowArr) {
            const cell = board.cells[row][c];
            if (!cell.isQueen && !cell.isX) {
              const key = `${row},${c}`;
              if (!elimSet.has(key)) { elimSet.add(key); eliminations.push({ row, col: c }); }
            }
          }
        }
        reasons.push(`第${c1}、${c2}列候选仅占${rowArr.join(',')}行`);
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
        for (const row of rowArr) {
          for (let c = 0; c < n; c++) {
            const cell = board.cells[row][c];
            if (cell.regionId !== rid1 && cell.regionId !== rid2 && !cell.isQueen && !cell.isX) {
              const key = `${row},${c}`;
              if (!elimSet.has(key)) { elimSet.add(key); eliminations.push({ row, col: c }); }
            }
          }
        }
        reasons.push(`区域${rid1}、${rid2}候选仅占${rowArr.join(',')}行`);
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
        for (const col of colArr) {
          for (let r = 0; r < n; r++) {
            const cell = board.cells[r][col];
            if (cell.regionId !== rid1 && cell.regionId !== rid2 && !cell.isQueen && !cell.isX) {
              const key = `${r},${col}`;
              if (!elimSet.has(key)) { elimSet.add(key); eliminations.push({ row: r, col }); }
            }
          }
        }
        reasons.push(`区域${rid1}、${rid2}候选仅占${colArr.join(',')}列`);
      }
    }
  }

  if (eliminations.length === 0) return null;

  return {
    index,
    strategy: 'L2_Lock2',
    eliminations,
    queenConfirmed: [],
    description: `L2 双锁定: ${reasons.join('; ')} — 消除 ${eliminations.length} 个 X`,
  };
}

function stepL2Lock3(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);
  const eliminations: Position[] = [];
  const elimSet = new Set<string>();
  const reasons: string[] = [];

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
      for (let r = 0; r < n; r++) {
        if (r === r1 || r === r2 || r === r3) continue;
        for (const col of colArr) {
          const cell = board.cells[r][col];
          if (!cell.isQueen && !cell.isX) {
            const key = `${r},${col}`;
            if (!elimSet.has(key)) { elimSet.add(key); eliminations.push({ row: r, col }); }
          }
        }
      }
      reasons.push(`第${r1}、${r2}、${r3}行候选仅占${colArr.length}列`);
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
      for (let c = 0; c < n; c++) {
        if (c === c1 || c === c2 || c === c3) continue;
        for (const row of rowArr) {
          const cell = board.cells[row][c];
          if (!cell.isQueen && !cell.isX) {
            const key = `${row},${c}`;
            if (!elimSet.has(key)) { elimSet.add(key); eliminations.push({ row, col: c }); }
          }
        }
      }
      reasons.push(`第${c1}、${c2}、${c3}列候选仅占${rowArr.length}行`);
    }
  }

  if (eliminations.length === 0) return null;

  return {
    index,
    strategy: 'L2_Lock3',
    eliminations,
    queenConfirmed: [],
    description: `L2 三锁定: ${reasons.join('; ')} — 消除 ${eliminations.length} 个 X`,
  };
}

// ---- Level 3 ----

function stepL3Projection(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);
  const eliminations: Position[] = [];
  const elimSet = new Set<string>();
  const reasons: string[] = [];

  // Collect units with 2-3 candidates (limit to 3 for performance)
  const units: { candidates: Position[]; label: string }[] = [];

  for (let r = 0; r < n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length >= 2 && cands.length <= 3) units.push({ candidates: cands, label: `第${r}行` });
  }
  for (let c = 0; c < n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length >= 2 && cands.length <= 3) units.push({ candidates: cands, label: `第${c}列` });
  }
  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length >= 2 && cands.length <= 3) units.push({ candidates: cands, label: `区域${rid}` });
  }

  for (const unit of units) {
    const cands = unit.candidates;

    // Common projection intersection
    const projections: Set<string>[] = [];
    for (const cand of cands) {
      const proj = new Set<string>();
      const rid = board.cells[cand.row][cand.col].regionId;
      // Row
      for (let cc = 0; cc < n; cc++) if (cc !== cand.col) proj.add(`${cand.row},${cc}`);
      // Col
      for (let rr = 0; rr < n; rr++) if (rr !== cand.row) proj.add(`${rr},${cand.col}`);
      // Region
      for (let rr = 0; rr < n; rr++)
        for (let cc = 0; cc < n; cc++)
          if (board.cells[rr][cc].regionId === rid && !(rr === cand.row && cc === cand.col))
            proj.add(`${rr},${cc}`);
      // Adjacent
      const adj = getAdjacentPositions(cand, n);
      for (const a of adj) proj.add(`${a.row},${a.col}`);
      projections.push(proj);
    }

    // Intersection
    let intersection = projections[0];
    for (let i = 1; i < projections.length; i++)
      intersection = new Set([...intersection].filter(x => projections[i].has(x)));

    for (const key of intersection) {
      if (elimSet.has(key)) continue;
      const [r, c] = key.split(',').map(Number);
      const cell = board.cells[r][c];
      if (!cell.isQueen && !cell.isX) {
        elimSet.add(key);
        eliminations.push({ row: r, col: c });
      }
    }

    // Single-step fatality
    candLoop:
    for (const cand of cands) {
      const candKey = posKey(cand);
      const rid = board.cells[cand.row][cand.col].regionId;
      const tempX = new Set<string>();

      for (let cc = 0; cc < n; cc++) if (cc !== cand.col) tempX.add(`${cand.row},${cc}`);
      for (let rr = 0; rr < n; rr++) if (rr !== cand.row) tempX.add(`${rr},${cand.col}`);
      for (let rr = 0; rr < n; rr++)
        for (let cc = 0; cc < n; cc++)
          if (board.cells[rr][cc].regionId === rid && !(rr === cand.row && cc === cand.col))
            tempX.add(`${rr},${cc}`);
      const adj = getAdjacentPositions(cand, n);
      for (const a of adj) tempX.add(`${a.row},${a.col}`);

      // Check rows
      for (let r = 0; r < n; r++) {
        if (r === cand.row) continue;
        const rowCands = getCandidatesInRow(board, r);
        if (rowCands.length > 0 && rowCands.every(rc => tempX.has(posKey(rc)))) {
          if (!elimSet.has(candKey)) {
            elimSet.add(candKey); eliminations.push(cand);
            reasons.push(`${formatPos(cand)} 若为 Queen 使第${r}行无候选 → 排除`);
            break candLoop;
          }
        }
      }
      // Check columns
      for (let c = 0; c < n; c++) {
        if (c === cand.col) continue;
        const colCands = getCandidatesInCol(board, c);
        if (colCands.length > 0 && colCands.every(cc => tempX.has(posKey(cc)))) {
          if (!elimSet.has(candKey)) {
            elimSet.add(candKey); eliminations.push(cand);
            reasons.push(`${formatPos(cand)} 若为 Queen 使第${c}列无候选 → 排除`);
            break candLoop;
          }
        }
      }
      // Check regions
      for (const rid2 of regionIds) {
        if (rid2 === rid) continue;
        const regCands = getCandidatesInRegion(board, rid2);
        if (regCands.length > 0 && regCands.every(rc => tempX.has(posKey(rc)))) {
          if (!elimSet.has(candKey)) {
            elimSet.add(candKey); eliminations.push(cand);
            reasons.push(`${formatPos(cand)} 若为 Queen 使区域${rid2}无候选 → 排除`);
            break candLoop;
          }
        }
      }
    }
  }

  if (eliminations.length === 0) return null;

  return {
    index,
    strategy: 'L3_Projection',
    eliminations,
    queenConfirmed: [],
    description: `L3 投影: ${reasons.join('; ')} — 消除 ${eliminations.length} 个 X`,
  };
}

function stepL3Capacity(board: BoardState, index: number): SolverBatch | null {
  const n = board.n;
  const regionIds = getRegionIds(board);
  const eliminations: Position[] = [];
  const elimSet = new Set<string>();
  const reasons: string[] = [];

  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const blockCells: Position[] = [
        { row: r, col: c }, { row: r, col: c + 1 },
        { row: r + 1, col: c }, { row: r + 1, col: c + 1 },
      ];
      const blockKeys = posSet(blockCells);

      const trappedRegions: number[] = [];
      for (const rid of regionIds) {
        const cands = getCandidatesInRegion(board, rid);
        if (cands.length === 0) continue;
        if (cands.every(p => blockKeys.has(posKey(p)))) {
          trappedRegions.push(rid);
        }
      }

      if (trappedRegions.length >= 1) {
        const ownerRid = trappedRegions[0];
        for (const pos of blockCells) {
          const cell = board.cells[pos.row][pos.col];
          if (cell.isQueen || cell.isX) continue;
          if (cell.regionId !== ownerRid) {
            const key = posKey(pos);
            if (!elimSet.has(key)) { elimSet.add(key); eliminations.push(pos); }
          }
        }
        if (eliminations.length > 0) {
          reasons.push(`2×2(${r},${c})被区域${ownerRid}独占`);
        }
      }
    }
  }

  if (eliminations.length === 0) return null;

  return {
    index,
    strategy: 'L3_Capacity',
    eliminations,
    queenConfirmed: [],
    description: `L3 容量: ${reasons.join('; ')} — 消除 ${eliminations.length} 个 X`,
  };
}

// ---- Main solver ----

export function solve(board: BoardState): SolverResult {
  const batches: SolverBatch[] = [];
  let currentBoard = cloneBoard(board);
  let batchIndex = 0;
  const maxIterations = 500;
  let iterations = 0;

  mainLoop:
  while (iterations++ < maxIterations) {
    // Level 1 loop
    let l1Produced: boolean;
    do {
      l1Produced = false;

      const directBatch = stepL1Direct(currentBoard, batchIndex + 1);
      if (directBatch) {
        batchIndex++;
        batches.push(directBatch);
        currentBoard = applyBatch(currentBoard, directBatch);
        l1Produced = true;
        continue;
      }

      const uniqueBatch = stepL1Unique(currentBoard, batchIndex + 1);
      if (uniqueBatch) {
        batchIndex++;
        batches.push(uniqueBatch);
        currentBoard = applyBatch(currentBoard, uniqueBatch);
        l1Produced = true;
      }
    } while (l1Produced);

    if (isBoardComplete(currentBoard)) {
      return buildResult(true, batches, batchIndex);
    }

    // Level 2
    for (const fn of [stepL2Lock1, stepL2Lock2, stepL2Lock3]) {
      const batch = fn(currentBoard, batchIndex + 1);
      if (batch) {
        batchIndex++;
        batches.push(batch);
        currentBoard = applyBatch(currentBoard, batch);
        continue mainLoop;
      }
    }

    // Level 3
    for (const fn of [stepL3Projection, stepL3Capacity]) {
      const batch = fn(currentBoard, batchIndex + 1);
      if (batch) {
        batchIndex++;
        batches.push(batch);
        currentBoard = applyBatch(currentBoard, batch);
        continue mainLoop;
      }
    }

    break; // all strategies exhausted
  }

  if (isBoardComplete(currentBoard)) {
    return buildResult(true, batches, batchIndex);
  }

  return buildResult(false, batches, batchIndex);
}

function buildResult(complete: boolean, batches: SolverBatch[], totalSteps: number): SolverResult {
  const typesUsed = new Set(batches.map(b => b.strategy));
  const strategyTypesUsed = Array.from(typesUsed);

  let highestLevel = 0;
  for (const t of strategyTypesUsed) {
    if (t.startsWith('L1_')) highestLevel = Math.max(highestLevel, 1);
    else if (t.startsWith('L2_')) highestLevel = Math.max(highestLevel, 2);
    else if (t.startsWith('L3_')) highestLevel = Math.max(highestLevel, 3);
  }

  return { complete, batches, totalSteps, strategyTypesUsed, highestLevel };
}

export function applyBatchesUpTo(board: BoardState, batches: SolverBatch[], step: number): BoardState {
  let b = cloneBoard(board);
  for (let i = 0; i < Math.min(step, batches.length); i++) {
    b = applyBatch(b, batches[i]);
  }
  return b;
}
