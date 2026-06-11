import type {
  Level,
  Position,
  Region,
  SolverBatch,
  SolverBatchReason,
  SolverBranch,
  SolverContradiction,
  SolverResult,
  SolverTraceMark,
  StrategyType,
  UnitKind,
  UnitRef,
} from './types';

type DogkuCell = { row: number; column: number };
type DogkuUnit = { kind: 'row' | 'column' | 'region'; index: number };

type DogkuStep = {
  step: number;
  action: string;
  action_zh?: string;
  cell: DogkuCell;
  cells?: DogkuCell[];
  results?: Array<{ action: string; action_zh?: string; cell: DogkuCell }>;
  rule: string;
  rule_zh?: string;
  difficulty?: string;
  difficulty_zh?: string;
  reason?: Record<string, any>;
};

type DogkuHumanSolve = {
  solved: boolean;
  stalled: boolean;
  step_count: number;
  steps: DogkuStep[];
};

type DogkuLevel = {
  format?: string;
  size: number;
  regions: number[][];
  palette_rgb?: number[][];
  solution_cells?: DogkuCell[];
  validation?: {
    solution_count?: number;
    unique_solution?: boolean;
    all_regions_connected?: boolean;
  };
  recognition?: {
    requires_manual_review?: boolean;
    geometry_score?: number;
    mean_color_error?: number;
  };
};

type AnalyzeResponse = {
  level: DogkuLevel;
  human_solve: DogkuHumanSolve;
};

export type ImportLevelResult = {
  level: Level | null;
  error: string | null;
};

function isJsonFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function fileToPayload(file: File) {
  if (isJsonFile(file)) {
    let level: unknown;
    try {
      level = JSON.parse(await file.text());
    } catch {
      throw new Error('JSON 文件格式错误。');
    }
    return { input_type: 'level_json', filename: file.name, level: normalizeJsonLevel(level) };
  }
  return {
    input_type: 'image',
    filename: file.name,
    data_base64: await fileToDataUrl(file),
  };
}

function normalizeJsonLevel(raw: any): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  if (Array.isArray(raw.regions)) {
    if (Array.isArray(raw.regions[0])) return raw;
    if (Number.isInteger(raw.n) && raw.regions.every((region: any) => Array.isArray(region.cells))) {
      const grid = Array.from({ length: raw.n }, () => Array(raw.n).fill(-1));
      for (const region of raw.regions) {
        for (const cell of region.cells) {
          if (Number.isInteger(cell.row) && Number.isInteger(cell.col)) {
            grid[cell.row][cell.col] = region.id;
          }
        }
      }
      return { size: raw.n, regions: grid, palette_rgb: raw.paletteRgb };
    }
  }
  if (Number.isInteger(raw.size) && Array.isArray(raw.colorMasks) && raw.colorMasks.length === raw.size * raw.size) {
    const remap = new Map<number, number>();
    const grid: number[][] = [];
    for (let row = 0; row < raw.size; row++) {
      const line: number[] = [];
      for (let col = 0; col < raw.size; col++) {
        const mask = Number(raw.colorMasks[row * raw.size + col]);
        if (!remap.has(mask)) remap.set(mask, remap.size);
        line.push(remap.get(mask)!);
      }
      grid.push(line);
    }
    return { ...raw, regions: grid };
  }
  return raw;
}

export async function importLevelViaAnalyzer(file: File): Promise<ImportLevelResult> {
  try {
    const payload = await fileToPayload(file);
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || '分析服务返回错误。');
    }
    return {
      level: adaptAnalyzerResponse(data as AnalyzeResponse, isJsonFile(file) ? 'imported-json' : 'imported-image'),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Failed to fetch')) {
      return {
        level: null,
        error: '无法连接分析服务。请使用 npm run dev:full，或单独启动 npm run backend。',
      };
    }
    return { level: null, error: message };
  }
}

