import { useMemo, useState, useEffect, useRef, memo } from 'react';
import { useGameStore } from '../game/store';
import { findUniqueCandidates, isBoardComplete } from '../game/rules';
import { applyBatchesUpTo } from '../game/solver';
import type { BoardState, Position, UnitRef } from '../game/types';
import Cell from './Cell';

const REGION_COLORS = [
  '#D9435F', '#E8923A', '#D4B83D', '#47B86B', '#3BBFB6',
  '#3A9FCA', '#7B6CBF', '#D486A8', '#6AAAD4', '#B8A67E',
];

function inBounds(pos: Position, n: number): boolean {
  return pos.row >= 0 && pos.row < n && pos.col >= 0 && pos.col < n;
}

function forEachUnitCell(
  board: BoardState,
  unit: UnitRef,
  visit: (row: number, col: number) => void,
) {
  for (let row = 0; row < board.n; row++) {
    for (let col = 0; col < board.n; col++) {
      if (
        (unit.kind === 'row' && row === unit.index) ||
        (unit.kind === 'col' && col === unit.index) ||
        (unit.kind === 'region' && board.cells[row][col].regionId === unit.index)
      ) {
        visit(row, col);
      }
    }
  }
}

export default memo(function Board({ interactive = false }: { interactive?: boolean }) {
  const board = useGameStore(s => s.board);
  const level = useGameStore(s => s.level);
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const boardMode = useGameStore(s => s.boardMode);

  const n = board?.n ?? 0;

  const displayBoard = useMemo(() => {
    if (!board) return null;
    if (!solverResult || solverStepIndex === 0) return board;
    return applyBatchesUpTo(board, solverResult.batches, solverStepIndex);
  }, [board, solverResult, solverStepIndex]);

  // Single pass: compute all per-cell metadata once
  interface CellMeta {
    isUnique: boolean;
    isHighlight: boolean;
    isSource: boolean;
    isTargetUnit: boolean;
    isContradiction: boolean;
    isEvidenceX: boolean;
    isBranchResult: boolean;
    isMuted: boolean;
    label: 'x' | 'queen' | null;
    tempMark: 'assumption' | 'temp-queen' | 'temp-x' | null;
  }

  const cellMetas = useMemo(() => {
    if (!displayBoard || !level) return null;
    const nn = displayBoard.n;
    const metas: CellMeta[][] = Array.from({ length: nn }, () =>
      Array.from({ length: nn }, () => ({
        isUnique: false,
        isHighlight: false,
        isSource: false,
        isTargetUnit: false,
        isContradiction: false,
        isEvidenceX: false,
        isBranchResult: false,
        isMuted: false,
        label: null,
        tempMark: null,
      })),
    );

    if (boardMode === 'hints') {
      const uniq = findUniqueCandidates(displayBoard);
      for (const u of uniq) {
        if (inBounds(u, nn)) metas[u.row][u.col].isUnique = true;
      }
    }

    // solver highlights — only in hints mode with a valid current batch
    if (boardMode !== 'hints' || !solverResult || solverStepIndex <= 0) return metas;

    const batch = solverResult.batches[solverStepIndex - 1];
    if (!batch) return metas;

    // step results
    for (const x of batch.eliminations) {
      if (inBounds(x, nn)) {
        metas[x.row][x.col].isHighlight = true;
        metas[x.row][x.col].label = 'x';
      }
    }
    for (const q of batch.queenConfirmed) {
      if (inBounds(q, nn)) {
        metas[q.row][q.col].isHighlight = true;
        metas[q.row][q.col].label = 'queen';
      }
    }

    const reason = batch.reason;
    if (!reason) return metas;

    // source candidates
    const sc = [
      ...(reason.sourceCandidates ?? []),
      ...(reason.remainingCandidates ?? []),
      ...(reason.assumptionCells ?? []),
      ...(reason.rejectedAssumptions ?? []),
    ];
    if (sc) for (const p of sc) {
      if (inBounds(p, nn)) metas[p.row][p.col].isSource = true;
    }

    for (const p of [...(reason.commonExcludedCells ?? []), ...(reason.commonConfirmedCells ?? [])]) {
      if (inBounds(p, nn)) metas[p.row][p.col].isBranchResult = true;
    }

    // target units
    const targets = reason.targetUnits ?? (reason.targetUnit ? [reason.targetUnit] : []);
    for (const u of targets) {
      forEachUnitCell(displayBoard, u, (r, c) => { metas[r][c].isTargetUnit = true; });
    }

    // contradiction
    if (reason.contradiction?.unit) {
      forEachUnitCell(displayBoard, reason.contradiction.unit, (r, c) => { metas[r][c].isContradiction = true; });
    }
    for (const p of [...(reason.contradiction?.cells ?? []), ...(reason.contradiction?.candidateCells ?? [])]) {
      if (inBounds(p, nn)) metas[p.row][p.col].isContradiction = true;
    }
    if (reason.contradictionType && reason.assumptionCell && inBounds(reason.assumptionCell, nn)) {
      metas[reason.assumptionCell.row][reason.assumptionCell.col].isContradiction = true;
    }

    // temporary trace marks
    const traceMarks = reason.trace ?? reason.branches?.find(branch => branch.trace?.length)?.trace ?? [];
    const markRank = { 'temp-x': 1, 'temp-queen': 2, assumption: 3 } as const;
    for (const mark of traceMarks) {
      if (!inBounds(mark.pos, nn)) continue;
      const current = metas[mark.pos.row][mark.pos.col].tempMark;
      if (!current || markRank[mark.mark] >= markRank[current]) {
        metas[mark.pos.row][mark.pos.col].tempMark = mark.mark;
      }
    }
    for (const p of reason.rejectedAssumptions ?? []) {
      if (inBounds(p, nn)) metas[p.row][p.col].tempMark = 'assumption';
    }

    // evidence X
    const sources = [
      ...(reason.sourceUnits ?? (reason.sourceUnit ? [reason.sourceUnit] : [])),
      ...(reason.unit ? [reason.unit] : []),
      ...(reason.contradiction?.unit ? [reason.contradiction.unit] : []),
      ...(reason.contradiction?.sourceUnits ?? []),
    ];
    const elimKeys = new Set(batch.eliminations.map(e => `${e.row},${e.col}`));
    const queenKeys = new Set(batch.queenConfirmed.map(q => `${q.row},${q.col}`));
    for (const u of sources) {
      forEachUnitCell(displayBoard, u, (r, c) => {
        if (!displayBoard.cells[r][c].isX) return;
        if (elimKeys.has(`${r},${c}`) || queenKeys.has(`${r},${c}`)) return;
        metas[r][c].isEvidenceX = true;
      });
    }

    // step-muted: everything that wasn't touched by any of the above
    for (let r = 0; r < nn; r++) {
      for (let c = 0; c < nn; c++) {
        const m = metas[r][c];
        if (!m.isHighlight && !m.isSource && !m.isTargetUnit && !m.isContradiction && !m.isEvidenceX && !m.isBranchResult && !m.tempMark) {
          m.isMuted = true;
        }
      }
    }

    return metas;
  }, [displayBoard, boardMode, solverResult, solverStepIndex]);

  // Region borders
  const regionBorders = useMemo(() => {
    if (!displayBoard) return null;
    const nn = displayBoard.n;
    const borders = Array.from({ length: nn }, () =>
      Array.from({ length: nn }, () => ({ top: false, right: false, bottom: false, left: false })),
    );
    for (let r = 0; r < nn; r++) {
      for (let c = 0; c < nn; c++) {
        const rid = displayBoard.cells[r][c].regionId;
        if (r === 0 || displayBoard.cells[r - 1][c].regionId !== rid) borders[r][c].top = true;
        if (r === nn - 1 || displayBoard.cells[r + 1][c].regionId !== rid) borders[r][c].bottom = true;
        if (c === 0 || displayBoard.cells[r][c - 1].regionId !== rid) borders[r][c].left = true;
        if (c === nn - 1 || displayBoard.cells[r][c + 1].regionId !== rid) borders[r][c].right = true;
      }
    }
    return borders;
  }, [displayBoard]);

  const isComplete = useMemo(() => {
    if (!displayBoard) return false;
    return isBoardComplete(displayBoard);
  }, [displayBoard]);

  const [showCelebration, setShowCelebration] = useState(false);
  const prevCompleteRef = useRef(false);

  useEffect(() => {
    if (isComplete && !prevCompleteRef.current) {
      setShowCelebration(true);
      const timer = setTimeout(() => setShowCelebration(false), 2000);
      prevCompleteRef.current = true;
      return () => clearTimeout(timer);
    }
    if (!isComplete) {
      prevCompleteRef.current = false;
    }
  }, [isComplete]);

  if (!board || !level || !displayBoard) {
    return (
      <div className="placeholder">
        <div className="placeholder-icon">♛</div>
        <div className="placeholder-text">点击「生成」创建新关卡</div>
      </div>
    );
  }

  return (
    <>
      {showCelebration && <div className="celebration-overlay" />}
      <div
        className={`board-grid${isComplete ? ' board-complete' : ''}`}
        style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
      >
        {Array.from({ length: n }, (_, r) =>
          Array.from({ length: n }, (_, c) => {
            const cell = displayBoard.cells[r][c];
            const key = `${r},${c}`;
            const meta = cellMetas?.[r]?.[c];
            return (
              <Cell
                key={key}
                row={r}
                col={c}
                regionId={cell.regionId}
                isQueen={cell.isQueen}
                isX={cell.isX}
                isWrong={cell.isWrong}
                color={level.paletteRgb?.[cell.regionId]
                  ? `rgb(${level.paletteRgb[cell.regionId].join(',')})`
                  : REGION_COLORS[cell.regionId % REGION_COLORS.length]}
                isUniqueCandidate={meta?.isUnique ?? false}
                isSolverHighlight={meta?.isHighlight ?? false}
                isSourceHighlight={meta?.isSource ?? false}
                isTargetUnitHighlight={meta?.isTargetUnit ?? false}
                isContradictionHighlight={meta?.isContradiction ?? false}
                isEvidenceX={meta?.isEvidenceX ?? false}
                isBranchResult={meta?.isBranchResult ?? false}
                isStepMuted={meta?.isMuted ?? false}
                stepResultLabel={meta?.label ?? null}
                tempMark={meta?.tempMark ?? null}
                borders={regionBorders?.[r]?.[c] ?? { top: false, right: false, bottom: false, left: false }}
                interactive={interactive}
              />
            );
          }),
        )}
      </div>
    </>
  );
});
