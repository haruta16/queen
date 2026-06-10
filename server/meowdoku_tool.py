#!/usr/bin/env python3
"""Recognize and validate a Meowdoku region puzzle from a screenshot."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import deque
from pathlib import Path
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw


DEFAULT_PALETTE = [
    "#B0795A",
    "#4CB5CA",
    "#C9B35D",
    "#D37291",
    "#A1D489",
    "#EEA2E0",
    "#8175BF",
    "#A4C5E8",
    "#40A269",
    "#F0CF7E",
    "#E58A65",
    "#72B7A8",
    "#B994D4",
    "#E2B45F",
    "#7E9FCB",
    "#D98DB0",
]

DEFAULT_BRANCH_PROPAGATION_LIMIT = 3

ACTION_ZH = {
    "exclude": "画X",
    "confirm_cat": "确认猫",
}

RULE_ZH = {
    "temporary_assumption": "临时假设",
    "confirmed_cat_exclusion": "已确认猫的行列色区排除",
    "confirmed_cat_diagonal_exclusion": "已确认猫的斜邻排除",
    "confirmed_cat_exclusion_batch": "已确认猫的基础排除",
    "single_candidate": "约束内唯一候选",
    "locked_candidates": "候选范围锁定",
    "candidate_group_lock": "多约束候选集合锁定",
    "range_common_diagonal": "候选范围共同斜邻排除",
    "short_contradiction": "短链反证",
    "branch_common_conclusion": "多分支共同结论",
    "branch_unique_survivor": "多分支唯一成立",
}

RULE_DIFFICULTY = {
    "confirmed_cat_exclusion": ("L1", "基础排除"),
    "confirmed_cat_diagonal_exclusion": ("L1", "基础排除"),
    "single_candidate": ("L2", "唯一候选"),
    "locked_candidates": ("L3", "范围锁定"),
    "candidate_group_lock": ("L3", "范围锁定"),
    "range_common_diagonal": ("L3", "范围锁定"),
    "branch_common_conclusion": ("L5", "单层分支"),
    "branch_unique_survivor": ("L5", "单层分支"),
}

UNIT_KIND_ZH = {
    "row": "行",
    "column": "列",
    "region": "色区",
}


def unit_count_zh(kind: str, count: int) -> str:
    prefix = f"{count}个" if kind == "region" else str(count)
    return f"{prefix}{UNIT_KIND_ZH[kind]}"


CONTRADICTION_ZH = {
    "multiple_cats_in_unit": "同一约束内出现多只猫",
    "unit_has_no_candidate": "约束内没有任何候选猫位",
    "cats_touch_diagonally": "两只猫斜向相邻",
    "no_perfect_matching": "约束集合无法完成一一匹配",
}


def palette_for_size(size: int) -> list[list[int]]:
    colors = []
    for index in range(size):
        value = DEFAULT_PALETTE[index % len(DEFAULT_PALETTE)].lstrip("#")
        colors.append(
            [int(value[offset : offset + 2], 16) for offset in (0, 2, 4)]
        )
    return colors


def normalize_region_grid(
    raw_grid: Sequence[Sequence[int]], declared_size: int | None = None
) -> list[list[int]]:
    if not isinstance(raw_grid, list) or not raw_grid:
        raise ValueError("关卡 JSON 缺少有效的 regions 二维数组。")
    size = len(raw_grid)
    if declared_size is not None and declared_size != size:
        raise ValueError(
            f"size={declared_size}，但 regions 实际有 {size} 行。"
        )
    if size < 3 or size > 30:
        raise ValueError("棋盘尺寸必须在 3x3 到 30x30 之间。")
    if any(not isinstance(row, list) or len(row) != size for row in raw_grid):
        raise ValueError("regions 必须是行列数量相同的 n×n 二维数组。")

    remap: dict[int, int] = {}
    normalized = []
    for row in raw_grid:
        normalized_row = []
        for value in row:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("regions 中的色区 ID 必须是整数。")
            if value not in remap:
                remap[value] = len(remap)
            normalized_row.append(remap[value])
        normalized.append(normalized_row)
    if len(remap) != size:
        raise ValueError(
            f"{size}x{size} 棋盘必须包含 {size} 个色区，"
            f"当前识别到 {len(remap)} 个。"
        )
    disconnected = [
        region
        for region in range(size)
        if not connected_region(normalized, region)
    ]
    if disconnected:
        display = "、".join(str(region + 1) for region in disconnected)
        raise ValueError(f"以下色区不连续：{display}。")
    return normalized


def step_batch_key(step: dict) -> tuple | None:
    rule = step["rule"]
    reason = step.get("reason", {})
    if rule in {
        "confirmed_cat_exclusion",
        "confirmed_cat_diagonal_exclusion",
    }:
        cat = reason.get("cat")
        return ("confirmed_cat", cat["row"], cat["column"])
    if rule == "locked_candidates":
        return (
            rule,
            json.dumps(reason.get("source_unit"), sort_keys=True),
            json.dumps(reason.get("target_unit"), sort_keys=True),
            json.dumps(reason.get("source_candidates"), sort_keys=True),
        )
    if rule == "candidate_group_lock":
        return (
            rule,
            json.dumps(reason.get("source_units"), sort_keys=True),
            json.dumps(reason.get("target_units"), sort_keys=True),
            json.dumps(reason.get("source_candidates"), sort_keys=True),
        )
    if rule == "range_common_diagonal":
        return (
            rule,
            json.dumps(reason.get("source_unit"), sort_keys=True),
            json.dumps(reason.get("source_candidates"), sort_keys=True),
        )
    if rule in {
        "short_contradiction",
        "branch_common_conclusion",
        "branch_unique_survivor",
    }:
        return (rule, reason.get("inference_key"))
    return None


def batch_human_steps(atomic_steps: Sequence[dict]) -> list[dict]:
    batches: list[dict] = []
    index = 0
    while index < len(atomic_steps):
        first = atomic_steps[index]
        key = step_batch_key(first)
        grouped = [first]
        cursor = index + 1
        if key is not None:
            while cursor < len(atomic_steps):
                candidate = atomic_steps[cursor]
                if step_batch_key(candidate) != key:
                    break
                grouped.append(candidate)
                cursor += 1

        results = [
            {
                "action": item["action"],
                "action_zh": item["action_zh"],
                "cell": item["cell"],
            }
            for item in grouped
        ]
        cells = [item["cell"] for item in grouped]
        batch = {
            **first,
            "step": len(batches) + 1,
            "atomic_step_count": len(grouped),
            "cells": cells,
            "results": results,
        }
        if len(grouped) > 1:
            batch["action"] = (
                "exclude_batch"
                if all(item["action"] == "exclude" for item in grouped)
                else "action_batch"
            )
            batch["action_zh"] = (
                f"批量画X（{len(grouped)}格）"
                if batch["action"] == "exclude_batch"
                else f"批量操作（{len(grouped)}格）"
            )
            if key and key[0] == "confirmed_cat":
                batch["rule"] = "confirmed_cat_exclusion_batch"
                batch["rule_zh"] = RULE_ZH[batch["rule"]]
                batch["difficulty"] = "L1"
                batch["difficulty_zh"] = "基础排除"
                batch["reason"] = {
                    "cat": first["reason"]["cat"],
                    "excluded_by": sorted(
                        {
                            (
                                item["reason"].get("conflict_zh")
                                or item["reason"].get("conflict", {}).get(
                                    "kind_zh"
                                )
                                or item["reason"].get("conflict", {}).get(
                                    "kind"
                                )
                                or "规则约束"
                            )
                            for item in grouped
                        }
                    ),
                    "explanation_zh": (
                        "同一只已确认猫同时排除其同行、同列、同色区"
                        "以及斜向相邻的所有候选格。"
                    ),
                }
        batches.append(batch)
        index = cursor if key is not None else index + 1
    return batches


def recognized_from_level(level: dict) -> dict:
    if not isinstance(level, dict):
        raise ValueError("上传内容不是有效的 JSON 对象。")
    grid = normalize_region_grid(level.get("regions"), level.get("size"))
    size = len(grid)
    palette = level.get("palette_rgb")
    if (
        not isinstance(palette, list)
        or len(palette) < size
        or any(
            not isinstance(color, list) or len(color) != 3
            for color in palette[:size]
        )
    ):
        palette = palette_for_size(size)
    else:
        palette = [
            [max(0, min(255, int(channel))) for channel in color]
            for color in palette[:size]
        ]
    return {
        "size": size,
        "regions": grid,
        "palette_rgb": palette,
        "grid_bounds": [0, 0, size, size],
        "recognition": {
            "input_type": "level_json",
            "geometry_score": 0.0,
            "mean_color_error": 0.0,
            "max_color_error": 0.0,
            "requires_manual_review": False,
        },
    }


def parse_crop(value: str) -> tuple[int, int, int, int]:
    parts = [int(part.strip()) for part in value.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("crop must be x0,y0,x1,y1")
    x0, y0, x1, y1 = parts
    if x1 <= x0 or y1 <= y0:
        raise argparse.ArgumentTypeError("crop must have x1>x0 and y1>y0")
    return x0, y0, x1, y1


def runs(values: np.ndarray) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    start = None
    for index, enabled in enumerate(values):
        if enabled and start is None:
            start = index
        elif not enabled and start is not None:
            result.append((start, index - 1))
            start = None
    if start is not None:
        result.append((start, len(values) - 1))
    return result


def merge_nearby_runs(
    intervals: Sequence[tuple[int, int]], max_gap: int
) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in intervals:
        if merged and start - merged[-1][1] - 1 <= max_gap:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def cell_run_candidates(
    projection: np.ndarray, expected: int | None, axis_length: int
) -> list[list[tuple[int, int]]]:
    peak = float(projection.max())
    if peak <= 0:
        raise ValueError("No colored grid cells were detected")

    candidates: list[list[tuple[int, int]]] = []
    seen = set()
    for ratio in (0.62, 0.54, 0.48, 0.42, 0.36, 0.30, 0.24, 0.18):
        raw = runs(projection >= peak * ratio)
        min_width = max(3, axis_length // 100)
        filtered = [(a, b) for a, b in raw if b - a + 1 >= min_width]
        lengths = (
            [expected]
            if expected is not None
            else range(3, min(30, len(filtered)) + 1)
        )
        for length in lengths:
            if length is None or length > len(filtered):
                continue
            for start_index in range(len(filtered) - length + 1):
                subset = filtered[start_index : start_index + length]
                key = tuple(subset)
                if key in seen:
                    continue
                seen.add(key)
                widths = [end - start + 1 for start, end in subset]
                if max(widths) / min(widths) >= 1.8:
                    continue
                width_cv, step_cv = run_geometry(subset)
                if width_cv > 0.22 or step_cv > 0.22:
                    continue
                candidates.append(subset)
    return candidates


def variation(values: Sequence[float]) -> float:
    array = np.asarray(values, dtype=float)
    mean = float(array.mean())
    return float(array.std() / mean) if mean else 1.0


def run_geometry(intervals: Sequence[tuple[int, int]]) -> tuple[float, float]:
    widths = [end - start + 1 for start, end in intervals]
    centers = [(start + end) / 2 for start, end in intervals]
    steps = [
        centers[index + 1] - centers[index] for index in range(len(centers) - 1)
    ]
    return variation(widths), variation(steps)


def detect_grid_runs(
    mask: np.ndarray, expected: int | None
) -> tuple[list[tuple[int, int]], list[tuple[int, int]], dict]:
    height, width = mask.shape
    row_candidates = cell_run_candidates(mask.sum(axis=1), expected, height)
    column_candidates = cell_run_candidates(mask.sum(axis=0), expected, width)
    pair_candidates = []
    for rows in row_candidates:
        for columns in column_candidates:
            if len(rows) != len(columns):
                continue
            row_width_cv, row_step_cv = run_geometry(rows)
            column_width_cv, column_step_cv = run_geometry(columns)
            board_height = rows[-1][1] - rows[0][0] + 1
            board_width = columns[-1][1] - columns[0][0] + 1
            aspect_error = abs(board_width / board_height - 1.0)
            cell_aspect_error = abs(
                np.mean([b - a + 1 for a, b in columns])
                / np.mean([b - a + 1 for a, b in rows])
                - 1.0
            )
            regularity = (
                row_width_cv
                + row_step_cv
                + column_width_cv
                + column_step_cv
                + aspect_error
                + cell_aspect_error
            )
            pair_candidates.append(
                (
                    -len(rows),
                    regularity,
                    rows,
                    columns,
                    {
                        "geometry_score": round(float(regularity), 5),
                        "row_width_cv": round(row_width_cv, 5),
                        "row_step_cv": round(row_step_cv, 5),
                        "column_width_cv": round(column_width_cv, 5),
                        "column_step_cv": round(column_step_cv, 5),
                        "board_aspect_error": round(float(aspect_error), 5),
                    },
                )
            )
    if pair_candidates:
        _, _, rows, columns, geometry = min(pair_candidates, key=lambda item: item[:2])
        return rows, columns, geometry

    row_counts = sorted({len(item) for item in row_candidates})
    column_counts = sorted({len(item) for item in column_candidates})
    expectation = f"expected {expected}; " if expected is not None else ""
    raise ValueError(
        f"Could not isolate a square grid ({expectation}"
        f"row candidates: {row_counts}; column candidates: {column_counts}). "
        "Try --crop or --size."
    )


def estimate_background(rgb: np.ndarray) -> np.ndarray:
    height, width, _ = rgb.shape
    band = max(2, min(height, width) // 80)
    border = np.concatenate(
        [
            rgb[:band].reshape(-1, 3),
            rgb[-band:].reshape(-1, 3),
            rgb[:, :band].reshape(-1, 3),
            rgb[:, -band:].reshape(-1, 3),
        ]
    )
    return np.median(border, axis=0)


def dominant_color(patch: np.ndarray) -> np.ndarray:
    pixels = patch.reshape(-1, 3).astype(np.int16)
    quantized = np.clip((pixels + 4) // 8, 0, 31)
    keys = quantized[:, 0] * 1024 + quantized[:, 1] * 32 + quantized[:, 2]
    best_key = np.bincount(keys).argmax()
    selected = pixels[keys == best_key]
    return np.median(selected, axis=0).astype(float)


def farthest_first_kmeans(
    colors: np.ndarray, cluster_count: int, iterations: int = 40
) -> tuple[np.ndarray, np.ndarray]:
    if len(colors) < cluster_count:
        raise ValueError("There are fewer cells than requested color regions")

    centers = [colors[0].astype(float)]
    while len(centers) < cluster_count:
        distances = np.min(
            np.stack(
                [np.sum((colors - center) ** 2, axis=1) for center in centers]
            ),
            axis=0,
        )
        centers.append(colors[int(np.argmax(distances))].astype(float))
    center_array = np.stack(centers)

    labels = np.zeros(len(colors), dtype=int)
    for _ in range(iterations):
        distances = np.stack(
            [np.sum((colors - center) ** 2, axis=1) for center in center_array],
            axis=1,
        )
        new_labels = np.argmin(distances, axis=1)
        new_centers = center_array.copy()
        for cluster in range(cluster_count):
            members = colors[new_labels == cluster]
            if len(members):
                new_centers[cluster] = np.median(members, axis=0)
        if np.array_equal(labels, new_labels) and np.allclose(
            center_array, new_centers
        ):
            break
        labels = new_labels
        center_array = new_centers

    return labels, center_array


def normalize_region_ids(
    flat_labels: np.ndarray, centers: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    remap: dict[int, int] = {}
    normalized = np.empty_like(flat_labels)
    ordered_centers = []
    for index, label in enumerate(flat_labels.tolist()):
        if label not in remap:
            remap[label] = len(remap)
            ordered_centers.append(centers[label])
        normalized[index] = remap[label]
    return normalized, np.stack(ordered_centers)


def connected_region(grid: Sequence[Sequence[int]], region: int) -> bool:
    cells = [
        (row, column)
        for row, values in enumerate(grid)
        for column, value in enumerate(values)
        if value == region
    ]
    if not cells:
        return False
    pending = deque([cells[0]])
    visited = {cells[0]}
    height = len(grid)
    width = len(grid[0])
    while pending:
        row, column = pending.popleft()
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = row + dr, column + dc
            if (
                0 <= nr < height
                and 0 <= nc < width
                and grid[nr][nc] == region
                and (nr, nc) not in visited
            ):
                visited.add((nr, nc))
                pending.append((nr, nc))
    return len(visited) == len(cells)


def solve(
    grid: Sequence[Sequence[int]], limit: int = 2
) -> list[list[int]]:
    """Return row-to-column solutions, stopping at limit."""
    size = len(grid)
    solutions: list[list[int]] = []

    def search(
        row: int, used_columns: set[int], used_regions: set[int], placed: list[int]
    ) -> None:
        if len(solutions) >= limit:
            return
        if row == size:
            solutions.append(placed.copy())
            return
        for column in range(size):
            region = grid[row][column]
            if column in used_columns or region in used_regions:
                continue
            if placed and abs(column - placed[-1]) == 1:
                continue
            search(
                row + 1,
                used_columns | {column},
                used_regions | {region},
                placed + [column],
            )

    search(0, set(), set(), [])
    return solutions


class HumanSolver:
    """Monotonic, explainable solver with optional one-assumption contradiction."""

    def __init__(
        self,
        grid: Sequence[Sequence[int]],
        record_steps: bool = True,
        branch_propagation_limit: int = DEFAULT_BRANCH_PROPAGATION_LIMIT,
    ) -> None:
        self.grid = grid
        self.size = len(grid)
        self.all_cells = {
            (row, column)
            for row in range(self.size)
            for column in range(self.size)
        }
        self.candidates = set(self.all_cells)
        self.cats: set[tuple[int, int]] = set()
        self.steps: list[dict] = []
        self.record_steps = record_steps
        self.branch_propagation_limit = max(
            1, int(branch_propagation_limit)
        )
        self.units = self._build_units()
        self.units_by_cell: dict[tuple[int, int], list[dict]] = {
            cell: [] for cell in self.all_cells
        }
        for unit in self.units:
            for cell in unit["cells"]:
                self.units_by_cell[cell].append(unit)
        self.propagated_cats: set[tuple[int, int]] = set()
        self.inferred_contradiction: dict | None = None

    def _build_units(self) -> list[dict]:
        units = []
        for row in range(self.size):
            units.append(
                {
                    "kind": "row",
                    "index": row,
                    "cells": {(row, column) for column in range(self.size)},
                }
            )
        for column in range(self.size):
            units.append(
                {
                    "kind": "column",
                    "index": column,
                    "cells": {(row, column) for row in range(self.size)},
                }
            )
        for region in range(self.size):
            units.append(
                {
                    "kind": "region",
                    "index": region,
                    "cells": {
                        (row, column)
                        for row in range(self.size)
                        for column in range(self.size)
                        if self.grid[row][column] == region
                    },
                }
            )
        return units

    @staticmethod
    def unit_ref(unit: dict) -> dict:
        return {
            "kind": unit["kind"],
            "kind_zh": UNIT_KIND_ZH[unit["kind"]],
            "index": unit["index"],
            "display_index": unit["index"] + 1,
        }

    @staticmethod
    def cell_ref(cell: tuple[int, int]) -> dict:
        return {"row": cell[0], "column": cell[1]}

    def unit_candidates(self, unit: dict) -> set[tuple[int, int]]:
        unit_cats = self.cats & unit["cells"]
        return unit_cats if unit_cats else self.candidates & unit["cells"]

    def add_step(
        self,
        action: str,
        cell: tuple[int, int],
        rule: str,
        reason: dict,
    ) -> None:
        if not self.record_steps:
            return
        difficulty, difficulty_zh = RULE_DIFFICULTY.get(
            rule, ("L0", "临时状态")
        )
        self.steps.append(
            {
                "step": len(self.steps) + 1,
                "action": action,
                "action_zh": ACTION_ZH[action],
                "cell": self.cell_ref(cell),
                "rule": rule,
                "rule_zh": RULE_ZH[rule],
                "difficulty": difficulty,
                "difficulty_zh": difficulty_zh,
                "reason": reason,
            }
        )

    def exclude(
        self,
        cell: tuple[int, int],
        rule: str,
        reason: dict,
    ) -> bool:
        if cell in self.cats:
            raise ValueError(f"Cannot exclude confirmed cat {cell}")
        if cell not in self.candidates:
            return False
        self.candidates.remove(cell)
        self.add_step("exclude", cell, rule, reason)
        return True

    def confirm_cat(
        self,
        cell: tuple[int, int],
        rule: str,
        reason: dict,
    ) -> bool:
        if cell in self.cats:
            return False
        if cell not in self.candidates:
            raise ValueError(f"Cannot confirm excluded cell {cell}")
        self.cats.add(cell)
        self.add_step("confirm_cat", cell, rule, reason)
        return True

    def contradiction(self) -> dict | None:
        for unit in self.units:
            unit_cats = self.cats & unit["cells"]
            if len(unit_cats) > 1:
                return {
                    "type": "multiple_cats_in_unit",
                    "type_zh": CONTRADICTION_ZH[
                        "multiple_cats_in_unit"
                    ],
                    "unit": self.unit_ref(unit),
                    "cats": [
                        self.cell_ref(cell) for cell in sorted(unit_cats)
                    ],
                }
            if not unit_cats and not (self.candidates & unit["cells"]):
                return {
                    "type": "unit_has_no_candidate",
                    "type_zh": CONTRADICTION_ZH[
                        "unit_has_no_candidate"
                    ],
                    "unit": self.unit_ref(unit),
                }
        for row, column in self.cats:
            for dc in (-1, 1):
                neighbor = (row + 1, column + dc)
                if neighbor in self.cats:
                    return {
                        "type": "cats_touch_diagonally",
                        "type_zh": CONTRADICTION_ZH[
                            "cats_touch_diagonally"
                        ],
                        "cats": [
                            self.cell_ref((row, column)),
                            self.cell_ref(neighbor),
                        ],
                    }
        for source_kind, target_kind in (
            ("row", "column"),
            ("row", "region"),
            ("column", "region"),
        ):
            source_units = self.units_of_kind(source_kind)
            target_units = self.units_of_kind(target_kind)
            adjacency = self.unit_adjacency(source_units, target_units)
            witness = self.matching_failure_witness(
                adjacency, len(target_units)
            )
            if witness is not None:
                source_indexes, target_indexes = witness
                witness_candidates = set().union(
                    *(
                        self.unit_candidates(source_units[index])
                        for index in source_indexes
                    )
                )
                return {
                    "type": "no_perfect_matching",
                    "type_zh": CONTRADICTION_ZH["no_perfect_matching"],
                    "source_kind": source_kind,
                    "source_kind_zh": UNIT_KIND_ZH[source_kind],
                    "target_kind": target_kind,
                    "target_kind_zh": UNIT_KIND_ZH[target_kind],
                    "source_units": [
                        self.unit_ref(source_units[index])
                        for index in sorted(source_indexes)
                    ],
                    "target_units": [
                        self.unit_ref(target_units[index])
                        for index in sorted(target_indexes)
                    ],
                    "source_count": len(source_indexes),
                    "target_count": len(target_indexes),
                    "deficit": (
                        len(source_indexes) - len(target_indexes)
                    ),
                    "candidate_cells": [
                        self.cell_ref(cell)
                        for cell in sorted(witness_candidates)
                    ],
                }
        return None

    def units_of_kind(self, kind: str) -> list[dict]:
        return [unit for unit in self.units if unit["kind"] == kind]

    def unit_adjacency(
        self,
        source_units: Sequence[dict],
        target_units: Sequence[dict],
    ) -> list[set[int]]:
        target_by_cell = {
            cell: target["index"]
            for target in target_units
            for cell in target["cells"]
        }
        return [
            {
                target_by_cell[cell]
                for cell in self.unit_candidates(source)
            }
            for source in source_units
        ]

    @staticmethod
    def maximum_matching_state(
        adjacency: Sequence[set[int]], target_count: int
    ) -> tuple[list[int], list[int]]:
        match_target = [-1] * target_count

        def augment(source: int, seen: set[int]) -> bool:
            for target in sorted(adjacency[source]):
                if target in seen:
                    continue
                seen.add(target)
                owner = match_target[target]
                if owner == -1 or augment(owner, seen):
                    match_target[target] = source
                    return True
            return False

        source_order = sorted(
            range(len(adjacency)),
            key=lambda source: (len(adjacency[source]), source),
        )
        for source in source_order:
            augment(source, set())
        match_source = [-1] * len(adjacency)
        for target, source in enumerate(match_target):
            if source != -1:
                match_source[source] = target
        return match_source, match_target

    @classmethod
    def maximum_matching(
        cls, adjacency: Sequence[set[int]], target_count: int
    ) -> tuple[list[int], list[int]] | None:
        match_source, match_target = cls.maximum_matching_state(
            adjacency, target_count
        )
        if any(target == -1 for target in match_source):
            return None
        return match_source, match_target

    @classmethod
    def matching_failure_witness(
        cls,
        adjacency: Sequence[set[int]],
        target_count: int,
    ) -> tuple[set[int], set[int]] | None:
        match_source, match_target = cls.maximum_matching_state(
            adjacency, target_count
        )
        unmatched_sources = {
            source
            for source, target in enumerate(match_source)
            if target == -1
        }
        if not unmatched_sources:
            return None

        source_witness = set(unmatched_sources)
        target_witness: set[int] = set()
        pending = list(sorted(unmatched_sources))
        while pending:
            source = pending.pop()
            for target in sorted(adjacency[source]):
                if target == match_source[source]:
                    continue
                if target in target_witness:
                    continue
                target_witness.add(target)
                matched_source = match_target[target]
                if (
                    matched_source != -1
                    and matched_source not in source_witness
                ):
                    source_witness.add(matched_source)
                    pending.append(matched_source)
        return source_witness, target_witness

    @staticmethod
    def strongly_connected_components(
        graph: Sequence[set[int]],
    ) -> tuple[list[list[int]], list[int]]:
        index = 0
        indexes = [-1] * len(graph)
        lowlinks = [0] * len(graph)
        stack: list[int] = []
        on_stack: set[int] = set()
        components: list[list[int]] = []

        def visit(node: int) -> None:
            nonlocal index
            indexes[node] = index
            lowlinks[node] = index
            index += 1
            stack.append(node)
            on_stack.add(node)
            for neighbor in sorted(graph[node]):
                if indexes[neighbor] == -1:
                    visit(neighbor)
                    lowlinks[node] = min(
                        lowlinks[node], lowlinks[neighbor]
                    )
                elif neighbor in on_stack:
                    lowlinks[node] = min(
                        lowlinks[node], indexes[neighbor]
                    )
            if lowlinks[node] != indexes[node]:
                return
            component = []
            while True:
                member = stack.pop()
                on_stack.remove(member)
                component.append(member)
                if member == node:
                    break
            components.append(sorted(component))

        for node in range(len(graph)):
            if indexes[node] == -1:
                visit(node)
        component_by_node = [-1] * len(graph)
        for component_index, component in enumerate(components):
            for node in component:
                component_by_node[node] = component_index
        return components, component_by_node

    def propagate_confirmed_cats(self) -> bool:
        changed = False
        for cat in sorted(self.cats - self.propagated_cats):
            row, column = cat
            for unit in self.units_by_cell[cat]:
                for cell in sorted(unit["cells"] - {cat}):
                    changed |= self.exclude(
                        cell,
                        "confirmed_cat_exclusion",
                        {
                            "cat": self.cell_ref(cat),
                            "conflict": self.unit_ref(unit),
                            "explanation_zh": (
                                "该格与已确认猫处于同一"
                                f"{UNIT_KIND_ZH[unit['kind']]}，因此不可能有猫。"
                            ),
                        },
                    )
            for dr, dc in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                neighbor = (row + dr, column + dc)
                if neighbor in self.all_cells:
                    changed |= self.exclude(
                        neighbor,
                        "confirmed_cat_diagonal_exclusion",
                        {
                            "cat": self.cell_ref(cat),
                            "conflict": "diagonal_touch",
                            "conflict_zh": "斜向相邻",
                            "explanation_zh": (
                                "该格与已确认猫斜向相邻，因此不可能有猫。"
                            ),
                        },
                    )
            self.propagated_cats.add(cat)
        return changed

    def confirm_single_candidates(self) -> bool:
        for unit in self.units:
            if self.cats & unit["cells"]:
                continue
            candidates = self.candidates & unit["cells"]
            if len(candidates) == 1:
                cell = next(iter(candidates))
                return self.confirm_cat(
                    cell,
                    "single_candidate",
                    {
                        "unit": self.unit_ref(unit),
                        "remaining_candidates": [self.cell_ref(cell)],
                        "explanation_zh": (
                            f"该{UNIT_KIND_ZH[unit['kind']]}只剩一个"
                            "候选格，因此确认此处有猫。"
                        ),
                    },
                )
        return False

    def hall_lock_deductions(self) -> list[dict]:
        """Find useful Hall-tight sets through matching closures."""
        deductions = []
        family_order = {"row": 0, "column": 1, "region": 2}
        for source_kind in ("row", "column", "region"):
            source_units = self.units_of_kind(source_kind)
            for target_kind in ("row", "column", "region"):
                if source_kind == target_kind:
                    continue
                target_units = self.units_of_kind(target_kind)
                adjacency = self.unit_adjacency(
                    source_units, target_units
                )
                matching = self.maximum_matching(
                    adjacency, len(target_units)
                )
                if matching is None:
                    continue
                match_source, match_target = matching
                alternating_graph = [set() for _ in source_units]
                for source, targets in enumerate(adjacency):
                    for target in targets:
                        alternating_graph[source].add(
                            match_target[target]
                        )
                components, component_by_node = (
                    self.strongly_connected_components(
                        alternating_graph
                    )
                )
                component_graph = [set() for _ in components]
                for source, neighbors in enumerate(alternating_graph):
                    source_component = component_by_node[source]
                    for neighbor in neighbors:
                        target_component = component_by_node[neighbor]
                        if source_component != target_component:
                            component_graph[source_component].add(
                                target_component
                            )

                seen_groups: set[tuple[int, ...]] = set()
                for start_component in range(len(components)):
                    closure = set()
                    pending = [start_component]
                    while pending:
                        component = pending.pop()
                        if component in closure:
                            continue
                        closure.add(component)
                        pending.extend(component_graph[component])
                    source_indexes = tuple(
                        sorted(
                            node
                            for component in closure
                            for node in components[component]
                        )
                    )
                    if (
                        not source_indexes
                        or len(source_indexes) == self.size
                        or source_indexes in seen_groups
                    ):
                        continue
                    seen_groups.add(source_indexes)
                    target_indexes = tuple(
                        sorted(match_source[source] for source in source_indexes)
                    )
                    neighbor_targets = set().union(
                        *(adjacency[source] for source in source_indexes)
                    )
                    if neighbor_targets != set(target_indexes):
                        continue
                    source_group = [
                        source_units[index] for index in source_indexes
                    ]
                    source_cells = set().union(
                        *(unit["cells"] for unit in source_group)
                    )
                    source_candidates = set().union(
                        *(
                            self.unit_candidates(unit)
                            for unit in source_group
                        )
                    )
                    target_cells = set().union(
                        *(
                            target_units[index]["cells"]
                            for index in target_indexes
                        )
                    )
                    excluded_cells = sorted(
                        self.candidates & target_cells - source_cells
                    )
                    if not excluded_cells:
                        continue
                    group_size = len(source_indexes)
                    deductions.append(
                        {
                            "group_size": group_size,
                            "source_kind": source_kind,
                            "target_kind": target_kind,
                            "source_units": source_group,
                            "target_units": [
                                target_units[index]
                                for index in target_indexes
                            ],
                            "source_candidates": source_candidates,
                            "excluded_cells": excluded_cells,
                            "rank": (
                                group_size,
                                -len(excluded_cells),
                                family_order[source_kind],
                                family_order[target_kind],
                                source_indexes,
                                target_indexes,
                                tuple(excluded_cells),
                            ),
                        }
                    )
        return sorted(deductions, key=lambda item: item["rank"])

    def range_lock_exclusion(self) -> bool:
        deductions = self.hall_lock_deductions()
        if not deductions:
            return False
        deduction = deductions[0]
        group_size = deduction["group_size"]
        source_units = deduction["source_units"]
        target_units = deduction["target_units"]
        source_kind = deduction["source_kind"]
        target_kind = deduction["target_kind"]
        reason = {
            "group_size": group_size,
            "source_kind": source_kind,
            "source_kind_zh": UNIT_KIND_ZH[source_kind],
            "target_kind": target_kind,
            "target_kind_zh": UNIT_KIND_ZH[target_kind],
            "source_candidates": [
                self.cell_ref(cell)
                for cell in sorted(deduction["source_candidates"])
            ],
            "excluded_cells": [
                self.cell_ref(cell)
                for cell in deduction["excluded_cells"]
            ],
        }
        if group_size == 1:
            reason.update(
                {
                    "source_unit": self.unit_ref(source_units[0]),
                    "target_unit": self.unit_ref(target_units[0]),
                    "explanation_zh": (
                        f"该{UNIT_KIND_ZH[source_kind]}的候选只位于"
                        f"{unit_count_zh(target_kind, 1)}，因此该"
                        f"{UNIT_KIND_ZH[target_kind]}中的其他候选均排除。"
                    ),
                }
            )
            rule = "locked_candidates"
        else:
            reason.update(
                {
                    "source_units": [
                        self.unit_ref(unit) for unit in source_units
                    ],
                    "target_units": [
                        self.unit_ref(unit) for unit in target_units
                    ],
                    "explanation_zh": (
                        f"{unit_count_zh(source_kind, group_size)}的候选"
                        f"只占据{unit_count_zh(target_kind, group_size)}，"
                        f"因此这些{UNIT_KIND_ZH[target_kind]}中的其他"
                        "候选均排除。"
                    ),
                }
            )
            rule = "candidate_group_lock"
        changed = False
        for cell in deduction["excluded_cells"]:
            changed |= self.exclude(cell, rule, reason)
        return changed

    def locked_unit_exclusion(self) -> bool:
        """Compatibility wrapper for the generic range-lock rule."""
        deductions = [
            item
            for item in self.hall_lock_deductions()
            if item["group_size"] == 1
        ]
        if not deductions:
            return False
        return self.range_lock_exclusion()

    def hall_set_exclusion(self, max_group_size: int | None = None) -> bool:
        """Compatibility wrapper; group size is intentionally unrestricted."""
        return self.range_lock_exclusion()

    def common_diagonal_exclusion(self) -> bool:
        """Exclude cells diagonally touching every candidate of a unit."""
        for unit in self.units:
            candidates = self.unit_candidates(unit)
            if len(candidates) <= 1:
                continue
            common_neighbors: set[tuple[int, int]] | None = None
            for row, column in candidates:
                neighbors = {
                    (row + dr, column + dc)
                    for dr, dc in ((-1, -1), (-1, 1), (1, -1), (1, 1))
                    if (row + dr, column + dc) in self.all_cells
                }
                common_neighbors = (
                    neighbors
                    if common_neighbors is None
                    else common_neighbors & neighbors
                )
            targets = sorted(
                (common_neighbors or set()) & self.candidates
            )
            if targets:
                reason = {
                    "source_unit": self.unit_ref(unit),
                    "source_candidates": [
                        self.cell_ref(item) for item in sorted(candidates)
                    ],
                    "excluded_cells": [
                        self.cell_ref(item) for item in targets
                    ],
                    "explanation_zh": (
                        "无论来源约束的猫落在哪个候选格，这些格都会与其"
                        "斜向相邻，因此均可画X。"
                    ),
                }
                changed = False
                for cell in targets:
                    changed |= self.exclude(
                        cell, "range_common_diagonal", reason
                    )
                return changed
        return False

    def clone(self, record_steps: bool = False) -> "HumanSolver":
        cloned = HumanSolver(
            self.grid,
            record_steps=record_steps,
            branch_propagation_limit=self.branch_propagation_limit,
        )
        cloned.candidates = set(self.candidates)
        cloned.cats = set(self.cats)
        cloned.propagated_cats = set(self.propagated_cats)
        cloned.inferred_contradiction = self.inferred_contradiction
        return cloned

    def deterministic_step(self) -> bool:
        return (
            self.propagate_confirmed_cats()
            or self.confirm_single_candidates()
            or self.range_lock_exclusion()
            or self.common_diagonal_exclusion()
        )

    def run_deterministic(self, max_actions: int | None = None) -> dict | None:
        start_count = len(self.steps)
        while max_actions is None or len(self.steps) - start_count < max_actions:
            contradiction = self.contradiction()
            if contradiction:
                return contradiction
            if len(self.cats) == self.size:
                return None
            if not self.deterministic_step():
                return None
        return self.contradiction()

    def run_branch_trial(self, cell: tuple[int, int]) -> dict:
        """Assume one cat and run bounded L1-L3 without nested assumptions."""
        trial = self.clone(record_steps=True)
        trial.confirm_cat(
            cell,
            "temporary_assumption",
            {
                "assumption": "cat",
                "assumption_zh": "临时假设此处有猫",
            },
        )
        propagation_depth = 0
        contradiction = trial.contradiction()
        while (
            contradiction is None
            and propagation_depth < self.branch_propagation_limit
        ):
            before = (len(trial.candidates), len(trial.cats))
            if not trial.deterministic_step():
                break
            after = (len(trial.candidates), len(trial.cats))
            if after == before:
                break
            propagation_depth += 1
            contradiction = trial.contradiction()
        contradiction = contradiction or trial.contradiction()
        reached_propagation_limit = (
            contradiction is None
            and propagation_depth >= self.branch_propagation_limit
        )
        trace = [
            {
                **trace_step,
                "trace_step": trace_index,
                "temporary": True,
            }
            for trace_index, trace_step in enumerate(
                trial.steps, start=1
            )
        ]
        derived_steps = trial.steps[1:]
        derived_action_count = sum(
            len(step.get("cells") or [step["cell"]])
            for step in derived_steps
        )
        used_rules = sorted({step["rule"] for step in derived_steps})
        uses_only_basic_propagation = all(
            step["rule"]
            in {
                "confirmed_cat_exclusion",
                "confirmed_cat_diagonal_exclusion",
            }
            for step in derived_steps
        )
        return {
            "cell": cell,
            "contradiction": contradiction,
            "candidates": set(trial.candidates),
            "cats": set(trial.cats),
            "trace": trace,
            "propagation_depth": propagation_depth,
            "derived_action_count": derived_action_count,
            "used_rules": used_rules,
            "direct_contradiction": (
                contradiction is not None
                and uses_only_basic_propagation
            ),
            "reached_propagation_limit": reached_propagation_limit,
        }

    def serialize_branch(self, branch: dict, include_trace: bool) -> dict:
        result = {
            "assumption": {
                "cell": self.cell_ref(branch["cell"]),
                "value": "cat",
                "value_zh": "假设此处有猫",
            },
            "status": (
                "contradiction"
                if branch["contradiction"]
                else "survives"
            ),
            "status_zh": (
                "产生矛盾"
                if branch["contradiction"]
                else (
                    f"{self.branch_propagation_limit}轮内未发现矛盾"
                    if branch.get("reached_propagation_limit")
                    else "确定性传播后未发现矛盾"
                )
            ),
            "propagation_depth": branch["propagation_depth"],
            "derived_action_count": branch["derived_action_count"],
            "used_rules": branch["used_rules"],
            "contradiction": branch["contradiction"],
            "reached_propagation_limit": branch.get(
                "reached_propagation_limit", False
            ),
        }
        if include_trace:
            result["trace"] = branch["trace"]
        return result

    def add_grouped_inference(
        self,
        excluded_cells: Sequence[tuple[int, int]],
        confirmed_cells: Sequence[tuple[int, int]],
        rule: str,
        reason: dict,
        difficulty: str,
        difficulty_zh: str,
    ) -> bool:
        changed = False
        for cell in sorted(set(excluded_cells)):
            if self.exclude(cell, rule, reason):
                changed = True
                if self.record_steps:
                    self.steps[-1]["difficulty"] = difficulty
                    self.steps[-1]["difficulty_zh"] = difficulty_zh
        for cell in sorted(set(confirmed_cells)):
            if self.confirm_cat(cell, rule, reason):
                changed = True
                if self.record_steps:
                    self.steps[-1]["difficulty"] = difficulty
                    self.steps[-1]["difficulty_zh"] = difficulty_zh
        return changed

    def branch_reasoning_step(self, max_difficulty: int = 5) -> bool:
        """Apply one best deduction from exhaustive single-level branches.

        Args:
            max_difficulty: Maximum difficulty level to consider (4 or 5).
                L4 deductions are attempted before L5 for level-by-level scanning.
        """
        branch_cache: dict[tuple[int, int], dict] = {}

        def branch_for(cell: tuple[int, int]) -> dict:
            if cell not in branch_cache:
                branch_cache[cell] = self.run_branch_trial(cell)
            return branch_cache[cell]

        deductions = []
        kind_order = {"row": 0, "column": 1, "region": 2}
        for unit in self.units:
            if self.cats & unit["cells"]:
                continue
            assumptions = sorted(self.candidates & unit["cells"])
            if len(assumptions) < 2:
                continue
            branches = [branch_for(cell) for cell in assumptions]
            contradictory = [
                branch for branch in branches
                if branch["contradiction"] is not None
            ]
            survivors = [
                branch for branch in branches
                if branch["contradiction"] is None
            ]
            unit_ref = self.unit_ref(unit)
            base_reason = {
                "unit": unit_ref,
                "branch_count": len(branches),
                "surviving_branch_count": len(survivors),
                "contradictory_branch_count": len(contradictory),
                "assumption_cells": [
                    self.cell_ref(cell) for cell in assumptions
                ],
            }

            if not survivors:
                self.inferred_contradiction = {
                    "type": "all_branches_contradict",
                    "type_zh": "约束内所有候选分支均产生矛盾",
                    "unit": unit_ref,
                    "branches": [
                        self.serialize_branch(branch, False)
                        for branch in contradictory
                    ],
                }
                return False

            if len(survivors) == 1:
                survivor = survivors[0]
                rejected_cells = [
                    branch["cell"] for branch in contradictory
                ]
                reason = {
                    **base_reason,
                    "inference_key": (
                        f"unique:{unit['kind']}:{unit['index']}:"
                        f"{survivor['cell'][0]}-{survivor['cell'][1]}"
                    ),
                    "surviving_assumption": self.cell_ref(
                        survivor["cell"]
                    ),
                    "rejected_assumptions": [
                        self.cell_ref(cell) for cell in rejected_cells
                    ],
                    "branches": [
                        self.serialize_branch(branch, True)
                        for branch in branches
                    ],
                    "propagation_depth": max(
                        branch["propagation_depth"]
                        for branch in branches
                    ),
                    "derived_action_count": sum(
                        branch["derived_action_count"]
                        for branch in branches
                    ),
                    "explanation_zh": (
                        "逐一检查该约束内的所有候选后，其他假设均"
                        "产生矛盾，只有一个假设未产生矛盾。因此本步"
                        "只排除失败分支；剩余候选由后续唯一候选规则"
                        "单独确认。"
                    ),
                }
                result_cells = tuple(sorted(rejected_cells))
                deductions.append(
                    {
                        "rule": "branch_unique_survivor",
                        "difficulty": "L5",
                        "difficulty_zh": "单层分支",
                        "excluded": rejected_cells,
                        "confirmed": [],
                        "reason": reason,
                        "rank": (
                            5,
                            len(branches),
                            -len(result_cells),
                            kind_order[unit["kind"]],
                            unit["index"],
                            result_cells,
                        ),
                    }
                )
                # Fall through to generate short_contradiction deductions.

            for direct, difficulty, difficulty_zh in (
                (True, "L4", "一步反证"),
                (False, "L5", "单层分支"),
            ):
                rejected = [
                    branch
                    for branch in contradictory
                    if branch["direct_contradiction"] is direct
                ]
                if not rejected:
                    continue
                rejected_by_contradiction: dict[str, list[dict]] = {}
                for rejected_branch in rejected:
                    signature = json.dumps(
                        rejected_branch["contradiction"],
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                    rejected_by_contradiction.setdefault(
                        signature, []
                    ).append(rejected_branch)
                for signature, rejected_group in sorted(
                    rejected_by_contradiction.items(),
                    key=lambda item: (
                        -len(item[1]),
                        tuple(
                            branch["cell"] for branch in item[1]
                        ),
                        item[0],
                    ),
                ):
                    primary = rejected_group[0]
                    rejected_cells = [
                        branch["cell"] for branch in rejected_group
                    ]
                    contradiction_key = hashlib.sha1(
                        signature.encode("utf-8")
                    ).hexdigest()[:12]
                    inference_key = (
                        f"contradiction:{unit['kind']}:{unit['index']}:"
                        f"{difficulty}:{contradiction_key}:"
                        + ",".join(
                            f"{row}-{column}"
                            for row, column in rejected_cells
                        )
                    )
                    reason = {
                        "unit": unit_ref,
                        "search_unit_candidate_count": len(branches),
                        "branch_count": len(rejected_group),
                        "surviving_branch_count": 0,
                        "contradictory_branch_count": len(
                            rejected_group
                        ),
                        "assumption_cells": [
                            self.cell_ref(cell)
                            for cell in rejected_cells
                        ],
                        "inference_key": inference_key,
                        "assumption": {
                            "cell": self.cell_ref(primary["cell"]),
                            "value": "cat",
                            "value_zh": "假设此处有猫",
                        },
                        "rejected_assumptions": [
                            self.cell_ref(cell)
                            for cell in rejected_cells
                        ],
                        "propagation_depth": max(
                            branch["propagation_depth"]
                            for branch in rejected_group
                        ),
                        "propagation_rounds": max(
                            branch["propagation_depth"]
                            for branch in rejected_group
                        ),
                        "derived_action_count": sum(
                            branch["derived_action_count"]
                            for branch in rejected_group
                        ),
                        "trace": primary["trace"],
                        "contradiction": primary["contradiction"],
                        "branches": [
                            self.serialize_branch(branch, True)
                            for branch in rejected_group
                        ],
                        "explanation_zh": (
                            "分别临时假设这些格有猫，经过确定性传播"
                            "后都产生同一个矛盾，因此对应格均画X。"
                            if len(rejected_group) > 1
                            else
                            "临时假设该格有猫，经过确定性传播后产生"
                            "矛盾，因此该格画X。"
                        ),
                    }
                    deductions.append(
                        {
                            "rule": "short_contradiction",
                            "difficulty": difficulty,
                            "difficulty_zh": difficulty_zh,
                            "excluded": rejected_cells,
                            "confirmed": [],
                            "reason": reason,
                            "rank": (
                                int(difficulty[1]),
                                len(branches),
                                -len(rejected_group),
                                kind_order[unit["kind"]],
                                unit["index"],
                                tuple(rejected_cells),
                            ),
                        }
                    )

            if len(survivors) >= 2:
                common_excluded = sorted(
                    cell
                    for cell in self.candidates
                    if all(
                        cell not in branch["candidates"]
                        for branch in survivors
                    )
                    and cell not in {
                        branch["cell"] for branch in contradictory
                    }
                )
                common_cats = sorted(
                    set.intersection(
                        *(set(branch["cats"]) for branch in survivors)
                    )
                    - self.cats
                )
                if common_excluded or common_cats:
                    result_cells = tuple(common_excluded + common_cats)
                    reason = {
                        **base_reason,
                        "inference_key": (
                            f"common:{unit['kind']}:{unit['index']}:"
                            + ",".join(
                                f"{cell[0]}-{cell[1]}"
                                for cell in result_cells
                            )
                        ),
                        "common_excluded_cells": [
                            self.cell_ref(cell) for cell in common_excluded
                        ],
                        "common_confirmed_cells": [
                            self.cell_ref(cell) for cell in common_cats
                        ],
                        "branches": [
                            self.serialize_branch(branch, True)
                            for branch in branches
                        ],
                        "propagation_depth": max(
                            branch["propagation_depth"]
                            for branch in branches
                        ),
                        "derived_action_count": sum(
                            branch["derived_action_count"]
                            for branch in branches
                        ),
                        "explanation_zh": (
                            "逐一检查该约束内所有仍可成立的候选分支，"
                            "这些分支都得到相同结论，因此将共同结果"
                            "提交到正式棋盘。"
                        ),
                    }
                    deductions.append(
                        {
                            "rule": "branch_common_conclusion",
                            "difficulty": "L5",
                            "difficulty_zh": "单层分支",
                            "excluded": common_excluded,
                            "confirmed": common_cats,
                            "reason": reason,
                            "rank": (
                                5,
                                len(branches),
                                -len(result_cells),
                                kind_order[unit["kind"]],
                                unit["index"],
                                result_cells,
                            ),
                        }
                    )

        if not deductions:
            return False
        eligible = [
            d for d in deductions
            if int(d["difficulty"][1]) <= max_difficulty
        ]
        if not eligible:
            return False
        deduction = min(eligible, key=lambda item: item["rank"])
        return self.add_grouped_inference(
            deduction["excluded"],
            deduction["confirmed"],
            deduction["rule"],
            deduction["reason"],
            deduction["difficulty"],
            deduction["difficulty_zh"],
        )

    def short_contradiction_exclusion(
        self, max_branch_rounds: int | None = None
    ) -> bool:
        """Compatibility wrapper for single-level branch reasoning."""
        return self.branch_reasoning_step()

    def solve_human(self) -> dict:
        contradiction = None
        while len(self.cats) < self.size:
            contradiction = self.inferred_contradiction or self.contradiction()
            if contradiction:
                break
            if self.deterministic_step():
                continue
            if self.branch_reasoning_step(max_difficulty=4):
                continue
            if self.branch_reasoning_step(max_difficulty=5):
                continue
            contradiction = self.inferred_contradiction
            break
        contradiction = (
            contradiction
            or self.inferred_contradiction
            or self.contradiction()
        )
        solved = len(self.cats) == self.size and contradiction is None
        atomic_steps = self.steps
        steps = batch_human_steps(atomic_steps)
        return {
            "solved": solved,
            "stalled": not solved and contradiction is None,
            "contradiction": contradiction,
            "confirmed_cats": [
                self.cell_ref(cell) for cell in sorted(self.cats)
            ],
            "remaining_candidates": [
                self.cell_ref(cell)
                for cell in sorted(self.candidates - self.cats)
            ],
            "step_count": len(steps),
            "atomic_step_count": len(atomic_steps),
            "steps": steps,
        }


def recognize(
    image: Image.Image,
    expected_size: int | None,
    color_threshold: float,
) -> dict:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    height, width, _ = rgb.shape
    background = estimate_background(rgb)
    distance = np.linalg.norm(rgb - background, axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    mask_options = [
        ("background_distance", distance >= color_threshold),
        ("color_chroma", chroma >= max(16.0, color_threshold * 0.65)),
    ]
    detections = []
    errors = []
    for method, mask in mask_options:
        try:
            rows, columns, candidate_geometry = detect_grid_runs(mask, expected_size)
            detections.append(
                (
                    -len(rows),
                    candidate_geometry["geometry_score"],
                    method,
                    rows,
                    columns,
                    candidate_geometry,
                )
            )
        except ValueError as error:
            errors.append(f"{method}: {error}")
    if not detections:
        raise ValueError("Grid detection failed. " + " | ".join(errors))
    _, _, mask_method, row_runs, column_runs, geometry = min(
        detections, key=lambda item: item[:2]
    )
    size = len(row_runs)
    if expected_size is not None and size != expected_size:
        raise ValueError(f"Detected {size}x{size}, expected {expected_size}x{expected_size}")

    sampled_colors = []
    for top, bottom in row_runs:
        for left, right in column_runs:
            inset_y = max(1, int((bottom - top + 1) * 0.18))
            inset_x = max(1, int((right - left + 1) * 0.18))
            patch = rgb[
                top + inset_y : bottom - inset_y + 1,
                left + inset_x : right - inset_x + 1,
            ]
            sampled_colors.append(dominant_color(patch))

    colors = np.stack(sampled_colors)
    labels, centers = farthest_first_kmeans(colors, size)
    labels, centers = normalize_region_ids(labels, centers)
    region_grid = labels.reshape(size, size).tolist()
    assigned_centers = centers[labels]
    errors = np.linalg.norm(colors - assigned_centers, axis=1)

    return {
        "size": size,
        "regions": region_grid,
        "palette_rgb": [
            [int(round(channel)) for channel in center] for center in centers
        ],
        "row_runs": row_runs,
        "column_runs": column_runs,
        "grid_bounds": [
            column_runs[0][0],
            row_runs[0][0],
            column_runs[-1][1] + 1,
            row_runs[-1][1] + 1,
        ],
        "recognition": {
            "mean_color_error": round(float(errors.mean()), 3),
            "max_color_error": round(float(errors.max()), 3),
            **geometry,
            "grid_mask_method": mask_method,
            "background_rgb": [
                int(round(channel)) for channel in background.tolist()
            ],
        },
    }


def render_preview(
    output: Path,
    grid: Sequence[Sequence[int]],
    palette_rgb: Sequence[Sequence[int]],
    solution: Sequence[int] | None = None,
) -> None:
    size = len(grid)
    cell = max(48, min(92, 760 // size))
    gap = max(5, cell // 10)
    margin = gap * 3
    side = margin * 2 + size * cell + (size - 1) * gap
    canvas = Image.new("RGB", (side, side), "#F7F2EF")
    draw = ImageDraw.Draw(canvas)

    for row in range(size):
        for column in range(size):
            x0 = margin + column * (cell + gap)
            y0 = margin + row * (cell + gap)
            color = tuple(palette_rgb[grid[row][column]])
            draw.rounded_rectangle(
                (x0, y0, x0 + cell, y0 + cell),
                radius=max(5, cell // 8),
                fill=color,
            )
            if solution is not None and solution[row] == column:
                radius = cell * 0.18
                center_x = x0 + cell / 2
                center_y = y0 + cell / 2
                draw.ellipse(
                    (
                        center_x - radius,
                        center_y - radius,
                        center_x + radius,
                        center_y + radius,
                    ),
                    fill="#29242A",
                )
    canvas.save(output)


def build_level(
    source: Path,
    recognized: dict,
    crop: tuple[int, int, int, int] | None,
) -> tuple[dict, list[list[int]], dict]:
    size = recognized["size"]
    grid = recognized["regions"]
    region_counts = [
        sum(value == region for row in grid for value in row)
        for region in range(size)
    ]
    connectivity = [
        connected_region(grid, region) for region in range(size)
    ]
    solutions = solve(grid, limit=2)
    human_result = HumanSolver(grid).solve_human()
    rule_counts: dict[str, int] = {}
    for step in human_result["steps"]:
        rule = step["rule"]
        rule_counts[rule] = rule_counts.get(rule, 0) + 1
    difficulty_counts: dict[str, int] = {}
    for step in human_result["steps"]:
        difficulty = step["difficulty"]
        difficulty_counts[difficulty] = (
            difficulty_counts.get(difficulty, 0) + 1
        )

    level = {
        "format": "meowdoku-region-v1",
        "source_image": str(source.resolve()),
        "size": size,
        "rules": {
            "one_cat_per_row": True,
            "one_cat_per_column": True,
            "one_cat_per_region": True,
            "cats_may_not_touch_diagonally": True,
        },
        "regions": grid,
        "palette_rgb": recognized["palette_rgb"],
        "validation": {
            "region_count": len(set(value for row in grid for value in row)),
            "region_cell_counts": region_counts,
            "all_regions_connected": all(connectivity),
            "region_connectivity": connectivity,
            "solution_count": len(solutions),
            "unique_solution": len(solutions) == 1,
            "solution_count_capped_at": 2,
        },
        "human_solver": {
            "solved": human_result["solved"],
            "stalled": human_result["stalled"],
            "step_count": human_result["step_count"],
            "atomic_step_count": human_result["atomic_step_count"],
            "confirmed_cat_count": len(human_result["confirmed_cats"]),
            "rule_counts": rule_counts,
            "rule_counts_zh": {
                RULE_ZH[rule]: count for rule, count in rule_counts.items()
            },
            "difficulty_counts": difficulty_counts,
            "step_file": "human-solve.json",
            "limits": {
                "nested_assumptions": 0,
                "single_level_branching": True,
                "branch_candidate_limit": None,
                "branch_propagation_limit": (
                    DEFAULT_BRANCH_PROPAGATION_LIMIT
                ),
                "deterministic_propagation": "bounded",
            },
        },
        "recognition": {
            **recognized["recognition"],
            "crop": list(crop) if crop else None,
            "grid_bounds_in_crop": recognized["grid_bounds"],
            "requires_manual_review": (
                recognized["recognition"]["geometry_score"] > 0.18
                or recognized["recognition"]["mean_color_error"] > 18
            ),
        },
    }
    if len(solutions) == 1:
        level["solution_columns_by_row"] = solutions[0]
        level["solution_cells"] = [
            {"row": row, "column": column}
            for row, column in enumerate(solutions[0])
        ]
    return level, solutions, human_result


def analyze_level_data(
    level_data: dict,
    source_name: str = "uploaded-level.json",
) -> tuple[dict, dict]:
    recognized = recognized_from_level(level_data)
    level, solutions, human_result = build_level(
        Path(source_name), recognized, None
    )
    validation = level["validation"]
    if validation["solution_count"] == 0:
        raise ValueError("该关卡无解。")
    if not validation["unique_solution"]:
        raise ValueError("该关卡存在多个解，不满足唯一解要求。")
    return level, human_result


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=(
            "Recognize a Meowdoku/Queens-style colored-region screenshot, "
            "redraw it, and verify that it has exactly one solution."
        )
    )
    result.add_argument("image", type=Path, help="input screenshot")
    result.add_argument(
        "-o", "--out-dir", type=Path, default=Path("meowdoku-output")
    )
    result.add_argument(
        "-n", "--size", type=int, help="expected grid size; auto-detected otherwise"
    )
    result.add_argument(
        "--crop",
        type=parse_crop,
        help="optional grid-area crop: x0,y0,x1,y1",
    )
    result.add_argument(
        "--color-threshold",
        type=float,
        default=28.0,
        help="distance from screenshot background used to find cells (default: 28)",
    )
    result.add_argument(
        "--draw-solution",
        action="store_true",
        help="also create preview-solution.png with answer dots",
    )
    return result


def main() -> int:
    args = parser().parse_args()
    if not args.image.is_file():
        raise SystemExit(f"Input image does not exist: {args.image}")
    if args.size is not None and args.size < 3:
        raise SystemExit("--size must be at least 3")

    image = Image.open(args.image).convert("RGB")
    working_image = image.crop(args.crop) if args.crop else image
    recognized = recognize(working_image, args.size, args.color_threshold)
    level, solutions, human_result = build_level(
        args.image, recognized, args.crop
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.out_dir / "level.json"
    preview_path = args.out_dir / "preview.png"
    json_path.write_text(
        json.dumps(level, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    human_path = args.out_dir / "human-solve.json"
    human_path.write_text(
        json.dumps(human_result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    render_preview(
        preview_path,
        level["regions"],
        level["palette_rgb"],
    )
    if args.draw_solution and len(solutions) == 1:
        render_preview(
            args.out_dir / "preview-solution.png",
            level["regions"],
            level["palette_rgb"],
            solutions[0],
        )

    validation = level["validation"]
    print(f"棋盘：{level['size']}x{level['size']}")
    print(f"色区数量：{validation['region_count']}")
    print(
        "所有色区均连续："
        f"{'是' if validation['all_regions_connected'] else '否'}"
    )
    if validation["solution_count"] == 2:
        print("解的数量：至少2个")
    else:
        print(f"解的数量：{validation['solution_count']}")
    print(f"是否唯一解：{'是' if validation['unique_solution'] else '否'}")
    print(
        "人类求解器："
        f"{'已解出' if human_result['solved'] else '推理停滞'}"
    )
    print(f"关卡文件：{json_path}")
    print(f"人类推理步骤：{human_path}")
    print(f"关卡预览：{preview_path}")

    return 0 if (
        validation["region_count"] == level["size"]
        and validation["all_regions_connected"]
        and validation["unique_solution"]
    ) else 2


if __name__ == "__main__":
    raise SystemExit(main())
