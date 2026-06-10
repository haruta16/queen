import { useRef, useEffect, useMemo } from 'react';
import { useGameStore } from '../game/store';

export default function SolverPanel({ role }: { role: 'reasoning' | 'steps' | 'difficultyCurve' }) {
  const solverResult = useGameStore(s => s.solverResult);
  const solverStepIndex = useGameStore(s => s.solverStepIndex);
  const setSolverStep = useGameStore(s => s.setSolverStep);

  // ── Reasoning Panel ──
  if (role === 'reasoning') {
    const currentBatch = solverResult && solverStepIndex > 0
      ? solverResult.batches[solverStepIndex - 1]
      : null;

    const reasonBox = (content: React.ReactNode) => (
      <aside className="reason-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">REASONING</p>
            <h2>推理说明</h2>
          </div>
        </div>
        <div id="reasonContent" className={`reason-content${!currentBatch ? ' empty-copy' : ''}`}>
          {content}
        </div>
      </aside>
    );

    if (!currentBatch) {
      return reasonBox('步骤 0：显示尚未执行任何推理的初始棋盘。');
    }

    const batch = currentBatch;
    const reason = batch.reason;
    const resultDesc = batch.queenConfirmed.length > 0
      ? batch.queenConfirmed.map(q => `r${q.row}c${q.col}`).join('、')
      : batch.eliminations.length === 1
        ? `r${batch.eliminations[0].row}c${batch.eliminations[0].col}`
        : `${batch.eliminations.length} 个格子`;

    const actionLabel = batch.queenConfirmed.length > 0 ? '确认 Queen' : '画X';

    return reasonBox(
      <>
        <div className="reason-card">
          <strong>
            <span className={`strategy-chip ${batch.strategy}`} style={{ marginRight: 6 }}>
              {batch.strategy}
            </span>
            步 {batch.index}
          </strong>
          <p>
            {actionLabel}：<span className="coordinate">{resultDesc}</span>
            {batch.eliminations.length > 0 && `（消除 ${batch.eliminations.length} X）`}
          </p>
        </div>

        {reason && (
          <div className="reason-card">
            {reason.sourceCandidates && reason.sourceCandidates.length > 0 && (
              <p>
                <strong>候选：</strong>
                {reason.sourceCandidates.map(c => (
                  <span key={`${c.row},${c.col}`} className="coordinate">r{c.row}c{c.col} </span>
                ))}
              </p>
            )}
            {reason.groupSize && <p><strong>{reason.groupSize} 组锁定</strong></p>}
            {reason.assumptionCell && (
              <p>
                假设 <span className="coordinate">r{reason.assumptionCell.row}c{reason.assumptionCell.col}</span> 为 Queen
                {reason.contradictionType && ' → 产生矛盾 → 排除该格'}
              </p>
            )}
            {reason.sourceUnit && (
              <p>源：{reason.sourceUnit.kind === 'row' ? '行' : reason.sourceUnit.kind === 'col' ? '列' : '区域'}{reason.sourceUnit.index}</p>
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
                  {batch.queenConfirmed.length > 0 ? '确认 Queen' : '画X'}
                </strong>
                <small>
                  {batch.queenConfirmed.length > 0
                    ? `r${batch.queenConfirmed[0].row}c${batch.queenConfirmed[0].col}`
                    : `消除 ${batch.eliminations.length} 个`}
                  {batch.reason?.groupSize ? ` · ${batch.reason.groupSize}组` : ''}
                </small>
              </span>
              <span className="level-chip">{batch.strategy}</span>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  // ── Difficulty Curve ──
  if (role === 'difficultyCurve') {
    const batches = solverResult?.batches ?? [];
    const curveRef = useRef<SVGSVGElement>(null);

    const curveData = useMemo(() =>
      batches.map((b, i) => ({
        step: i + 1,
        level: b.strategy.startsWith('L1') ? 1 : b.strategy.startsWith('L2') ? 2 : 3,
        strategy: b.strategy,
      })),
    [batches]);

    useEffect(() => {
      const svg = curveRef.current;
      if (!svg || curveData.length === 0) return;

      // Only rebuild if data changed (not on step cursor move)
      const existing = svg.querySelector('.curve-point');
      if (existing) return;
      svg.innerHTML = '';

      const width = 900;
      const height = 240;
      const margin = { left: 48, right: 18, top: 20, bottom: 34 };
      const plotW = width - margin.left - margin.right;
      const plotH = height - margin.top - margin.bottom;
      const total = curveData.length;
      const x = (i: number) => margin.left + (total <= 1 ? plotW / 2 : (i) * plotW / (total - 1));
      const y = (lvl: number) => margin.top + (3 - lvl) * plotH / 2;

      const svgNS = 'http://www.w3.org/2000/svg';
      const mk = (tag: string, attrs: Record<string, string>) => {
        const el = document.createElementNS(svgNS, tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
      };

      for (let lvl = 1; lvl <= 3; lvl++) {
        const ly = y(lvl);
        svg.appendChild(mk('line', { x1: String(margin.left), x2: String(width - margin.right), y1: String(ly), y2: String(ly), class: 'curve-grid' }));
        const label = mk('text', { x: '12', y: String(ly + 4), class: 'curve-axis-label' });
        label.textContent = `L${lvl}`;
        svg.appendChild(label);
      }

      const points = curveData.map((d, i) => [x(i), y(d.level)] as [number, number]);

      if (points.length > 1) {
        const d = `M ${points.map(([px, py]) => `${px} ${py}`).join(' L ')}`;
        const areaD = `${d} L ${points[points.length - 1][0]} ${height - margin.bottom} L ${points[0][0]} ${height - margin.bottom} Z`;
        svg.appendChild(mk('path', { d: areaD, class: 'curve-area' }));
        svg.appendChild(mk('path', { d: d, class: 'curve-line' }));
      }

      const cursor = mk('line', { id: 'curveCursor', x1: String(margin.left), x2: String(margin.left), y1: String(margin.top), y2: String(height - margin.bottom), class: 'curve-cursor' });
      cursor.style.display = 'none';
      svg.appendChild(cursor);

      points.forEach(([cx, cy], i) => {
        const circle = mk('circle', { cx: String(cx), cy: String(cy), r: '5', class: 'curve-point', 'data-step': String(i + 1) });
        circle.setAttribute('tabindex', '0');
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = `步骤 ${i + 1} · ${curveData[i].strategy}`;
        circle.appendChild(title);
        circle.addEventListener('click', () => setSolverStep(i + 1));
        svg.appendChild(circle);
      });

      // update cursor position
      const activePt = svg.querySelector(`.curve-point[data-step="${solverStepIndex}"]`);
      svg.querySelectorAll('.curve-point').forEach(p => p.classList.remove('active'));
      activePt?.classList.add('active');
      const actEl = svg.querySelector(`.curve-point[data-step="${solverStepIndex}"]`);
      if (actEl) {
        const cx = actEl.getAttribute('cx') || '0';
        cursor.setAttribute('x1', cx);
        cursor.setAttribute('x2', cx);
        cursor.style.display = '';
      }
    }, [curveData, solverStepIndex, setSolverStep]);

    const currentBatch = solverStepIndex > 0 && solverResult
      ? solverResult.batches[solverStepIndex - 1]
      : null;

    return (
      <section className="curve-card">
        <div className="curve-heading">
          <div>
            <strong>推理难度曲线</strong>
            <span>横轴为推理步，纵轴为 L1–L3</span>
          </div>
          <span id="curvePointLabel">
            {currentBatch ? `步骤 ${solverStepIndex} · ${currentBatch.strategy}` : '步骤 0'}
          </span>
        </div>
        <svg ref={curveRef} id="difficultyCurve" viewBox="0 0 900 240" role="img" aria-label="推理难度曲线" />
      </section>
    );
  }

  return null;
}
