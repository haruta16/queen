import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../game/store';

interface CellProps {
  row: number;
  col: number;
  regionId: number;
  isQueen: boolean;
  isX: boolean;
  isWrong: boolean;
  color: string;
  isUniqueCandidate: boolean;
  isSolverHighlight: boolean;
  isSourceHighlight: boolean;
  isTargetUnitHighlight: boolean;
  isContradictionHighlight: boolean;
  isEvidenceX: boolean;
  isStepMuted: boolean;
  stepResultLabel: 'x' | 'queen' | null;
  borders: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

function areEqual(prev: CellProps, next: CellProps) {
  return (
    prev.row === next.row &&
    prev.col === next.col &&
    prev.isQueen === next.isQueen &&
    prev.isX === next.isX &&
    prev.isWrong === next.isWrong &&
    prev.isUniqueCandidate === next.isUniqueCandidate &&
    prev.isSolverHighlight === next.isSolverHighlight &&
    prev.isSourceHighlight === next.isSourceHighlight &&
    prev.isTargetUnitHighlight === next.isTargetUnitHighlight &&
    prev.isContradictionHighlight === next.isContradictionHighlight &&
    prev.isEvidenceX === next.isEvidenceX &&
    prev.isStepMuted === next.isStepMuted &&
    prev.stepResultLabel === next.stepResultLabel &&
    prev.color === next.color &&
    prev.borders.top === next.borders.top &&
    prev.borders.right === next.borders.right &&
    prev.borders.bottom === next.borders.bottom &&
    prev.borders.left === next.borders.left
  );
}

function CellComponent({
  row, col, isQueen, isX, isWrong, color,
  isUniqueCandidate, isSolverHighlight,
  isSourceHighlight, isTargetUnitHighlight, isContradictionHighlight,
  isEvidenceX, isStepMuted, stepResultLabel,
  borders,
}: CellProps) {
  const [animClass, setAnimClass] = useState('');
  const toggleX = useGameStore(s => s.toggleX);
  const confirmQueen = useGameStore(s => s.confirmQueen);
  const prevIsX = useRef(isX);
  const prevIsQueen = useRef(isQueen);
  const prevIsWrong = useRef(isWrong);

  useEffect(() => {
    if (isX && !prevIsX.current) {
      setAnimClass('cell-anim-x');
      const timer = setTimeout(() => setAnimClass(''), 300);
      prevIsX.current = isX;
      return () => clearTimeout(timer);
    }
    prevIsX.current = isX;
  }, [isX]);

  useEffect(() => {
    if (isQueen && !prevIsQueen.current) {
      setAnimClass('cell-anim-queen');
      const timer = setTimeout(() => setAnimClass(''), 400);
      prevIsQueen.current = isQueen;
      return () => clearTimeout(timer);
    }
    prevIsQueen.current = isQueen;
  }, [isQueen]);

  useEffect(() => {
    if (isWrong && !prevIsWrong.current) {
      setAnimClass('cell-anim-error');
      const timer = setTimeout(() => setAnimClass(''), 360);
      prevIsWrong.current = isWrong;
      return () => clearTimeout(timer);
    }
    prevIsWrong.current = isWrong;
  }, [isWrong]);

  const handleClick = useCallback(() => { toggleX(row, col); }, [row, col, toggleX]);
  const handleDoubleClick = useCallback(() => {
    const err = confirmQueen(row, col);
    if (err) { setAnimClass('cell-anim-error'); setTimeout(() => setAnimClass(''), 360); }
  }, [row, col, confirmQueen]);

  // Build className with all highlights
  let cls = 'cell';
  if (isQueen) cls += ' is-queen';
  else {
    if (isX) cls += ' is-x';
    if (isWrong) cls += ' is-wrong';
  }
  if (isUniqueCandidate && !isQueen && !isX) cls += ' is-unique-candidate';
  if (isSolverHighlight) cls += ' current';
  if (stepResultLabel === 'x') cls += ' current-x';
  if (stepResultLabel === 'queen') cls += ' current-cat';
  if (isSourceHighlight) cls += ' source';
  if (isTargetUnitHighlight) cls += ' target-unit';
  if (isContradictionHighlight) cls += ' contradiction';
  if (isEvidenceX) cls += ' evidence-x';
  if (isStepMuted) cls += ' step-muted';
  if (animClass) cls += ` ${animClass}`;

  const regionBorder = '2px solid rgba(36, 33, 42, 0.34)';
  const style: React.CSSProperties = {
    background: color,
    borderTop: borders.top ? regionBorder : '0 none',
    borderRight: borders.right ? regionBorder : '0 none',
    borderBottom: borders.bottom ? regionBorder : '0 none',
    borderLeft: borders.left ? regionBorder : '0 none',
  };

  return (
    <div className={cls} style={style} onClick={handleClick} onDoubleClick={handleDoubleClick}>
      {/* Queen mark: solid circle (dogku style) */}
      {isQueen && <span className="mark cat" />}
      {/* X mark: two crossed lines */}
      {(isX || isWrong) && !isQueen && <span className="mark x" />}
      {/* wrong X mark: additional dashed styling via wrong class */}
    </div>
  );
}

export default memo(CellComponent, areEqual);
