import { useEffect, useMemo, useRef, useState } from 'react';
import { GeneratorDraft, useGameStore } from '../game/store';
import { solve } from '../game/solver';
import { createEmptyBoard } from '../game/rules';
import { generateLevelResult } from '../game/generator';
import type { GenerationResult, GenerationTraceFrame, Level, Region, Position } from '../game/types';

const TRACE_COLORS = [
  '#D9435F', '#E8923A', '#D4B83D', '#47B86B', '#3BBFB6',
  '#3A9FCA', '#7B6CBF', '#D486A8', '#6AAAD4', '#B8A67E',
];

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

function posKey(pos: Position): string {
  return `${pos.row},${pos.col}`;
}

function TraceBoard({ frame, queens }: { frame: GenerationTraceFrame; queens: Position[] }) {
  const queenKeys = useMemo(() => new Set(queens.map(posKey)), [queens]);
  const placed = useMemo(() => new Set(frame.placed.map(posKey)), [frame]);
  const skeleton = useMemo(() => new Set(frame.skeleton.map(posKey)), [frame]);
  const expected = useMemo(() => new Set(frame.expected.map(posKey)), [frame]);
  const protectedSet = useMemo(() => new Set(frame.protected.map(posKey)), [frame]);
  const n = frame.grid.length;

  return (
    <div className="trace-board" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
      {frame.grid.flatMap((row, r) => row.map((rid, c) => {
        const key = `${r},${c}`;
        const marks = [
          placed.has(key) ? 'trace-placed' : '',
          skeleton.has(key) ? 'trace-skeleton' : '',
          expected.has(key) ? 'trace-expected' : '',
          protectedSet.has(key) ? 'trace-protected' : '',
          rid < 0 ? 'trace-unknown' : '',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={key}
            className={`trace-cell ${marks}`}
            style={{ background: rid >= 0 ? TRACE_COLORS[rid % TRACE_COLORS.length] : '#f2ede1' }}
            title={`r${r} c${c} region=${rid}`}
          >
            {queenKeys.has(key) ? 'Q' : expected.has(key) ? 'E' : protectedSet.has(key) ? 'P' : skeleton.has(key) ? 'S' : ''}
          </div>
        );
      }))}
    </div>
  );
}

