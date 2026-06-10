import { create } from 'zustand';
import {
  BoardState, Level, SolverResult, OpHistoryEntry, GeneratorParams, GenerationResult,
} from './types';
import {
  createEmptyBoard, applyX, removeX, applyQueen,
  applyWrong,
  isBoardComplete,
  formatPos,
} from './rules';
import { solve, applyBatchesUpTo } from './solver';
import { generateLevelResult } from './generator';
import { importLevelViaAnalyzer } from './importer';

// ============================================================
// 游戏状态 — zustand store
// ============================================================

export type GeneratorDraft = {
  n: number;
  targetSteps: number;
  seed: number | null;
  maxAttempts: number;
  allowApproximate: boolean;
};

interface GameState {
  // 当前关卡
  level: Level | null;

  // 玩家棋盘状态
  board: BoardState | null;

  // 操作历史（仅 X 标记，用于撤销/重做）
  xHistory: OpHistoryEntry[];
  redoStack: OpHistoryEntry[];

  // 求解器展示状态
  solverResult: SolverResult | null;
  solverStepIndex: number;
  solverPanelOpen: boolean;
  boardMode: 'hints' | 'board';

  // 生成器状态
  isGenerating: boolean;
  generationError: string | null;
  generatorDraft: GeneratorDraft;
  lastGeneratedLevel: Level | null;
  lastGenerationResult: GenerationResult | null;

  // UI 反馈
  message: string | null;
  messageType: 'info' | 'error' | 'success';

  // 操作
  loadLevel: (level: Level) => void;
  recomputeSolver: () => void;
  toggleX: (row: number, col: number) => void;
  confirmQueen: (row: number, col: number) => string | null;
  undoX: () => void;
  redoX: () => void;
  resetBoard: () => void;
  setSolverStep: (index: number) => void;
  setSolverPanelOpen: (open: boolean) => void;
  setBoardMode: (mode: 'hints' | 'board') => void;
  requestGenerate: (params: GeneratorParams) => Promise<GenerationResult>;
  setGeneratorDraft: (patch: Partial<GeneratorDraft>) => void;
  enterGeneratedLevel: () => boolean;
  clearMessage: () => void;
  getSolverBoardAtStep: (stepIndex: number) => BoardState | null;
  importLevelFromFile: (file: File) => Promise<{ level: Level | null; error: string | null }>;
}

