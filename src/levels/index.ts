/**
 * 关卡加载器 — 从 Bullpen Levels 目录批量导入 JSON
 * colorMasks（bitmask）→ 顺序 regionId
 * cows（x=col, y=row）→ Position（row, col）
 *
 * 设计：region 数据在导入时立即解析（轻量），solver 在首次加载关卡时按需计算。
 */

import type { Level, Position, Region } from '../game/types';
import { createEmptyBoard, getQueenPositions } from '../game/rules';
import { solve } from '../game/solver';

// ── 原始 JSON 类型 ──────────────────────────────────────────

interface RawLevel {
  LevelID: number;
  size: number;
  difficulty: number;
  seed: number;
  colorMasks: number[];
  cows: { x: number; y: number }[];
  note?: string;
}

// ── 批量导入 ────────────────────────────────────────────────

const modules = import.meta.glob<{ default: RawLevel }>('./data/*.json', { eager: true });

const rawLevels: RawLevel[] = Object.entries(modules)
  .map(([path, mod]) => {
    const raw = mod.default;
    if (!raw.LevelID) {
      const match = path.match(/(\d+)\.json$/);
      raw.LevelID = match ? Number(match[1]) : 0;
    }
    return raw;
  })
  .filter(r => r.size >= 5 && r.size <= 10 && r.cows?.length === r.size)
  .sort((a, b) => a.LevelID - b.LevelID);

// ── 转换函数 ────────────────────────────────────────────────

function normalizeColorMasks(masks: number[]): number[] {
  const remap = new Map<number, number>();
  return masks.map(m => {
    if (!remap.has(m)) remap.set(m, remap.size);
    return remap.get(m)!;
  });
}

function cowsToPositions(cows: { x: number; y: number }[]): Position[] {
  return cows.map(c => ({ row: c.y, col: c.x }));
}

// ── 缓解析：regions 立即构建，solver 按需计算 ───────────────

interface LevelShell {
  raw: RawLevel;
  regions: Region[];
  solution: Position[];
}

const shellCache = new Map<number, LevelShell>();

function buildShell(raw: RawLevel): LevelShell {
  const n = raw.size;
  const normalizedMasks = normalizeColorMasks(raw.colorMasks);

  const regionMap = new Map<number, Position[]>();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const rid = normalizedMasks[r * n + c];
      if (!regionMap.has(rid)) regionMap.set(rid, []);
      regionMap.get(rid)!.push({ row: r, col: c });
    }
  }
  const regions: Region[] = [...regionMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, cells]) => ({ id, cells }));

  return { raw, regions, solution: cowsToPositions(raw.cows) };
}

function getShell(id: number): LevelShell {
  if (!shellCache.has(id)) {
    const raw = rawLevels.find(r => r.LevelID === id);
    if (!raw) throw new Error(`Level ${id} not found`);
    shellCache.set(id, buildShell(raw));
  }
  return shellCache.get(id)!;
}

// ── 懒加载：首次访问时跑 solver ─────────────────────────────

const levelCache = new Map<number, Level>();

function buildLevel(shell: LevelShell): Level {
  const { raw, regions, solution } = shell;
  const n = raw.size;
  const board = createEmptyBoard(n, regions);
  const solverResult = solve(board);

  return {
    id: `lv-${raw.LevelID}`,
    n,
    regions,
    solution,
    seed: raw.seed,
    targetSteps: solverResult.totalSteps,
    actualSteps: solverResult.totalSteps,
    strategySequence: solverResult.batches.map(b => b.strategy),
    solverResult,
    source: 'imported-json',
    validation: { uniqueSolution: solverResult.complete },
  };
}

// ── 公开 API ────────────────────────────────────────────────

/** 关卡摘要（不触发 solver），用于下拉列表 */
export interface LevelSummary {
  id: number;
  n: number;
}

export const levelSummaries: LevelSummary[] = rawLevels.map(r => ({
  id: r.LevelID,
  n: r.size,
}));

/** 按 ID 获取完整关卡（首次触发 solver） */
export function getLevelById(id: number): Level | undefined {
  if (levelCache.has(id)) return levelCache.get(id)!;
  const shell = getShell(id);
  const level = buildLevel(shell);
  levelCache.set(id, level);
  return level;
}

/** 随机获取一个关卡 */
export function randomLevel(): Level {
  const i = Math.floor(Math.random() * rawLevels.length);
  return getLevelById(rawLevels[i].LevelID)!;
}

/** 关卡总数 */
export const levelCount = rawLevels.length;
