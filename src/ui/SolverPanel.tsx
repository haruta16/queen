import { useMemo } from 'react';
import { useGameStore } from '../game/store';
import type { ReactNode } from 'react';
import type { Position, SolverBranch, SolverTraceMark, UnitRef } from '../game/types';

function coord(pos: Position): string {
  return `r${pos.row}c${pos.col}`;
}

function unitLabel(unit?: UnitRef): string {
  if (!unit) return '';
  const kind = unit.kind === 'row' ? '行' : unit.kind === 'col' ? '列' : '区域';
  return `${kind}${unit.index}`;
}

function listCells(cells?: Position[]): string {
  return cells?.length ? cells.map(coord).join('、') : '-';
}

function traceSummary(trace?: SolverTraceMark[]): string {
  if (!trace?.length) return '无临时传播';
  const assumptions = trace.filter(item => item.mark === 'assumption').length;
  const queens = trace.filter(item => item.mark === 'temp-queen').length;
  const xs = trace.filter(item => item.mark === 'temp-x').length;
  return `假设 ${assumptions} · 临时 Queen ${queens} · 临时 X ${xs}`;
}

function branchTitle(branch: SolverBranch, index: number): string {
  const assumption = branch.assumption ? coord(branch.assumption) : `分支 ${index + 1}`;
  return `分支 ${index + 1}: 假设 ${assumption} 为 Queen`;
}