export const useGameStore = create<GameState>((set, get) => {
  // 面板打开时棋盘变化 → 下一帧重算（去抖合并连续操作）
  // 不再先清除 solverResult，因为 Board 始终用真实棋盘 + cellMetas 叠加层
  let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
  const maybeRecompute = () => {
    if (!get().solverPanelOpen) return;
    if (recomputeTimer) clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(() => get().recomputeSolver(), 0);
  };

  return {
  level: null,
  board: null,
  xHistory: [],
  redoStack: [],
  solverResult: null,
  solverStepIndex: 0,
  solverPanelOpen: false,
  boardMode: 'hints' as const,
  isGenerating: false,
  generationError: null,
  generatorDraft: {
    n: 6,
    targetSteps: 6,
    seed: null,
    maxAttempts: 2500,
    allowApproximate: true,
  },
  lastGeneratedLevel: null,
  lastGenerationResult: null,
  message: null,
  messageType: 'info',

  loadLevel: (level) => {
    const board = createEmptyBoard(level.n, level.regions);
    set({
      level,
      board,
      xHistory: [],
      redoStack: [],
      solverResult: level.solverResult,
      solverStepIndex: 0,
      solverPanelOpen: true,
      boardMode: 'hints' as const,
      message: `关卡已加载: ${level.n}×${level.n} / ${level.actualSteps}步`,
      messageType: 'info',
    });
  },

  recomputeSolver: () => {
    const { board } = get();
    if (!board) return;
    const result = solve(board);
    set({ solverResult: result, solverStepIndex: 0 });
  },

  toggleX: (row, col) => {
    const { board } = get();
    if (!board) return;

    const cell = board.cells[row][col];
    // 已翻面的格子不可再操作
    if (cell.isQueen || cell.isWrong) return;

    if (cell.isX) {
      // 移除 X
      const newBoard = removeX(board, { row, col });
      set({
        board: newBoard,
        xHistory: [...get().xHistory, { pos: { row, col }, wasX: true }],
        redoStack: [],
        solverStepIndex: 0,
        message: null,
      });
    } else {
      // 放置 X
      const newBoard = applyX(board, { row, col });
      set({
        board: newBoard,
        xHistory: [...get().xHistory, { pos: { row, col }, wasX: false }],
        redoStack: [],
        solverStepIndex: 0,
        message: null,
      });
    }
    maybeRecompute();
  },

  confirmQueen: (row, col) => {
    const { board, level } = get();
    if (!board) return '无棋盘状态';
    if (!level) return '无关卡答案';

    const cell = board.cells[row][col];
    if (cell.isQueen) return '此格已是 Queen';
    if (cell.isWrong) return '此格已翻出红 X';

    const isSolutionQueen = level.solution.some(pos => pos.row === row && pos.col === col);
    if (!isSolutionQueen) {
      const newBoard = applyWrong(board, { row, col });
      set({
        board: newBoard,
        redoStack: [],
        solverStepIndex: 0,
        message: `不是 Queen: ${formatPos({ row, col })}`,
        messageType: 'error',
      });
      maybeRecompute();
      return null;
    }

    // 放置 Queen
    const { board: newBoard } = applyQueen(board, { row, col });

    // 检查是否完成
    const complete = isBoardComplete(newBoard);

    set({
      board: newBoard,
      // Queen 确认后棋盘大面积变化，清空操作历史
      xHistory: [],
      redoStack: [],
      solverStepIndex: 0,
      message: complete ? '恭喜！所有 Queen 已就位！' : `Queen 确认: ${formatPos({ row, col })}`,
      messageType: complete ? 'success' : 'info',
    });

    maybeRecompute();
    return null;
  },

  undoX: () => {
    const { board, xHistory } = get();
    if (!board || xHistory.length === 0) return;

    const lastOp = xHistory[xHistory.length - 1];
    const newHistory = xHistory.slice(0, -1);

    let newBoard: BoardState;
    if (lastOp.wasX) {
      // 该格之前是 X（操作把它移除了）→ 撤销就是放回 X
      newBoard = applyX(board, lastOp.pos);
    } else {
      // 该格之前不是 X（操作放置了 X）→ 撤销就是移除 X
      newBoard = removeX(board, lastOp.pos);
    }

    set({
      board: newBoard,
      xHistory: newHistory,
      redoStack: [...get().redoStack, lastOp],
      solverStepIndex: 0,
      message: null,
    });
    maybeRecompute();
  },

  redoX: () => {
    const { board, redoStack, xHistory } = get();
    if (!board || redoStack.length === 0) return;

    const op = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);

    let newBoard: BoardState;
    if (op.wasX) {
      // 重做 = 再次移除 X（撤销把它恢复了）
      newBoard = removeX(board, op.pos);
    } else {
      // 重做 = 再次放置 X
      newBoard = applyX(board, op.pos);
    }

    set({
      board: newBoard,
      xHistory: [...xHistory, op],
      redoStack: newRedo,
      solverStepIndex: 0,
      message: null,
    });
    maybeRecompute();
  },

  resetBoard: () => {
    const { level } = get();
    if (!level) return;
    const board = createEmptyBoard(level.n, level.regions);
    set({
      board,
      xHistory: [],
      redoStack: [],
      solverStepIndex: 0,
      solverResult: level.solverResult,
      boardMode: 'hints' as const,
      message: '棋盘已重置',
      messageType: 'info',
    });
    maybeRecompute();
  },

  setSolverStep: (index) => {
    const { solverResult } = get();
    if (!solverResult) return;
    const clamped = Math.max(0, Math.min(index, solverResult.totalSteps));
    set({ solverStepIndex: clamped });
  },

  setSolverPanelOpen: (open) => {
    if (open) {
      set({ solverPanelOpen: true });
      get().recomputeSolver();
    } else {
      // 关闭面板时清空求解结果
      set({ solverPanelOpen: false, solverResult: null, solverStepIndex: 0, boardMode: 'hints' as const });
    }
  },

  setBoardMode: (mode) => set({ boardMode: mode }),

  requestGenerate: async (params) => {
    const actualSeed = params.seed ?? Date.now();
    const maxAttempts = params.maxAttempts ?? get().generatorDraft.maxAttempts;
    const allowApproximate = params.allowApproximate ?? get().generatorDraft.allowApproximate;
    set({
      isGenerating: true,
      generationError: null,
      generatorDraft: {
        n: params.n,
        targetSteps: params.targetSteps,
        seed: params.seed ?? null,
        maxAttempts,
        allowApproximate,
      },
    });

    try {
      // setTimeout(0) 让生成不阻塞 UI 渲染
      const result = await new Promise<GenerationResult>((resolve) => {
        setTimeout(() => {
          resolve(generateLevelResult({
            n: params.n,
            targetSteps: params.targetSteps,
            seed: actualSeed,
            maxAttempts,
            allowApproximate,
          }));
        }, 50);
      });

      if (result.level) {
        const level = result.level;
        set({
          isGenerating: false,
          lastGeneratedLevel: level,
          lastGenerationResult: result,
          message: result.status === 'exact'
            ? `生成完成: 精确命中 ${level.actualSteps} 步`
            : `生成完成: 近似结果 ${level.actualSteps} 步，目标 ${params.targetSteps} 步`,
          messageType: result.status === 'exact' ? 'success' : 'info',
        });
        return result;
      } else {
        set({
          isGenerating: false,
          lastGeneratedLevel: null,
          lastGenerationResult: result,
          generationError: `未命中目标: 已尝试 ${result.diagnostics.attempts}/${result.diagnostics.maxAttempts} 次`,
          message: '关卡生成失败，没有返回不符合条件的关卡',
          messageType: 'error',
        });
        return result;
      }
    } catch (e) {
      const failed: GenerationResult = {
        status: 'failed',
        level: null,
        diagnostics: {
          status: 'failed',
          attempts: 0,
          maxAttempts,
          elapsedMs: 0,
          seed: actualSeed,
          targetSteps: params.targetSteps,
          bestActualSteps: null,
          bestDiff: null,
          selectedAttempt: null,
          selectedAttemptSeed: null,
          completeCandidates: 0,
          incompleteCandidates: 0,
          exactCandidates: 0,
          allowApproximate,
        },
      };
      set({
        isGenerating: false,
        lastGeneratedLevel: null,
        lastGenerationResult: failed,
        generationError: `生成错误: ${String(e)}`,
        message: '生成过程出错',
        messageType: 'error',
      });
      return failed;
    }
  },

  setGeneratorDraft: (patch) => set(state => ({
    generatorDraft: { ...state.generatorDraft, ...patch },
  })),

  enterGeneratedLevel: () => {
    const level = get().lastGeneratedLevel;
    if (!level) return false;
    get().loadLevel(level);
    return true;
  },

  clearMessage: () => set({ message: null }),

  // 在给定棋盘上叠加求解器批次，重建对应步骤的预览棋盘（保留供外部使用）
  getSolverBoardAtStep: (stepIndex) => {
    const { board, solverResult } = get();
    if (!board || !solverResult || stepIndex <= 0) return null;
    return applyBatchesUpTo(board, solverResult.batches, stepIndex);
  },

  importLevelFromFile: async (file) => {
    const startedAt = performance.now();
    set({
      isGenerating: true,
      generationError: null,
      message: '正在分析导入文件...',
      messageType: 'info',
    });
    const result = await importLevelViaAnalyzer(file);
    if (!result.level) {
      set({
        isGenerating: false,
        generationError: result.error,
        message: result.error || '导入失败',
        messageType: 'error',
      });
      return result;
    }

    const level = result.level;
    set({
      isGenerating: false,
      lastGeneratedLevel: level,
      lastGenerationResult: {
        status: 'exact',
        level,
        diagnostics: {
          status: 'exact',
          attempts: 1,
          maxAttempts: 1,
          elapsedMs: Math.round(performance.now() - startedAt),
          seed: level.seed,
          targetSteps: level.targetSteps,
          bestActualSteps: level.actualSteps,
          bestDiff: 0,
          selectedAttempt: 1,
          selectedAttemptSeed: level.seed,
          completeCandidates: 1,
          incompleteCandidates: 0,
          exactCandidates: 1,
          allowApproximate: true,
        },
      },
      generationError: null,
      message: `导入完成: ${level.n}×${level.n} / ${level.actualSteps}步`,
      messageType: 'success',
    });
    return result;
  },
  };
});
