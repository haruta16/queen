import { useMemo } from 'react';
import { GeneratorDraft, useGameStore } from '../game/store';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function strategyLabel(type: string): string {
  return type.replace('_', ' ');
}

export default function GeneratorPanel({ onEnterMainline }: { onEnterMainline?: () => void }) {
  const isGenerating = useGameStore(s => s.isGenerating);
  const generationError = useGameStore(s => s.generationError);
  const requestGenerate = useGameStore(s => s.requestGenerate);
  const draft = useGameStore(s => s.generatorDraft);
  const setDraft = useGameStore(s => s.setGeneratorDraft);
  const lastLevel = useGameStore(s => s.lastGeneratedLevel);
  const enterGeneratedLevel = useGameStore(s => s.enterGeneratedLevel);

  const diff = useMemo(() => {
    if (!lastLevel) return null;
    return lastLevel.actualSteps - lastLevel.targetSteps;
  }, [lastLevel]);

  const updateDraft = (patch: Partial<GeneratorDraft>) => {
    setDraft(patch);
  };

  const handleGenerate = () => {
    requestGenerate(
      clamp(draft.n, 5, 10),
      clamp(draft.targetSteps, 1, 80),
      clamp(draft.seed, 1, 999_999_999),
    );
  };

  const handleEnter = () => {
    if (enterGeneratedLevel()) onEnterMainline?.();
  };

  const randomizeSeed = () => {
    updateDraft({ seed: Math.floor(100000 + Math.random() * 900000000) });
  };

  return (
    <main className="generator-shell">
      <section className="generator-hero">
        <span className="brand-kicker">LEVEL FORGE</span>
        <h2>关卡生成器</h2>
        <p>生成和进入主线已经分开。先生成、看结果参数，满意后再进入主线。</p>
      </section>

      <section className="generator-workbench">
        <div className="generator-controls-panel">
          <div className="generator-band">
            <div className="band-title">
              <span>01</span>
              <strong>核心参数</strong>
            </div>

            <label className="generator-field">
              <span>棋盘大小</span>
              <select value={draft.n} onChange={event => updateDraft({ n: Number(event.target.value) })}>
                {[5, 6, 7, 8, 9, 10].map(size => (
                  <option key={size} value={size}>{size} × {size}</option>
                ))}
              </select>
            </label>

            <label className="generator-field">
              <span>通关策略步数</span>
              <input
                type="number"
                min={1}
                max={80}
                value={draft.targetSteps}
                onChange={event => updateDraft({ targetSteps: clamp(Number(event.target.value), 1, 80) })}
              />
            </label>

            <label className="generator-field">
              <span>随机种子</span>
              <div className="inline-field">
                <input
                  type="number"
                  min={1}
                  max={999999999}
                  value={draft.seed}
                  onChange={event => updateDraft({ seed: clamp(Number(event.target.value), 1, 999_999_999) })}
                />
                <button className="micro-btn" onClick={randomizeSeed}>随机</button>
              </div>
            </label>
          </div>

          <div className="generator-actions">
            <button className="forge-btn" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? '生成中...' : '生成'}
            </button>
            <button className="ghost-btn" onClick={handleEnter} disabled={!lastLevel || isGenerating}>
              进入主线
            </button>
          </div>

          {generationError && <p className="generator-error">{generationError}</p>}
        </div>

        <div className="generator-results-panel">
          <div className="results-topline">
            <div>
              <span className="brand-kicker">RESULT</span>
              <strong>{lastLevel ? lastLevel.id : '等待生成'}</strong>
            </div>
            {lastLevel && (
              <span className={diff === 0 ? 'hit-pill exact' : 'hit-pill near'}>
                {diff === 0 ? '精确命中' : `偏差 ${diff! > 0 ? '+' : ''}${diff}`}
              </span>
            )}
          </div>

          {!lastLevel && !isGenerating && (
            <div className="generator-empty">
              <strong>参数会保留</strong>
              <span>切回主线再回来，棋盘大小、目标步数、seed 和上次结果都会留在这里。</span>
            </div>
          )}

          {isGenerating && (
            <div className="generator-empty">
              <span className="spinner" />
              <strong>正在搜索目标步数附近的关卡</strong>
              <span>优先找精确命中；找不到时返回最近且策略循环可完成的候选。</span>
            </div>
          )}

          {lastLevel && (
            <>
              <div className="generator-metrics">
                <div>
                  <span>棋盘</span>
                  <strong>{lastLevel.n}×{lastLevel.n}</strong>
                </div>
                <div>
                  <span>目标步数</span>
                  <strong>{lastLevel.targetSteps}</strong>
                </div>
                <div>
                  <span>实际步数</span>
                  <strong>{lastLevel.actualSteps}</strong>
                </div>
                <div>
                  <span>策略类型</span>
                  <strong>{lastLevel.solverResult.strategyTypesUsed.length}</strong>
                </div>
                <div>
                  <span>最高等级</span>
                  <strong>L{lastLevel.solverResult.highestLevel}</strong>
                </div>
                <div>
                  <span>种子</span>
                  <strong>{lastLevel.seed}</strong>
                </div>
              </div>

              <div className="result-section">
                <span className="brand-kicker">STRATEGY SEQUENCE</span>
                <div className="strategy-chip-row">
                  {lastLevel.strategySequence.map((type, index) => (
                    <span key={`${type}-${index}`} className={`batch-strategy-tag strat-${type}`}>
                      {index + 1}. {strategyLabel(type)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="result-section">
                <span className="brand-kicker">SOLUTION ANCHORS</span>
                <div className="solution-list">
                  {lastLevel.solution.map(pos => (
                    <span key={`${pos.row}-${pos.col}`}>r{pos.row} c{pos.col}</span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
