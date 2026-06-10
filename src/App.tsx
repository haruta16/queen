import { useEffect, useState } from 'react';
import { useGameStore } from './game/store';
import Board from './ui/Board';
import SolverPanel from './ui/SolverPanel';
import GeneratorPanel from './ui/GeneratorPanel';

type AppMode = 'replay' | 'generator';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('replay');

  const message = useGameStore(s => s.message);
  const messageType = useGameStore(s => s.messageType);
  const clearMessage = useGameStore(s => s.clearMessage);
  const level = useGameStore(s => s.level);
  const board = useGameStore(s => s.board);
  const requestGenerate = useGameStore(s => s.requestGenerate);
  const loadLevel = useGameStore(s => s.loadLevel);
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const setSolverStep = useGameStore(s => s.setSolverStep);
  const boardMode = useGameStore(s => s.boardMode);
  const setBoardMode = useGameStore(s => s.setBoardMode);
  const undoX = useGameStore(s => s.undoX);
  const redoX = useGameStore(s => s.redoX);
  const resetBoard = useGameStore(s => s.resetBoard);
  const xHistory = useGameStore(s => s.xHistory);
  const redoStack = useGameStore(s => s.redoStack);

  useEffect(() => {
    if (!level) {
      requestGenerate({
        n: 6,
        targetSteps: 6,
        seed: 20260515,
        maxAttempts: 2500,
        allowApproximate: true,
      }).then(result => {
        if (result.level) loadLevel(result.level);
      });
    }
  }, [level, requestGenerate, loadLevel]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clearMessage, 3000);
    return () => clearTimeout(timer);
  }, [message, clearMessage]);

  const n = level?.n ?? 6;
  const hasLevel = !!(level && board && solverResult);
  const showGenerator = appMode === 'generator';
  const showReplay = appMode === 'replay' && hasLevel;
  const showLoading = appMode === 'replay' && !hasLevel;
  const totalSteps = solverResult?.totalSteps ?? 0;
  const currentBatch = solverResult && solverStepIndex > 0 ? solverResult.batches[solverStepIndex - 1] : null;
  const sourceLabel = level?.source === 'imported-image'
    ? '截图导入'
    : level?.source === 'imported-json'
      ? 'JSON 导入'
      : '生成关卡';

  const resetReplay = () => {
    resetBoard();
    setSolverStep(0);
    setBoardMode('hints');
  };

  const boardNode = hasLevel && (
    <div className="board-wrap">
      <Board interactive />
    </div>
  );

  return (
    <main className="app-shell">
      {showGenerator && (
        <GeneratorPanel onEnterReplay={() => setAppMode('replay')} />
      )}

      {showLoading && (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">皇后消元</p>
              <h1>推理回放</h1>
              <p className="hero-copy">生成或导入一个棋盘后，按步骤查看 Queen 的完整推理过程。</p>
            </div>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => setAppMode('generator')}>生成 / 导入</button>
            </div>
          </header>
          <div className="placeholder" style={{ marginTop: 80 }}>
            <span className="spinner" /><span>正在装配默认回放棋盘...</span>
          </div>
        </>
      )}

      {showReplay && (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">皇后消元 · {sourceLabel} · {n}×{n}</p>
              <h1>推理回放</h1>
              <p className="hero-copy">单击画 X，双击确认 Queen。每次操作都会基于当前棋盘重新计算推理回放和提示。</p>
            </div>
            <div className="hero-actions">
              <span className="status-pill">{n}×{n}</span>
              <button className="primary-button" onClick={() => setAppMode('generator')}>生成 / 导入</button>
            </div>
          </header>

          <div className="summary-strip">
            <div><span>棋盘</span><strong>{n}×{n}</strong></div>
            <div><span>步骤数</span><strong>{totalSteps}</strong></div>
            <div><span>策略类型</span><strong>{solverResult?.strategyTypesUsed.length ?? 0}</strong></div>
            <div><span>当前</span><strong>{currentBatch?.difficulty ?? currentBatch?.strategy ?? 'STEP 0'}</strong></div>
          </div>

          <div className="replay-layout">
            <section className="board-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">BOARD STATE</p>
                  <h2>{solverStepIndex === 0 ? '初始棋盘' : `步骤 ${solverStepIndex} · ${currentBatch?.ruleZh ?? currentBatch?.strategy ?? ''}`}</h2>
                </div>
                <div className="board-heading-actions">
                  <div className="board-mode-toggle" role="group" aria-label="棋盘显示模式">
                    <button
                      className={boardMode === 'board' ? 'active' : ''}
                      aria-pressed={boardMode === 'board'}
                      onClick={() => setBoardMode('board')}
                    >
                      真实棋盘
                    </button>
                    <button
                      className={boardMode === 'hints' ? 'active' : ''}
                      aria-pressed={boardMode === 'hints'}
                      onClick={() => setBoardMode('hints')}
                    >
                      推理提示
                    </button>
                  </div>
                  <span className="difficulty-badge">{currentBatch?.difficulty ? `${currentBatch.difficulty} ${currentBatch.difficultyZh ?? ''}` : 'STEP 0'}</span>
                </div>
              </div>

              {boardNode}

              <div className="legend">
                <span><i className="legend-cat" />确认 Queen</span>
                <span><i className="legend-x">x</i>已排除</span>
                <span><i className="legend-evidence-x">x</i>推理前提</span>
                <span><i className="legend-assumption" />临时假设</span>
                <span><i className="legend-temp-x">x</i>临时传播</span>
              </div>

              <div className="controls replay-controls">
                <button onClick={undoX} disabled={xHistory.length === 0}>撤销</button>
                <button onClick={redoX} disabled={redoStack.length === 0}>重做</button>
                <button onClick={resetReplay}>重置回放</button>
                <button onClick={() => setSolverStep(Math.max(0, solverStepIndex - 1))} disabled={solverStepIndex === 0}>← 上一步</button>
                <input type="range" min={0} max={totalSteps} value={solverStepIndex} onChange={event => setSolverStep(Number(event.target.value))} />
                <span className="range-label">{solverStepIndex} / {totalSteps}</span>
                <button onClick={() => setSolverStep(Math.min(totalSteps, solverStepIndex + 1))} disabled={solverStepIndex >= totalSteps}>下一步 →</button>
              </div>

              <SolverPanel role="difficultyCurve" />
            </section>
            <SolverPanel role="reasoning" />
            <SolverPanel role="steps" />
          </div>
        </>
      )}

      {message && <div className={`message-toast ${messageType}`}>{message}</div>}
    </main>
  );
}
