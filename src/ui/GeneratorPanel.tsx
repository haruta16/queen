import { useState } from 'react';
import { useGameStore } from '../game/store';
import { ComplexityLabel } from '../game/types';

export default function GeneratorPanel() {
  const open = useGameStore(s => s.generatorPanelOpen);
  const setOpen = useGameStore(s => s.setGeneratorPanelOpen);
  const isGenerating = useGameStore(s => s.isGenerating);
  const generationError = useGameStore(s => s.generationError);
  const requestGenerate = useGameStore(s => s.requestGenerate);

  const [n, setN] = useState(5);
  const [complexity, setComplexity] = useState<ComplexityLabel>('中等');

  const handleGenerate = () => {
    requestGenerate(n, complexity);
  };

  if (!open) return null;

  return (
    <div className="panel-overlay" onClick={() => setOpen(false)}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">⚡ 生成关卡</span>
          <button className="panel-close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="panel-body">
          {/* Board size */}
          <div className="gen-section">
            <div className="gen-section-label">棋盘大小 n × n</div>
            <div className="gen-size-group">
              {[5, 6, 7, 8, 9, 10].map(size => (
                <button
                  key={size}
                  className={`gen-size-btn ${size === n ? 'selected' : ''}`}
                  onClick={() => setN(size)}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* Complexity */}
          <div className="gen-section">
            <div className="gen-section-label">难度</div>
            <div className="gen-complexity-group">
              {(['简单', '中等', '困难'] as ComplexityLabel[]).map(label => (
                <button
                  key={label}
                  className={`gen-complexity-btn ${label === complexity ? 'selected' : ''}`}
                  onClick={() => setComplexity(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            className="gen-generate-btn"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="spinner" />
                生成中...
              </>
            ) : (
              `生成 ${n}×${n} ${complexity} 关卡`
            )}
          </button>

          {generationError && (
            <div className="gen-error">{generationError}</div>
          )}
        </div>
      </div>
    </div>
  );
}
