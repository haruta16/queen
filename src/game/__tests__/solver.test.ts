import { describe, it, expect } from 'vitest';
import { solve, applyBatchesUpTo } from '../solver';
import { createEmptyBoard, isBoardComplete, getQueenPositions, cloneBoard, applyX, isBoardValid, applyQueen } from '../rules';
import { BoardState, Region } from '../types';

function makeRegions(layout: number[][]): Region[] {
  const n = layout.length;
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

function makeBoard(layout: number[][], queens: {row:number;col:number}[] = [], xs: {row:number;col:number}[] = []): BoardState {
  const n = layout.length;
  const regions = makeRegions(layout);
  const board = createEmptyBoard(n, regions);
  for (const q of queens) board.cells[q.row][q.col].isQueen = true;
  for (const x of xs) board.cells[x.row][x.col].isX = true;
  return board;
}

describe('Solver — batch contract', () => {
  it('batch indices are strictly increasing from 1', () => {
    // 4x4 with 2x2 corner regions — standard Queen puzzle
    const layout = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const board = makeBoard(layout);
    const result = solve(board);

    for (let i = 0; i < result.batches.length; i++) {
      expect(result.batches[i].index).toBe(i + 1);
    }
  });

  it('each batch has a valid strategy type', () => {
    const layout = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const board = makeBoard(layout);
    const result = solve(board);

    const validStrategies = ['L1_Direct', 'L1_Unique', 'L2_Lock1', 'L2_Lock2', 'L2_Lock3', 'L3_Projection', 'L3_Capacity'];
    for (const batch of result.batches) {
      expect(validStrategies).toContain(batch.strategy);
    }
  });

  it('no empty batches (rule: no output, no record)', () => {
    const layout = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const board = makeBoard(layout);
    const result = solve(board);

    for (const batch of result.batches) {
      const hasOutput = batch.eliminations.length > 0 || batch.queenConfirmed.length > 0;
      expect(hasOutput).toBe(true);
    }
  });
});

describe('Solver — determinism', () => {
  it('same board produces same batch sequence', () => {
    const layout = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const board1 = makeBoard(layout);
    const board2 = makeBoard(layout);

    const r1 = solve(board1);
    const r2 = solve(board2);

    expect(r1.totalSteps).toBe(r2.totalSteps);
    expect(r1.batches.length).toBe(r2.batches.length);
    for (let i = 0; i < r1.batches.length; i++) {
      expect(r1.batches[i].strategy).toBe(r2.batches[i].strategy);
      expect(r1.batches[i].eliminations.length).toBe(r2.batches[i].eliminations.length);
    }
  });
});

describe('Solver — output structure', () => {
  it('SolverResult has all required fields', () => {
    const layout = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const board = makeBoard(layout);
    const result = solve(board);

    expect(result).toHaveProperty('complete');
    expect(result).toHaveProperty('batches');
    expect(result).toHaveProperty('totalSteps');
    expect(result).toHaveProperty('strategyTypesUsed');
    expect(result).toHaveProperty('highestLevel');
    expect(result.totalSteps).toBe(result.batches.length);
  });

  it('applyBatchesUpTo reconstructs intermediate state', () => {
    const layout = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];
    const board = makeBoard(layout);
    const result = solve(board);

    const step0 = applyBatchesUpTo(board, result.batches, 0);
    expect(getQueenPositions(step0).length).toBe(0);

    const stepAll = applyBatchesUpTo(board, result.batches, result.totalSteps);
    if (result.complete) {
      expect(isBoardComplete(stepAll)).toBe(true);
    }
  });
});

describe('Solver — mid-game completion', () => {
  it('completes from a partial board with pre-placed Xs', () => {
    // Start with known solution: queens at (0,1), (1,3), (2,0), (3,2) on 2x2 regions
    const layout = [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ];

    // Place first queen and apply its X propagation
    let board = makeBoard(layout);
    const { board: b1 } = applyQueen(board, { row: 0, col: 1 });
    board = b1;

    // Now the solver should be able to complete from this state
    const result = solve(board);
    expect(result.complete).toBe(true);
    expect(result.totalSteps).toBeGreaterThan(0);

    const finalBoard = applyBatchesUpTo(board, result.batches, result.totalSteps);
    expect(isBoardComplete(finalBoard)).toBe(true);
  });
});
