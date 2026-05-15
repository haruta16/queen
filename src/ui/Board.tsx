import { useMemo, useState, useEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import { applyBatchesUpTo } from '../game/solver';
import { findUniqueCandidates, createEmptyBoard, isBoardComplete } from '../game/rules';
import Cell from './Cell';

const REGION_COLORS = [
  '#D9435F', '#E8923A', '#D4B83D', '#47B86B', '#3BBFB6',
  '#3A9FCA', '#7B6CBF', '#D486A8', '#6AAAD4', '#B8A67E',
];

function getCellSize(n: number): number {
  const boardChrome = window.innerWidth <= 760 ? 46 : 74;
  const vhSize = Math.floor((window.innerHeight * 0.62 - boardChrome) / n);
  const vwSize = Math.floor((window.innerWidth * 0.92 - boardChrome) / n);
  const minSize = window.innerWidth <= 420 ? 24 : 34;
  return Math.max(minSize, Math.min(vhSize, vwSize, 68));
}

interface CellBorders {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

function computeRegionBorders(displayBoard: { n: number; cells: { regionId: number }[][] }): CellBorders[][] {
  const n = displayBoard.n;
  const borders: CellBorders[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => ({ top: false, right: false, bottom: false, left: false }))
  );

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const rid = displayBoard.cells[r][c].regionId;
      if (r === 0 || displayBoard.cells[r - 1][c].regionId !== rid) borders[r][c].top = true;
      if (r === n - 1 || displayBoard.cells[r + 1][c].regionId !== rid) borders[r][c].bottom = true;
      if (c === 0 || displayBoard.cells[r][c - 1].regionId !== rid) borders[r][c].left = true;
      if (c === n - 1 || displayBoard.cells[r][c + 1].regionId !== rid) borders[r][c].right = true;
    }
  }

  return borders;
}

export default function Board() {
  const board = useGameStore(s => s.board);
  const level = useGameStore(s => s.level);
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);

  const n = board?.n ?? 0;

  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick(t => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cellSize = n > 0 ? getCellSize(n) : 48;

  const displayBoard = useMemo(() => {
    if (!board || !level) return null;
    if (solverResult && solverStepIndex > 0) {
      const emptyBoard = createEmptyBoard(level.n, level.regions);
      return applyBatchesUpTo(emptyBoard, solverResult.batches, solverStepIndex);
    }
    return board;
  }, [board, level, solverResult, solverStepIndex]);

  const uniqueCandidates = useMemo(() => {
    if (!displayBoard) return new Set<string>();
    const uniq = findUniqueCandidates(displayBoard);
    return new Set(uniq.map(u => `${u.row},${u.col}`));
  }, [displayBoard]);

  const solverHighlights = useMemo(() => {
    if (!solverResult || solverStepIndex <= 0) return new Set<string>();
    const batch = solverResult.batches[solverStepIndex - 1];
    if (!batch) return new Set<string>();
    const set = new Set<string>();
    for (const x of batch.eliminations) set.add(`${x.row},${x.col}`);
    for (const q of batch.queenConfirmed) set.add(`${q.row},${q.col}`);
    return set;
  }, [solverResult, solverStepIndex]);

  const regionBorders = useMemo(() => {
    if (!displayBoard) return null;
    return computeRegionBorders(displayBoard);
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

  if (!board || !level) {
    return (
      <div className="placeholder">
        <div className="placeholder-icon">♛</div>
        <div className="placeholder-text">点击下方「⚡ 生成」创建新关卡</div>
      </div>
    );
  }

  const defaultBorders = { top: false, right: false, bottom: false, left: false };
  const isPreviewingSolver = !!solverResult && solverStepIndex > 0;

  return (
    <div className="board-container">
      {showCelebration && <div className="celebration-overlay" />}
      <div
        className={`board-grid ${isComplete ? 'board-complete' : ''}`}
        style={{
          gridTemplateColumns: `repeat(${n}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${n}, ${cellSize}px)`,
        }}
      >
        {Array.from({ length: n }, (_, r) =>
          Array.from({ length: n }, (_, c) => {
            const cell = displayBoard!.cells[r][c];
            const key = `${r},${c}`;
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
                size={cellSize}
                isUniqueCandidate={!isPreviewingSolver && uniqueCandidates.has(key)}
                isSolverHighlight={solverHighlights.has(key)}
                borders={regionBorders?.[r]?.[c] ?? defaultBorders}
                interactive={!isPreviewingSolver}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
