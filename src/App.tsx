import { useEffect, useState } from 'react';
import { useGameStore } from './game/store';
import Board from './ui/Board';
import SolverPanel from './ui/SolverPanel';
import GeneratorPanel from './ui/GeneratorPanel';

export default function App() {
  const [appMode, setAppMode] = useState<'mainline' | 'generator'>('mainline');

  const message = useGameStore(s => s.message);
  const messageType = useGameStore(s => s.messageType);
  const clearMessage = useGameStore(s => s.clearMessage);
  const level = useGameStore(s => s.level);
  const board = useGameStore(s => s.board);
  const requestGenerate = useGameStore(s => s.requestGenerate);
  const loadLevel = useGameStore(s => s.loadLevel);
  const solverPanelOpen = useGameStore(s => s.solverPanelOpen);
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const setSolverStep = useGameStore(s => s.setSolverStep);
  const setSolverPanelOpen = useGameStore(s => s.setSolverPanelOpen);
  const boardMode = useGameStore(s => s.boardMode);
  const setBoardMode = useGameStore(s => s.setBoardMode);
  const undoX = useGameStore(s => s.undoX);
  const redoX = useGameStore(s => s.redoX);
  const resetBoard = useGameStore(s => s.resetBoard);
  const xHistory = useGameStore(s => s.xHistory);
  const redoStack = useGameStore(s => s.redoStack);

  // Auto-load level
  useEffect(() => {
    if (!level) {
      requestGenerate({
        n: 6, targetSteps: 6, seed: 20260515,
        maxAttempts: 2500, allowApproximate: true,
      }).then(r => { if (r.level) loadLevel(r.level); });
    }
  }, [level, requestGenerate, loadLevel]);

  useEffect(() => {
    if (message) { const t = setTimeout(clearMessage, 3000); return () => clearTimeout(t); }
  }, [message, clearMessage]);

  useEffect(() => {
    document.body.style.overflow = solverPanelOpen ? 'auto' : '';
  }, [solverPanelOpen]);

  const n = level?.n ?? 6;
  const hasLevel = !!(level && board);
  const showGenerator = appMode === 'generator';
  const showReplay = solverPanelOpen && !!solverResult;
  const showPlay = !showGenerator && hasLevel && !showReplay;
  const showLoading = !showGenerator && !hasLevel;
  const totalSteps = solverResult?.totalSteps ?? 0;
  const currentBatch = solverResult && solverStepIndex > 0 ? solverResult.batches[solverStepIndex - 1] : null;
  const queensPlaced = board?.cells.flat().filter(c => c.isQueen).length ?? 0;

  // Single Board instance — always mounted when level is loaded.
  // Chassis (header, controls, side panels) varies by mode; Board stays stable.
  const boardNode = hasLevel && <div className="board-wrap"><Board /></div>;

  return (
    <main className="app-shell">
      {/* ── GENERATOR ── */}
      {showGenerator && (
        <GeneratorPanel onEnterMainline={() => setAppMode('mainline')} />
      )}

      {/* ── LOADING ── */}
      {showLoading && (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">皇后消元</p>
              <h1>Queen</h1>
              <p className="hero-copy">标记 X 缩小候选范围，逐层消元直到确认全部 Queen。</p>
            </div>
            <div className="status-pill">准备就绪</div>
          </header>
          <div className="placeholder" style={{ marginTop: 80 }}>
            <span className="spinner" /><span>正在装配主线关卡...</span>
          </div>
        </>
      )}

      {/* ── REPLAY MODE ── */}
      {showReplay && (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">皇后消元 · {n}×{n}</p>
              <h1>推理回放</h1>
              <p className="hero-copy">逐步骤查看求解器的推理过程。单击标记 X，双击确认 Queen。</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="status-pill">{n}×{n}</span>
              <button className="primary-button" onClick={() => setSolverPanelOpen(false)}>✕ 关闭回放</button>
            </div>
          </header>
          <div className="summary-strip">
            <div><span>棋盘</span><strong>{n}×{n}</strong></div>
            <div><span>步骤数</span><strong>{totalSteps}</strong></div>
            <div><span>策略类型</span><strong>{solverResult?.strategyTypesUsed.length ?? 0}</strong></div>
            <div><span>当前</span><strong>{currentBatch?.strategy ?? 'STEP 0'}</strong></div>
          </div>
          <div className="replay-layout">
            <section className="board-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">BOARD STATE</p>
                  <h2>{solverStepIndex === 0 ? '初始棋盘' : `步骤 ${solverStepIndex} · ${currentBatch?.strategy ?? ''}`}</h2>
                </div>
                <div className="board-heading-actions">
                  <div className="board-mode-toggle" role="group">
                    <button className={boardMode === 'board' ? 'active' : ''} onClick={() => setBoardMode('board')}>真实棋盘</button>
                    <button className={boardMode === 'hints' ? 'active' : ''} onClick={() => setBoardMode('hints')}>推理提示</button>
                  </div>
                  <span className="difficulty-badge">{solverStepIndex === 0 ? 'STEP 0' : `步 ${solverStepIndex}`}</span>
                </div>
              </div>
              {boardNode}
              <div className="legend">
                <span><i className="legend-cat" />确认 Queen</span>
                <span><i className="legend-x">✕</i>已排除</span>
                <span><i className="legend-evidence-x">✕</i>推理前提</span>
              </div>
              <div className="controls">
                <button onClick={() => setSolverStep(Math.max(0, solverStepIndex - 1))} disabled={solverStepIndex === 0}>← 上一步</button>
                <input type="range" min={0} max={totalSteps} value={solverStepIndex} onChange={e => setSolverStep(Number(e.target.value))} />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{solverStepIndex} / {totalSteps}</span>
                <button onClick={() => setSolverStep(Math.min(totalSteps, solverStepIndex + 1))} disabled={solverStepIndex >= totalSteps}>下一步 →</button>
              </div>
              <SolverPanel role="difficultyCurve" />
            </section>
            <SolverPanel role="reasoning" />
            <SolverPanel role="steps" />
          </div>
        </>
      )}

      {/* ── NORMAL PLAY MODE ── */}
      {showPlay && (
        <>
          <header className="hero">
            <div>
              <p className="eyebrow">皇后消元 · {n}×{n}</p>
              <h1>Queen</h1>
              <p className="hero-copy">单击标记 X，双击确认 Queen。利用行、列、区域约束消元推进。</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="status-pill">{n}×{n}</span>
              <button className="primary-button" onClick={() => setAppMode('generator')}>生成器</button>
            </div>
          </header>
          {boardNode}
          <div className="controls" style={{ justifyContent: 'center', marginBottom: 24 }}>
            <button onClick={undoX} disabled={xHistory.length === 0}>↩ 撤销</button>
            <button onClick={redoX} disabled={redoStack.length === 0}>↪ 重做</button>
            <button onClick={resetBoard}>↺ 重置</button>
            <button onClick={() => setSolverPanelOpen(true)} style={{ background: 'var(--accent)' }}>求解器</button>
          </div>
          <div className="toolbar-hint" style={{ justifyContent: 'center', marginTop: -8 }}>
            <span>单击</span> <strong>标记 X</strong><span>·</span>
            <span>双击</span> <strong>确认 Queen</strong><span>·</span>
            <span>已放置</span> <strong>{queensPlaced}/{n}</strong><span>·</span>
            <span>步数</span> <strong>{level?.actualSteps ?? 0}</strong>
          </div>
        </>
      )}

      {/* ── TOAST ── */}
      {message && <div className={`message-toast ${messageType}`}>{message}</div>}
    </main>
  );
}
