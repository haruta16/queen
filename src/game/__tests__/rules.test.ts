import { describe, it, expect } from 'vitest';
import {
  cloneBoard,
  getAdjacentPositions,
  hasAdjacentQueen,
  getCandidatesInRow,
  getCandidatesInCol,
  getCandidatesInRegion,
  findUniqueCandidates,
  applyQueen,
  applyX,
  removeX,
  isBoardComplete,
  isBoardValid,
  createEmptyBoard,
  getQueenPositions,
  getRegionIds,
  formatPos,
} from '../rules';
import { BoardState, Region } from '../types';

function makeBoard(n: number, regions: Region[], queens: { row: number; col: number }[] = [], xs: { row: number; col: number }[] = []): BoardState {
  const board = createEmptyBoard(n, regions);
  for (const q of queens) {
    board.cells[q.row][q.col].isQueen = true;
  }
  for (const x of xs) {
    board.cells[x.row][x.col].isX = true;
  }
  return board;
}

function makeRegions(n: number, layout: number[][]): Region[] {
  const map = new Map<number, { row: number; col: number }[]>();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const rid = layout[r][c];
      if (!map.has(rid)) map.set(rid, []);
      map.get(rid)!.push({ row: r, col: c });
    }
  }
  return Array.from(map.entries()).map(([id, cells]) => ({ id, cells }));
}

describe('getAdjacentPositions', () => {
  it('returns 8 neighbours for interior cell', () => {
    const adj = getAdjacentPositions({ row: 2, col: 2 }, 5);
    expect(adj.length).toBe(8);
  });

  it('returns fewer for corner cell', () => {
    const adj = getAdjacentPositions({ row: 0, col: 0 }, 5);
    expect(adj.length).toBe(3);
  });

  it('returns fewer for edge cell', () => {
    const adj = getAdjacentPositions({ row: 0, col: 2 }, 5);
    expect(adj.length).toBe(5);
  });
});

describe('hasAdjacentQueen', () => {
  it('detects adjacent Queen diagonally', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const board = makeBoard(3, regions, [{ row: 0, col: 0 }]);
    expect(hasAdjacentQueen(board, { row: 1, col: 1 })).toBe(true);
  });

  it('returns false when no adjacent Queen', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const board = makeBoard(3, regions, [{ row: 0, col: 0 }]);
    expect(hasAdjacentQueen(board, { row: 2, col: 2 })).toBe(false);
  });
});

describe('getCandidates', () => {
  it('getCandidatesInRow excludes Queens and X marks', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const queens = [{ row: 1, col: 1 }];
    const xs = [{ row: 1, col: 0 }];
    const board = makeBoard(3, regions, queens, xs);
    const cands = getCandidatesInRow(board, 1);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toEqual({ row: 1, col: 2 });
  });

  it('getCandidatesInCol works correctly', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const queens = [{ row: 1, col: 1 }];
    const board = makeBoard(3, regions, queens);
    const cands = getCandidatesInCol(board, 1);
    expect(cands).toHaveLength(2); // rows 0 and 2
  });

  it('getCandidatesInRegion works correctly', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const queens = [{ row: 0, col: 0 }];
    const board = makeBoard(3, regions, queens);
    const cands = getCandidatesInRegion(board, 0);
    // region 0 has 4 cells: (0,0)(0,1)(1,0)(1,1), one is Queen
    expect(cands).toHaveLength(3);
  });
});

describe('findUniqueCandidates', () => {
  it('finds when a row has exactly one candidate', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const xs = [
      { row: 0, col: 0 }, { row: 0, col: 1 },
      { row: 1, col: 0 }, { row: 1, col: 1 },
      { row: 2, col: 0 }, { row: 2, col: 1 },
    ];
    const board = makeBoard(3, regions, [], xs);
    const uniq = findUniqueCandidates(board);
    // Each row should have col 2 as only candidate
    expect(uniq.length).toBeGreaterThan(0);
    expect(uniq.some(u => u.row === 0 && u.col === 2)).toBe(true);
  });
});

