#!/usr/bin/env python3

"""Compare two element-level PowerPoint structural-fidelity ledgers.

The comparison is intentionally structural-first: missing outlines and outline
status changes outrank tolerant edge-distance and edge-F1 changes. Pixel RMSE
does not participate in the structural verdict.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


STATUS_RANK = {
    "empty": 0,
    "aligned_1px": 0,
    "aligned_2px": 1,
    "displaced": 2,
    "presence_mismatch": 3,
    "unknown": 4,
}
INTERNAL_STATUS_RANK = {
    "empty": 0,
    "aligned": 0,
    "layout_displaced": 1,
    "topology_changed": 2,
    "presence_mismatch": 3,
    "unknown": 4,
}
EPSILON = 1e-6


def optional_float(value: str | None) -> float | None:
    if value in {None, ""}:
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def optional_json(value: str | None) -> Any:
    if value in {None, ""}:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def load_elements(path: Path) -> dict[str, dict[str, Any]]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row.get("key")
        if not key:
            raise ValueError(f"Element row without key in {path}")
        if key in result:
            raise ValueError(f"Duplicate element key {key} in {path}")
        raw_roles = row.get("structuralRoles") or ""
        try:
            structural_roles = json.loads(raw_roles) if raw_roles else []
        except json.JSONDecodeError:
            structural_roles = [raw_roles]
        if not isinstance(structural_roles, list):
            structural_roles = [str(structural_roles)]
        raw_traits = row.get("structuralTraits") or ""
        try:
            structural_traits = json.loads(raw_traits) if raw_traits else []
        except json.JSONDecodeError:
            structural_traits = [raw_traits]
        if not isinstance(structural_traits, list):
            structural_traits = [str(structural_traits)]
        result[key] = {
            **row,
            "structuralRoles": structural_roles,
            "structuralTraits": structural_traits,
            "edgeDistanceP95Px": optional_float(row.get("edgeDistanceP95Px")),
            "edgeF1At2Px": optional_float(row.get("edgeF1At2Px")),
            "edgeProjectionXEmdPx": optional_float(
                row.get("edgeProjectionXEmdPx")
            ),
            "edgeProjectionYEmdPx": optional_float(
                row.get("edgeProjectionYEmdPx")
            ),
            "edgeGridDistributionL1": optional_float(
                row.get("edgeGridDistributionL1")
            ),
            "edgeComponentCountAbsoluteDelta": optional_float(
                row.get("edgeComponentCountAbsoluteDelta")
            ),
        }
    return result


def load_unattributed_regions(path: Path) -> dict[str, dict[str, Any]]:
    """Load the slide remainder that is outside every stored element box."""

    if not path.exists():
        return {}
    result: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for source in csv.DictReader(handle):
            slide_key = source.get("key")
            if not slide_key:
                raise ValueError(f"Slide row without key in {path}")
            key = f"{slide_key}:unattributed"
            result[key] = {
                "key": key,
                "corpus": source.get("corpus"),
                "deckId": source.get("deckId"),
                "slideNumber": source.get("slideNumber"),
                "shapeId": "unattributed",
                "kind": "unattributed",
                "structuralRoles": ["master_layout_background"],
                "structuralTraits": ["outside_top_level_element_boxes"],
                "name": "Unattributed slide remainder",
                "hasText": "false",
                "isolationConfidence": "unattributed",
                "overlapAreaFraction": "",
                "higherZOverlapAreaFraction": "",
                "outlineStatus": source.get("unattributedOutlineStatus"),
                "internalLayoutStatus": source.get(
                    "unattributedInternalLayoutStatus"
                ),
                "edgeDistanceP95Px": optional_float(
                    source.get("unattributedEdgeDistanceP95Px")
                ),
                "edgeF1At2Px": optional_float(
                    source.get("unattributedEdgeF1At2Px")
                ),
                "edgeProjectionXEmdPx": optional_float(
                    source.get("unattributedEdgeProjectionXEmdPx")
                ),
                "edgeProjectionYEmdPx": optional_float(
                    source.get("unattributedEdgeProjectionYEmdPx")
                ),
                "edgeGridDistributionL1": optional_float(
                    source.get("unattributedEdgeGridDistributionL1")
                ),
                "edgeComponentCountAbsoluteDelta": optional_float(
                    source.get("unattributedEdgeComponentCountAbsoluteDelta")
                ),
            }
    return result


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def status_rank(row: dict[str, Any]) -> int:
    return STATUS_RANK.get(row.get("outlineStatus") or "unknown", 4)


def internal_status_rank(row: dict[str, Any]) -> int:
    return INTERNAL_STATUS_RANK.get(
        row.get("internalLayoutStatus") or "unknown", 4
    )


def classify_pair(
    baseline: dict[str, Any], candidate: dict[str, Any]
) -> tuple[str, bool]:
    baseline_rank = status_rank(baseline)
    candidate_rank = status_rank(candidate)
    baseline_internal_rank = internal_status_rank(baseline)
    candidate_internal_rank = internal_status_rank(candidate)
    status_deltas = [
        candidate_rank - baseline_rank,
        candidate_internal_rank - baseline_internal_rank,
    ]
    has_status_improvement = any(delta < 0 for delta in status_deltas)
    has_status_regression = any(delta > 0 for delta in status_deltas)
    if has_status_improvement and has_status_regression:
        return "mixed", True
    if has_status_regression:
        return "regressed", True
    if has_status_improvement:
        return "improved", False

    lower_is_better = [
        "edgeDistanceP95Px",
        "edgeProjectionXEmdPx",
        "edgeProjectionYEmdPx",
        "edgeGridDistributionL1",
        "edgeComponentCountAbsoluteDelta",
    ]
    deltas = [
        candidate.get(metric) - baseline.get(metric)
        for metric in lower_is_better
        if candidate.get(metric) is not None and baseline.get(metric) is not None
    ]
    baseline_f1 = baseline.get("edgeF1At2Px")
    candidate_f1 = candidate.get("edgeF1At2Px")
    if baseline_f1 is not None and candidate_f1 is not None:
        deltas.append(baseline_f1 - candidate_f1)
    if not deltas:
        return "unmeasured", False
    has_improvement = any(delta < -EPSILON for delta in deltas)
    has_regression = any(delta > EPSILON for delta in deltas)
    if has_improvement and has_regression:
        return "mixed", False
    if has_improvement:
        return "improved", False
    if has_regression:
        return "regressed", False
    return "unchanged", False


def summarize(
    rows: list[dict[str, Any]], include_isolated: bool = True
) -> dict[str, Any]:
    baseline_distances = [
        row["baselineDistanceP95Px"]
        for row in rows
        if row["baselineDistanceP95Px"] is not None
    ]
    candidate_distances = [
        row["candidateDistanceP95Px"]
        for row in rows
        if row["candidateDistanceP95Px"] is not None
    ]
    paired_distances = [
        row
        for row in rows
        if row["baselineDistanceP95Px"] is not None
        and row["candidateDistanceP95Px"] is not None
    ]
    baseline_f1 = [
        row["baselineF1At2Px"] for row in rows if row["baselineF1At2Px"] is not None
    ]
    candidate_f1 = [
        row["candidateF1At2Px"] for row in rows if row["candidateF1At2Px"] is not None
    ]
    baseline_grid = [
        row["baselineGridDistributionL1"]
        for row in rows
        if row["baselineGridDistributionL1"] is not None
    ]
    candidate_grid = [
        row["candidateGridDistributionL1"]
        for row in rows
        if row["candidateGridDistributionL1"] is not None
    ]
    outcomes = Counter(row["outcome"] for row in rows)
    result = {
        "pairedElements": len(rows),
        "outcomes": dict(outcomes),
        "hardRegressions": sum(row["hardRegression"] for row in rows),
        "baseline": {
            "outlineMeasured": len(baseline_distances),
            "outlineDistanceMedianPx": (
                statistics.median(baseline_distances) if baseline_distances else None
            ),
            "outlineDistanceP95Px": percentile(baseline_distances, 0.95),
            "outlineP95Within1Px": sum(value <= 1 for value in baseline_distances),
            "outlineP95Within2Px": sum(value <= 2 for value in baseline_distances),
            "outlineF1At2PxAtLeast090": sum(value >= 0.90 for value in baseline_f1),
            "internalLayoutStatusCounts": dict(
                Counter(row["baselineInternalLayoutStatus"] for row in rows)
            ),
            "edgeGridDistributionL1Median": (
                statistics.median(baseline_grid) if baseline_grid else None
            ),
            "edgeGridDistributionL1P95": percentile(baseline_grid, 0.95),
        },
        "candidate": {
            "outlineMeasured": len(candidate_distances),
            "outlineDistanceMedianPx": (
                statistics.median(candidate_distances) if candidate_distances else None
            ),
            "outlineDistanceP95Px": percentile(candidate_distances, 0.95),
            "outlineP95Within1Px": sum(value <= 1 for value in candidate_distances),
            "outlineP95Within2Px": sum(value <= 2 for value in candidate_distances),
            "outlineF1At2PxAtLeast090": sum(value >= 0.90 for value in candidate_f1),
            "internalLayoutStatusCounts": dict(
                Counter(row["candidateInternalLayoutStatus"] for row in rows)
            ),
            "edgeGridDistributionL1Median": (
                statistics.median(candidate_grid) if candidate_grid else None
            ),
            "edgeGridDistributionL1P95": percentile(candidate_grid, 0.95),
        },
        "pairedMeanDistanceDeltaPx": (
            statistics.mean(
                row["candidateDistanceP95Px"] - row["baselineDistanceP95Px"]
                for row in paired_distances
            )
            if paired_distances
            else None
        ),
    }
    if include_isolated:
        isolated = [row for row in rows if row.get("isolationConfidence") == "isolated"]
        result["isolated"] = summarize(isolated, include_isolated=False)
    return result


def build_comparison_row(
    key: str, before: dict[str, Any], after: dict[str, Any]
) -> dict[str, Any]:
    outcome, hard_regression = classify_pair(before, after)
    row = {
        "key": key,
        "corpus": after.get("corpus"),
        "deckId": after.get("deckId"),
        "slideNumber": int(after.get("slideNumber") or 0),
        "shapeId": after.get("shapeId"),
        "kind": after.get("kind") or "unknown",
        "structuralRoles": after.get("structuralRoles")
        or [after.get("kind") or "unknown"],
        "structuralTraits": after.get("structuralTraits") or [],
        "name": after.get("name"),
        "bbox": optional_json(after.get("bbox")),
        "hasText": str(after.get("hasText") or "").lower() == "true",
        "isolationConfidence": after.get("isolationConfidence") or "unknown",
        "overlapAreaFraction": optional_float(after.get("overlapAreaFraction")),
        "higherZOverlapAreaFraction": optional_float(
            after.get("higherZOverlapAreaFraction")
        ),
        "baselineOutlineStatus": before.get("outlineStatus") or "unknown",
        "candidateOutlineStatus": after.get("outlineStatus") or "unknown",
        "baselineInternalLayoutStatus": before.get("internalLayoutStatus")
        or "unknown",
        "candidateInternalLayoutStatus": after.get("internalLayoutStatus")
        or "unknown",
        "baselineDistanceP95Px": before.get("edgeDistanceP95Px"),
        "candidateDistanceP95Px": after.get("edgeDistanceP95Px"),
        "baselineF1At2Px": before.get("edgeF1At2Px"),
        "candidateF1At2Px": after.get("edgeF1At2Px"),
        "baselineProjectionXEmdPx": before.get("edgeProjectionXEmdPx"),
        "candidateProjectionXEmdPx": after.get("edgeProjectionXEmdPx"),
        "baselineProjectionYEmdPx": before.get("edgeProjectionYEmdPx"),
        "candidateProjectionYEmdPx": after.get("edgeProjectionYEmdPx"),
        "baselineGridDistributionL1": before.get("edgeGridDistributionL1"),
        "candidateGridDistributionL1": after.get("edgeGridDistributionL1"),
        "baselineComponentCountAbsoluteDelta": before.get(
            "edgeComponentCountAbsoluteDelta"
        ),
        "candidateComponentCountAbsoluteDelta": after.get(
            "edgeComponentCountAbsoluteDelta"
        ),
        "outcome": outcome,
        "hardRegression": hard_regression,
    }
    if (
        row["baselineDistanceP95Px"] is not None
        and row["candidateDistanceP95Px"] is not None
    ):
        row["distanceDeltaPx"] = (
            row["candidateDistanceP95Px"] - row["baselineDistanceP95Px"]
        )
    if row["baselineF1At2Px"] is not None and row["candidateF1At2Px"] is not None:
        row["f1Delta"] = row["candidateF1At2Px"] - row["baselineF1At2Px"]
    for output_name, baseline_name, candidate_name in [
        (
            "projectionXEmdDeltaPx",
            "baselineProjectionXEmdPx",
            "candidateProjectionXEmdPx",
        ),
        (
            "projectionYEmdDeltaPx",
            "baselineProjectionYEmdPx",
            "candidateProjectionYEmdPx",
        ),
        (
            "gridDistributionL1Delta",
            "baselineGridDistributionL1",
            "candidateGridDistributionL1",
        ),
        (
            "componentCountAbsoluteDeltaChange",
            "baselineComponentCountAbsoluteDelta",
            "candidateComponentCountAbsoluteDelta",
        ),
    ]:
        if row[baseline_name] is not None and row[candidate_name] is not None:
            row[output_name] = row[candidate_name] - row[baseline_name]
    return row


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, help="Baseline elements.csv")
    parser.add_argument("--candidate", required=True, help="Candidate elements.csv")
    parser.add_argument("--output", required=True, help="Comparison JSON")
    arguments = sys.argv[1:]
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    args = parser.parse_args(arguments)

    baseline_path = Path(args.baseline).resolve()
    candidate_path = Path(args.candidate).resolve()
    output_path = Path(args.output).resolve()
    baseline = load_elements(baseline_path)
    candidate = load_elements(candidate_path)
    baseline_unattributed = load_unattributed_regions(
        baseline_path.parent / "slides.csv"
    )
    candidate_unattributed = load_unattributed_regions(
        candidate_path.parent / "slides.csv"
    )
    paired_keys = sorted(baseline.keys() & candidate.keys())
    rows: list[dict[str, Any]] = []
    by_kind: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_role: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_trait: dict[str, list[dict[str, Any]]] = defaultdict(list)

    def register(row: dict[str, Any]) -> None:
        rows.append(row)
        by_kind[row["kind"]].append(row)
        for role in row["structuralRoles"]:
            by_role[str(role)].append(row)
        for trait in row["structuralTraits"]:
            by_trait[str(trait)].append(row)

    for key in paired_keys:
        row = build_comparison_row(key, baseline[key], candidate[key])
        register(row)
    paired_unattributed_keys = sorted(
        baseline_unattributed.keys() & candidate_unattributed.keys()
    )
    for key in paired_unattributed_keys:
        register(
            build_comparison_row(
                key, baseline_unattributed[key], candidate_unattributed[key]
            )
        )

    regressed = [row for row in rows if row["outcome"] == "regressed"]
    improved = [row for row in rows if row["outcome"] == "improved"]
    mixed = [row for row in rows if row["outcome"] == "mixed"]
    missing_from_candidate = sorted(baseline.keys() - candidate.keys())
    new_in_candidate = sorted(candidate.keys() - baseline.keys())
    missing_unattributed_from_candidate = sorted(
        baseline_unattributed.keys() - candidate_unattributed.keys()
    )
    new_unattributed_in_candidate = sorted(
        candidate_unattributed.keys() - baseline_unattributed.keys()
    )
    hard_regressions = sum(row["hardRegression"] for row in rows)
    comparison = {
        "contractVersion": "1.3",
        "method": {
            "priority": "Outline presence/status first, internal-layout status second, then outline distance/F1 and internal projection, grid-distribution, and component metrics. Pixel RMSE is excluded.",
            "outcomes": "A status-rank change decides first. Within matching statuses, a Pareto improvement/regression across outline and internal-layout metrics decides; opposing movement is mixed.",
            "hardRegression": "The candidate moved to a worse outline or internal-layout status, including newly missing content or changed topology.",
            "unattributedCoverage": "Sibling slides.csv files are loaded automatically. The region outside all top-level element boxes participates in the same fail-closed comparison so master, layout, background, clipping, or otherwise unattributed changes cannot pass unseen.",
        },
        "baseline": str(baseline_path),
        "candidate": str(candidate_path),
        "baselineElements": len(baseline),
        "candidateElements": len(candidate),
        "pairedElements": len(paired_keys),
        "baselineUnattributedSlideRegions": len(baseline_unattributed),
        "candidateUnattributedSlideRegions": len(candidate_unattributed),
        "pairedUnattributedSlideRegions": len(paired_unattributed_keys),
        "pairedStructuralRegions": len(rows),
        "missingFromCandidate": missing_from_candidate,
        "newInCandidate": new_in_candidate,
        "missingUnattributedFromCandidate": missing_unattributed_from_candidate,
        "newUnattributedInCandidate": new_unattributed_in_candidate,
        "summary": summarize(rows),
        # Review every blocking status change, even when an outline improvement
        # makes the overall Pareto outcome 'improved'. Top-100 lists are only
        # summaries and must not determine release-review coverage.
        "hardRegressionRows": [row for row in rows if row["hardRegression"]],
        "elementSummary": summarize(rows[: len(paired_keys)]),
        "unattributedSummary": summarize(rows[len(paired_keys) :]),
        "byKind": {
            kind: summarize(members) for kind, members in sorted(by_kind.items())
        },
        "byStructuralRole": {
            role: summarize(members) for role, members in sorted(by_role.items())
        },
        "byStructuralTrait": {
            trait: summarize(members) for trait, members in sorted(by_trait.items())
        },
        "worstRegressions": sorted(
            regressed,
            key=lambda row: (
                status_rank({"outlineStatus": row["candidateOutlineStatus"]})
                - status_rank({"outlineStatus": row["baselineOutlineStatus"]}),
                internal_status_rank(
                    {"internalLayoutStatus": row["candidateInternalLayoutStatus"]}
                )
                - internal_status_rank(
                    {"internalLayoutStatus": row["baselineInternalLayoutStatus"]}
                ),
                row.get("distanceDeltaPx") or 0,
                row.get("gridDistributionL1Delta") or 0,
                -(row.get("f1Delta") or 0),
            ),
            reverse=True,
        )[:100],
        "largestImprovements": sorted(
            improved,
            key=lambda row: (
                status_rank({"outlineStatus": row["baselineOutlineStatus"]})
                - status_rank({"outlineStatus": row["candidateOutlineStatus"]}),
                internal_status_rank(
                    {"internalLayoutStatus": row["baselineInternalLayoutStatus"]}
                )
                - internal_status_rank(
                    {"internalLayoutStatus": row["candidateInternalLayoutStatus"]}
                ),
                -(row.get("distanceDeltaPx") or 0),
                -(row.get("gridDistributionL1Delta") or 0),
                row.get("f1Delta") or 0,
            ),
            reverse=True,
        )[:100],
        "mixedMovements": sorted(
            mixed,
            key=lambda row: (
                abs(row.get("distanceDeltaPx") or 0),
                abs(row.get("gridDistributionL1Delta") or 0),
                abs(row.get("f1Delta") or 0),
            ),
            reverse=True,
        )[:100],
        "releaseGate": {
            "status": (
                "pass"
                if not missing_from_candidate
                and not new_in_candidate
                and not missing_unattributed_from_candidate
                and not new_unattributed_in_candidate
                and hard_regressions == 0
                and not regressed
                and not mixed
                else "review"
            ),
            "blockingMissingElements": len(missing_from_candidate),
            "unexpectedNewElements": len(new_in_candidate),
            "blockingMissingUnattributedRegions": len(
                missing_unattributed_from_candidate
            ),
            "unexpectedNewUnattributedRegions": len(
                new_unattributed_in_candidate
            ),
            "hardStructuralRegressions": hard_regressions,
            "structuralRegressions": len(regressed),
            "mixedMetricMovements": len(mixed),
            "policy": "Only identical element and unattributed-slide region sets with no outline or internal-layout regression pass automatically. Review can still accept a candidate after every regression and mixed movement is visually adjudicated.",
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(comparison["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
