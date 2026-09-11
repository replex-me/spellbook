#!/usr/bin/env python3

"""Build reference/baseline/candidate crop montages for structural review."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def rendered_map(report_path: Path) -> dict[tuple[str, int], Path]:
    report = read_json(report_path)
    root = report_path.parent
    result: dict[tuple[str, int], Path] = {}
    for deck in report.get("decks") or []:
        for slide in deck.get("slides") or []:
            rendered = slide.get("rendered")
            if rendered:
                result[(deck["id"], int(slide["slideNumber"]))] = root / rendered
    return result


def load_image(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"Could not read {path}")
    return image


def normalize(image: np.ndarray, reference: np.ndarray) -> np.ndarray:
    if image.shape[:2] == reference.shape[:2]:
        return image
    return cv2.resize(
        image,
        (reference.shape[1], reference.shape[0]),
        interpolation=cv2.INTER_LANCZOS4,
    )


def reference_path(root: Path, deck_id: str, slide_number: int) -> Path:
    candidates = [
        root / deck_id / f"slide-{slide_number}.png",
        root / deck_id / f"slide-{slide_number:02}.png",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"No reference image for {deck_id} slide {slide_number} under {root}"
    )


def crop_with_padding(
    image: np.ndarray, bbox: list[int], padding: int = 12
) -> np.ndarray:
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - padding), max(0, y0 - padding)
    x1, y1 = min(image.shape[1], x1 + padding), min(image.shape[0], y1 + padding)
    return image[y0:y1, x0:x1]


def review_cell(
    row: dict[str, Any],
    reference: np.ndarray,
    baseline: np.ndarray,
    candidate: np.ndarray,
) -> np.ndarray:
    bbox = row.get("bbox")
    if row.get("kind") == "unattributed" and not bbox:
        bbox = [0, 0, reference.shape[1], reference.shape[0]]
    if not isinstance(bbox, list) or len(bbox) != 4:
        raise ValueError(f"Missing bbox for {row.get('key')}")
    panels = [
        crop_with_padding(reference, bbox),
        crop_with_padding(baseline, bbox),
        crop_with_padding(candidate, bbox),
    ]
    target_height = min(260, max(100, panels[0].shape[0]))
    resized = []
    for panel in panels:
        width = max(1, round(panel.shape[1] * target_height / panel.shape[0]))
        resized.append(
            cv2.resize(panel, (width, target_height), interpolation=cv2.INTER_AREA)
        )
    panel_width = max(panel.shape[1] for panel in resized)
    padded = [
        cv2.copyMakeBorder(
            panel,
            0,
            0,
            0,
            panel_width - panel.shape[1],
            cv2.BORDER_CONSTANT,
            value=(255, 255, 255),
        )
        for panel in resized
    ]
    body = np.hstack(padded)
    header = np.full((92, body.shape[1], 3), 245, dtype=np.uint8)
    title = (
        f"{row.get('outcome')} {row['deckId']} s{row['slideNumber']} "
        f"shape={row.get('shapeId')} {row.get('kind')} {row.get('structuralRoles')}"
    )
    metrics = (
        f"d95 {row.get('baselineDistanceP95Px')} -> "
        f"{row.get('candidateDistanceP95Px')}  "
        f"F1 {row.get('baselineF1At2Px')} -> {row.get('candidateF1At2Px')}  "
        "panels: PowerPoint | baseline | candidate"
    )
    internal_metrics = (
        f"internal {row.get('baselineInternalLayoutStatus')} -> "
        f"{row.get('candidateInternalLayoutStatus')}  grid L1 "
        f"{row.get('baselineGridDistributionL1')} -> "
        f"{row.get('candidateGridDistributionL1')}"
    )
    cv2.putText(
        header,
        title[:180],
        (8, 25),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.50,
        (20, 20, 20),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        header,
        metrics[:220],
        (8, 53),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.43,
        (45, 45, 45),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        header,
        internal_metrics[:220],
        (8, 78),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.43,
        (45, 45, 45),
        1,
        cv2.LINE_AA,
    )
    return np.vstack([header, body])


def select_review_rows(comparison, *, corpus=None, hard_only=False, limit=None):
    if hard_only and "hardRegressionRows" in comparison:
        candidates = comparison["hardRegressionRows"]
    else:
        categories = ["worstRegressions", "mixedMovements"]
        if hard_only:
            categories.append("largestImprovements")
        candidates = [row for category in categories for row in comparison.get(category, [])]
    effective_limit = limit if limit is not None else (None if hard_only else 100)
    selected, seen = [], set()
    for row in candidates:
        if corpus and row.get("corpus") != corpus:
            continue
        if hard_only and not row.get("hardRegression"):
            continue
        if row["key"] in seen:
            continue
        seen.add(row["key"])
        selected.append(row)
        if effective_limit is not None and len(selected) >= effective_limit:
            break
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--comparison", required=True)
    parser.add_argument("--baseline-report", required=True)
    parser.add_argument("--candidate-report", required=True)
    parser.add_argument("--references", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--rows-per-page", type=int, default=8)
    parser.add_argument("--limit", type=int, help="Default: all hard regressions, or 100 other review rows")
    parser.add_argument("--corpus", choices=("public", "real"))
    parser.add_argument("--hard-only", action="store_true")
    arguments = sys.argv[1:]
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    args = parser.parse_args(arguments)

    comparison = read_json(Path(args.comparison).resolve())
    baseline_images = rendered_map(Path(args.baseline_report).resolve())
    candidate_images = rendered_map(Path(args.candidate_report).resolve())
    references = Path(args.references).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)

    selected = select_review_rows(
        comparison, corpus=args.corpus, hard_only=args.hard_only, limit=args.limit
    )

    cells: list[np.ndarray] = []
    for row in selected:
        key = (row["deckId"], int(row["slideNumber"]))
        reference = load_image(reference_path(references, *key))
        baseline = normalize(load_image(baseline_images[key]), reference)
        candidate = normalize(load_image(candidate_images[key]), reference)
        cells.append(review_cell(row, reference, baseline, candidate))

    pages = 0
    for offset in range(0, len(cells), args.rows_per_page):
        page_cells = cells[offset : offset + args.rows_per_page]
        width = max(cell.shape[1] for cell in page_cells)
        page_cells = [
            cv2.copyMakeBorder(
                cell,
                0,
                0,
                0,
                width - cell.shape[1],
                cv2.BORDER_CONSTANT,
                value=(255, 255, 255),
            )
            for cell in page_cells
        ]
        pages += 1
        cv2.imwrite(
            str(output / f"structural-review-{pages:02}.png"), np.vstack(page_cells)
        )

    print(json.dumps({"rows": len(cells), "pages": pages, "output": str(output)}))


if __name__ == "__main__":
    main()