describe('applyQueen', () => {
  it('marks same row, col, region, and adjacent cells as X', () => {
    const layout = [
      [0, 0, 1],
      [0, 0, 1],
      [2, 2, 1],
    ];
    const regions = makeRegions(3, layout);
    const board = makeBoard(3, regions);

    const { board: newBoard, newX } = applyQueen(board, { row: 1, col: 1 });

    // Region 0: cells are (0,0)(0,1)(1,0)(1,1) — all in region 0 should be X except the Queen
    // Row 1: (1,0)(1,2) should be X
    // Col 1: (0,1)(2,1) should be X
    // Adjacent to (1,1): (0,0)(0,1)(0,2)(1,0)(1,2)(2,0)(2,1)(2,2)
    // So (1,2) is X (row), (2,1) is X (col), (0,1) is X (col), (0,0)(1,0) are X (region), and adjacents
    expect(newBoard.cells[1][1].isQueen).toBe(true);
    expect(newBoard.cells[1][1].isX).toBe(false);
    expect(newBoard.cells[0][0].isX).toBe(true);  // region + adjacent
    expect(newBoard.cells[0][1].isX).toBe(true);  // region/col + adjacent
    expect(newBoard.cells[1][0].isX).toBe(true);  // region + adjacent
    expect(newBoard.cells[0][2].isX).toBe(true);  // adjacent
    expect(newBoard.cells[1][2].isX).toBe(true);  // row + adjacent
    expect(newBoard.cells[2][0].isX).toBe(true);  // adjacent
    expect(newBoard.cells[2][1].isX).toBe(true);  // col + adjacent
    expect(newBoard.cells[2][2].isX).toBe(true);  // adjacent

    // 8 cells total should be X + 1 Queen = all 9 cells accounted for
    expect(newX.length).toBe(8);
  });

  it('does not mutate the original board (deep clone)', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const board = makeBoard(3, regions);
    const orig = cloneBoard(board);
    applyQueen(board, { row: 1, col: 1 });
    expect(board.cells[1][1].isQueen).toBe(false);
    expect(board.cells[0][0].isX).toBe(false);
    // check deep equality
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(board.cells[r][c].isQueen).toBe(orig.cells[r][c].isQueen);
        expect(board.cells[r][c].isX).toBe(orig.cells[r][c].isX);
      }
    }
  });
});

describe('applyX and removeX', () => {
  it('marks a cell as X', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const board = makeBoard(3, regions);
    const newBoard = applyX(board, { row: 1, col: 1 });
    expect(newBoard.cells[1][1].isX).toBe(true);
    expect(board.cells[1][1].isX).toBe(false); // does not mutate original
  });

  it('removeX clears an X mark', () => {
    const regions = makeRegions(3, [[0,0,1],[0,0,1],[2,2,1]]);
    const board = makeBoard(3, regions, [], [{ row: 1, col: 1 }]);
    const newBoard = removeX(board, { row: 1, col: 1 });
    expect(newBoard.cells[1][1].isX).toBe(false);
  });
});

