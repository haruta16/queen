import { Level, Position, Region, SolverResult } from './types';
import { createEmptyBoard, getQueenPositions } from './rules';
import { applyBatchesUpTo, solve } from './solver';
import { createRNG, shuffle } from './random';

// Project generator:
// Build explicit strategy dependencies first, then verify the final region
// layout with the real solver. No Monte Carlo region fallback is used here.

type L1ChainCandidate = {
  regions: Region[];
  queens: Position[];
  plannedOrder: Position[];
  solverResult: SolverResult;
};

type ProjectGenerationAttempt = { level: Level | null; attempts: number };

function samePos(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

function positionsSet(positions: Position[]): Set<string> {
  return new Set(positions.map(posKey));
}

function samePositionSet(a: Position[], b: Position[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = positionsSet(a);
  return b.every(p => aSet.has(posKey(p)));
}

function canQueensCoexist(a: Position, b: Position): boolean {
  if (a.row === b.row || a.col === b.col) return false;
  return Math.abs(a.row - b.row) > 1 || Math.abs(a.col - b.col) > 1;
}

function generateLegalQueens(n: number, rng: () => number): Position[] {
  const rows = shuffle(Array.from({ length: n }, (_, i) => i), rng);
  const queens: Position[] = [];

  function backtrack(rowIndex: number): boolean {
    if (rowIndex === n) return true;

    const row = rows[rowIndex];
    const cols = shuffle(Array.from({ length: n }, (_, i) => i), rng);

    for (const col of cols) {
      const candidate = { row, col };
      if (!queens.every(q => canQueensCoexist(q, candidate))) continue;
      queens.push(candidate);
      if (backtrack(rowIndex + 1)) return true;
      queens.pop();
    }

    return false;
  }

  if (!backtrack(0)) throw new Error(`无法生成 ${n} 个合法 Queen`);
  return queens;
}

function isGeometricallyEliminatedBy(pos: Position, queen: Position): boolean {
  if (samePos(pos, queen)) return false;
  if (pos.row === queen.row || pos.col === queen.col) return true;
  return Math.abs(pos.row - queen.row) <= 1 && Math.abs(pos.col - queen.col) <= 1;
}

function firstGeometricEliminationStep(pos: Position, order: Position[]): number | null {
  for (let i = 0; i < order.length; i++) {
    if (isGeometricallyEliminatedBy(pos, order[i])) return i;
  }
  return null;
}

function hasEarlierEliminator(pos: Position, order: Position[]): boolean {
  return order.some(queen => isGeometricallyEliminatedBy(pos, queen));
}

function isSolutionCell(pos: Position, solutionSet: Set<string>): boolean {
  return solutionSet.has(posKey(pos));
}

function guardsFor(previous: Position, current: Position): Position[] {
  return [
    { row: current.row, col: previous.col },
    { row: previous.row, col: current.col },
  ];
}

function findGuardedOrder(queens: Position[], rng: () => number): Position[] | null {
  const starts = shuffle(queens, rng);

  for (const start of starts) {
    const order = [start];
    const remaining = queens.filter(q => !samePos(q, start));

    function backtrack(): boolean {
      if (remaining.length === 0) return true;

      const previous = order[order.length - 1];
      const candidates = shuffle(remaining, rng);

      for (const current of candidates) {
        const guards = guardsFor(previous, current);
        if (guards.some(guard => hasEarlierEliminator(guard, order.slice(0, -1)))) continue;

        order.push(current);
        remaining.splice(remaining.findIndex(q => samePos(q, current)), 1);
        if (backtrack()) return true;
        remaining.push(current);
        order.pop();
      }

      return false;
    }

    if (backtrack()) return order;
  }

  return null;
}

function tryBuildL1Chain(n: number, rng: () => number): L1ChainCandidate | null {
  const queens = generateLegalQueens(n, rng);
  const plannedOrder = findGuardedOrder(queens, rng);
  if (!plannedOrder) return null;
  const solutionSet = positionsSet(queens);
  const regions: Position[][] = Array.from({ length: n }, () => []);
  const assigned = new Set<string>();

  for (let i = 0; i < plannedOrder.length; i++) {
    regions[i].push(plannedOrder[i]);
    assigned.add(posKey(plannedOrder[i]));
  }

  for (let i = 1; i < plannedOrder.length; i++) {
    const previous = plannedOrder[i - 1];
    const current = plannedOrder[i];
    const guards = guardsFor(previous, current);

    for (const guard of guards) {
      if (isSolutionCell(guard, solutionSet)) return null;
      if (firstGeometricEliminationStep(guard, plannedOrder) !== i - 1) return null;
    }

    for (const guard of guards) {
      const key = posKey(guard);
      if (!assigned.has(key)) {
        regions[i].push(guard);
        assigned.add(key);
      }
    }
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const pos = { row, col };
      const key = posKey(pos);
      if (assigned.has(key)) continue;

      const firstEliminatedAt = firstGeometricEliminationStep(pos, plannedOrder);
      if (firstEliminatedAt === null) return null;

      const possibleRegionIndexes = Array.from(
        { length: n - firstEliminatedAt - 1 },
        (_, offset) => firstEliminatedAt + 1 + offset,
      );
      if (possibleRegionIndexes.length === 0) return null;

      const regionIndex = shuffle(possibleRegionIndexes, rng)[0];
      regions[regionIndex].push(pos);
      assigned.add(key);
    }
  }

  const candidateRegions = regions.map((cells, id) => ({ id, cells }));
  const board = createEmptyBoard(n, candidateRegions.map(region => ({ id: region.id, cells: [...region.cells] })));
  const solverResult = solve(board);
  if (!solverResult.complete) return null;
  if (solverResult.totalSteps !== n) return null;
  if (solverResult.strategyTypesUsed.length !== 1 || solverResult.strategyTypesUsed[0] !== 'L1') return null;

  const solved = applyBatchesUpTo(board, solverResult.batches, solverResult.totalSteps);
  if (!samePositionSet(getQueenPositions(solved), queens)) return null;

  return {
    regions: candidateRegions,
    queens,
    plannedOrder,
    solverResult,
  };
}

function findUnusedCellInCol(args: {
  n: number;
  col: number;
  rng: () => number;
  assigned: Set<string>;
  solutionSet: Set<string>;
  avoidRows?: Set<number>;
}): Position | null {
  const rows = shuffle(Array.from({ length: args.n }, (_, row) => row), args.rng);
  for (const row of rows) {
    if (args.avoidRows?.has(row)) continue;
    const pos = { row, col: args.col };
    const key = posKey(pos);
    if (args.assigned.has(key)) continue;
    if (isSolutionCell(pos, args.solutionSet)) continue;
    return pos;
  }
  return null;
}

function lockColsFor(order: Position[], lockCount: number): Set<number> {
  return new Set(order.slice(1, lockCount + 1).map(queen => queen.col));
}

function tryBuildLock1PrefixForOrder(
  n: number,
  queens: Position[],
  plannedOrder: Position[],
  lockCount: number,
  rng: () => number,
): L1ChainCandidate | null {
  const solutionSet = positionsSet(queens);
  const lockCols = lockColsFor(plannedOrder, lockCount);
  const regions: Position[][] = Array.from({ length: n }, () => []);
  const assigned = new Set<string>();

  for (let i = 0; i < plannedOrder.length; i++) {
    regions[i].push(plannedOrder[i]);
    assigned.add(posKey(plannedOrder[i]));
  }

  for (let i = 1; i < plannedOrder.length; i++) {
    const previous = plannedOrder[i - 1];
    const current = plannedOrder[i];

    if (i <= lockCount) {
      const lockGuard = { row: previous.row, col: current.col };
      if (isSolutionCell(lockGuard, solutionSet)) return null;
      if (firstGeometricEliminationStep(lockGuard, plannedOrder) !== i - 1) return null;
      const key = posKey(lockGuard);
      if (!assigned.has(key)) {
        regions[i].push(lockGuard);
        assigned.add(key);
      }
      continue;
    }

    const guards = guardsFor(previous, current).filter(guard =>
      !isSolutionCell(guard, solutionSet) &&
      !lockCols.has(guard.col) &&
      firstGeometricEliminationStep(guard, plannedOrder) === i - 1
    );
    if (guards.length === 0) return null;

    for (const guard of guards) {
      const key = posKey(guard);
      if (!assigned.has(key)) {
        regions[i].push(guard);
        assigned.add(key);
      }
    }
  }

  for (let i = 2; i <= lockCount; i++) {
    const blocker = findUnusedCellInCol({
      n,
      col: plannedOrder[i - 1].col,
      rng,
      assigned,
      solutionSet,
      avoidRows: new Set([plannedOrder[i].row, plannedOrder[i - 2].row]),
    });
    if (!blocker) return null;
    regions[i].push(blocker);
    assigned.add(posKey(blocker));
  }

  if (lockCount > 0) {
    const firstBlocker = findUnusedCellInCol({
      n,
      col: plannedOrder[lockCount].col,
      rng,
      assigned,
      solutionSet,
      avoidRows: new Set([plannedOrder[0].row, plannedOrder[lockCount - 1].row]),
    });
    if (!firstBlocker) return null;
    regions[0].push(firstBlocker);
    assigned.add(posKey(firstBlocker));
  }

  let validFill = true;
  for (let row = 0; row < n && validFill; row++) {
    for (let col = 0; col < n; col++) {
      const pos = { row, col };
      const key = posKey(pos);
      if (assigned.has(key)) continue;

      const possibleRegionIndexes: number[] = [];
      const lockColIndex = plannedOrder.findIndex((queen, index) =>
        index >= 1 && index <= lockCount && queen.col === col
      );

      for (let regionIndex = 0; regionIndex < n; regionIndex++) {
        if (regionIndex >= 1 && regionIndex <= lockCount) continue;

        if (lockColIndex >= 1 && lockColIndex <= lockCount && regionIndex !== lockColIndex) {
          possibleRegionIndexes.push(regionIndex);
          continue;
        }

        const firstEliminatedAt = firstGeometricEliminationStep(pos, plannedOrder);
        if (firstEliminatedAt !== null && firstEliminatedAt < regionIndex) {
          possibleRegionIndexes.push(regionIndex);
        }
      }

      if (possibleRegionIndexes.length === 0) {
        validFill = false;
        break;
      }

      const regionIndex = shuffle(possibleRegionIndexes, rng)[0];
      regions[regionIndex].push(pos);
      assigned.add(key);
    }
  }

  if (!validFill) return null;

  const candidateRegions = regions.map((cells, id) => ({ id, cells }));
  const board = createEmptyBoard(n, candidateRegions.map(region => ({ id: region.id, cells: [...region.cells] })));
  const solverResult = solve(board);
  if (!solverResult.complete) return null;
  if (solverResult.totalSteps !== n + lockCount) return null;
  if (solverResult.batches.slice(0, lockCount).some(batch => batch.strategy !== 'L2_Lock1')) return null;
  if (solverResult.batches.slice(lockCount).some(batch => batch.strategy !== 'L1')) return null;

  const solved = applyBatchesUpTo(board, solverResult.batches, solverResult.totalSteps);
  if (!samePositionSet(getQueenPositions(solved), queens)) return null;

  return {
    regions: candidateRegions,
    queens,
    plannedOrder,
    solverResult,
  };
}

function tryBuildLock1Prefix(n: number, lockCount: number, rng: () => number): L1ChainCandidate | null {
  if (lockCount < 1 || lockCount >= n) return null;
  const queens = generateLegalQueens(n, rng);

  for (let orderAttempt = 0; orderAttempt < 200; orderAttempt++) {
    const plannedOrder = shuffle(queens, rng);
    const candidate = tryBuildLock1PrefixForOrder(n, queens, plannedOrder, lockCount, rng);
    if (candidate) return candidate;
  }

  return null;
}

function findCell(args: {
  n: number;
  rng: () => number;
  assigned: Set<string>;
  solutionSet: Set<string>;
  predicate: (pos: Position) => boolean;
}): Position | null {
  const all = [];
  for (let row = 0; row < args.n; row++) {
    for (let col = 0; col < args.n; col++) all.push({ row, col });
  }

  for (const pos of shuffle(all, args.rng)) {
    if (args.assigned.has(posKey(pos))) continue;
    if (isSolutionCell(pos, args.solutionSet)) continue;
    if (!args.predicate(pos)) continue;
    return pos;
  }

  return null;
}

function tryBuildInterleavedSingleLock1(n: number, rng: () => number): L1ChainCandidate | null {
  const queens = generateLegalQueens(n, rng);
  const solutionSet = positionsSet(queens);

  for (const firstQueen of shuffle(queens, rng)) {
    for (const secondQueen of shuffle(queens.filter(q => !samePos(q, firstQueen)), rng)) {
      const lockQueens = shuffle(queens.filter(q => !samePos(q, firstQueen) && !samePos(q, secondQueen)), rng);

      for (const lockQueen of lockQueens) {
        const lockCol = lockQueen.col;
        const assigned = new Set<string>();
        const regions: Position[][] = Array.from({ length: n }, () => []);
        const baseOrder = [firstQueen, secondQueen, lockQueen];

        for (let i = 0; i < baseOrder.length; i++) {
          regions[i].push(baseOrder[i]);
          assigned.add(posKey(baseOrder[i]));
        }

        const lockPreBlocker = findCell({
          n,
          rng,
          assigned,
          solutionSet,
          predicate: pos => pos.col !== lockCol && isGeometricallyEliminatedBy(pos, firstQueen),
        });
        if (!lockPreBlocker) continue;
        regions[2].push(lockPreBlocker);
        assigned.add(posKey(lockPreBlocker));

        const lockInternalGuard = { row: secondQueen.row, col: lockCol };
        if (assigned.has(posKey(lockInternalGuard))) continue;
        if (isSolutionCell(lockInternalGuard, solutionSet)) continue;
        if (isGeometricallyEliminatedBy(lockInternalGuard, firstQueen)) continue;
        regions[2].push(lockInternalGuard);
        assigned.add(posKey(lockInternalGuard));

        const secondBlocker = findCell({
          n,
          rng,
          assigned,
          solutionSet,
          predicate: pos =>
            pos.col === lockCol &&
            !isGeometricallyEliminatedBy(pos, firstQueen) &&
            !samePos(pos, lockInternalGuard),
        });
        if (!secondBlocker) continue;
        regions[1].push(secondBlocker);
        assigned.add(posKey(secondBlocker));

        const remaining = queens.filter(q => !baseOrder.some(base => samePos(base, q)));
        let plannedOrder: Position[] | null = null;

        for (let orderAttempt = 0; orderAttempt < 100 && !plannedOrder; orderAttempt++) {
          const candidateOrder = [...baseOrder, ...shuffle(remaining, rng)];
          let ok = true;
          for (let i = 3; i < candidateOrder.length; i++) {
            const guards = guardsFor(candidateOrder[i - 1], candidateOrder[i]).filter(guard =>
              !isSolutionCell(guard, solutionSet) &&
              guard.col !== lockCol &&
              firstGeometricEliminationStep(guard, candidateOrder) === i - 1
            );
            if (guards.length === 0) {
              ok = false;
              break;
            }
          }
          if (ok) plannedOrder = candidateOrder;
        }

        if (!plannedOrder) continue;

        for (let i = 3; i < plannedOrder.length; i++) {
          regions[i].push(plannedOrder[i]);
          assigned.add(posKey(plannedOrder[i]));

          const guards = guardsFor(plannedOrder[i - 1], plannedOrder[i]).filter(guard =>
            !isSolutionCell(guard, solutionSet) &&
            guard.col !== lockCol &&
            firstGeometricEliminationStep(guard, plannedOrder!) === i - 1
          );

          for (const guard of guards) {
            const key = posKey(guard);
            if (!assigned.has(key)) {
              regions[i].push(guard);
              assigned.add(key);
            }
          }
        }

        let validFill = true;
        for (let row = 0; row < n && validFill; row++) {
          for (let col = 0; col < n; col++) {
            const pos = { row, col };
            const key = posKey(pos);
            if (assigned.has(key)) continue;

            const possibleRegionIndexes: number[] = [];
            for (let regionIndex = 1; regionIndex < n; regionIndex++) {
              if (regionIndex !== 2 && col === lockCol) {
                possibleRegionIndexes.push(regionIndex);
                continue;
              }

              const firstEliminatedAt = firstGeometricEliminationStep(pos, plannedOrder);
              if (firstEliminatedAt !== null && firstEliminatedAt < regionIndex) {
                possibleRegionIndexes.push(regionIndex);
              }
            }

            if (possibleRegionIndexes.length === 0) {
              validFill = false;
              break;
            }

            const regionIndex = shuffle(possibleRegionIndexes, rng)[0];
            regions[regionIndex].push(pos);
            assigned.add(key);
          }
        }

        if (!validFill) continue;

        const candidateRegions = regions.map((cells, id) => ({ id, cells }));
        const board = createEmptyBoard(n, candidateRegions.map(region => ({ id: region.id, cells: [...region.cells] })));
        const solverResult = solve(board);
        if (!solverResult.complete) continue;
        if (solverResult.totalSteps !== n + 1) continue;
        if (solverResult.batches[0]?.strategy !== 'L1') continue;
        if (solverResult.batches[1]?.strategy !== 'L2_Lock1') continue;
        if (solverResult.batches.slice(2).some(batch => batch.strategy !== 'L1')) continue;

        const solved = applyBatchesUpTo(board, solverResult.batches, solverResult.totalSteps);
        if (!samePositionSet(getQueenPositions(solved), queens)) continue;

        return {
          regions: candidateRegions,
          queens,
          plannedOrder,
          solverResult,
        };
      }
    }
  }

  return null;
}

function firstEliminatedByAnyBefore(pos: Position, order: Position[], endExclusive: number): boolean {
  return order.slice(0, endExclusive).some(queen => isGeometricallyEliminatedBy(pos, queen));
}

function tryBuildInterleavedLock1Blocks(n: number, lockCount: number, rng: () => number): L1ChainCandidate | null {
  if (lockCount < 1 || 1 + lockCount * 2 >= n) return null;

  const queens = generateLegalQueens(n, rng);
  const solutionSet = positionsSet(queens);

  for (let orderAttempt = 0; orderAttempt < 300; orderAttempt++) {
    const shuffled = shuffle(queens, rng);
    const plannedOrder = [...shuffled];
    const lockIndexes = Array.from({ length: lockCount }, (_, i) => 2 + i * 2);
    const targetIndexes = Array.from({ length: lockCount }, (_, i) => 1 + i * 2);
    const lockCols = new Map<number, { lockIndex: number; targetIndex: number }>();
    for (let i = 0; i < lockCount; i++) {
      lockCols.set(plannedOrder[lockIndexes[i]].col, {
        lockIndex: lockIndexes[i],
        targetIndex: targetIndexes[i],
      });
    }

    const regions: Position[][] = Array.from({ length: n }, () => []);
    const assigned = new Set<string>();

    for (let i = 0; i < plannedOrder.length; i++) {
      regions[i].push(plannedOrder[i]);
      assigned.add(posKey(plannedOrder[i]));
    }

    let valid = true;

    for (let block = 0; block < lockCount && valid; block++) {
      const targetIndex = targetIndexes[block];
      const lockIndex = lockIndexes[block];
      const prevIndex = block === 0 ? 0 : lockIndexes[block - 1];
      const prevQueen = plannedOrder[prevIndex];
      const targetQueen = plannedOrder[targetIndex];
      const lockQueen = plannedOrder[lockIndex];
      const lockCol = lockQueen.col;

      const lockPreBlocker = findCell({
        n,
        rng,
        assigned,
        solutionSet,
        predicate: pos =>
          pos.col !== lockCol &&
          isGeometricallyEliminatedBy(pos, prevQueen) &&
          !firstEliminatedByAnyBefore(pos, plannedOrder, prevIndex),
      });
      if (!lockPreBlocker) {
        valid = false;
        break;
      }
      regions[lockIndex].push(lockPreBlocker);
      assigned.add(posKey(lockPreBlocker));

      const internalGuard = { row: targetQueen.row, col: lockCol };
      if (
        assigned.has(posKey(internalGuard)) ||
        isSolutionCell(internalGuard, solutionSet) ||
        firstEliminatedByAnyBefore(internalGuard, plannedOrder, targetIndex)
      ) {
        valid = false;
        break;
      }
      regions[lockIndex].push(internalGuard);
      assigned.add(posKey(internalGuard));

      const targetBlocker = findCell({
        n,
        rng,
        assigned,
        solutionSet,
        predicate: pos =>
          pos.col === lockCol &&
          !firstEliminatedByAnyBefore(pos, plannedOrder, targetIndex),
      });
      if (!targetBlocker) {
        valid = false;
        break;
      }
      regions[targetIndex].push(targetBlocker);
      assigned.add(posKey(targetBlocker));
    }

    if (!valid) continue;

    const regularStart = 1 + lockCount * 2;
    for (let i = regularStart; i < plannedOrder.length && valid; i++) {
      const guards = guardsFor(plannedOrder[i - 1], plannedOrder[i]).filter(guard =>
        !isSolutionCell(guard, solutionSet) &&
        !lockCols.has(guard.col) &&
        firstGeometricEliminationStep(guard, plannedOrder) === i - 1
      );
      if (guards.length === 0) {
        valid = false;
        break;
      }

      for (const guard of guards) {
        const key = posKey(guard);
        if (!assigned.has(key)) {
          regions[i].push(guard);
          assigned.add(key);
        }
      }
    }

    if (!valid) continue;

    for (let row = 0; row < n && valid; row++) {
      for (let col = 0; col < n; col++) {
        const pos = { row, col };
        const key = posKey(pos);
        if (assigned.has(key)) continue;

        const possibleRegionIndexes: number[] = [];
        const lockInfo = lockCols.get(col);

        for (let regionIndex = 1; regionIndex < n; regionIndex++) {
          if (lockIndexes.includes(regionIndex)) continue;

          if (lockInfo && regionIndex !== lockInfo.lockIndex && regionIndex >= lockInfo.targetIndex) {
            possibleRegionIndexes.push(regionIndex);
            continue;
          }

          const firstEliminatedAt = firstGeometricEliminationStep(pos, plannedOrder);
          if (firstEliminatedAt !== null && firstEliminatedAt < regionIndex) {
            possibleRegionIndexes.push(regionIndex);
          }
        }

        if (possibleRegionIndexes.length === 0) {
          valid = false;
          break;
        }

        const regionIndex = shuffle(possibleRegionIndexes, rng)[0];
        regions[regionIndex].push(pos);
        assigned.add(key);
      }
    }

    if (!valid) continue;

    const candidateRegions = regions.map((cells, id) => ({ id, cells }));
    const board = createEmptyBoard(n, candidateRegions.map(region => ({ id: region.id, cells: [...region.cells] })));
    const solverResult = solve(board);
    if (!solverResult.complete) continue;
    if (solverResult.totalSteps !== n + lockCount) continue;
    if (solverResult.batches.filter(batch => batch.strategy === 'L2_Lock1').length !== lockCount) continue;
    if (solverResult.batches.some(batch => batch.strategy !== 'L1' && batch.strategy !== 'L2_Lock1')) continue;
    if (solverResult.batches.slice(0, lockCount + 1).every(batch => batch.strategy !== 'L2_Lock1')) continue;

    const solved = applyBatchesUpTo(board, solverResult.batches, solverResult.totalSteps);
    if (!samePositionSet(getQueenPositions(solved), queens)) continue;

    return {
      regions: candidateRegions,
      queens,
      plannedOrder,
      solverResult,
    };
  }

  return null;
}

function tryBuildOpeningLock2(n: number, rng: () => number): L1ChainCandidate | null {
  const queens = generateLegalQueens(n, rng);
  const solutionSet = positionsSet(queens);

  for (const firstQueen of shuffle(queens, rng)) {
    const lockPairs = shuffle(
      queens
        .filter(q => !samePos(q, firstQueen))
        .flatMap((a, index, arr) => arr.slice(index + 1).map(b => [a, b] as [Position, Position])),
      rng,
    );

    for (const [lockA, lockB] of lockPairs) {
      const lockCols = new Set([lockA.col, lockB.col]);
      const guardA = { row: firstQueen.row, col: lockB.col };
      const guardB = { row: firstQueen.row, col: lockA.col };
      if (isSolutionCell(guardA, solutionSet) || isSolutionCell(guardB, solutionSet)) continue;

      const remaining = queens.filter(q =>
        !samePos(q, firstQueen) && !samePos(q, lockA) && !samePos(q, lockB)
      );

      for (let orderAttempt = 0; orderAttempt < 100; orderAttempt++) {
        const plannedOrder = [firstQueen, lockA, lockB, ...shuffle(remaining, rng)];
        const regions: Position[][] = Array.from({ length: n }, () => []);
        const assigned = new Set<string>();

        for (let i = 0; i < plannedOrder.length; i++) {
          regions[i].push(plannedOrder[i]);
          assigned.add(posKey(plannedOrder[i]));
        }

        regions[1].push(guardA);
        regions[2].push(guardB);
        assigned.add(posKey(guardA));
        assigned.add(posKey(guardB));

        const firstBlocker = findCell({
          n,
          rng,
          assigned,
          solutionSet,
          predicate: pos =>
            lockCols.has(pos.col) &&
            pos.row !== firstQueen.row,
        });
        if (!firstBlocker) continue;
        regions[0].push(firstBlocker);
        assigned.add(posKey(firstBlocker));

        let valid = true;
        for (let i = 3; i < plannedOrder.length && valid; i++) {
          const guards = guardsFor(plannedOrder[i - 1], plannedOrder[i]).filter(guard =>
            !isSolutionCell(guard, solutionSet) &&
            !lockCols.has(guard.col) &&
            firstGeometricEliminationStep(guard, plannedOrder) === i - 1
          );
          if (guards.length === 0) {
            valid = false;
            break;
          }

          for (const guard of guards) {
            const key = posKey(guard);
            if (!assigned.has(key)) {
              regions[i].push(guard);
              assigned.add(key);
            }
          }
        }

        if (!valid) continue;

        for (let row = 0; row < n && valid; row++) {
          for (let col = 0; col < n; col++) {
            const pos = { row, col };
            const key = posKey(pos);
            if (assigned.has(key)) continue;

            if (lockCols.has(col)) {
              regions[0].push(pos);
              assigned.add(key);
              continue;
            }

            const possibleRegionIndexes: number[] = [];
            for (let regionIndex = 3; regionIndex < n; regionIndex++) {
              const firstEliminatedAt = firstGeometricEliminationStep(pos, plannedOrder);
              if (firstEliminatedAt !== null && firstEliminatedAt < regionIndex) {
                possibleRegionIndexes.push(regionIndex);
              }
            }

            if (possibleRegionIndexes.length === 0) {
              valid = false;
              break;
            }

            const regionIndex = shuffle(possibleRegionIndexes, rng)[0];
            regions[regionIndex].push(pos);
            assigned.add(key);
          }
        }

        if (!valid) continue;

        const candidateRegions = regions.map((cells, id) => ({ id, cells }));
        const board = createEmptyBoard(n, candidateRegions.map(region => ({ id: region.id, cells: [...region.cells] })));
        const solverResult = solve(board);
        if (!solverResult.complete) continue;
        if (solverResult.totalSteps !== n + 1) continue;
        if (solverResult.batches[0]?.strategy !== 'L2_Lock2') continue;
        if (solverResult.batches.slice(1).some(batch => batch.strategy !== 'L1')) continue;

        const solved = applyBatchesUpTo(board, solverResult.batches, solverResult.totalSteps);
        if (!samePositionSet(getQueenPositions(solved), queens)) continue;

        return {
          regions: candidateRegions,
          queens,
          plannedOrder,
          solverResult,
        };
      }
    }
  }

  return null;
}

function assembleProjectLevel(
  n: number,
  targetSteps: number,
  seed: number,
  attempt: number,
  candidate: L1ChainCandidate,
): Level {
  const board = createEmptyBoard(n, candidate.regions.map(region => ({
    id: region.id,
    cells: [...region.cells],
  })));
  const solved = applyBatchesUpTo(board, candidate.solverResult.batches, candidate.solverResult.totalSteps);
  const openingStrategy = candidate.solverResult.batches[0]?.strategy ?? 'Solved';

  return {
    id: `P-${openingStrategy}-${n}x${n}-${seed}-${attempt}`,
    n,
    regions: candidate.regions,
    solution: getQueenPositions(solved),
    seed,
    targetSteps,
    actualSteps: candidate.solverResult.totalSteps,
    strategySequence: candidate.solverResult.batches.map(batch => batch.strategy),
    solverResult: candidate.solverResult,
  };
}

export function generateProjectL1ChainLevel(args: {
  n: number;
  targetSteps: number;
  seed: number;
  maxAttempts: number;
}): ProjectGenerationAttempt {
  if (args.targetSteps !== args.n) return { level: null, attempts: 0 };
  if (args.n < 6) return { level: null, attempts: 0 };

  for (let attempt = 0; attempt < args.maxAttempts; attempt++) {
    const rng = createRNG(args.seed + attempt * 104729);
    const candidate = tryBuildL1Chain(args.n, rng);
    if (!candidate) continue;
    return {
      level: assembleProjectLevel(args.n, args.targetSteps, args.seed, attempt + 1, candidate),
      attempts: attempt + 1,
    };
  }

  return { level: null, attempts: args.maxAttempts };
}

export function generateProjectLock1PrefixLevel(args: {
  n: number;
  targetSteps: number;
  seed: number;
  maxAttempts: number;
}): ProjectGenerationAttempt {
  const lockCount = args.targetSteps - args.n;
  if (lockCount < 1) return { level: null, attempts: 0 };
  if (args.n < 6) return { level: null, attempts: 0 };
  if (lockCount >= args.n) return { level: null, attempts: 0 };

  for (let attempt = 0; attempt < args.maxAttempts; attempt++) {
    const rng = createRNG(args.seed + attempt * 130363);
    const candidate = tryBuildLock1Prefix(args.n, lockCount, rng);
    if (!candidate) continue;
    return {
      level: assembleProjectLevel(args.n, args.targetSteps, args.seed, attempt + 1, candidate),
      attempts: attempt + 1,
    };
  }

  return { level: null, attempts: args.maxAttempts };
}

export function generateProjectInterleavedSingleLock1Level(args: {
  n: number;
  targetSteps: number;
  seed: number;
  maxAttempts: number;
}): ProjectGenerationAttempt {
  if (args.targetSteps !== args.n + 1) return { level: null, attempts: 0 };
  if (args.n < 6) return { level: null, attempts: 0 };

  for (let attempt = 0; attempt < args.maxAttempts; attempt++) {
    const rng = createRNG(args.seed + attempt * 170141);
    const candidate = tryBuildInterleavedSingleLock1(args.n, rng);
    if (!candidate) continue;
    return {
      level: assembleProjectLevel(args.n, args.targetSteps, args.seed, attempt + 1, candidate),
      attempts: attempt + 1,
    };
  }

  return { level: null, attempts: args.maxAttempts };
}

export function generateProjectInterleavedLock1BlocksLevel(args: {
  n: number;
  targetSteps: number;
  seed: number;
  maxAttempts: number;
}): ProjectGenerationAttempt {
  const lockCount = args.targetSteps - args.n;
  if (lockCount < 2) return { level: null, attempts: 0 };
  if (args.n < 6) return { level: null, attempts: 0 };
  if (1 + lockCount * 2 >= args.n) return { level: null, attempts: 0 };

  for (let attempt = 0; attempt < args.maxAttempts; attempt++) {
    const rng = createRNG(args.seed + attempt * 199999);
    const candidate = tryBuildInterleavedLock1Blocks(args.n, lockCount, rng);
    if (!candidate) continue;
    return {
      level: assembleProjectLevel(args.n, args.targetSteps, args.seed, attempt + 1, candidate),
      attempts: attempt + 1,
    };
  }

  return { level: null, attempts: args.maxAttempts };
}

export function generateProjectOpeningLock2Level(args: {
  n: number;
  targetSteps: number;
  seed: number;
  maxAttempts: number;
}): ProjectGenerationAttempt {
  if (args.targetSteps !== args.n + 1) return { level: null, attempts: 0 };
  if (args.n < 8) return { level: null, attempts: 0 };

  for (let attempt = 0; attempt < args.maxAttempts; attempt++) {
    const rng = createRNG(args.seed + attempt * 224737);
    const candidate = tryBuildOpeningLock2(args.n, rng);
    if (!candidate) continue;
    return {
      level: assembleProjectLevel(args.n, args.targetSteps, args.seed, attempt + 1, candidate),
      attempts: attempt + 1,
    };
  }

  return { level: null, attempts: args.maxAttempts };
}

export function generateProjectLevel(args: {
  n: number;
  targetSteps: number;
  seed: number;
  maxAttempts: number;
}): ProjectGenerationAttempt {
  const openingLock2 = generateProjectOpeningLock2Level(args);
  if (openingLock2.level) return openingLock2;

  const interleavedLock1 = generateProjectInterleavedSingleLock1Level(args);
  if (interleavedLock1.level) return interleavedLock1;

  const interleavedLock1Blocks = generateProjectInterleavedLock1BlocksLevel(args);
  if (interleavedLock1Blocks.level) return interleavedLock1Blocks;

  const lock1 = generateProjectLock1PrefixLevel(args);
  if (lock1.level) return lock1;
  return generateProjectL1ChainLevel(args);
}