function adaptAnalyzerResponse(response: AnalyzeResponse, source: Level['source']): Level {
  const { level, human_solve: humanSolve } = response;
  const n = level.size;
  const regions = regionsFromGrid(level.regions);
  const solution = (level.solution_cells ?? []).map(cellFromDogku);
  const solverResult = solverResultFromDogku(humanSolve);
  const seed = stableHash(JSON.stringify(level.regions));

  return {
    id: `${source}-${n}x${n}-${seed}`,
    n,
    regions,
    paletteRgb: level.palette_rgb,
    solution,
    seed,
    targetSteps: solverResult.totalSteps,
    actualSteps: solverResult.totalSteps,
    strategySequence: solverResult.batches.map(batch => batch.strategy),
    solverResult,
    source,
    validation: {
      uniqueSolution: level.validation?.unique_solution,
      solutionCount: level.validation?.solution_count,
      allRegionsConnected: level.validation?.all_regions_connected,
    },
  };
}

function solverResultFromDogku(humanSolve: DogkuHumanSolve): SolverResult {
  const batches = (humanSolve.steps ?? []).map(batchFromDogkuStep);
  return {
    complete: humanSolve.solved,
    batches,
    totalSteps: batches.length,
    strategyTypesUsed: [...new Set(batches.map(batch => batch.strategy))],
  };
}

function batchFromDogkuStep(step: DogkuStep, index: number): SolverBatch {
  const results = step.results?.length
    ? step.results
    : [{ action: step.action, action_zh: step.action_zh, cell: step.cell }];
  const eliminations = results
    .filter(result => result.action !== 'confirm_cat')
    .map(result => cellFromDogku(result.cell));
  const queenConfirmed = results
    .filter(result => result.action === 'confirm_cat')
    .map(result => cellFromDogku(result.cell));
  const resultText = results
    .map(result => `${cellLabel(cellFromDogku(result.cell))}${result.action === 'confirm_cat' ? '确认 Queen' : '画X'}`)
    .join('；');

  return {
    index: index + 1,
    strategy: strategyFromDogku(step),
    rule: step.rule,
    ruleZh: queenText(step.rule_zh ?? step.rule),
    difficulty: step.difficulty,
    difficultyZh: queenText(step.difficulty_zh ?? ''),
    eliminations,
    queenConfirmed,
    description: queenText(step.reason?.explanation_zh || `${step.rule_zh ?? step.rule}: ${resultText}`),
    reason: normalizeReason(step.reason ?? {}),
  };
}

function normalizeReason(reason: Record<string, any>): SolverBatchReason {
  return {
    unit: unitFromDogku(reason.unit),
    sourceUnit: unitFromDogku(reason.source_unit),
    sourceUnits: unitListFromDogku(reason.source_units),
    targetUnit: unitFromDogku(reason.target_unit),
    targetUnits: unitListFromDogku(reason.target_units),
    sourceCandidates: cellListFromDogku(reason.source_candidates),
    remainingCandidates: cellListFromDogku(reason.remaining_candidates),
    excludedCells: cellListFromDogku(reason.excluded_cells),
    assumptionCell: cellFromMaybeDogku(reason.assumption?.cell) ?? cellFromMaybeDogku(reason.assumptionCell),
    assumptionCells: cellListFromDogku(reason.assumption_cells),
    rejectedAssumptions: cellListFromDogku(reason.rejected_assumptions),
    commonExcludedCells: cellListFromDogku(reason.common_excluded_cells),
    commonConfirmedCells: cellListFromDogku(reason.common_confirmed_cells),
    contradictionType: reason.contradiction?.type,
    contradiction: contradictionFromDogku(reason.contradiction),
    groupSize: reason.group_size,
    branchCount: reason.branch_count,
    survivingBranchCount: reason.surviving_branch_count,
    contradictoryBranchCount: reason.contradictory_branch_count,
    propagationDepth: reason.propagation_depth,
    derivedActionCount: reason.derived_action_count,
    trace: traceFromDogku(reason.trace),
    branches: branchesFromDogku(reason.branches),
    explanation: queenText(reason.explanation_zh ?? ''),
  };
}

function strategyFromDogku(step: DogkuStep): StrategyType {
  if (step.rule === 'single_candidate') return 'L1_RC';
  if (step.rule === 'locked_candidates') return 'L2_RC';
  if (step.rule === 'candidate_group_lock') {
    // 根据来源单位类型判断是 L2_RC 还是 L2_Color
    const sourceKind = step.reason?.source_unit?.kind;
    return sourceKind === 'region' ? 'L2_RC' : 'L2_Color';
  }
  if (step.rule === 'range_common_diagonal') return 'L3_Projection_RC';
  if (step.rule === 'short_contradiction') {
    return step.difficulty === 'L4' ? 'L4_Contra' : 'L3_Contra_RC';
  }
  if (step.rule === 'branch_common_conclusion' || step.rule === 'branch_unique_survivor') return 'L4_Contra';
  return step.difficulty === 'L1' ? 'L1_RC' : 'L3_Projection_RC';
}

