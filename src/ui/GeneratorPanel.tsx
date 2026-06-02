import { useMemo, useRef, useState } from 'react';
import { GeneratorDraft, useGameStore } from '../game/store';
import type { Level } from '../game/types';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function strategyLabel(type: string): string {
  return type.replace('_', ' ');
}

function statusLabel(status: string): string {
  if (status === 'exact') return '精确命中';
  if (status === 'approximate') return '近似结果';
  return '未生成';
}

function exportLevelAsJson(level: Level) {
  const sortedRegionIds = [...new Set(level.regions.map(r => r.id))].sort((a, b) => a - b);
  const maskMap = new Map<number, number>();
  sortedRegionIds.forEach((rid, i) => maskMap.set(rid, 1 << i));

  const grid: number[][] = Array.from({ length: level.n }, () => Array(level.n).fill(0));
  for (const region of level.regions) {
    const mask = maskMap.get(region.id)!;
    for (const cell of region.cells) {
      grid[cell.row][cell.col] = mask;
    }
  }

  const json = {
    LevelID: level.seed,
    size: level.n,
    difficulty: 1,
    seed: level.seed,
    note: `Queen 解谜生成器导出。大小: ${level.n}×${level.n}, 步数: ${level.actualSteps}, 种子: ${level.seed}`,
    colorMasks: grid.flat(),
    cows: level.solution.map(pos => ({ x: pos.col, y: pos.row })),
  };

  const blob = new Blob([JSON.stringify(json, null, 4)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `level-${level.n}x${level.n}-s${level.seed}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GeneratorPanel({ onEnterMainline }: { onEnterMainline?: () => void }) {
  const isGenerating = useGameStore(s => s.isGenerating);
  const generationError = useGameStore(s => s.generationError);
  const requestGenerate = useGameStore(s => s.requestGenerate);
  const draft = useGameStore(s => s.generatorDraft);
  const setDraft = useGameStore(s => s.setGeneratorDraft);
  const lastLevel = useGameStore(s => s.lastGeneratedLevel);
  const lastResult = useGameStore(s => s.lastGenerationResult);
  const enterGeneratedLevel = useGameStore(s => s.enterGeneratedLevel);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const diff = useMemo(() => {
    if (!lastLevel) return null;
    return lastLevel.actualSteps - lastLevel.targetSteps;
  }, [lastLevel]);

  const handleGenerate = () => {
    requestGenerate({
      n: clamp(draft.n, 5, 10),
      targetSteps: clamp(draft.targetSteps, 1, 80),
      seed: draft.seed == null ? undefined : clamp(draft.seed, 1, 999_999_999),
      maxAttempts: clamp(draft.maxAttempts, 1, 100000),
      allowApproximate: draft.allowApproximate,
    });
  };

  const handleEnter = () => {
    if (enterGeneratedLevel()) onEnterMainline?.();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const importLevelFromJson = useGameStore(s => s.importLevelFromJson);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const { error } = await importLevelFromJson(file);
    if (error) setImportError(error);
    event.target.value = '';
  };

  const randomizeSeed = () => {
    setDraft({ seed: Math.floor(100000 + Math.random() * 900000000) });
  };

  return (
    <main className="generator-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <section className="generator-hero">
        <span className="brand-kicker">关卡工坊</span>
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
              <select value={draft.n} onChange={event => setDraft({ n: Number(event.target.value) })}>
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
                onChange={event => setDraft({ targetSteps: clamp(Number(event.target.value), 1, 80) })}
              />
            </label>

            <label className="generator-field">
              <span>随机种子</span>
              <div className="inline-field">
                <input
                  type="number"
                  min={1}
                  max={999999999}
                  placeholder="留空则随机"
                  value={draft.seed ?? ''}
                  onChange={event => {
                    const raw = event.target.value.trim();
                    setDraft({ seed: raw ? clamp(Number(raw), 1, 999_999_999) : null });
                  }}
                />
                <button className="micro-btn" onClick={randomizeSeed}>随机</button>
                <button className="micro-btn" onClick={() => setDraft({ seed: null })}>清空</button>
              </div>
            </label>

            <label className="generator-field">
              <span>生成尝试上限</span>
              <input
                type="number"
                min={1}
                max={100000}
                value={draft.maxAttempts}
                onChange={event => setDraft({ maxAttempts: clamp(Number(event.target.value), 1, 100000) })}
              />
            </label>

            <label className="check-line">
              <input
                type="checkbox"
                checked={draft.allowApproximate}
                onChange={event => setDraft({ allowApproximate: event.target.checked })}
              />
              <span>
                允许近似结果
                <small>关闭时只接受实际步数等于目标步数的关卡。</small>
              </span>
            </label>

          </div>

          <div className="generator-actions">
            <button className="forge-btn" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? '生成中...' : '生成'}
            </button>
            <button className="ghost-btn" onClick={handleEnter} disabled={!lastLevel || isGenerating}>
              进入主线
            </button>
            <button className="ghost-btn" onClick={() => lastLevel && exportLevelAsJson(lastLevel)} disabled={!lastLevel || isGenerating}>
              导出 JSON
            </button>
            <button className="ghost-btn" onClick={handleImportClick} disabled={isGenerating}>
              导入 JSON
            </button>
          </div>

          {generationError && <p className="generator-error">{generationError}</p>}
          {importError && <p className="generator-error">{importError}</p>}
        </div>

        <div className="generator-results-panel">
          <div className="results-topline">
            <div>
              <span className="brand-kicker">结果</span>
              <strong>{lastLevel ? lastLevel.id : lastResult ? statusLabel(lastResult.status) : '等待生成'}</strong>
            </div>
            {lastResult && (
              <span className={`hit-pill ${lastResult.status === 'exact' ? 'exact' : lastResult.status === 'approximate' ? 'near' : 'miss'}`}>
                {lastResult.status === 'failed'
                  ? '无可进入关卡'
                  : diff === 0 ? '精确命中' : `偏差 ${diff! > 0 ? '+' : ''}${diff}`}
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
              <strong>正在搜索目标步数关卡</strong>
              <span>关闭近似时不会返回偏离目标步数的关卡。</span>
            </div>
          )}

          {lastResult && !isGenerating && (
            <div className="diagnostic-grid">
              <div>
                <span>状态</span>
                <strong>{statusLabel(lastResult.status)}</strong>
              </div>
              <div>
                <span>尝试</span>
                <strong>{lastResult.diagnostics.attempts}/{lastResult.diagnostics.maxAttempts}</strong>
              </div>
              <div>
                <span>耗时</span>
                <strong>{lastResult.diagnostics.elapsedMs}ms</strong>
              </div>
              <div>
                <span>可解候选</span>
                <strong>{lastResult.diagnostics.completeCandidates}</strong>
              </div>
              <div>
                <span>不可解候选</span>
                <strong>{lastResult.diagnostics.incompleteCandidates}</strong>
              </div>
              <div>
                <span>最佳步数</span>
                <strong>{lastResult.diagnostics.bestActualSteps ?? '-'}</strong>
              </div>
              <div>
                <span>命中尝试</span>
                <strong>{lastResult.diagnostics.selectedAttempt ?? '-'}</strong>
              </div>
              <div>
                <span>派生种子</span>
                <strong>{lastResult.diagnostics.selectedAttemptSeed ?? '-'}</strong>
              </div>
            </div>
          )}

          {lastResult?.status === 'failed' && !isGenerating && (
            <div className="result-warning">
              没有命中目标步数，因此本次没有生成可进入主线的关卡。可以提高尝试上限、调整目标步数，或打开近似结果查看最近候选。
            </div>
          )}

          {lastResult?.status === 'approximate' && !isGenerating && (
            <div className="result-warning">
              这是你允许的近似结果，已保留 seed 和搜索参数，方便复现或继续加大尝试次数。
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
                  <span>种子</span>
                  <strong>{lastLevel.seed}</strong>
                </div>
              </div>

              <div className="result-section">
                <span className="brand-kicker">策略序列</span>
                <div className="strategy-chip-row">
                  {lastLevel.strategySequence.map((type, index) => (
                    <span key={`${type}-${index}`} className={`batch-strategy-tag strat-${type}`}>
                      {index + 1}. {strategyLabel(type)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="result-section">
                <span className="brand-kicker">解法锚点</span>
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