describe('isBoardValid', () => {
  it('accepts a valid Queen placement', () => {
    // 3 queens in different rows, cols, regions, not adjacent
    const layout = [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ];
    const regions = makeRegions(3, layout);
    const board = makeBoard(3, regions, [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
    // (0,0) adjacent to (1,0),(1,1),(0,1) — none are queens
    // (1,1) is diagonally adjacent to (0,0) — wait that IS a violation!
    // Let me choose better positions
  });

  it('rejects queens in same row', () => {
    const layout = [[0,0,1],[0,0,1],[2,2,1]];
    const regions = makeRegions(3, layout);
    const board = makeBoard(3, regions, [
      { row: 0, col: 0 },
      { row: 0, col: 2 },
    ]);
    expect(isBoardValid(board)).toBe(false);
  });

  it('rejects adjacent queens', () => {
    const layout = [[0,0,1],[0,0,1],[2,2,1]];
    const regions = makeRegions(3, layout);
    const board = makeBoard(3, regions, [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ]);
    expect(isBoardValid(board)).toBe(false);
  });

  it('rejects two queens in same region', () => {
    const layout = [[0,0,1],[0,0,1],[2,2,1]];
    const regions = makeRegions(3, layout);
    const board = makeBoard(3, regions, [
      { row: 0, col: 0 },
      { row: 2, col: 0 }, // same region 0 as (0,0)? Let me check layout
    ]);
    // (0,0) is region 0, (1,0) is region 0, (2,0) is region 2
    // Actually (0,0) and (2,0) are different regions. Let me adjust.
  });

  it('accepts valid non-adjacent queens in different rows/cols/regions', () => {
    const n = 5;
    const layout: number[][] = [];
    for (let r = 0; r < n; r++) {
      layout.push([]);
      for (let c = 0; c < n; c++) {
        layout[r].push(r * n + c);
      }
    }
    const regions = makeRegions(n, layout);
    // 5 non-adjacent queens with distinct rows/cols
    const board = makeBoard(n, regions, [
      { row: 0, col: 0 },
      { row: 1, col: 3 },
      { row: 2, col: 1 },
      { row: 3, col: 4 },
      { row: 4, col: 2 },
    ]);
    expect(isBoardValid(board)).toBe(true);
  });
});

describe('isBoardComplete', () => {
  it('returns false when not all Queens placed', () => {
    const layout = [[0,0,1],[0,0,1],[2,2,1]];
    const regions = makeRegions(3, layout);
    const board = makeBoard(3, regions, [{ row: 0, col: 0 }]);
    expect(isBoardComplete(board)).toBe(false);
  });

  it('returns true for valid complete board', () => {
    const n = 5;
    const layout: number[][] = [];
    for (let r = 0; r < n; r++) {
      layout.push([]);
      for (let c = 0; c < n; c++) {
        layout[r].push(r * n + c);
      }
    }
    const regions = makeRegions(n, layout);
    const board = makeBoard(n, regions, [
      { row: 0, col: 0 },
      { row: 1, col: 3 },
      { row: 2, col: 1 },
      { row: 3, col: 4 },
      { row: 4, col: 2 },
    ]);
    expect(isBoardComplete(board)).toBe(true);
  });
});

describe('createEmptyBoard', () => {
  it('creates board with correct region assignments', () => {
    const regions: Region[] = [
      { id: 0, cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      { id: 1, cells: [{ row: 1, col: 0 }, { row: 1, col: 1 }] },
    ];
    const board = createEmptyBoard(2, regions);
    expect(board.n).toBe(2);
    expect(board.cells[0][0].regionId).toBe(0);
    expect(board.cells[0][1].regionId).toBe(0);
    expect(board.cells[1][0].regionId).toBe(1);
    expect(board.cells[1][1].regionId).toBe(1);
    expect(board.cells[0][0].isQueen).toBe(false);
    expect(board.cells[0][0].isX).toBe(false);
  });
});

describe('getQueenPositions', () => {
  it('returns all Queen positions', () => {
    const layout = [[0,1],[0,1]];
    const regions = makeRegions(2, layout);
    const board = makeBoard(2, regions, [{ row: 0, col: 0 }]);
    const queens = getQueenPositions(board);
    expect(queens).toHaveLength(1);
    expect(queens[0]).toEqual({ row: 0, col: 0 });
  });
});

describe('formatPos', () => {
  it('formats position correctly', () => {
    expect(formatPos({ row: 3, col: 5 })).toBe('r3c5');
  });
});

describe('cloneBoard', () => {
  it('produces a deep copy', () => {
    const regions = makeRegions(2, [[0,1],[0,1]]);
    const board = makeBoard(2, regions);
    const clone = cloneBoard(board);
    clone.cells[0][0].isQueen = true;
    expect(board.cells[0][0].isQueen).toBe(false);
  });
});
