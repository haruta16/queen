import { useEffect } from 'react';
import { useGameStore } from './game/store';
import Hud from './ui/Hud';
import Board from './ui/Board';
import Toolbar from './ui/Toolbar';
import SolverPanel from './ui/SolverPanel';
import GeneratorPanel from './ui/GeneratorPanel';

export default function App() {
  const message = useGameStore(s => s.message);
  const messageType = useGameStore(s => s.messageType);
  const clearMessage = useGameStore(s => s.clearMessage);
  const isGenerating = useGameStore(s => s.isGenerating);

  // Auto-clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(clearMessage, 3000);
      return () => clearTimeout(timer);
    }
  }, [message, clearMessage]);

  return (
    <div className="app-layout">
      <Hud />
      <div className="app-main">
        {isGenerating ? (
          <div className="placeholder">
            <span className="spinner" />
            <span style={{ marginLeft: 8 }}>正在生成关卡...</span>
          </div>
        ) : (
          <Board />
        )}
      </div>
      <Toolbar />

      {/* Message toast */}
      {message && (
        <div className={`message-toast ${messageType}`}>
          {message}
        </div>
      )}

      {/* Panels */}
      <SolverPanel />
      <GeneratorPanel />
    </div>
  );
}
