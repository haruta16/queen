import { RNG } from './types';

/**
 * Mulberry32 — 快速高质量的 32 位种子化伪随机数生成器。
 * 相同种子产生相同的 [0, 1) 序列。
 */
export function createRNG(seed: number): RNG {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌，使用指定随机数生成器 */
export function shuffle<T>(arr: T[], rng: RNG): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