function importLevelFromJson(file: File): Promise<Level> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        const n: number = json.size;
        const colorMasks: number[] = json.colorMasks;
        const cows: { x: number; y: number }[] = json.cows;

        if (!Number.isFinite(n) || n < 2 || !Array.isArray(colorMasks) || colorMasks.length !== n * n) {
          throw new Error(`无效的关卡数据: size=${n}, colorMasks长度=${colorMasks?.length}`);
        }

        // Group cells by mask value → regions
        const maskToCells = new Map<number, Position[]>();
        for (let i = 0; i < colorMasks.length; i++) {
          const row = Math.floor(i / n);
          const col = i % n;
          const mask = colorMasks[i];
          if (!maskToCells.has(mask)) maskToCells.set(mask, []);
          maskToCells.get(mask)!.push({ row, col });
        }

        const regions: Region[] = [...maskToCells.entries()].map(([_mask, cells], idx) => ({
          id: idx,
          cells,
        }));

        // Convert cows (x=col, y=row) to solution positions
        const solution: Position[] = cows.map(c => ({ row: c.y, col: c.x }));

        // Run solver
        const board = createEmptyBoard(n, regions);
        const solverResult = solve(board);

        if (!solverResult.complete) {
          throw new Error('导入的关卡无法被求解器完全求解');
        }

        const level: Level = {
          id: `import-${json.seed || json.levelId || Date.now()}`,
          n,
          regions,
          solution,
          seed: json.seed ?? json.levelId ?? 0,
          targetSteps: solverResult.totalSteps,
          actualSteps: solverResult.totalSteps,
          strategySequence: solverResult.batches.map(b => b.strategy),
          solverResult,
        };

        resolve(level);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
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
    levelId: level.seed,
    size: level.n,
    difficulty: 1,
    seed: level.seed,
    note: `Generated from Queen Puzzle Generator. Size: ${level.n}×${level.n}, Steps: ${level.actualSteps}, Seed: ${level.seed}`,
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
  const [traceIndex, setTraceIndex] = useState(0);
  const [previewResult, setPreviewResult] = useState<GenerationResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const diff = useMemo(() => {
    if (!lastLevel) return null;
    return lastLevel.actualSteps - lastLevel.targetSteps;
  }, [lastLevel]);

  const updateDraft = (patch: Partial<GeneratorDraft>) => {
    setDraft(patch);
  };

  const previewSeed = draft.seed ?? 1;
  const previewKey = [
    draft.n,
    draft.targetSteps,
    previewSeed,
    draft.anchorCount ?? 'auto',
    draft.genMode,
  ].join(':');

  useEffect(() => {
    let cancelled = false;
    setIsPreviewing(true);
    setTraceIndex(0);
    const timer = window.setTimeout(() => {
      const result = generateLevelResult({
        n: clamp(draft.n, 5, 10),
        targetSteps: clamp(draft.targetSteps, 1, 80),
        seed: clamp(previewSeed, 1, 999_999_999),
        maxAttempts: 8,
        allowApproximate: true,
        anchorCount: draft.anchorCount == null ? undefined : clamp(draft.anchorCount, 1, 4),
        mode: draft.genMode,
      });
      if (!cancelled) {
        setPreviewResult(result);
        setIsPreviewing(false);
      }
    }, 420);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [previewKey]);

  const trace = previewResult?.trace ?? lastResult?.trace;
  const traceFrame = trace?.frames[Math.min(traceIndex, Math.max(0, trace.frames.length - 1))];
  const setTraceStep = (next: number) => {
    if (!trace) return;
    setTraceIndex(Math.max(0, Math.min(next, trace.frames.length - 1)));
  };

  const handleGenerate = () => {
    setTraceIndex(0);
    requestGenerate({
      n: clamp(draft.n, 5, 10),
      targetSteps: clamp(draft.targetSteps, 1, 80),
      seed: draft.seed == null ? undefined : clamp(draft.seed, 1, 999_999_999),
      maxAttempts: clamp(draft.maxAttempts, 1, 100000),
      allowApproximate: draft.allowApproximate,
      anchorCount: draft.anchorCount == null ? undefined : clamp(draft.anchorCount, 1, 4),
      mode: draft.genMode,
    });
  };

  const handleEnter = () => {
    if (enterGeneratedLevel()) onEnterMainline?.();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const level = await importLevelFromJson(file);
      useGameStore.setState({
        lastGeneratedLevel: level,
        lastGenerationResult: {
          status: 'exact',
          level,
          diagnostics: {
            status: 'exact',
            attempts: 1,
            maxAttempts: 1,
            elapsedMs: 0,
            seed: level.seed,
            targetSteps: level.targetSteps,
            bestActualSteps: level.actualSteps,
            bestDiff: 0,
            selectedAttempt: 1,
            selectedAttemptSeed: level.seed,
            completeCandidates: 1,
            incompleteCandidates: 0,
            exactCandidates: 1,
            allowApproximate: false,
            anchorStrategy: 'import',
            anchorQueenIndices: null,
            anchorCount: null,
          },
        },
        generationError: null,
      });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
    // Reset input so the same file can be re-imported
    event.target.value = '';
  };

  const randomizeSeed = () => {
    updateDraft({ seed: Math.floor(100000 + Math.random() * 900000000) });
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
              <span>锚点区域数</span>
              <select
                value={draft.anchorCount ?? ''}
                onChange={event => {
                  const raw = event.target.value;
                  updateDraft({ anchorCount: raw === '' ? null : clamp(Number(raw), 1, 4) });
                }}
              >
                <option value="">自动</option>
                {[1, 2, 3, 4].map(x => (
                  <option key={x} value={x}>{x} 个锚点</option>
                ))}
              </select>
            </label>

            <label className="generator-field">
              <span>生成方式</span>
              <select
                value={draft.genMode ?? 'reverseV2'}
                onChange={event => updateDraft({ genMode: event.target.value as 'anchor' | 'reverseV2' })}
              >
                <option value="reverseV2">逆向依赖 (reverseV2)</option>
                <option value="anchor">旧锚点反向 (anchor)</option>
              </select>
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
                    updateDraft({ seed: raw ? clamp(Number(raw), 1, 999_999_999) : null });
                  }}
                />
                <button className="micro-btn" onClick={randomizeSeed}>随机</button>
                <button className="micro-btn" onClick={() => updateDraft({ seed: null })}>清空</button>
              </div>
            </label>

            <label className="generator-field">
              <span>生成尝试上限</span>
              <input
                type="number"
                min={1}
                max={100000}
                value={draft.maxAttempts}
                onChange={event => updateDraft({ maxAttempts: clamp(Number(event.target.value), 1, 100000) })}
              />
            </label>

            <label className="check-line">
              <input
                type="checkbox"
                checked={draft.allowApproximate}
                onChange={event => updateDraft({ allowApproximate: event.target.checked })}
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
              <span className="brand-kicker">RESULT</span>
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
              {lastResult.diagnostics.anchorStrategy && (
                <div>
                  <span>锚点策略</span>
                  <strong>{lastResult.diagnostics.anchorStrategy}</strong>
                </div>
              )}
              {lastResult.diagnostics.anchorQueenIndices && lastResult.diagnostics.anchorQueenIndices.length > 0 && (
                <div>
                  <span>锚点 Queen</span>
                  <strong>[{lastResult.diagnostics.anchorQueenIndices.join(', ')}]</strong>
                </div>
              )}
            </div>
          )}

          {trace && traceFrame && !isGenerating && (
            <div className="trace-simulator">
              <div className="trace-header">
                <div>
                  <span className="brand-kicker">GENERATION SIM</span>
                  <strong>
                    {isPreviewing ? '更新中...' : `${traceFrame.index + 1}/${trace.frames.length} · ${traceFrame.phase}`}
                  </strong>
                </div>
                <span className={`hit-pill ${traceFrame.accepted ? 'exact' : 'miss'}`}>
                  {previewResult ? `preview ${previewResult.status}` : traceFrame.accepted ? 'accepted' : 'rejected'}
                </span>
              </div>
              <TraceBoard frame={traceFrame} queens={trace.queenPositions} />
              <div className="trace-controls">
                <button className="micro-btn" onClick={() => setTraceStep(traceIndex - 1)} disabled={traceIndex <= 0}>上一步</button>
                <input
                  type="range"
                  min={0}
                  max={trace.frames.length - 1}
                  value={Math.min(traceIndex, trace.frames.length - 1)}
                  onChange={event => setTraceStep(Number(event.target.value))}
                />
                <button className="micro-btn" onClick={() => setTraceStep(traceIndex + 1)} disabled={traceIndex >= trace.frames.length - 1}>下一步</button>
              </div>
              <div className="trace-detail-grid">
                <div>
                  <span>Step</span>
                  <strong>{traceFrame.step ?? '-'}</strong>
                </div>
                <div>
                  <span>Strategy</span>
                  <strong>{traceFrame.strategy ?? '-'}</strong>
                </div>
                <div>
                  <span>Placed</span>
                  <strong>{traceFrame.placed.length}</strong>
                </div>
                <div>
                  <span>Expected</span>
                  <strong>{traceFrame.expected.length}</strong>
                </div>
              </div>
              <p className="trace-reason">{traceFrame.reason}</p>
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