export default function SolverPanel({ role }: { role: 'reasoning' | 'steps' | 'difficultyCurve' }) {
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const setSolverStep = useGameStore(s => s.setSolverStep);
  const board = useGameStore(s => s.board);
  const level = useGameStore(s => s.level);

  // ── Reasoning Panel ──
  if (role === 'reasoning') {
    const currentBatch = solverResult && solverStepIndex > 0
      ? solverResult.batches[solverStepIndex - 1]
      : null;

    // Detect conflicts: player X on a solution Queen, or wrong Queen placed
    const conflicts: string[] = [];
    if (board && level) {
      const xOnSolution = level.solution.filter(p => board.cells[p.row]?.[p.col]?.isX);
      if (xOnSolution.length > 0) {
        const names = xOnSolution.map(p => `r${p.row}c${p.col}`).join('、');
        conflicts.push(`答案格 ${names} 被标 X — 该棋盘无法被求解器解出。请撤销对应 X。`);
      }
      // Also check if solver can't solve current board
      if (solverResult && !solverResult.complete && xOnSolution.length > 0) {
        // additional detail already covered above
      }
    }

    const reasonBox = (content: ReactNode) => (
      <aside className="reason-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">REASONING</p>
            <h2>推理说明</h2>
          </div>
        </div>
        <div className={`reason-content${!currentBatch && conflicts.length === 0 ? ' empty-copy' : ''}`}>
          {conflicts.length > 0 && (
            <div className="reason-card" style={{ background: '#fff0ed', border: '1px solid #d85f47' }}>
              <strong style={{ color: '#b82727' }}>⚠ 冲突</strong>
              {conflicts.map((c, i) => <p key={i} style={{ margin: '6px 0 0', color: '#9b3826' }}>{c}</p>)}
            </div>
          )}
          {content}
        </div>
      </aside>
    );

    if (!currentBatch) {
      return reasonBox('步骤 0：显示尚未执行任何推理的初始棋盘。');
    }

    const batch = currentBatch;
    const reason = batch.reason;
    const resultParts = [
      ...batch.queenConfirmed.map(q => `${coord(q)} 确认 Queen`),
      ...batch.eliminations.map(x => `${coord(x)} 画X`),
    ];
    const resultDesc = resultParts.length <= 3
      ? resultParts.join('、')
      : `${resultParts.length} 个结果`;
    const actionLabel = batch.queenConfirmed.length > 0 && batch.eliminations.length > 0
      ? '提交结论'
      : batch.queenConfirmed.length > 0
        ? '确认 Queen'
        : '画X';
    const isBranchLike = batch.rule === 'short_contradiction' ||
      batch.rule === 'branch_common_conclusion' ||
      batch.rule === 'branch_unique_survivor' ||
      batch.strategy === 'L4_Contradiction' ||
      batch.strategy === 'L5_Branch';

    return reasonBox(
      <>
        <div className="reason-card">
          <strong>
            <span className={`strategy-chip ${batch.strategy}`} style={{ marginRight: 6 }}>
              {batch.difficulty ?? batch.strategy}
            </span>
            步 {batch.index}
          </strong>
          <p>
            {actionLabel}: <span className="coordinate">{resultDesc}</span>
            {batch.eliminations.length > 0 && `（消除 ${batch.eliminations.length} X）`}
          </p>
        </div>

        {isBranchLike && reason && (
          <>
            <p className="logic-summary">
              {reason.rejectedAssumptions?.length
                ? `假设 ${listCells(reason.rejectedAssumptions)} 为 Queen -> ${reason.contradiction?.description ?? '产生矛盾'} -> 对应格画X。`
                : batch.description}
            </p>
            <p className="compact-detail">
              亮色 X 是推理前提，虚线圈是临时假设，半透明 X / Queen 是分支内传播，红框表示矛盾范围。
            </p>
            {reason.branches?.length ? (
              <details className="branch-details">
                <summary>查看 {reason.branches.length} 个分支（{reason.contradictoryBranchCount ?? reason.branches.filter(b => b.status === 'contradiction').length} 个矛盾）</summary>
                <div className="branch-list">
                  {reason.branches.map((branch, index) => (
                    <div key={index} className={`branch-card ${branch.status === 'contradiction' ? 'rejected' : 'survives'}`}>
                      <strong>{branchTitle(branch, index)}</strong>
                      <p>{branch.statusZh || (branch.status === 'contradiction' ? '产生矛盾' : '暂未矛盾')} · {traceSummary(branch.trace)}</p>
                      {branch.contradiction && <p>{branch.contradiction.description}</p>}
                    </div>
                  ))}
                </div>
              </details>
            ) : reason.trace?.length ? (
              <details className="trace-details">
                <summary>展开传播摘要（{traceSummary(reason.trace)}）</summary>
                <div className="trace-groups">
                  {reason.trace.slice(0, 24).map((item, index) => (
                    <div className="trace-group" key={`${item.mark}-${item.pos.row}-${item.pos.col}-${index}`}>
                      <strong>{index + 1}. {item.actionZh || item.ruleZh || item.mark}</strong>
                      <p>{coord(item.pos)}</p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </>
        )}

        {!isBranchLike && reason && (
          <div className="reason-card">
            {reason.sourceCandidates && reason.sourceCandidates.length > 0 && (
              <p>
                <strong>候选：</strong>
                {reason.sourceCandidates.map(c => (
                  <span key={`${c.row},${c.col}`} className="coordinate">{coord(c)} </span>
                ))}
              </p>
            )}
            {reason.remainingCandidates && reason.remainingCandidates.length > 0 && (
              <p><strong>剩余候选：</strong><span className="coordinate">{listCells(reason.remainingCandidates)}</span></p>
            )}
            {reason.groupSize && <p><strong>{reason.groupSize} 组锁定</strong></p>}
            {reason.sourceUnit && <p>来源：{unitLabel(reason.sourceUnit)}</p>}
            {reason.sourceUnits && <p>来源：{reason.sourceUnits.map(unitLabel).join('、')}</p>}
            {reason.targetUnit && <p>目标：{unitLabel(reason.targetUnit)}</p>}
            {reason.targetUnits && <p>目标：{reason.targetUnits.map(unitLabel).join('、')}</p>}
            {reason.assumptionCell && (
              <p>
                假设 <span className="coordinate">{coord(reason.assumptionCell)}</span> 为 Queen
                {reason.contradictionType && ' → 产生矛盾 → 排除该格'}
              </p>
            )}
          </div>
        )}

        <p className="logic-summary">{batch.description}</p>
      </>
    );
  }

  // ── Steps Timeline ──
  if (role === 'steps') {
    const batches = solverResult?.batches ?? [];

    return (
      <aside className="steps-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">TIMELINE</p>
            <h2>解题步骤</h2>
          </div>
        </div>
        <div className="step-list">
          <button
            className={`step-item${solverStepIndex === 0 ? ' active' : ''}`}
            onClick={() => setSolverStep(0)}
          >
            <span className="step-number">0</span>
            <span className="step-main">
              <strong>初始棋盘</strong>
              <small>尚未执行推理</small>
            </span>
            <span className="level-chip">START</span>
          </button>
          {batches.map((batch, i) => (
            <button
              key={batch.index}
              className={`step-item${i === solverStepIndex - 1 ? ' active' : ''}`}
              onClick={() => setSolverStep(i + 1)}
            >
              <span className="step-number">{batch.index}</span>
              <span className="step-main">
                <strong>
                  {batch.ruleZh ?? (batch.queenConfirmed.length > 0 ? '确认 Queen' : '画X')}
                </strong>
                <small>
                  {batch.queenConfirmed.length > 0
                    ? coord(batch.queenConfirmed[0])
                    : `消除 ${batch.eliminations.length} 个`}
                  {batch.reason?.groupSize ? ` · ${batch.reason.groupSize}组` : ''}
                  {batch.reason?.branchCount ? ` · ${batch.reason.branchCount}分支` : ''}
                </small>
              </span>
              <span className="level-chip">{batch.difficulty ?? batch.strategy}</span>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  // ── Difficulty Curve ──
  if (role === 'difficultyCurve') {
    const batches = solverResult?.batches ?? [];
    const width = 900;
    const height = 240;
    const margin = { left: 48, right: 18, top: 20, bottom: 34 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const curveData = useMemo(() => {
      const total = Math.max(1, batches.length);
      const x = (i: number) => margin.left + (total <= 1 ? plotW / 2 : i * plotW / (total - 1));
      const y = (level: number) => margin.top + (5 - level) * plotH / 4;
      return batches.map((batch, i) => {
        const level = Number(String(batch.difficulty ?? batch.strategy.match(/^L\d/)?.[0] ?? 'L1').replace('L', '')) || 1;
        return {
          step: i + 1,
          level: Math.max(1, Math.min(5, level)),
          x: x(i),
          y: y(Math.max(1, Math.min(5, level))),
          label: `${batch.difficulty ?? batch.strategy} ${batch.difficultyZh ?? batch.ruleZh ?? ''}`.trim(),
        };
      });
    }, [batches]);

    const linePath = curveData.length
      ? `M ${curveData.map(point => `${point.x} ${point.y}`).join(' L ')}`
      : '';
    const areaPath = curveData.length
      ? `${linePath} L ${curveData[curveData.length - 1].x} ${height - margin.bottom} L ${curveData[0].x} ${height - margin.bottom} Z`
      : '';
    const activePoint = curveData.find(point => point.step === solverStepIndex);

    const currentBatch = solverStepIndex > 0 && solverResult
      ? solverResult.batches[solverStepIndex - 1]
      : null;

    return (
      <section className="curve-card">
        <div className="curve-heading">
          <div>
            <strong>推理难度曲线</strong>
            <span>横轴为推理步，纵轴为 L1-L5</span>
          </div>
          <span id="curvePointLabel">
            {currentBatch ? `步骤 ${solverStepIndex} · ${currentBatch.difficulty ?? currentBatch.strategy}` : '步骤 0'}
          </span>
        </div>
        <svg id="difficultyCurve" viewBox="0 0 900 240" role="img" aria-label="推理难度曲线">
          {[1, 2, 3, 4, 5].map(level => {
            const y = margin.top + (5 - level) * plotH / 4;
            return (
              <g key={level}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="curve-grid" />
                <text x={12} y={y + 4} className="curve-axis-label">L{level}</text>
              </g>
            );
          })}
          {areaPath && <path d={areaPath} className="curve-area" />}
          {linePath && <path d={linePath} className="curve-line" />}
          {activePoint && (
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={margin.top}
              y2={height - margin.bottom}
              className="curve-cursor"
            />
          )}
          {curveData.map(point => (
            <circle
              key={point.step}
              cx={point.x}
              cy={point.y}
              r={point.step === solverStepIndex ? 8 : 5}
              className={`curve-point${point.step === solverStepIndex ? ' active' : ''}`}
              data-step={point.step}
              tabIndex={0}
              role="button"
              aria-label={`步骤 ${point.step} · ${point.label}`}
              onClick={() => setSolverStep(point.step)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') setSolverStep(point.step);
              }}
            >
              <title>{`步骤 ${point.step} · ${point.label}`}</title>
            </circle>
          ))}
        </svg>
      </section>
    );
  }

  return null;
}
