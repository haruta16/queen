import { useGameStore } from '../game/store';
import { getQueenPositions } from '../game/rules';

export default function Hud() {
  const level = useGameStore(s => s.level);
  const board = useGameStore(s => s.board);
  const mode = useGameStore(s => s.mode);

  if (!level || !board) return null;

  const queensPlaced = getQueenPositions(board).length;
  const { n } = board;

  return (
    <div className="hud">
      <div className="hud-item">
        棋盘
        <span className="hud-value">{n}×{n}</span>
      </div>
      <div className="hud-item">
        步骤
        <span className="hud-value">{level.actualSteps}</span>
      </div>
      <div className="hud-item">
        Queen
        <span className="hud-value">{queensPlaced}/{n}</span>
      </div>
      <div className="hud-item">
        模式
        <span className="hud-value" style={{ color: mode === 'confirmQueen' ? '#FFD700' : undefined }}>
          {mode === 'markX' ? '标记 X' : '确认 Queen'}
        </span>
      </div>
    </div>
  );
}
