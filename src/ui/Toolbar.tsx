import { useGameStore } from '../game/store';

export default function Toolbar() {
  const level = useGameStore(s => s.level);
  const board = useGameStore(s => s.board);
  const mode = useGameStore(s => s.mode);
  const setMode = useGameStore(s => s.setMode);
  const xHistory = useGameStore(s => s.xHistory);
  const redoStack = useGameStore(s => s.redoStack);
  const undoX = useGameStore(s => s.undoX);
  const redoX = useGameStore(s => s.redoX);
  const resetBoard = useGameStore(s => s.resetBoard);
  const requestSolve = useGameStore(s => s.requestSolve);
  const solverPanelOpen = useGameStore(s => s.solverPanelOpen);
  const setSolverPanelOpen = useGameStore(s => s.setSolverPanelOpen);
  const generatorPanelOpen = useGameStore(s => s.generatorPanelOpen);
  const setGeneratorPanelOpen = useGameStore(s => s.setGeneratorPanelOpen);

  if (!level || !board) return null;

  return (
    <div className="toolbar">
      <button
        className={`toolbar-btn ${mode === 'markX' ? 'active' : ''}`}
        onClick={() => setMode('markX')}
      >
        ✕ 标记
      </button>
      <button
        className={`toolbar-btn ${mode === 'confirmQueen' ? 'active' : ''}`}
        onClick={() => setMode('confirmQueen')}
      >
        ♛ 确认
      </button>

      <div className="toolbar-divider" />

      <button
        className="toolbar-btn"
        onClick={undoX}
        disabled={xHistory.length === 0}
      >
        ↩ 撤销
      </button>
      <button
        className="toolbar-btn"
        onClick={redoX}
        disabled={redoStack.length === 0}
      >
        ↪ 重做
      </button>
      <button
        className="toolbar-btn"
        onClick={resetBoard}
      >
        ↺ 重置
      </button>

      <div className="toolbar-divider" />

      <button
        className={`toolbar-btn ${solverPanelOpen ? 'active' : ''}`}
        onClick={() => setSolverPanelOpen(!solverPanelOpen)}
      >
        🔍 求解器
      </button>
      <button
        className={`toolbar-btn primary ${generatorPanelOpen ? 'active' : ''}`}
        onClick={() => setGeneratorPanelOpen(!generatorPanelOpen)}
      >
        ⚡ 生成
      </button>
    </div>
  );
}
