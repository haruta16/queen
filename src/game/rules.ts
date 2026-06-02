import { BoardState, CellState, Position, Region } from './types';

// ============================================================
// Queen 消元解谜 — 纯规则函数
// ============================================================

/** 深拷贝棋盘 */
export function cloneBoard(board: BoardState): BoardState {
  return {
    n: board.n,
    cells: board.cells.map(row => row.map(cell => ({ ...cell }))),
  };
}

/** 获取某格 8 邻域内所有在界坐标 */
export function getAdjacentPositions(pos: Position, n: number): Position[] {
  const result: Position[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = pos.row + dr;
      const c = pos.col + dc;
      if (r >= 0 && r < n && c >= 0 && c < n) {
        result.push({ row: r, col: c });
      }
    }
  }
  return result;
}

/** 获取某行内所有候选格（非 Queen、非 X、非 Wrong） */
export function getCandidatesInRow(board: BoardState, row: number): Position[] {
  const result: Position[] = [];
  for (let c = 0; c < board.n; c++) {
    const cell = board.cells[row][c];
    if (!cell.isQueen && !cell.isX && !cell.isWrong) result.push({ row, col: c });
  }
  return result;
}

/** 获取某列内所有候选格 */
export function getCandidatesInCol(board: BoardState, col: number): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < board.n; r++) {
    const cell = board.cells[r][col];
    if (!cell.isQueen && !cell.isX && !cell.isWrong) result.push({ row: r, col });
  }
  return result;
}

/** 获取某区域内所有候选格 */
export function getCandidatesInRegion(board: BoardState, regionId: number): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < board.n; r++) {
    for (let c = 0; c < board.n; c++) {
      const cell = board.cells[r][c];
      if (cell.regionId === regionId && !cell.isQueen && !cell.isX && !cell.isWrong) {
        result.push({ row: r, col: c });
      }
    }
  }
  return result;
}

/** 获取棋盘上所有 Queen 的位置 */
export function getQueenPositions(board: BoardState): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < board.n; r++) {
    for (let c = 0; c < board.n; c++) {
      if (board.cells[r][c].isQueen) result.push({ row: r, col: c });
    }
  }
  return result;
}

/** 获取所有区域 ID */
export function getRegionIds(board: BoardState): number[] {
  const ids = new Set<number>();
  for (let r = 0; r < board.n; r++) {
    for (let c = 0; c < board.n; c++) {
      ids.add(board.cells[r][c].regionId);
    }
  }
  return Array.from(ids);
}

/**
 * 找出所有唯一候选格。
 * 唯一候选 = 该格是其所在行、列、或区域中唯一尚未被排除的格子。
 * 不返回已经确认 Queen 的格子。
 */
