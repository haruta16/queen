import { BoardState, CellState, Position, Region } from './types';

// ============================================================
// Pure rule functions for Queen Elimination Puzzle
// ============================================================

/** Deep-clone a board */
export function cloneBoard(board: BoardState): BoardState {
  return {
    n: board.n,
    cells: board.cells.map(row => row.map(cell => ({ ...cell }))),
  };
}

/** Get all 8-adjacent positions within bounds */
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

/** Check if there's a Queen in the 8-neighbourhood of pos */
export function hasAdjacentQueen(board: BoardState, pos: Position): boolean {
  const adj = getAdjacentPositions(pos, board.n);
  return adj.some(a => board.cells[a.row][a.col].isQueen);
}

/** Get all candidate cells in a row (not Queen, not X) */
export function getCandidatesInRow(board: BoardState, row: number): Position[] {
  const result: Position[] = [];
  for (let c = 0; c < board.n; c++) {
    const cell = board.cells[row][c];
    if (!cell.isQueen && !cell.isX) result.push({ row, col: c });
  }
  return result;
}

/** Get all candidate cells in a column */
export function getCandidatesInCol(board: BoardState, col: number): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < board.n; r++) {
    const cell = board.cells[r][col];
    if (!cell.isQueen && !cell.isX) result.push({ row: r, col });
  }
  return result;
}

/** Get all candidate cells in a region */
export function getCandidatesInRegion(board: BoardState, regionId: number): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < board.n; r++) {
    for (let c = 0; c < board.n; c++) {
      const cell = board.cells[r][c];
      if (cell.regionId === regionId && !cell.isQueen && !cell.isX) {
        result.push({ row: r, col: c });
      }
    }
  }
  return result;
}

/** Get all Queen positions on the board */
export function getQueenPositions(board: BoardState): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < board.n; r++) {
    for (let c = 0; c < board.n; c++) {
      if (board.cells[r][c].isQueen) result.push({ row: r, col: c });
    }
  }
  return result;
}

/** Get all region IDs */
export function getRegionIds(board: BoardState): number[] {
  const ids = new Set<number>();
  for (let r = 0; r < board.n; r++) {
    for (let c = 0; c < board.n; c++) {
      ids.add(board.cells[r][c].regionId);
    }
  }
  return Array.from(ids);
}

/** Get all cells belonging to a region */
export function getRegionCells(board: BoardState, regionId: number): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < board.n; r++) {
    for (let c = 0; c < board.n; c++) {
      if (board.cells[r][c].regionId === regionId) {
        result.push({ row: r, col: c });
      }
    }
  }
  return result;
}

/**
 * Find positions that are the only candidate in their row, column, or region.
 * Only returns cells that are NOT already Queen.
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
 * Apply Queen at position. Returns new board and list of NEW X positions created.
 * Does NOT mutate the input board.
 */
export function applyQueen(board: BoardState, pos: Position): { board: BoardState; newX: Position[] } {
  const b = cloneBoard(board);
  const newX: Position[] = [];
  const n = b.n;
  const { row, col } = pos;
  const regionId = b.cells[row][col].regionId;

  // Place Queen
  b.cells[row][col].isQueen = true;
  b.cells[row][col].isX = false;

  // Helper to mark X if not already Queen/X
  const markX = (r: number, c: number) => {
    const cell = b.cells[r][c];
    if (!cell.isQueen && !cell.isX) {
      cell.isX = true;
      newX.push({ row: r, col: c });
    }
  };

  // Same row
  for (let c = 0; c < n; c++) {
    if (c !== col) markX(row, c);
  }

  // Same column
  for (let r = 0; r < n; r++) {
    if (r !== row) markX(r, col);
  }

  // Same region
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (b.cells[r][c].regionId === regionId && !(r === row && c === col)) {
        markX(r, c);
      }
    }
  }

  // Adjacent (8-neighbourhood)
  const adj = getAdjacentPositions(pos, n);
  for (const a of adj) {
    markX(a.row, a.col);
  }

  return { board: b, newX };
}

/** Apply X at position. Returns new board. Does not mutate input. */
export function applyX(board: BoardState, pos: Position): BoardState {
  const b = cloneBoard(board);
  if (!b.cells[pos.row][pos.col].isQueen) {
    b.cells[pos.row][pos.col].isX = true;
  }
  return b;
}

/** Remove X at position. Returns new board. */
export function removeX(board: BoardState, pos: Position): BoardState {
  const b = cloneBoard(board);
  b.cells[pos.row][pos.col].isX = false;
  return b;
}

/** Check if board is complete: n Queens placed and all constraints satisfied */
export function isBoardComplete(board: BoardState): boolean {
  const queens = getQueenPositions(board);
  if (queens.length !== board.n) return false;

  return isBoardValid(board);
}

/** Check if current board state (partial or complete) is valid */
export function isBoardValid(board: BoardState): boolean {
  const queens = getQueenPositions(board);
  const n = board.n;

  // Check row uniqueness
  const rows = new Set<number>();
  for (const q of queens) {
    if (rows.has(q.row)) return false;
    rows.add(q.row);
  }

  // Check column uniqueness
  const cols = new Set<number>();
  for (const q of queens) {
    if (cols.has(q.col)) return false;
    cols.add(q.col);
  }

  // Check region uniqueness
  const regions = new Set<number>();
  for (const q of queens) {
    const rid = board.cells[q.row][q.col].regionId;
    if (regions.has(rid)) return false;
    regions.add(rid);
  }

  // Check adjacency
  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const dr = Math.abs(queens[i].row - queens[j].row);
      const dc = Math.abs(queens[i].col - queens[j].col);
      if (dr <= 1 && dc <= 1) return false;
    }
  }

  // Check no Queen is also marked X
  for (const q of queens) {
    if (board.cells[q.row][q.col].isX) return false;
  }

  return true;
}

/**
 * Create an empty board from region layout.
 * No Queens, no X marks — just region IDs.
 */
export function createEmptyBoard(n: number, regions: Region[]): BoardState {
  const cells: CellState[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => ({ regionId: -1, isQueen: false, isX: false }))
  );

  for (const region of regions) {
    for (const { row, col } of region.cells) {
      cells[row][col].regionId = region.id;
    }
  }

  return { n, cells };
}

/** Build regions array from a board's cell data */
export function buildRegionsFromBoard(board: BoardState): Region[] {
  const n = board.n;
  const regionMap = new Map<number, Position[]>();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const rid = board.cells[r][c].regionId;
      if (!regionMap.has(rid)) {
        regionMap.set(rid, []);
      }
      regionMap.get(rid)!.push({ row: r, col: c });
    }
  }

  return Array.from(regionMap.entries()).map(([id, cells]) => ({ id, cells }));
}

/** Get region ID count */
export function getRegionCount(board: BoardState): number {
  return getRegionIds(board).length;
}

/** Check if two positions are the same */
export function posEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

/** Format position as human-readable string */
export function formatPos(pos: Position): string {
  return `r${pos.row}c${pos.col}`;
}
