import { useEffect, useState } from 'react';
import { useGameStore } from './game/store';
import Hud from './ui/Hud';
import Board from './ui/Board';
import Toolbar from './ui/Toolbar';
import SolverPanel from './ui/SolverPanel';
import GeneratorPanel from './ui/GeneratorPanel';

export default function App() {
  const [appMode, setAppMode] = useState<'mainline' | 'generator'>('mainline');
  const message = useGameStore(s => s.message);
  const messageType = useGameStore(s => s.messageType);
  const clearMessage = useGameStore(s => s.clearMessage);
  const isGenerating = useGameStore(s => s.isGenerating);
  const level = useGameStore(s => s.level);
  const requestGenerate = useGameStore(s => s.requestGenerate);
  const loadLevel = useGameStore(s => s.loadLevel);

  // 主线启动时自动加载一个确定性关卡
  useEffect(() => {
    if (!level) {
      requestGenerate({
        n: 6,
        targetSteps: 12,
        seed: 20260515,
        maxAttempts: 2500,
        allowApproximate: true,
      }).then(result => {
        if (result.level) loadLevel(result.level);
      });
    }
  }, [level, requestGenerate, loadLevel]);

  // 消息 3 秒后自动消失
  useEffect(() => {
    if (message) {
      const timer = setTimeout(clearMessage, 3000);
      return () => clearTimeout(timer);
    }
  }, [message, clearMessage]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-kicker">皇后消元</span>
          <h1>皇后消元</h1>
        </div>
        <nav className="mode-tabs" aria-label="应用模式">
          <button className={appMode === 'mainline' ? 'active' : ''} onClick={() => setAppMode('mainline')}>
            主线
          </button>
          <button className={appMode === 'generator' ? 'active' : ''} onClick={() => setAppMode('generator')}>
            关卡生成器
          </button>
        </nav>
      </header>

      {appMode === 'mainline' ? (
        <>
          <Hud />
          <div className="main-area">
            <div className="app-main">
              {isGenerating ? (
                <div className="placeholder">
                  <span className="spinner" />
                  <span style={{ marginLeft: 8 }}>正在装配主线关卡...</span>
                </div>
              ) : (
                <Board />
              )}
            </div>
            <SolverPanel />
          </div>
          <Toolbar onOpenGenerator={() => setAppMode('generator')} />
        </>
      ) : (
        <GeneratorPanel onEnterMainline={() => setAppMode('mainline')} />
      )}

      {/* Message toast */}
      {message && (
        <div className={`message-toast ${messageType}`}>
          {message}
        </div>
      )}
    </div>
  );
}
