import { useMemo, useState, useEffect, useRef, memo } from 'react';
import { useGameStore } from '../game/store';
import { findUniqueCandidates, isBoardComplete } from '../game/rules';
import Cell from './Cell';

const REGION_COLORS = [
  '#D9435F', '#E8923A', '#D4B83D', '#47B86B', '#3BBFB6',
  '#3A9FCA', '#7B6CBF', '#D486A8', '#6AAAD4', '#B8A67E',
];

export default memo(function Board() {
  const board = useGameStore(s => s.board);
  const level = useGameStore(s => s.level);
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const boardMode = useGameStore(s => s.boardMode);

  const n = board?.n ?? 0;

  // Always use the real player board as the data source.
  // In replay mode, solver highlights are overlaid via cellMetas — the board itself is never replaced.
  const displayBoard = board;

  // Single pass: compute all per-cell metadata once
  interface CellMeta {
    isUnique: boolean;
    isHighlight: boolean;
    isSource: boolean;
    isTargetUnit: boolean;
    isContradiction: boolean;
    isEvidenceX: boolean;
    isMuted: boolean;
    label: 'x' | 'queen' | null;
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
        isMuted: false,
        label: null,
      })),
    );

    // unique candidates (cheap, always computed)
    const uniq = findUniqueCandidates(displayBoard);
    for (const u of uniq) {
      if (u.row >= 0 && u.row < nn && u.col >= 0 && u.col < nn) {
        metas[u.row][u.col].isUnique = true;
      }
    }

    // solver highlights — only in hints mode with a valid current batch
    if (boardMode !== 'hints' || !solverResult || solverStepIndex <= 0) return metas;

    const batch = solverResult.batches[solverStepIndex - 1];
    if (!batch) return metas;

    // step results
    for (const x of batch.eliminations) {
      if (x.row >= 0 && x.row < nn && x.col >= 0 && x.col < nn) {
        metas[x.row][x.col].isHighlight = true;
        metas[x.row][x.col].label = 'x';
      }
    }
    for (const q of batch.queenConfirmed) {
      if (q.row >= 0 && q.row < nn && q.col >= 0 && q.col < nn) {
        metas[q.row][q.col].isHighlight = true;
        metas[q.row][q.col].label = 'queen';
      }
    }

    const reason = batch.reason;
    if (!reason) return metas;

    // source candidates
    const sc = reason.sourceCandidates ?? reason.remainingCandidates;
    if (sc) for (const p of sc) {
      if (p.row >= 0 && p.row < nn && p.col >= 0 && p.col < nn) metas[p.row][p.col].isSource = true;
    }

    // target units
    const targets = reason.targetUnits ?? (reason.targetUnit ? [reason.targetUnit] : []);
    for (const u of targets) {
      for (let r = 0; r < nn; r++) {
        for (let c = 0; c < nn; c++) {
          if ((u.kind === 'row' && r === u.index) ||
              (u.kind === 'col' && c === u.index) ||
              (u.kind === 'region' && displayBoard.cells[r][c].regionId === u.index)) {
            metas[r][c].isTargetUnit = true;
          }
        }
      }
    }

    // contradiction
    if (reason.contradictionType && reason.assumptionCell) {
      const a = reason.assumptionCell;
      if (a.row >= 0 && a.row < nn && a.col >= 0 && a.col < nn) metas[a.row][a.col].isContradiction = true;
    }

    // evidence X
    const sources = reason.sourceUnits ?? (reason.sourceUnit ? [reason.sourceUnit] : []);
    const elimKeys = new Set(batch.eliminations.map(e => `${e.row},${e.col}`));
    const queenKeys = new Set(batch.queenConfirmed.map(q => `${q.row},${q.col}`));
    for (const u of sources) {
      for (let r = 0; r < nn; r++) {
        for (let c = 0; c < nn; c++) {
          if (!displayBoard.cells[r][c].isX) continue;
          if (elimKeys.has(`${r},${c}`) || queenKeys.has(`${r},${c}`)) continue;
          if ((u.kind === 'row' && r === u.index) ||
              (u.kind === 'col' && c === u.index) ||
              (u.kind === 'region' && displayBoard.cells[r][c].regionId === u.index)) {
            metas[r][c].isEvidenceX = true;
          }
        }
      }
    }

    // step-muted: everything that wasn't touched by any of the above
    for (let r = 0; r < nn; r++) {
      for (let c = 0; c < nn; c++) {
        const m = metas[r][c];
        if (!m.isHighlight && !m.isSource && !m.isTargetUnit && !m.isContradiction && !m.isEvidenceX) {
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
                color={REGION_COLORS[cell.regionId % REGION_COLORS.length]}
                isUniqueCandidate={meta?.isUnique ?? false}
                isSolverHighlight={meta?.isHighlight ?? false}
                isSourceHighlight={meta?.isSource ?? false}
                isTargetUnitHighlight={meta?.isTargetUnit ?? false}
                isContradictionHighlight={meta?.isContradiction ?? false}
                isEvidenceX={meta?.isEvidenceX ?? false}
                isStepMuted={meta?.isMuted ?? false}
                stepResultLabel={meta?.label ?? null}
                borders={regionBorders?.[r]?.[c] ?? { top: false, right: false, bottom: false, left: false }}
              />
            );
          }),
        )}
      </div>
    </>
  );
});
