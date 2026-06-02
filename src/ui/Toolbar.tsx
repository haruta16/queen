import { useGameStore } from '../game/store';

export default function Toolbar({ onOpenGenerator }: { onOpenGenerator: () => void }) {
  const level = useGameStore(s => s.level);
  const board = useGameStore(s => s.board);
  const xHistory = useGameStore(s => s.xHistory);
  const redoStack = useGameStore(s => s.redoStack);
  const undoX = useGameStore(s => s.undoX);
  const redoX = useGameStore(s => s.redoX);
  const resetBoard = useGameStore(s => s.resetBoard);
  const solverPanelOpen = useGameStore(s => s.solverPanelOpen);
  const setSolverPanelOpen = useGameStore(s => s.setSolverPanelOpen);

  const hasLevel = !!(level && board);

  return (
    <div className="toolbar">
      <div className="toolbar-hint">
        <strong>单击</strong> 标记 X
        <span>·</span>
        <strong>双击</strong> 翻面确认
      </div>

      <div className="toolbar-divider" />

      <button
        className="toolbar-btn"
        onClick={undoX}
        disabled={!hasLevel || xHistory.length === 0}
      >
        ↩ 撤销
      </button>
      <button
        className="toolbar-btn"
        onClick={redoX}
        disabled={!hasLevel || redoStack.length === 0}
      >
        ↪ 重做
      </button>
      <button
        className="toolbar-btn"
        onClick={resetBoard}
        disabled={!hasLevel}
      >
        ↺ 重置
      </button>

      <div className="toolbar-divider" />

      <button
        className={`toolbar-btn ${solverPanelOpen ? 'active' : ''}`}
        onClick={() => setSolverPanelOpen(!solverPanelOpen)}
        disabled={!hasLevel}
      >
        🔍 求解器
      </button>
      <button
        className="toolbar-btn primary"
        onClick={onOpenGenerator}
      >
        ⚡ 生成器
      </button>
    </div>
  );
}
