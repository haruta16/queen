import { useEffect } from 'react';
import { useGameStore } from '../game/store';

export default function SolverPanel() {
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const setSolverStep = useGameStore(s => s.setSolverStep);
  const open = useGameStore(s => s.solverPanelOpen);
  const setOpen = useGameStore(s => s.setSolverPanelOpen);
  const board = useGameStore(s => s.board);
  const level = useGameStore(s => s.level);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  // 检测是否玩家把解 Queen 标了 X（唯一会破坏可解性的操作）
  const xOnSolution = (() => {
    if (!board || !level) return false;
    return level.solution.some(p => board.cells[p.row]?.[p.col]?.isX);
  })();

  const panelShell = (body: React.ReactNode) => (
    <>
      <div
        className={`solver-backdrop${open ? ' is-open' : ''}`}
        onClick={() => setOpen(false)}
      />
      <div className={`solver-sidebar${open ? ' is-open' : ''}`}>
        <div className="panel-header">
          <span className="panel-title">🔍 求解器</span>
          <button className="panel-close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="panel-body">{body}</div>
      </div>
    </>
  );

  if (!solverResult) {
    return panelShell(<p className="placeholder">打开面板即对当前棋盘实时求解。</p>);
  }

  // solverResult 非 null，直接 destructure，零个 !
  const { batches, totalSteps, strategyTypesUsed, complete } = solverResult;
  const currentBatch = solverStepIndex > 0 ? batches[solverStepIndex - 1] : null;

  return panelShell(
    <>
      {/* 状态提示 */}
      {!complete && xOnSolution && (
        <div style={{
          background: 'rgba(255,100,80,0.12)',
          border: '1px solid rgba(255,100,80,0.3)',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 12,
          fontSize: 13,
          color: '#c0392b',
        }}>
          ⚠️ 有解 Queen 被标 X，当前棋盘无解。撤销错误的 X 即可恢复。
        </div>
      )}
      {!complete && !xOnSolution && (
        <div style={{
          background: 'rgba(255,180,60,0.1)',
          border: '1px solid rgba(255,180,60,0.25)',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 12,
          fontSize: 13,
          color: '#b8860b',
        }}>
          🔍 求解器已推导 {totalSteps} 步，剩余候选需更多信息才能确定。
        </div>
      )}
      {complete && totalSteps === 0 && (
        <div style={{
          background: 'rgba(80,200,120,0.12)',
          border: '1px solid rgba(80,200,120,0.3)',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 12,
          fontSize: 13,
          color: '#27ae60',
        }}>
          ✅ 棋盘已完全求解，无需更多步骤。
        </div>
      )}

      {/* Overview */}
      <div className="solver-overview">
        <div className="solver-stat">
          <div className="solver-stat-label">{complete ? '剩余步骤' : '已推导'}</div>
          <div className="solver-stat-value">{totalSteps}</div>
        </div>
        <div className="solver-stat">
          <div className="solver-stat-label">策略类型</div>
          <div className="solver-stat-value">{strategyTypesUsed.length}</div>
        </div>
      </div>

      {/* Strategy type tags */}
      {strategyTypesUsed.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
          {strategyTypesUsed.map(t => (
            <span key={t} className={`batch-strategy-tag strat-${t}`}>{t}</span>
          ))}
        </div>
      )}

      {/* Playback controls */}
      {totalSteps > 0 && (
      <div className="solver-controls">
        <button className="solver-ctrl-btn" onClick={() => setSolverStep(0)} disabled={solverStepIndex === 0}>
          ⏮
        </button>
        <button className="solver-ctrl-btn" onClick={() => setSolverStep(solverStepIndex - 1)} disabled={solverStepIndex <= 0}>
          ◀
        </button>
        <button className="solver-ctrl-btn" onClick={() => setSolverStep(solverStepIndex + 1)} disabled={solverStepIndex >= totalSteps}>
          ▶
        </button>
        <button className="solver-ctrl-btn" onClick={() => setSolverStep(totalSteps)} disabled={solverStepIndex >= totalSteps}>
          ⏭
        </button>
        <span className="solver-step-indicator">
          {solverStepIndex} / {totalSteps}
        </span>
      </div>
      )}

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
        {batches.map((batch, i) => (
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
  );
}
