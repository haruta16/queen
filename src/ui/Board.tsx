import { useMemo, useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../game/store';
import { applyBatchesUpTo } from '../game/solver';
import { findUniqueCandidates } from '../game/rules';
import Cell from './Cell';

const REGION_COLORS = [
  '#E84D5B', '#F4A261', '#F9E076', '#6BCB77', '#4ECDC4',
  '#45B7D1', '#8B7FC7', '#E8A0BF', '#A0C8F0', '#C9B99A',
];

function getCellSize(n: number): number {
  const vhSize = Math.floor((window.innerHeight * 0.78) / n);
  const vwSize = Math.floor((window.innerWidth * 0.88) / n);
  return Math.max(28, Math.min(vhSize, vwSize, 64));
}

export default function Board() {
  const board = useGameStore(s => s.board);
  const level = useGameStore(s => s.level);
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);

  const n = board?.n ?? 0;

  // Responsive cell size
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick(t => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cellSize = n > 0 ? getCellSize(n) : 48;

  // Compute the board state to display (considering solver step)
  const displayBoard = useMemo(() => {
    if (!board) return null;
    if (solverResult && solverStepIndex > 0) {
      return applyBatchesUpTo(board, solverResult.batches, solverStepIndex);
    }
    return board;
  }, [board, solverResult, solverStepIndex]);

  // Find unique candidates for highlighting
  const uniqueCandidates = useMemo(() => {
    if (!displayBoard) return new Set<string>();
    const uniq = findUniqueCandidates(displayBoard);
    return new Set(uniq.map(u => `${u.row},${u.col}`));
  }, [displayBoard]);

  // Get solver-highlighted cells
  const solverHighlights = useMemo(() => {
    if (!solverResult || solverStepIndex <= 0) return new Set<string>();
    const batch = solverResult.batches[solverStepIndex - 1];
    if (!batch) return new Set<string>();
    const set = new Set<string>();
    for (const x of batch.eliminations) set.add(`${x.row},${x.col}`);
    for (const q of batch.queenConfirmed) set.add(`${q.row},${q.col}`);
    return set;
  }, [solverResult, solverStepIndex]);

  if (!board || !level) {
    return (
      <div className="placeholder">
        点击「生成」创建新关卡
      </div>
    );
  }

  return (
    <div className="board-container">
      <div
        className="board-grid"
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
                color={REGION_COLORS[cell.regionId % REGION_COLORS.length]}
                size={cellSize}
                isUniqueCandidate={uniqueCandidates.has(key)}
                isSolverHighlight={solverHighlights.has(key)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
