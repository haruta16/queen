import { memo, useState, useCallback } from 'react';
import { useGameStore } from '../game/store';

interface CellProps {
  row: number;
  col: number;
  regionId: number;
  isQueen: boolean;
  isX: boolean;
  color: string;
  size: number;
  isUniqueCandidate: boolean;
  isSolverHighlight: boolean;
}

const QueenIcon = () => <span className="queen-icon">♛</span>;

function CellComponent({
  row, col, isQueen, isX, color, size,
  isUniqueCandidate, isSolverHighlight,
}: CellProps) {
  const [animClass, setAnimClass] = useState('');
  const toggleX = useGameStore(s => s.toggleX);
  const mode = useGameStore(s => s.mode);

  const handleClick = useCallback(() => {
    if (isQueen) return;
    toggleX(row, col);
  }, [row, col, isQueen, toggleX]);

  let className = 'cell';
  if (isQueen) className += ' is-queen';
  if (isX && !isQueen) className += ' is-x';
  if (isUniqueCandidate && !isQueen && !isX) className += ' is-unique-candidate';
  if (isSolverHighlight) className += ' is-solver-highlight';
  if (animClass) className += ` ${animClass}`;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        background: isQueen ? undefined : color,
      }}
      onClick={handleClick}
    >
      {isQueen && <QueenIcon />}
    </div>
  );
}

export default memo(CellComponent);
