import { useGameStore } from '../game/store';
import { getQueenPositions } from '../game/rules';

export default function Hud() {
  const level = useGameStore(s => s.level);
  const board = useGameStore(s => s.board);

  if (!level || !board) return null;

  const queensPlaced = getQueenPositions(board).length;
  const { n } = board;
  const wrongCount = board.cells.flat().filter(cell => cell.isWrong).length;

  return (
    <div className="hud">
      <div className="hud-item">
        棋盘
        <span className="hud-value">{n}×{n}</span>
      </div>
      <div className="hud-item">
        策略步
        <span className="hud-value">{level.actualSteps}/{level.targetSteps}</span>
      </div>
      <div className="hud-item">
        Queen
        <span className="hud-value">{queensPlaced}/{n}</span>
      </div>
      <div className="hud-item">
        红 X
        <span className="hud-value" style={{ color: wrongCount > 0 ? 'var(--danger)' : undefined }}>
          {wrongCount}
        </span>
      </div>
    </div>
  );
}
