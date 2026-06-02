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
import { solve } from './solver';
import { generateLevelResult } from './generator';

// ============================================================
// Game Store — zustand
// ============================================================

export type InteractionMode = 'markX' | 'confirmQueen';

export type GeneratorDraft = {
  n: number;
  targetSteps: number;
  seed: number | null;
  maxAttempts: number;
  allowApproximate: boolean;
};

interface GameState {
  // Current level
  level: Level | null;

  // Player board state
  board: BoardState | null;

  // Interaction mode
  mode: InteractionMode;
  setMode: (mode: InteractionMode) => void;

  // Operation history for undo/redo (X marks only)
  xHistory: OpHistoryEntry[];
  redoStack: OpHistoryEntry[];

  // Solver display state
  solverResult: SolverResult | null;
  solverStepIndex: number;
  solverPanelOpen: boolean;

  // Generator state
  generatorPanelOpen: boolean;
  isGenerating: boolean;
  generationError: string | null;
  generatorDraft: GeneratorDraft;
  lastGeneratedLevel: Level | null;
  lastGenerationResult: GenerationResult | null;

  // UI feedback
  message: string | null;
  messageType: 'info' | 'error' | 'success';

  // Actions
  loadLevel: (level: Level) => void;
  toggleX: (row: number, col: number) => void;
  confirmQueen: (row: number, col: number) => string | null;
  undoX: () => void;
  redoX: () => void;
  resetBoard: () => void;
  requestSolve: () => void;
  setSolverStep: (index: number) => void;
  setSolverPanelOpen: (open: boolean) => void;
  requestGenerate: (params: GeneratorParams) => Promise<GenerationResult>;
  setGeneratorDraft: (patch: Partial<GeneratorDraft>) => void;
  enterGeneratedLevel: () => boolean;
  setGeneratorPanelOpen: (open: boolean) => void;
  clearMessage: () => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  level: null,
  board: null,
  mode: 'markX',
  xHistory: [],
  redoStack: [],
  solverResult: null,
  solverStepIndex: 0,
  solverPanelOpen: false,
  generatorPanelOpen: false,
  isGenerating: false,
  generationError: null,
  generatorDraft: {
    n: 7,
    targetSteps: 16,
    seed: null,
    maxAttempts: 2500,
    allowApproximate: false,
  },
  lastGeneratedLevel: null,
  lastGenerationResult: null,
  message: null,
  messageType: 'info',

  setMode: (mode) => set({ mode }),

  loadLevel: (level) => {
    const board = createEmptyBoard(level.n, level.regions);
    set({
      level,
      board,
      xHistory: [],
      redoStack: [],
      solverResult: level.solverResult,
      solverStepIndex: 0,
      solverPanelOpen: false,
      message: `关卡已加载: ${level.n}×${level.n} / ${level.actualSteps}步`,
      messageType: 'info',
    });
  },

  toggleX: (row, col) => {
    const { board } = get();
    if (!board) return;

    const cell = board.cells[row][col];
    if (cell.isQueen || cell.isWrong) return; // revealed cells are final

    if (cell.isX) {
      // Remove X
      const newBoard = removeX(board, { row, col });
      set({
        board: newBoard,
        xHistory: [...get().xHistory, { pos: { row, col }, wasX: true }],
        redoStack: [],
        message: null,
      });
    } else {
      // Place X
      const newBoard = applyX(board, { row, col });
      set({
        board: newBoard,
        xHistory: [...get().xHistory, { pos: { row, col }, wasX: false }],
        redoStack: [],
        message: null,
      });
    }
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
        message: `不是 Queen: ${formatPos({ row, col })}`,
        messageType: 'error',
      });
      return null;
    }

    // Apply Queen
    const { board: newBoard } = applyQueen(board, { row, col });

    // Check completion
    const complete = isBoardComplete(newBoard);

    set({
      board: newBoard,
      xHistory: [], // Queen reveal changes propagated board; keep history simple
      redoStack: [],
      message: complete ? '恭喜！所有 Queen 已就位！' : `Queen 确认: ${formatPos({ row, col })}`,
      messageType: complete ? 'success' : 'info',
    });

    return null; // no error
  },

  undoX: () => {
    const { board, xHistory } = get();
    if (!board || xHistory.length === 0) return;

    const lastOp = xHistory[xHistory.length - 1];
    const newHistory = xHistory.slice(0, -1);

    let newBoard: BoardState;
    if (lastOp.wasX) {
      // The cell WAS X before we toggled it (meaning we removed the X)
      // Undo = put the X back
      newBoard = applyX(board, lastOp.pos);
    } else {
      // The cell was NOT X before (meaning we placed an X)
      // Undo = remove the X
      newBoard = removeX(board, lastOp.pos);
    }

    set({
      board: newBoard,
      xHistory: newHistory,
      redoStack: [...get().redoStack, lastOp],
      message: null,
    });
  },

  redoX: () => {
    const { board, redoStack, xHistory } = get();
    if (!board || redoStack.length === 0) return;

    const op = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);

    let newBoard: BoardState;
    if (op.wasX) {
      // Redo = remove X again (undo removed it)
      newBoard = removeX(board, op.pos);
    } else {
      // Redo = place X again
      newBoard = applyX(board, op.pos);
    }

    set({
      board: newBoard,
      xHistory: [...xHistory, op],
      redoStack: newRedo,
      message: null,
    });
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
      message: '棋盘已重置',
      messageType: 'info',
    });
  },

  requestSolve: () => {
    const { board, level } = get();
    if (!board || !level) return;

    const result = solve(createEmptyBoard(level.n, level.regions));
    set({
      solverResult: result,
      solverStepIndex: 0,
      solverPanelOpen: true,
    });
  },

  setSolverStep: (index) => {
    const { solverResult } = get();
    if (!solverResult) return;
    const clamped = Math.max(0, Math.min(index, solverResult.totalSteps));
    set({ solverStepIndex: clamped });
  },

  setSolverPanelOpen: (open) => set({ solverPanelOpen: open }),

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

  setGeneratorPanelOpen: (open) => set({ generatorPanelOpen: open }),

  clearMessage: () => set({ message: null }),
}));
