import { useEffect } from 'react';
import { useGameStore } from '../game/store';

export default function SolverPanel() {
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const setSolverStep = useGameStore(s => s.setSolverStep);
  const open = useGameStore(s => s.solverPanelOpen);
  const setOpen = useGameStore(s => s.setSolverPanelOpen);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  const result = solverResult;
  const batches = result?.batches;
  const totalSteps = result?.totalSteps;
  const strategyTypesUsed = result?.strategyTypesUsed;
  const currentBatch = solverStepIndex > 0 && batches ? batches[solverStepIndex - 1] : null;

  return (
    <>
      {/* 窄屏遮罩层 — 仅移动端 overlay 时可见 */}
      <div
        className={`solver-backdrop${open ? ' is-open' : ''}`}
        onClick={() => setOpen(false)}
      />
      <div className={`solver-sidebar${open ? ' is-open' : ''}`}>
        <div className="panel-header">
          <span className="panel-title">🔍 求解器</span>
          <button className="panel-close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="panel-body">
          {!result ? (
            <p className="placeholder">暂无求解数据，请先生成关卡。</p>
          ) : (
            <>
              {/* Overview */}
              <div className="solver-overview">
                <div className="solver-stat">
                  <div className="solver-stat-label">总步骤</div>
                  <div className="solver-stat-value">{totalSteps}</div>
                </div>
                <div className="solver-stat">
                  <div className="solver-stat-label">策略类型</div>
                  <div className="solver-stat-value">{strategyTypesUsed!.length}</div>
                </div>
              </div>

              {/* Strategy type tags */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                {strategyTypesUsed!.map(t => (
                  <span key={t} className={`batch-strategy-tag strat-${t}`}>{t}</span>
                ))}
              </div>

              {/* Playback controls */}
              <div className="solver-controls">
                <button className="solver-ctrl-btn" onClick={() => setSolverStep(0)} disabled={solverStepIndex === 0}>
                  ⏮
                </button>
                <button className="solver-ctrl-btn" onClick={() => setSolverStep(solverStepIndex - 1)} disabled={solverStepIndex <= 0}>
                  ◀
                </button>
                <button className="solver-ctrl-btn" onClick={() => setSolverStep(solverStepIndex + 1)} disabled={solverStepIndex >= totalSteps!}>
                  ▶
                </button>
                <button className="solver-ctrl-btn" onClick={() => setSolverStep(totalSteps!)} disabled={solverStepIndex >= totalSteps!}>
                  ⏭
                </button>
                <span className="solver-step-indicator">
                  {solverStepIndex} / {totalSteps}
                </span>
              </div>

              {/* Current step info */}
              {currentBatch && (
                <div style={{
                  background: 'rgba(23,23,23,0.04)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  marginBottom: 12,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}>
                  <span className={`batch-strategy-tag strat-${currentBatch.strategy}`} style={{ marginRight: 8 }}>
                    {currentBatch.strategy}
                  </span>
                  <span style={{ color: 'var(--ink)', fontWeight: 700 }}>
                    步 {currentBatch.index}:
                  </span>{' '}
                  <span style={{ color: 'var(--muted)' }}>{currentBatch.description}</span>
                </div>
              )}

              {/* Batch list */}
              <div className="solver-batch-list">
                {batches!.map((batch, i) => (
                  <div
                    key={batch.index}
                    className={`solver-batch-item ${i === solverStepIndex - 1 ? 'active' : ''}`}
                    onClick={() => setSolverStep(i + 1)}
                  >
                    <span className="batch-index">{batch.index}</span>
                    <span className={`batch-strategy-tag strat-${batch.strategy}`}>
                      {batch.strategy}
                    </span>
                    <span className="batch-desc">
                      消除 {batch.eliminations.length} X
                      {batch.queenConfirmed.length > 0 && ` · 确认 ${batch.queenConfirmed.length} Queen`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