function regionsFromGrid(grid: number[][]): Region[] {
  const map = new Map<number, Position[]>();
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const id = grid[row][col];
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push({ row, col });
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, cells]) => ({ id, cells }));
}

function unitFromDogku(unit?: DogkuUnit | null): UnitRef | undefined {
  if (!unit) return undefined;
  const kind: UnitKind = unit.kind === 'column' ? 'col' : unit.kind;
  return { kind, index: unit.index };
}

function unitListFromDogku(units?: DogkuUnit[]): UnitRef[] | undefined {
  if (!Array.isArray(units)) return undefined;
  return units.map(unitFromDogku).filter(Boolean) as UnitRef[];
}

function cellFromDogku(cell: DogkuCell): Position {
  return { row: cell.row, col: cell.column };
}

function cellFromMaybeDogku(cell: any): Position | undefined {
  if (!cell || !Number.isInteger(cell.row)) return undefined;
  if (Number.isInteger(cell.col)) return { row: cell.row, col: cell.col };
  if (Number.isInteger(cell.column)) return { row: cell.row, col: cell.column };
  return undefined;
}

function cellListFromDogku(cells?: any[]): Position[] | undefined {
  if (!Array.isArray(cells)) return undefined;
  return cells.map(cellFromMaybeDogku).filter(Boolean) as Position[];
}

function contradictionFromDogku(raw: any): SolverContradiction | undefined {
  if (!raw) return undefined;
  const sourceKind = raw.source_kind_zh && raw.source_count
    ? `${raw.source_count}${raw.source_kind_zh}`
    : '';
  const targetKind = raw.target_kind_zh && raw.target_count
    ? `${raw.target_count}${raw.target_kind_zh}`
    : '';
  const description = raw.type === 'no_perfect_matching' && sourceKind && targetKind
    ? `${sourceKind}的候选只落在${targetKind}，无法一一匹配`
    : queenText(raw.type_zh || raw.description || raw.type || '产生矛盾');

  return {
    type: raw.type ?? 'contradiction',
    typeZh: queenText(raw.type_zh ?? ''),
    description,
    unit: unitFromDogku(raw.unit),
    sourceUnits: unitListFromDogku(raw.source_units),
    targetUnits: unitListFromDogku(raw.target_units),
    cells: cellListFromDogku(raw.cats),
    candidateCells: cellListFromDogku(raw.candidate_cells),
  };
}

function traceFromDogku(trace?: DogkuStep[]): SolverTraceMark[] | undefined {
  if (!Array.isArray(trace)) return undefined;
  return trace
    .map((step): SolverTraceMark | null => {
      const pos = cellFromMaybeDogku(step.cell);
      if (!pos) return null;
      const mark = step.rule === 'temporary_assumption'
        ? 'assumption'
        : step.action === 'confirm_cat'
          ? 'temp-queen'
          : 'temp-x';
      return {
        pos,
        mark,
        rule: step.rule,
        ruleZh: queenText(step.rule_zh ?? ''),
        actionZh: queenText(step.action_zh ?? ''),
      };
    })
    .filter(Boolean) as SolverTraceMark[];
}

function branchesFromDogku(branches?: any[]): SolverBranch[] | undefined {
  if (!Array.isArray(branches)) return undefined;
  return branches.map(branch => ({
    assumption: cellFromMaybeDogku(branch.assumption?.cell),
    status: branch.status === 'contradiction' ? 'contradiction' : 'survives',
    statusZh: queenText(branch.status_zh ?? ''),
    propagationDepth: branch.propagation_depth,
    derivedActionCount: branch.derived_action_count,
    contradiction: contradictionFromDogku(branch.contradiction) ?? null,
    trace: traceFromDogku(branch.trace),
  }));
}

function cellLabel(pos: Position): string {
  return `r${pos.row}c${pos.col}`;
}

function queenText(text: string): string {
  return text.replace(/猫/g, 'Queen').replace(/色区/g, '区域');
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
