import { useRef, useState, useCallback, type DragEvent } from 'react';
import { useGameStore } from '../game/store';

export default function QuickImport() {
  const [dragover, setDragover] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importLevelFromFile = useGameStore(s => s.importLevelFromFile);
  const loadLevel = useGameStore(s => s.loadLevel);

  const processFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const { level, error } = await importLevelFromFile(file);
      if (level) {
        loadLevel(level);
      } else if (error) {
        // 短暂提示
        useGameStore.setState({
          message: error,
          messageType: 'error',
        });
      }
    } finally {
      setBusy(false);
    }
  }, [importLevelFromFile, loadLevel]);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  return (
    <div
      className={`quick-import${dragover ? ' dragover' : ''}${busy ? ' busy' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragover(true); }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
      onClick={() => fileRef.current?.click()}
      title="拖拽截图或 JSON 到此，自动识别并加载关卡"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,.json,application/json"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <span className="quick-import-icon">{busy ? '⏳' : '🖼'}</span>
      <span className="quick-import-label">
        {busy ? '识别中…' : dragover ? '松手导入' : '拖入图片'}
      </span>
    </div>
  );
}
