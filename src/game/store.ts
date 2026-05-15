import { create } from 'zustand';
import {
  BoardState, Level, SolverBatch, SolverResult, Position,
  GeneratorParams, ComplexityLabel, OpHistoryEntry,
} from './types';
import {
  createEmptyBoard, cloneBoard, applyX, removeX, applyQueen,
  findUniqueCandidates, getCandidatesInRow, getCandidatesInCol,
  getCandidatesInRegion, isBoardComplete, isBoardValid,
  getQueenPositions, formatPos,
} from './rules';
import { solve, applyBatchesUpTo } from './solver';
import { generateLevel, complexityToTargetSteps } from './generator';

// ============================================================
// Game Store — zustand
// ============================================================

export type InteractionMode = 'markX' | 'confirmQueen';

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
  requestGenerate: (n: number, complexity: ComplexityLabel, targetSteps?: number) => Promise<void>;
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
    const { board, mode } = get();
    if (!board) return;

    if (mode === 'markX') {
      const cell = board.cells[row][col];
      if (cell.isQueen) return; // can't mark X on Queen

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
    } else {
      // In confirmQueen mode
      get().confirmQueen(row, col);
    }
  },

  confirmQueen: (row, col) => {
    const { board } = get();
    if (!board) return '无棋盘状态';

    const cell = board.cells[row][col];
    if (cell.isQueen) return '此格已是 Queen';
    if (cell.isX) return '此格已标记为 X';

    // Check if this cell is a unique candidate in its row, column, or region
    const rowCands = getCandidatesInRow(board, row);
    const colCands = getCandidatesInCol(board, col);
    const regCands = getCandidatesInRegion(board, cell.regionId);

    const isUniqueRow = rowCands.length === 1 && rowCands[0].row === row && rowCands[0].col === col;
    const isUniqueCol = colCands.length === 1 && colCands[0].row === row && colCands[0].col === col;
    const isUniqueReg = regCands.length === 1 && regCands[0].row === row && regCands[0].col === col;

    if (!isUniqueRow && !isUniqueCol && !isUniqueReg) {
      const reasons: string[] = [];
      if (rowCands.length > 1) reasons.push(`该行还有 ${rowCands.length} 个候选`);
      if (colCands.length > 1) reasons.push(`该列还有 ${colCands.length} 个候选`);
      if (regCands.length > 1) reasons.push(`该区域还有 ${regCands.length} 个候选`);
      return `无法确认 Queen: ${reasons.join('; ')}`;
    }

    // Check adjacency with existing Queens
    const queens = getQueenPositions(board);
    for (const q of queens) {
      const dr = Math.abs(q.row - row);
      const dc = Math.abs(q.col - col);
      if (dr <= 1 && dc <= 1) {
        return `与 ${formatPos(q)} 的 Queen 相邻`;
      }
    }

    // Apply Queen
    const { board: newBoard } = applyQueen(board, { row, col });

    // Check completion
    const complete = isBoardComplete(newBoard);

    set({
      board: newBoard,
      xHistory: [], // Queen placement clears undo history
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

    // Use level's solver result if available, or recompute
    const result = level.solverResult;
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

  requestGenerate: async (n, complexity, targetSteps?) => {
    set({ isGenerating: true, generationError: null });

    try {
      const steps = targetSteps ?? complexityToTargetSteps(n, complexity);

      // Run generation asynchronously (it's potentially slow)
      const level = await new Promise<Level | null>((resolve) => {
        setTimeout(() => {
          resolve(generateLevel({ n, targetSteps: steps }));
        }, 50); // Small delay to let the UI update
      });

      if (level) {
        get().loadLevel(level);
        set({
          isGenerating: false,
          generatorPanelOpen: false,
          message: `关卡生成成功: ${n}×${n} / ${level.actualSteps}步`,
          messageType: 'success',
        });
      } else {
        set({
          isGenerating: false,
          generationError: '生成失败，请尝试不同参数',
          message: '关卡生成失败，请尝试其他参数',
          messageType: 'error',
        });
      }
    } catch (e) {
      set({
        isGenerating: false,
        generationError: `生成错误: ${String(e)}`,
        message: '生成过程出错',
        messageType: 'error',
      });
    }
  },

  setGeneratorPanelOpen: (open) => set({ generatorPanelOpen: open }),

  clearMessage: () => set({ message: null }),
}));
