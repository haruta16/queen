import { useGameStore } from '../game/store';
import { levelSummaries, getLevelById } from '../levels';

export default function LevelSelect() {
  const level = useGameStore(s => s.level);
  const loadLevel = useGameStore(s => s.loadLevel);
  const solverPanelOpen = useGameStore(s => s.solverPanelOpen);

  const currentId = level ? Number(level.id.replace('lv-', '')) : 0;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    if (!id) return;
    const lv = getLevelById(id);
    if (lv) {
      loadLevel(lv);
      // 如果关闭了面板，打开它
      if (!solverPanelOpen) {
        useGameStore.getState().setSolverPanelOpen(true);
      }
    }
  };

  return (
    <div className="level-select-wrap">
      <label className="level-select-label" htmlFor="level-select">关卡</label>
      <select
        id="level-select"
        className="level-select"
        value={currentId || ''}
        onChange={handleChange}
      >
        {!currentId && <option value="" disabled>选择关卡…</option>}
        {levelSummaries.map(s => (
          <option key={s.id} value={s.id}>
            #{s.id} · {s.n}×{s.n}
          </option>
        ))}
      </select>
    </div>
  );
}
