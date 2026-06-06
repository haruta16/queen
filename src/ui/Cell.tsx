import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../game/store';

interface CellBorders {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

interface CellProps {
  row: number;
  col: number;
  regionId: number;
  isQueen: boolean;
  isX: boolean;
  isWrong: boolean;
  color: string;
  size: number;
  isUniqueCandidate: boolean;
  isSolverHighlight: boolean;
  borders: CellBorders;
}

function CellComponent({
  row, col, isQueen, isX, isWrong, color, size,
  isUniqueCandidate, isSolverHighlight, borders,
}: CellProps) {
  const [animClass, setAnimClass] = useState('');
  const toggleX = useGameStore(s => s.toggleX);
  const confirmQueen = useGameStore(s => s.confirmQueen);
  const prevIsX = useRef(isX);
  const prevIsQueen = useRef(isQueen);
  const prevIsWrong = useRef(isWrong);

  useEffect(() => {
    if (isX && !prevIsX.current) {
      setAnimClass('is-x-mark');
      const timer = setTimeout(() => setAnimClass(''), 300);
      prevIsX.current = isX;
      return () => clearTimeout(timer);
    }
    prevIsX.current = isX;
  }, [isX]);

  useEffect(() => {
    if (isQueen && !prevIsQueen.current) {
      setAnimClass('is-queen-highlight');
      const timer = setTimeout(() => setAnimClass(''), 400);
      prevIsQueen.current = isQueen;
      return () => clearTimeout(timer);
    }
    prevIsQueen.current = isQueen;
  }, [isQueen]);

  const handleClick = useCallback(() => {
    toggleX(row, col);
  }, [row, col, toggleX]);

  useEffect(() => {
    if (isWrong && !prevIsWrong.current) {
      setAnimClass('is-error');
      const timer = setTimeout(() => setAnimClass(''), 360);
      prevIsWrong.current = isWrong;
      return () => clearTimeout(timer);
    }
    prevIsWrong.current = isWrong;
  }, [isWrong]);

  const handleDoubleClick = useCallback(() => {
    const error = confirmQueen(row, col);
    if (error) {
      setAnimClass('is-error');
      setTimeout(() => setAnimClass(''), 360);
    }
  }, [row, col, confirmQueen]);

  let className = 'cell';
  if (isQueen) className += ' is-queen';
  if (isX && !isQueen) className += ' is-x';
  if (isWrong && !isQueen) className += ' is-wrong';
  if (isUniqueCandidate && !isQueen && !isX) className += ' is-unique-candidate';
  if (isSolverHighlight) className += ' is-solver-highlight';
  if (animClass) className += ` ${animClass}`;

  const regionBorder = '2px solid rgba(23,23,23,0.38)';

  const style: React.CSSProperties = {
    width: size,
    height: size,
    background: color,
    borderTop: borders.top ? regionBorder : '0 none',
    borderRight: borders.right ? regionBorder : '0 none',
    borderBottom: borders.bottom ? regionBorder : '0 none',
    borderLeft: borders.left ? regionBorder : '0 none',
  };

  return (
    <div className={className} style={style} onClick={handleClick} onDoubleClick={handleDoubleClick}>
      {isQueen && <span className="queen-icon" style={{ fontSize: Math.round(size * 0.55) }}>♛</span>}
      {isX && !isQueen && !isWrong && <span className="x-icon">✕</span>}
      {isWrong && !isQueen && <span className="wrong-icon">✕</span>}
    </div>
  );
}

export default memo(CellComponent);