export function findUniqueCandidates(board: BoardState): Position[] {
  const result: Position[] = [];
  const seen = new Set<string>();

  for (let r = 0; r < board.n; r++) {
    const cands = getCandidatesInRow(board, r);
    if (cands.length === 1 && !board.cells[cands[0].row][cands[0].col].isQueen) {
      const key = `${cands[0].row},${cands[0].col}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(cands[0]);
      }
    }
  }

  for (let c = 0; c < board.n; c++) {
    const cands = getCandidatesInCol(board, c);
    if (cands.length === 1 && !board.cells[cands[0].row][cands[0].col].isQueen) {
      const key = `${cands[0].row},${cands[0].col}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(cands[0]);
      }
    }
  }

  const regionIds = getRegionIds(board);
  for (const rid of regionIds) {
    const cands = getCandidatesInRegion(board, rid);
    if (cands.length === 1 && !board.cells[cands[0].row][cands[0].col].isQueen) {
      const key = `${cands[0].row},${cands[0].col}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(cands[0]);
      }
    }
  }

  return result;
}

/**
 * 在指定位置放置 Queen，返回新棋盘和新产生的 X 列表。
 * 不修改原棋盘。
 * 传播规则：同行、同列、同区域、8邻域全部标记为 X。
 */
export function applyQueen(board: BoardState, pos: Position): { board: BoardState; newX: Position[] } {
  const b = cloneBoard(board);
  const newX: Position[] = [];
  const n = b.n;
  const { row, col } = pos;
  const regionId = b.cells[row][col].regionId;

  // 放置 Queen
  b.cells[row][col].isQueen = true;
  b.cells[row][col].isX = false;
  b.cells[row][col].isWrong = false;

  const markX = (r: number, c: number) => {
    const cell = b.cells[r][c];
    if (!cell.isQueen && !cell.isX && !cell.isWrong) {
      cell.isX = true;
      newX.push({ row: r, col: c });
    }
  };

  // 同行
  for (let c = 0; c < n; c++) {
    if (c !== col) markX(row, c);
  }

  // 同列
  for (let r = 0; r < n; r++) {
    if (r !== row) markX(r, col);
  }

  // 同区域
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (b.cells[r][c].regionId === regionId && !(r === row && c === col)) {
        markX(r, c);
      }
    }
  }

  // 邻域（8邻域）
  const adj = getAdjacentPositions(pos, n);
  for (const a of adj) {
    markX(a.row, a.col);
  }

  return { board: b, newX };
}

/** 在指定位置放置 X。返回新棋盘，不修改原棋盘。 */
export function applyX(board: BoardState, pos: Position): BoardState {
  const b = cloneBoard(board);
  if (!b.cells[pos.row][pos.col].isQueen && !b.cells[pos.row][pos.col].isWrong) {
    b.cells[pos.row][pos.col].isX = true;
  }
  return b;
}

/** 移除指定位置的 X 标记。返回新棋盘。 */
export function removeX(board: BoardState, pos: Position): BoardState {
  const b = cloneBoard(board);
  if (!b.cells[pos.row][pos.col].isWrong) {
    b.cells[pos.row][pos.col].isX = false;
  }
  return b;
}

/** 标记错误翻面（红X），不可撤销。 */
export function applyWrong(board: BoardState, pos: Position): BoardState {
  const b = cloneBoard(board);
  const cell = b.cells[pos.row][pos.col];
  if (!cell.isQueen) {
    cell.isWrong = true;
    cell.isX = false;
  }
  return b;
}

/** 检查棋盘是否完成：已放置 n 个 Queen 且所有约束满足 */
export function isBoardComplete(board: BoardState): boolean {
  const queens = getQueenPositions(board);
  if (queens.length !== board.n) return false;

  return isBoardValid(board);
}

/** 检查当前棋盘状态（完整或部分）是否有效 */
export function isBoardValid(board: BoardState): boolean {
  const queens = getQueenPositions(board);
  const n = board.n;

  // 行唯一性
  const rows = new Set<number>();
  for (const q of queens) {
    if (rows.has(q.row)) return false;
    rows.add(q.row);
  }

  // 列唯一性
  const cols = new Set<number>();
  for (const q of queens) {
    if (cols.has(q.col)) return false;
    cols.add(q.col);
  }

  // 区域唯一性
  const regions = new Set<number>();
  for (const q of queens) {
    const rid = board.cells[q.row][q.col].regionId;
    if (regions.has(rid)) return false;
    regions.add(rid);
  }

  // 邻接检查
  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const dr = Math.abs(queens[i].row - queens[j].row);
      const dc = Math.abs(queens[i].col - queens[j].col);
      if (dr <= 1 && dc <= 1) return false;
    }
  }

  // Queen 不能同时被标记 X
  for (const q of queens) {
      if (board.cells[q.row][q.col].isX || board.cells[q.row][q.col].isWrong) return false;
  }

  return true;
}

/**
 * 从区域布局创建空棋盘。
 * 无 Queen、无 X — 仅填充区域 ID。
 */
export function createEmptyBoard(n: number, regions: Region[]): BoardState {
  const cells: CellState[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => ({ regionId: -1, isQueen: false, isX: false, isWrong: false }))
  );

  for (const region of regions) {
    for (const { row, col } of region.cells) {
      cells[row][col].regionId = region.id;
    }
  }

  return { n, cells };
}

/** 格式化坐标为可读字符串 */
export function formatPos(pos: Position): string {
  return `r${pos.row}c${pos.col}`;
}
