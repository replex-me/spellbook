#!/usr/bin/env python3

"""Build a slide- and element-level ledger for PowerPoint render differences.

Structural fidelity is evaluated before pixel residuals. The ledger measures
outline displacement with tolerant edge matching and symmetric edge distance,
then retains RMSE and changed-pixel area for color and rasterization review.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import posixpath
import statistics
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import cv2
import numpy as np


PUBLIC_SPEC = {
    "name": "public",
    "report": ".tmp-eval/results/public-pptx-feature-corpus-v13/report.json",
    "results": ".tmp-eval/results/public-pptx-feature-corpus-v13",
    "references": ".tmp-eval/references-public-powerpoint-macos",
    "manifest": ".tmp-eval/public-corpus.json",
    "source_stage": ".tmp-eval/cloud-stage-public-v13/decks",
}

REAL_SPEC = {
    "name": "real",
    "report": ".tmp-eval/results/lo-26-8-0-public-corpus-v13-full/report.json",
    "results": ".tmp-eval/results/lo-26-8-0-public-corpus-v13-full",
    "references": ".tmp-eval/references-powerpoint-macos",
    "manifest": ".tmp-eval/real-corpus.json",
    "source_stage": ".tmp-eval/cloud-stage-lo-26-8-0-font-scope-v7-full/decks",
}

RELATIONSHIP_FLAGS = {
    "chart": "chart",
    "diagram": "smartart",
    "audio": "media",
    "video": "media",
    "media": "media",
    "oleObject": "ole",
    "image": "image_relationship",
    "hyperlink": "hyperlink",
}

EDGE_CANNY_LOW = 50
EDGE_CANNY_HIGH = 150
EDGE_LAYOUT_GRID_SIZE = 8


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    return float(np.quantile(np.asarray(values, dtype=np.float64), quantile))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_source(
    root: Path,
    spec: dict[str, str],
    deck: dict[str, Any],
    manifest_decks: dict[str, dict[str, Any]],
) -> Path:
    staged = root / spec["source_stage"] / f"{deck['id']}.pptx"
    if staged.exists() and sha256_file(staged) == deck["sourceSha256"]:
        return staged

    manifest_source = Path(manifest_decks[deck["id"]]["source"])
    if not manifest_source.is_absolute():
        manifest_source = (root / spec["manifest"]).parent / manifest_source
    manifest_source = manifest_source.resolve()
    if not manifest_source.exists():
        raise FileNotFoundError(f"Source PPTX is unavailable for {deck['id']}")
    if sha256_file(manifest_source) != deck["sourceSha256"]:
        raise ValueError(f"Source SHA-256 mismatch for {deck['id']}")
    return manifest_source


def relationship_feature_flags(xml_bytes: bytes) -> set[str]:
    flags: set[str] = set()
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return {"relationship_xml_parse_error"}
    for relationship in root.iter():
        if local_name(relationship.tag) != "Relationship":
            continue
        rel_type = relationship.attrib.get("Type", "")
        target = relationship.attrib.get("Target", "").lower()
        if relationship.attrib.get("TargetMode") == "External":
            flags.add("external_relationship")
        for suffix, flag in RELATIONSHIP_FLAGS.items():
            if rel_type.endswith(f"/{suffix}"):
                flags.add(flag)
        if target.endswith((".svg", ".emf", ".wmf")):
            flags.add("vector_image")
        if target.endswith((".gif",)):
            flags.add("animated_gif")
    return flags


def relationship_target(
    archive: zipfile.ZipFile,
    part_path: str,
    relationship_type_suffix: str,
) -> str | None:
    rels_path = posixpath.join(
        posixpath.dirname(part_path),
        "_rels",
        posixpath.basename(part_path) + ".rels",
    )
    if rels_path not in archive.namelist():
        return None
    try:
        root = ET.fromstring(archive.read(rels_path))
    except ET.ParseError:
        return None
    for relationship in root.iter():
        if local_name(relationship.tag) != "Relationship":
            continue
        if not relationship.attrib.get("Type", "").endswith(
            f"/{relationship_type_suffix}"
        ):
            continue
        target = unquote(relationship.attrib.get("Target", ""))
        if not target:
            continue
        if target.startswith("/"):
            resolved = target.lstrip("/")
        else:
            resolved = posixpath.normpath(
                posixpath.join(posixpath.dirname(part_path), target)
            )
        return resolved if resolved in archive.namelist() else None
    return None


def placeholder_details(root: ET.Element) -> tuple[set[str], set[tuple[str, str]]]:
    flags: set[str] = set()
    keys: set[tuple[str, str]] = set()
    payload_names = {
        "audioFile",
        "blip",
        "graphicData",
        "oleObj",
        "tbl",
        "videoFile",
        "wavAudioFile",
    }
    content_types = {"chart", "clipArt", "dgm", "media", "obj", "pic", "tbl"}
    for shape in root.iter():
        if local_name(shape.tag) not in {"sp", "pic", "graphicFrame"}:
            continue
        placeholder = next(
            (item for item in shape.iter() if local_name(item.tag) == "ph"), None
        )
        if placeholder is None:
            continue
        attrs = {local_name(key): value for key, value in placeholder.attrib.items()}
        placeholder_type = attrs.get("type", "obj")
        placeholder_index = attrs.get("idx", "")
        keys.add((placeholder_type, placeholder_index))
        flags.add(f"placeholder_type_{placeholder_type}")
        descendants = list(shape.iter())
        has_text = any(
            local_name(item.tag) == "t" and (item.text or "").strip()
            for item in descendants
        )
        has_payload = any(local_name(item.tag) in payload_names for item in descendants)
        if placeholder_type in content_types and not has_text and not has_payload:
            flags.add("empty_content_placeholder")
            flags.add(f"empty_{placeholder_type}_placeholder")
    return flags, keys


def slide_feature_flags(archive: zipfile.ZipFile, slide_number: int) -> set[str]:
    slide_path = f"ppt/slides/slide{slide_number}.xml"
    rels_path = f"ppt/slides/_rels/slide{slide_number}.xml.rels"
    flags: set[str] = set()
    try:
        xml_bytes = archive.read(slide_path)
    except KeyError:
        return {"missing_slide_xml"}

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return {"slide_xml_parse_error"}

    detail_flags, slide_placeholder_keys = placeholder_details(root)
    flags.update(detail_flags)

    for element in root.iter():
        name = local_name(element.tag)
        attrs = {local_name(key): value for key, value in element.attrib.items()}
        if name == "spAutoFit":
            flags.add("shape_autofit")
        elif name == "normAutofit":
            flags.add("normal_autofit")
        elif name == "noAutofit":
            flags.add("no_autofit")
        elif name == "ph":
            flags.add("placeholder")
            if attrs.get("type") == "media":
                flags.add("media_placeholder")
        elif name == "tbl":
            flags.add("table")
        elif name == "oleObj":
            flags.add("ole")
        elif name == "pic":
            flags.add("picture")
        elif name == "grpSp":
            flags.add("group")
        elif name == "cxnSp":
            flags.add("connector")
        elif name in {"scene3d", "sp3d"}:
            flags.add("three_dimensional")
        elif name in {
            "effectLst",
            "effectDag",
            "outerShdw",
            "innerShdw",
            "glow",
            "softEdge",
            "reflection",
        }:
            flags.add("effect")
        elif name == "prstTxWarp":
            flags.add("word_art")
        elif name == "custGeom":
            flags.add("custom_geometry")
        elif name == "gradFill":
            flags.add("gradient_fill")
        elif name == "pattFill":
            flags.add("pattern_fill")
        elif name == "alpha":
            flags.add("transparency")
        elif name == "transition":
            flags.add("transition")
        elif name == "timing":
            flags.add("animation")
        elif name in {"hlinkClick", "hlinkHover"}:
            flags.add("hyperlink")
        elif name == "bodyPr":
            if attrs.get("wrap") == "none":
                flags.add("no_wrap")
            if int(attrs.get("numCol", "1") or "1") > 1:
                flags.add("text_columns")
            if attrs.get("vert") not in {None, "horz"}:
                flags.add("vertical_text")
        elif name.endswith("pPr"):
            if attrs.get("rtl") in {"1", "true"}:
                flags.add("rtl_text")
            east_asian_line_break = attrs.get("eaLnBrk")
            if east_asian_line_break in {"1", "true", "on"}:
                flags.add("east_asian_line_break_enabled")
            elif east_asian_line_break in {"0", "false", "off"}:
                flags.add("east_asian_line_break_disabled")
        elif name == "t" and is_east_asian_text(element.text or ""):
            flags.add("east_asian_text")
        elif name == "xfrm":
            if attrs.get("rot") not in {None, "0"}:
                flags.add("rotation")
            if attrs.get("flipH") in {"1", "true"} or attrs.get("flipV") in {
                "1",
                "true",
            }:
                flags.add("flip")
        elif name == "graphicData":
            uri = attrs.get("uri", "").lower()
            if "diagram" in uri:
                flags.add("smartart")
            if "chart" in uri:
                flags.add("chart")

    if "east_asian_text" in flags and not flags & {
        "east_asian_line_break_enabled",
        "east_asian_line_break_disabled",
    }:
        flags.add("east_asian_line_break_implicit")

    if rels_path in archive.namelist():
        flags.update(relationship_feature_flags(archive.read(rels_path)))

    layout_path = relationship_target(archive, slide_path, "slideLayout")
    if layout_path:
        try:
            layout_root = ET.fromstring(archive.read(layout_path))
        except ET.ParseError:
            flags.add("layout_xml_parse_error")
        else:
            for layout_shape in layout_root.iter():
                if local_name(layout_shape.tag) not in {"sp", "pic", "graphicFrame"}:
                    continue
                placeholder = next(
                    (
                        item
                        for item in layout_shape.iter()
                        if local_name(item.tag) == "ph"
                    ),
                    None,
                )
                if placeholder is None:
                    continue
                attrs = {
                    local_name(key): value for key, value in placeholder.attrib.items()
                }
                key = (attrs.get("type", "obj"), attrs.get("idx", ""))
                if key not in slide_placeholder_keys:
                    continue
                if any(
                    local_name(item.tag) == "custGeom" for item in layout_shape.iter()
                ):
                    flags.add("layout_custom_geometry_placeholder")
    return flags


def slide_element_structural_roles(
    archive: zipfile.ZipFile, slide_number: int
) -> dict[int, list[str]]:
    """Map OOXML shape ids to exact structural roles for per-kind review."""

    slide_path = f"ppt/slides/slide{slide_number}.xml"
    try:
        root = ET.fromstring(archive.read(slide_path))
    except (KeyError, ET.ParseError):
        return {}
    roles_by_shape: dict[int, list[str]] = {}
    for item in root.iter():
        item_name = local_name(item.tag)
        if item_name not in {"sp", "pic", "graphicFrame", "grpSp", "cxnSp"}:
            continue
        shape_id = None
        for descendant in item.iter():
            if local_name(descendant.tag) != "cNvPr":
                continue
            try:
                shape_id = int(descendant.attrib.get("id", ""))
            except ValueError:
                shape_id = None
            break
        if shape_id is None:
            continue

        roles: set[str] = set()
        if item_name == "sp":
            has_text = any(
                local_name(descendant.tag) == "t" and bool(descendant.text)
                for descendant in item.iter()
            )
            roles.add("text_shape" if has_text else "shape")
        elif item_name == "pic":
            roles.add("picture")
        elif item_name == "grpSp":
            roles.add("group")
        elif item_name == "cxnSp":
            roles.add("connector")
        else:
            for descendant in item.iter():
                name = local_name(descendant.tag)
                if name == "tbl":
                    roles.add("table")
                elif name == "oleObj":
                    roles.add("ole")
                elif name == "graphicData":
                    uri = descendant.attrib.get("uri", "").lower()
                    if "diagram" in uri:
                        roles.add("smartart")
                    elif "chart" in uri:
                        roles.add("chart")
            if not roles:
                roles.add("structured_object")
        roles_by_shape[shape_id] = sorted(roles)
    return roles_by_shape


def slide_element_stroke_widths(
    archive: zipfile.ZipFile, slide_number: int
) -> dict[int, int]:
    """Return explicit OOXML line widths so crops include the full stroke."""

    slide_path = f"ppt/slides/slide{slide_number}.xml"
    try:
        root = ET.fromstring(archive.read(slide_path))
    except (KeyError, ET.ParseError):
        return {}
    widths: dict[int, int] = {}
    for item in root.iter():
        if local_name(item.tag) not in {"sp", "pic", "cxnSp"}:
            continue
        shape_id = None
        for descendant in item.iter():
            if local_name(descendant.tag) != "cNvPr":
                continue
            try:
                shape_id = int(descendant.attrib.get("id", ""))
            except ValueError:
                shape_id = None
            break
        if shape_id is None:
            continue
        line = next(
            (
                descendant
                for descendant in item.iter()
                if local_name(descendant.tag) == "ln"
            ),
            None,
        )
        try:
            width = int(line.attrib.get("w", "0")) if line is not None else 0
        except ValueError:
            width = 0
        if width > 0:
            widths[shape_id] = width
    return widths


def package_relationships(
    archive: zipfile.ZipFile, part_path: str
) -> dict[str, dict[str, str | None]]:
    """Resolve all internal relationships for one OOXML part by relationship id."""

    rels_path = posixpath.join(
        posixpath.dirname(part_path),
        "_rels",
        posixpath.basename(part_path) + ".rels",
    )
    if rels_path not in archive.namelist():
        return {}
    try:
        root = ET.fromstring(archive.read(rels_path))
    except ET.ParseError:
        return {}
    relationships: dict[str, dict[str, str | None]] = {}
    for relationship in root.iter():
        if local_name(relationship.tag) != "Relationship":
            continue
        relationship_id = relationship.attrib.get("Id")
        target = unquote(relationship.attrib.get("Target", ""))
        if not relationship_id or not target:
            continue
        external = relationship.attrib.get("TargetMode") == "External"
        if target.startswith("/"):
            resolved = target.lstrip("/")
        else:
            resolved = posixpath.normpath(
                posixpath.join(posixpath.dirname(part_path), target)
            )
        relationships[relationship_id] = {
            "type": relationship.attrib.get("Type"),
            "target": target,
            "resolved": None if external else resolved,
            "targetMode": relationship.attrib.get("TargetMode"),
        }
    return relationships


def local_attribute(element: ET.Element, name: str) -> str | None:
    return next(
        (
            value
            for attribute, value in element.attrib.items()
            if local_name(attribute) == name
        ),
        None,
    )


def is_east_asian_text(text: str) -> bool:
    """Return whether text contains a common BMP Hangul, CJK, or kana code point."""

    return any(
        "\u1100" <= character <= "\u11ff"
        or "\u2e80" <= character <= "\u9fff"
        or "\ua960" <= character <= "\ua97f"
        or "\uac00" <= character <= "\ud7ff"
        or "\uf900" <= character <= "\ufaff"
        for character in text
    )


def east_asian_line_break_traits(descendants: list[ET.Element]) -> set[str]:
    """Record DrawingML eaLnBrk declarations without guessing style inheritance."""

    text = "".join(
        item.text or "" for item in descendants if local_name(item.tag) == "t"
    )
    if not is_east_asian_text(text):
        return set()

    traits = {"text_east_asian_content"}
    declarations = [
        item.attrib["eaLnBrk"]
        for item in descendants
        if local_name(item.tag).endswith("pPr") and "eaLnBrk" in item.attrib
    ]
    if not declarations:
        traits.add("text_east_asian_line_break_implicit")
    if any(value in {"1", "true", "on"} for value in declarations):
        traits.add("text_east_asian_line_break_enabled")
    if any(value in {"0", "false", "off"} for value in declarations):
        traits.add("text_east_asian_line_break_disabled")
    return traits


def element_shape_id(element: ET.Element) -> int | None:
    properties = next(
        (
            descendant
            for descendant in element.iter()
            if local_name(descendant.tag) == "cNvPr"
        ),
        None,
    )
    try:
        return int(properties.attrib.get("id", "")) if properties is not None else None
    except ValueError:
        return None


def slide_element_structural_traits(
    archive: zipfile.ZipFile, slide_number: int
) -> dict[int, list[str]]:
    """Describe element-specific rendering paths so failures group by real subtype."""

    slide_path = f"ppt/slides/slide{slide_number}.xml"
    try:
        root = ET.fromstring(archive.read(slide_path))
    except (KeyError, ET.ParseError):
        return {}
    relationships = package_relationships(archive, slide_path)
    shape_tree = next(
        (item for item in root.iter() if local_name(item.tag) == "spTree"), None
    )
    if shape_tree is None:
        return {}

    traits_by_shape: dict[int, list[str]] = {}
    effect_names = {
        "blur",
        "glow",
        "innerShdw",
        "outerShdw",
        "reflection",
        "softEdge",
    }
    chart_type_names = {
        "area3DChart",
        "areaChart",
        "bar3DChart",
        "barChart",
        "bubbleChart",
        "doughnutChart",
        "line3DChart",
        "lineChart",
        "ofPieChart",
        "pie3DChart",
        "pieChart",
        "radarChart",
        "scatterChart",
        "stockChart",
        "surface3DChart",
        "surfaceChart",
    }
    for item in list(shape_tree):
        item_name = local_name(item.tag)
        if item_name not in {"sp", "pic", "graphicFrame", "grpSp", "cxnSp"}:
            continue
        shape_id = element_shape_id(item)
        if shape_id is None:
            continue
        descendants = list(item.iter())
        names = [local_name(descendant.tag) for descendant in descendants]
        traits: set[str] = set()
        traits.update(east_asian_line_break_traits(descendants))
        transform = next(
            (descendant for descendant in descendants if local_name(descendant.tag) == "xfrm"),
            None,
        )
        if transform is not None:
            if transform.attrib.get("rot") not in {None, "0"}:
                traits.add("rotated")
            if transform.attrib.get("flipH") in {"1", "true"}:
                traits.add("flipped_horizontal")
            if transform.attrib.get("flipV") in {"1", "true"}:
                traits.add("flipped_vertical")
        placeholder = next(
            (
                descendant
                for descendant in descendants
                if local_name(descendant.tag) == "ph"
            ),
            None,
        )
        if placeholder is not None:
            placeholder_type = placeholder.attrib.get("type", "obj")
            traits.add(f"placeholder_{placeholder_type}")
            if transform is None:
                traits.add("placeholder_inherited_geometry")
        if any(name in effect_names for name in names):
            traits.add("effects")
        if "scene3d" in names or "sp3d" in names:
            traits.add("three_dimensional")

        if item_name == "sp":
            if "custGeom" in names:
                traits.add("shape_custom_geometry")
            preset_geometry = next(
                (
                    descendant.attrib.get("prst")
                    for descendant in descendants
                    if local_name(descendant.tag) == "prstGeom"
                ),
                None,
            )
            if preset_geometry:
                traits.add(f"shape_preset_{preset_geometry}")
            if "gradFill" in names:
                traits.add("gradient_fill")
            if "pattFill" in names:
                traits.add("pattern_fill")
            if "solidFill" in names:
                traits.add("solid_fill")
            if "txBody" in names:
                body_properties = next(
                    (
                        descendant
                        for descendant in descendants
                        if local_name(descendant.tag) == "bodyPr"
                    ),
                    None,
                )
                if body_properties is not None:
                    if body_properties.attrib.get("wrap") == "none":
                        traits.add("text_no_wrap")
                    if int(body_properties.attrib.get("numCol", "1") or "1") > 1:
                        traits.add("text_columns")
                    if body_properties.attrib.get("vert") not in {None, "horz"}:
                        traits.add("text_vertical")
                if "spAutoFit" in names:
                    traits.add("text_shape_autofit")
                elif "normAutofit" in names:
                    traits.add("text_normal_autofit")
                elif "noAutofit" in names:
                    traits.add("text_no_autofit")
        elif item_name == "pic":
            source_rectangle = next(
                (
                    descendant
                    for descendant in descendants
                    if local_name(descendant.tag) == "srcRect"
                ),
                None,
            )
            if source_rectangle is not None and any(
                value not in {"", "0"} for value in source_rectangle.attrib.values()
            ):
                traits.add("picture_cropped")
            if "tile" in names:
                traits.add("picture_tiled")
            if "stretch" in names:
                traits.add("picture_stretched")
            blip = next(
                (descendant for descendant in descendants if local_name(descendant.tag) == "blip"),
                None,
            )
            relationship_id = local_attribute(blip, "embed") if blip is not None else None
            relationship = relationships.get(relationship_id or "", {})
            target = str(relationship.get("resolved") or "").lower()
            if target.endswith((".emf", ".svg", ".wmf")):
                traits.add("picture_vector")
            elif target:
                traits.add("picture_raster")
            if relationship.get("targetMode") == "External":
                traits.add("picture_external")
        elif item_name == "grpSp":
            traits.add("group_nested" if names.count("grpSp") > 1 else "group_flat")
            child_count = sum(
                local_name(child.tag) in {"sp", "pic", "graphicFrame", "grpSp", "cxnSp"}
                for child in list(item)
            )
            traits.add(f"group_children_{min(child_count, 10)}{'_plus' if child_count > 10 else ''}")
        elif item_name == "cxnSp":
            preset_geometry = next(
                (
                    descendant.attrib.get("prst")
                    for descendant in descendants
                    if local_name(descendant.tag) == "prstGeom"
                ),
                None,
            )
            if preset_geometry:
                traits.add(f"connector_{preset_geometry}")
            if any(
                local_name(descendant.tag) in {"headEnd", "tailEnd"}
                and descendant.attrib.get("type") not in {None, "none"}
                for descendant in descendants
            ):
                traits.add("connector_arrow")
        elif item_name == "graphicFrame":
            if "tbl" in names:
                rows = [
                    descendant
                    for descendant in descendants
                    if local_name(descendant.tag) == "tr"
                ]
                cells = [
                    descendant
                    for descendant in descendants
                    if local_name(descendant.tag) == "tc"
                ]
                traits.add(f"table_rows_{min(len(rows), 20)}{'_plus' if len(rows) > 20 else ''}")
                traits.add(f"table_cells_{min(len(cells), 100)}{'_plus' if len(cells) > 100 else ''}")
                if any(
                    local_attribute(descendant, "gridSpan") not in {None, "1"}
                    or local_attribute(descendant, "rowSpan") not in {None, "1"}
                    or local_attribute(descendant, "hMerge") in {"1", "true"}
                    or local_attribute(descendant, "vMerge") in {"1", "true"}
                    for descendant in cells
                ):
                    traits.add("table_merged_cells")

            chart_reference = next(
                (
                    descendant
                    for descendant in descendants
                    if local_name(descendant.tag) == "chart"
                ),
                None,
            )
            if chart_reference is not None:
                relationship_id = local_attribute(chart_reference, "id")
                chart_path = relationships.get(relationship_id or "", {}).get("resolved")
                if isinstance(chart_path, str) and chart_path in archive.namelist():
                    try:
                        chart_root = ET.fromstring(archive.read(chart_path))
                    except ET.ParseError:
                        traits.add("chart_xml_parse_error")
                    else:
                        chart_descendants = list(chart_root.iter())
                        traits.update(
                            east_asian_line_break_traits(chart_descendants)
                        )
                        chart_names = [
                            local_name(node.tag) for node in chart_descendants
                        ]
                        for chart_type in sorted(set(chart_names) & chart_type_names):
                            traits.add(f"chart_type_{chart_type}")
                        if "view3D" in chart_names:
                            traits.add("chart_three_dimensional")
                        if "legend" in chart_names:
                            traits.add("chart_legend")
                        if "title" in chart_names:
                            traits.add("chart_title")
                        if "manualLayout" in chart_names:
                            traits.add("chart_manual_layout")
                        if "dTable" in chart_names:
                            traits.add("chart_data_table")

            graphic_data = next(
                (
                    descendant
                    for descendant in descendants
                    if local_name(descendant.tag) == "graphicData"
                ),
                None,
            )
            if graphic_data is not None and "diagram" in graphic_data.attrib.get("uri", "").lower():
                relationship_ids = next(
                    (
                        descendant
                        for descendant in descendants
                        if local_name(descendant.tag) == "relIds"
                    ),
                    None,
                )
                data_relationship_id = (
                    local_attribute(relationship_ids, "dm")
                    if relationship_ids is not None
                    else None
                )
                data_path = relationships.get(data_relationship_id or "", {}).get("resolved")
                cached_shape_count = 0
                if isinstance(data_path, str) and data_path in archive.namelist():
                    try:
                        data_root = ET.fromstring(archive.read(data_path))
                    except ET.ParseError:
                        traits.add("smartart_data_parse_error")
                    else:
                        traits.update(
                            east_asian_line_break_traits(list(data_root.iter()))
                        )
                        data_extension = next(
                            (
                                node
                                for node in data_root.iter()
                                if local_name(node.tag) == "dataModelExt"
                            ),
                            None,
                        )
                        drawing_relationship_id = (
                            data_extension.attrib.get("relId")
                            if data_extension is not None
                            else None
                        )
                        drawing_path = relationships.get(
                            drawing_relationship_id or "", {}
                        ).get("resolved")
                        if isinstance(drawing_path, str) and drawing_path in archive.namelist():
                            try:
                                drawing_root = ET.fromstring(archive.read(drawing_path))
                            except ET.ParseError:
                                traits.add("smartart_drawing_parse_error")
                            else:
                                traits.update(
                                    east_asian_line_break_traits(
                                        list(drawing_root.iter())
                                    )
                                )
                                cached_shape_count = sum(
                                    local_name(node.tag) in {"sp", "pic", "cxnSp"}
                                    for node in drawing_root.iter()
                                )
                traits.add(
                    "smartart_cached_drawing"
                    if cached_shape_count > 0
                    else "smartart_layout_engine_required"
                )
                if cached_shape_count > 0:
                    traits.add(f"smartart_cached_nodes_{min(cached_shape_count, 50)}{'_plus' if cached_shape_count > 50 else ''}")
        traits_by_shape[shape_id] = sorted(traits)
    return traits_by_shape


def classify_candidates(
    flags: set[str],
    has_missing_fonts: bool,
    has_embedded_fonts: bool,
    has_text: bool,
    rmse: float,
) -> list[str]:
    if rmse == 0:
        return ["pixel_exact"]
    candidates: list[str] = []
    if "smartart" in flags:
        candidates.append("smartart_import")
    if flags & {"media", "media_placeholder"}:
        candidates.append("media_placeholder_or_frame")
    if flags & {"empty_content_placeholder", "layout_custom_geometry_placeholder"}:
        candidates.append("placeholder_visibility_or_inheritance")
    if flags & {
        "east_asian_line_break_disabled",
        "east_asian_line_break_enabled",
        "east_asian_line_break_implicit",
        "shape_autofit",
        "normal_autofit",
        "no_wrap",
        "text_columns",
        "vertical_text",
        "rtl_text",
    }:
        candidates.append("text_layout_autofit")
    if flags & {"chart", "table", "ole"}:
        candidates.append("structured_object")
    if flags & {"three_dimensional", "effect", "word_art", "transparency"}:
        candidates.append("effects_3d_transparency")
    if has_missing_fonts and has_text:
        candidates.append("font_substitution_metrics")
    elif has_embedded_fonts and has_text:
        candidates.append("embedded_font_text_layout")
    elif has_text:
        candidates.append("text_metrics_without_reported_missing_font")
    if flags & {"vector_image", "animated_gif", "picture", "image_relationship"}:
        candidates.append("image_vector_rasterization")
    if flags & {"group", "connector", "rotation", "flip", "custom_geometry"}:
        candidates.append("group_connector_geometry")
    if flags & {"gradient_fill", "pattern_fill"}:
        candidates.append("fill_and_color")
    if flags & {"placeholder"}:
        candidates.append("master_layout_placeholder")
    if not candidates:
        candidates.append("unclassified_visual_difference")
    return candidates


def primary_pattern(
    flags: set[str],
    missing_fonts: list[str],
    has_embedded_fonts: bool,
    has_text: bool,
    rmse: float,
) -> str:
    """Assign one review route without claiming that correlation proves cause."""

    if rmse == 0:
        return "pixel_exact"
    if "media_placeholder" in flags and "media" not in flags:
        return "unbound_media_placeholder"
    if "layout_custom_geometry_placeholder" in flags:
        return "layout_placeholder_geometry_inheritance"
    if "empty_content_placeholder" in flags:
        return "empty_content_placeholder_visibility"
    if "smartart" in flags:
        return "smartart_import"
    if has_embedded_fonts and not missing_fonts and has_text:
        return "embedded_font_text_layout"
    if missing_fonts and has_text:
        return "missing_font_substitution"
    if flags & {
        "shape_autofit",
        "normal_autofit",
        "no_wrap",
        "text_columns",
        "vertical_text",
        "rtl_text",
    }:
        return "text_layout_autofit"
    if flags & {"chart", "table", "ole"}:
        return "structured_object"
    if flags & {"three_dimensional", "effect", "word_art", "transparency"}:
        return "effects_3d_transparency"
    if has_text:
        return "other_text_metrics"
    if flags & {"vector_image", "animated_gif", "picture", "image_relationship"}:
        return "image_vector_rasterization"
    if flags & {"group", "connector", "rotation", "flip", "custom_geometry"}:
        return "group_connector_geometry"
    if flags & {"gradient_fill", "pattern_fill"}:
        return "fill_and_color"
    if "placeholder" in flags:
        return "master_layout_placeholder"
    return "unclassified_visual_difference"


def load_image(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(f"Could not read image {path}")
    return image


def normalize_render(rendered: np.ndarray, reference: np.ndarray) -> np.ndarray:
    if rendered.shape[:2] == reference.shape[:2]:
        return rendered
    return cv2.resize(
        rendered,
        (reference.shape[1], reference.shape[0]),
        interpolation=cv2.INTER_LANCZOS4,
    )


def edge_bounds(edges: np.ndarray) -> list[int] | None:
    ys, xs = np.where(edges)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]


def detect_edges(image: np.ndarray) -> np.ndarray:
    """Detect both dark outlines and PowerPoint's low-contrast theme strokes."""

    return cv2.Canny(image, EDGE_CANNY_LOW, EDGE_CANNY_HIGH) > 0


def normalized_projection_emd(
    reference_edges: np.ndarray, rendered_edges: np.ndarray, axis: int
) -> float | None:
    """Return one-dimensional earth-mover distance for edge placement in pixels."""

    reference_projection = reference_edges.sum(axis=axis).astype(np.float64)
    rendered_projection = rendered_edges.sum(axis=axis).astype(np.float64)
    reference_total = float(reference_projection.sum())
    rendered_total = float(rendered_projection.sum())
    if reference_total == 0 or rendered_total == 0:
        return None
    reference_cdf = np.cumsum(reference_projection / reference_total)
    rendered_cdf = np.cumsum(rendered_projection / rendered_total)
    return float(np.abs(reference_cdf - rendered_cdf).sum())


def edge_grid_distribution(edges: np.ndarray) -> np.ndarray | None:
    """Summarize internal edge placement without assuming an OOXML sub-layout."""

    edge_count = int(edges.sum())
    if edge_count == 0:
        return None
    grid = cv2.resize(
        edges.astype(np.float32),
        (EDGE_LAYOUT_GRID_SIZE, EDGE_LAYOUT_GRID_SIZE),
        interpolation=cv2.INTER_AREA,
    ).reshape(-1)
    total = float(grid.sum())
    return grid / total if total > 0 else None


def stable_edge_component_count(edges: np.ndarray) -> int:
    """Count visually separate edge islands after closing one-pixel raster gaps."""

    if not edges.any():
        return 0
    closed = cv2.morphologyEx(
        edges.astype(np.uint8),
        cv2.MORPH_CLOSE,
        np.ones((3, 3), dtype=np.uint8),
    )
    component_count, _, stats, _ = cv2.connectedComponentsWithStats(
        closed, connectivity=8
    )
    return sum(
        int(stats[index, cv2.CC_STAT_AREA]) >= 4
        for index in range(1, component_count)
    )


def edge_internal_layout_metrics(
    reference_edges: np.ndarray, rendered_edges: np.ndarray
) -> dict[str, Any]:
    """Measure internal layout for text, shapes, pictures, and structured objects."""

    reference_count = int(reference_edges.sum())
    rendered_count = int(rendered_edges.sum())
    reference_components = stable_edge_component_count(reference_edges)
    rendered_components = stable_edge_component_count(rendered_edges)
    metrics: dict[str, Any] = {
        "referenceEdgeComponentCount": reference_components,
        "renderedEdgeComponentCount": rendered_components,
        "edgeComponentCountDelta": rendered_components - reference_components,
        "edgeComponentCountAbsoluteDelta": abs(
            rendered_components - reference_components
        ),
        "edgeOccupancyFractionDelta": float(
            rendered_edges.mean() - reference_edges.mean()
        ),
    }
    if reference_count == 0 and rendered_count == 0:
        return {
            **metrics,
            "internalLayoutStatus": "empty",
            "edgeProjectionXEmdPx": 0.0,
            "edgeProjectionYEmdPx": 0.0,
            "edgeGridDistributionL1": 0.0,
            "edgeCentroidDeltaPx": [0.0, 0.0],
        }
    if reference_count == 0 or rendered_count == 0:
        return {
            **metrics,
            "internalLayoutStatus": "presence_mismatch",
            "edgeProjectionXEmdPx": None,
            "edgeProjectionYEmdPx": None,
            "edgeGridDistributionL1": 2.0,
            "edgeCentroidDeltaPx": None,
        }

    reference_y, reference_x = np.where(reference_edges)
    rendered_y, rendered_x = np.where(rendered_edges)
    projection_x = normalized_projection_emd(reference_edges, rendered_edges, axis=0)
    projection_y = normalized_projection_emd(reference_edges, rendered_edges, axis=1)
    reference_grid = edge_grid_distribution(reference_edges)
    rendered_grid = edge_grid_distribution(rendered_edges)
    grid_l1 = (
        float(np.abs(reference_grid - rendered_grid).sum())
        if reference_grid is not None and rendered_grid is not None
        else 2.0
    )
    component_tolerance = max(3, round(reference_components * 0.20))
    large_grid_rearrangement = grid_l1 > 0.50 and (
        (projection_x is not None and projection_x > 4)
        or (projection_y is not None and projection_y > 4)
    )
    if (
        large_grid_rearrangement
        or (
            abs(rendered_components - reference_components) > component_tolerance
            and grid_l1 > 0.20
        )
    ):
        layout_status = "topology_changed"
    elif (
        grid_l1 > 0.20
        or (projection_x is not None and projection_x > 2)
        or (projection_y is not None and projection_y > 2)
    ):
        layout_status = "layout_displaced"
    else:
        layout_status = "aligned"
    return {
        **metrics,
        "internalLayoutStatus": layout_status,
        "edgeProjectionXEmdPx": projection_x,
        "edgeProjectionYEmdPx": projection_y,
        "edgeGridDistributionL1": grid_l1,
        "edgeCentroidDeltaPx": [
            float(rendered_x.mean() - reference_x.mean()),
            float(rendered_y.mean() - reference_y.mean()),
        ],
    }


def edge_geometry_metrics_from_edges(
    ref_edges: np.ndarray, out_edges: np.ndarray
) -> dict[str, Any]:
    """Compare already-detected edges, including masked unattributed regions."""

    ref_count = int(ref_edges.sum())
    out_count = int(out_edges.sum())
    ref_box = edge_bounds(ref_edges)
    out_box = edge_bounds(out_edges)
    result: dict[str, Any] = {
        "referenceEdgePixels": ref_count,
        "renderedEdgePixels": out_count,
        "referenceEdgeBounds": ref_box,
        "renderedEdgeBounds": out_box,
        **edge_internal_layout_metrics(ref_edges, out_edges),
    }
    if ref_count == 0 and out_count == 0:
        return {
            **result,
            "edgePresenceStatus": "both_empty",
            "outlineStatus": "empty",
            "edgeF1At1Px": 1.0,
            "edgeF1At2Px": 1.0,
            "edgeDistanceMeanPx": 0.0,
            "edgeDistanceP95Px": 0.0,
        }
    if ref_count == 0 or out_count == 0:
        maximum_distance = float(math.hypot(ref_edges.shape[1], ref_edges.shape[0]))
        return {
            **result,
            "edgePresenceStatus": (
                "missing_in_render" if ref_count else "unexpected_in_render"
            ),
            "outlineStatus": "presence_mismatch",
            "edgeF1At1Px": 0.0,
            "edgeF1At2Px": 0.0,
            # A missing or unexpected element is a structural failure, not an
            # unavailable measurement. Use the crop diagonal as a finite
            # worst-case displacement so it remains in corpus aggregates.
            "edgeDistanceMeanPx": maximum_distance,
            "edgeDistanceP95Px": maximum_distance,
        }

    def tolerant_f1(radius: int) -> float:
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
        )
        ref_near = cv2.dilate(ref_edges.astype(np.uint8), kernel) > 0
        out_near = cv2.dilate(out_edges.astype(np.uint8), kernel) > 0
        precision = float(np.logical_and(out_edges, ref_near).sum() / out_count)
        recall = float(np.logical_and(ref_edges, out_near).sum() / ref_count)
        return (
            2 * precision * recall / (precision + recall) if precision + recall else 0.0
        )

    distance_to_ref = cv2.distanceTransform(
        (~ref_edges).astype(np.uint8), cv2.DIST_L2, 5
    )
    distance_to_out = cv2.distanceTransform(
        (~out_edges).astype(np.uint8), cv2.DIST_L2, 5
    )
    distances = np.concatenate([distance_to_ref[out_edges], distance_to_out[ref_edges]])
    edge_f1_at_1 = tolerant_f1(1)
    edge_f1_at_2 = tolerant_f1(2)
    edge_distance_mean = float(distances.mean())
    edge_distance_p95 = float(np.quantile(distances, 0.95))
    if edge_distance_p95 <= 1 and edge_f1_at_2 >= 0.90:
        outline_status = "aligned_1px"
    elif edge_distance_p95 <= 2 and edge_f1_at_2 >= 0.80:
        outline_status = "aligned_2px"
    else:
        outline_status = "displaced"
    result.update(
        {
            "edgePresenceStatus": "spellbook_in_both",
            "outlineStatus": outline_status,
            "edgeF1At1Px": edge_f1_at_1,
            "edgeF1At2Px": edge_f1_at_2,
            "edgeDistanceMeanPx": edge_distance_mean,
            "edgeDistanceP95Px": edge_distance_p95,
        }
    )
    if ref_box is not None and out_box is not None:
        ref_width, ref_height = ref_box[2] - ref_box[0], ref_box[3] - ref_box[1]
        out_width, out_height = out_box[2] - out_box[0], out_box[3] - out_box[1]
        result.update(
            {
                "edgeBoundsWidthDeltaPx": out_width - ref_width,
                "edgeBoundsHeightDeltaPx": out_height - ref_height,
                "edgeBoundsCenterDeltaPx": [
                    (out_box[0] + out_box[2] - ref_box[0] - ref_box[2]) / 2,
                    (out_box[1] + out_box[3] - ref_box[1] - ref_box[3]) / 2,
                ],
            }
        )
    return result


def edge_geometry_metrics(
    reference: np.ndarray, rendered: np.ndarray
) -> dict[str, Any]:
    return edge_geometry_metrics_from_edges(
        detect_edges(reference), detect_edges(rendered)
    )


def image_difference_metrics(
    reference: np.ndarray, rendered: np.ndarray
) -> dict[str, Any]:
    ref = reference.astype(np.float32) / 255.0
    out = rendered.astype(np.float32) / 255.0
    absolute = np.abs(ref - out)
    pixel_max = absolute.max(axis=2)
    edge_metrics = edge_geometry_metrics(reference, rendered)
    ref_edges = detect_edges(reference)
    out_edges = detect_edges(rendered)
    edge_union = np.logical_or(ref_edges, out_edges)
    edge_xor = np.logical_xor(ref_edges, out_edges)
    return {
        "meanAbsolute": float(absolute.mean()),
        "changed16Fraction": float((pixel_max > 16 / 255.0).mean()),
        "changed32Fraction": float((pixel_max > 32 / 255.0).mean()),
        "changed64Fraction": float((pixel_max > 64 / 255.0).mean()),
        "edgeMismatchFraction": float(edge_xor.sum() / max(1, edge_union.sum())),
        **edge_metrics,
    }


def element_box(
    element: dict[str, Any],
    slide_width_emu: int,
    slide_height_emu: int,
    image_width: int,
    image_height: int,
    padding: int | None = None,
) -> tuple[int, int, int, int] | None:
    width = float(element.get("width") or 0)
    height = float(element.get("height") or 0)
    kind = element.get("kind")
    if (
        width < 0
        or height < 0
        or slide_width_emu <= 0
        or slide_height_emu <= 0
        or (width == 0 and height == 0)
        or (kind != "connector" and (width == 0 or height == 0))
    ):
        return None
    core_x0 = int(
        math.floor(float(element.get("x") or 0) / slide_width_emu * image_width)
    )
    core_y0 = int(
        math.floor(float(element.get("y") or 0) / slide_height_emu * image_height)
    )
    core_x1 = int(
        math.ceil(
            (float(element.get("x") or 0) + width) / slide_width_emu * image_width
        )
    )
    core_y1 = int(
        math.ceil(
            (float(element.get("y") or 0) + height) / slide_height_emu * image_height
        )
    )
    core_x1 = max(core_x0 + 1, core_x1)
    core_y1 = max(core_y0 + 1, core_y1)
    if (
        core_x0 >= image_width
        or core_y0 >= image_height
        or core_x1 <= 0
        or core_y1 <= 0
    ):
        return None
    if padding is None:
        stroke_width_emu = float(element.get("strokeWidthEmu") or 0)
        pixels_per_emu = max(
            image_width / slide_width_emu, image_height / slide_height_emu
        )
        stroke_half_width = math.ceil(stroke_width_emu * pixels_per_emu / 2)
        padding = max(4 if kind == "connector" else 2, stroke_half_width + 2)
    x0, y0 = max(0, core_x0 - padding), max(0, core_y0 - padding)
    x1, y1 = min(image_width, core_x1 + padding), min(image_height, core_y1 + padding)
    return x0, y0, x1, y1


def element_difference_metrics(
    reference: np.ndarray,
    rendered: np.ndarray,
    element: dict[str, Any],
    graph: dict[str, Any],
    slide_elements: list[dict[str, Any]],
) -> dict[str, Any]:
    box = element_box(
        element,
        int(graph.get("slideWidthEmu") or 0),
        int(graph.get("slideHeightEmu") or 0),
        reference.shape[1],
        reference.shape[0],
    )
    if box is None:
        return {"bboxAvailable": False}
    x0, y0, x1, y1 = box
    overlaps = 0
    higher_z_overlaps = 0
    lower_z_overlaps = 0
    element_core_box = element_box(
        element,
        int(graph.get("slideWidthEmu") or 0),
        int(graph.get("slideHeightEmu") or 0),
        reference.shape[1],
        reference.shape[0],
        padding=0,
    )
    overlap_mask = None
    higher_z_overlap_mask = None
    if element_core_box is not None:
        ex0, ey0, ex1, ey1 = element_core_box
        overlap_mask = np.zeros((ey1 - ey0, ex1 - ex0), dtype=bool)
        higher_z_overlap_mask = np.zeros_like(overlap_mask)
    element_z = int(element.get("zIndex") or 0)
    for sibling in slide_elements:
        if sibling is element:
            continue
        sibling_box = element_box(
            sibling,
            int(graph.get("slideWidthEmu") or 0),
            int(graph.get("slideHeightEmu") or 0),
            reference.shape[1],
            reference.shape[0],
            padding=0,
        )
        if sibling_box is None or element_core_box is None:
            continue
        ex0, ey0, ex1, ey1 = element_core_box
        sx0, sy0, sx1, sy1 = sibling_box
        intersection_width = max(0, min(ex1, sx1) - max(ex0, sx0))
        intersection_height = max(0, min(ey1, sy1) - max(ey0, sy0))
        intersection_area = intersection_width * intersection_height
        if intersection_area == 0:
            continue
        overlaps += 1
        intersection_x0 = max(ex0, sx0) - ex0
        intersection_y0 = max(ey0, sy0) - ey0
        intersection_x1 = min(ex1, sx1) - ex0
        intersection_y1 = min(ey1, sy1) - ey0
        overlap_mask[
            intersection_y0:intersection_y1, intersection_x0:intersection_x1
        ] = True
        sibling_z = int(sibling.get("zIndex") or 0)
        if sibling_z > element_z:
            higher_z_overlaps += 1
            higher_z_overlap_mask[
                intersection_y0:intersection_y1, intersection_x0:intersection_x1
            ] = True
        else:
            lower_z_overlaps += 1
    overlap_area_fraction = (
        float(overlap_mask.mean()) if overlap_mask is not None else 0
    )
    higher_z_overlap_area_fraction = (
        float(higher_z_overlap_mask.mean()) if higher_z_overlap_mask is not None else 0
    )
    overlap_region_metrics: dict[str, Any] = {}
    if element_core_box is not None:
        ex0, ey0, ex1, ey1 = element_core_box
        core_delta = (
            reference[ey0:ey1, ex0:ex1].astype(np.float32)
            - rendered[ey0:ey1, ex0:ex1].astype(np.float32)
        ) / 255.0

        def masked_pixel_metrics(mask: np.ndarray | None) -> tuple[float | None, float | None]:
            if mask is None or not mask.any():
                return None, None
            selected = core_delta[mask]
            maximum = np.abs(selected).max(axis=1)
            return (
                float(np.sqrt(np.mean(selected * selected))),
                float((maximum > 32 / 255.0).mean()),
            )

        overlap_rmse, overlap_changed = masked_pixel_metrics(overlap_mask)
        higher_z_rmse, higher_z_changed = masked_pixel_metrics(higher_z_overlap_mask)
        visible_mask = (
            np.logical_not(higher_z_overlap_mask)
            if higher_z_overlap_mask is not None
            else None
        )
        visible_rmse, visible_changed = masked_pixel_metrics(visible_mask)
        overlap_region_metrics = {
            "overlapRegionRmse": overlap_rmse,
            "overlapRegionChanged32Fraction": overlap_changed,
            "higherZOverlapRegionRmse": higher_z_rmse,
            "higherZOverlapRegionChanged32Fraction": higher_z_changed,
            "visibleCoreRegionRmse": visible_rmse,
            "visibleCoreRegionChanged32Fraction": visible_changed,
        }
    ref_pixels = reference[y0:y1, x0:x1]
    out_pixels = rendered[y0:y1, x0:x1]
    ref_crop = ref_pixels.astype(np.float32) / 255.0
    out_crop = out_pixels.astype(np.float32) / 255.0
    delta = ref_crop - out_crop
    absolute = np.abs(delta)
    pixel_max = absolute.max(axis=2)
    rmse = float(np.sqrt(np.mean(delta * delta)))
    return {
        "bboxAvailable": True,
        "bbox": [x0, y0, x1, y1],
        "overlappingElementCount": overlaps,
        "higherZOverlapCount": higher_z_overlaps,
        "lowerOrEqualZOverlapCount": lower_z_overlaps,
        "overlapAreaFraction": overlap_area_fraction,
        "higherZOverlapAreaFraction": higher_z_overlap_area_fraction,
        **overlap_region_metrics,
        "isolationConfidence": "isolated" if overlaps == 0 else "overlapping",
        "localRmse": rmse,
        "meanAbsolute": float(absolute.mean()),
        "changed16Fraction": float((pixel_max > 16 / 255.0).mean()),
        "changed32Fraction": float((pixel_max > 32 / 255.0).mean()),
        "pixelExact": bool(np.max(absolute) == 0),
        **edge_geometry_metrics(ref_pixels, out_pixels),
    }


def slide_element_coverage_metrics(
    reference: np.ndarray,
    rendered: np.ndarray,
    elements: list[dict[str, Any]],
    graph: dict[str, Any],
) -> dict[str, Any]:
    """Account for slide pixels outside every stored top-level element box."""

    covered = np.zeros(reference.shape[:2], dtype=bool)
    for element in elements:
        box = element_box(
            element,
            int(graph.get("slideWidthEmu") or 0),
            int(graph.get("slideHeightEmu") or 0),
            reference.shape[1],
            reference.shape[0],
        )
        if box is None:
            continue
        x0, y0, x1, y1 = box
        covered[y0:y1, x0:x1] = True
    unattributed = np.logical_not(covered)
    reference_edges = detect_edges(reference)
    rendered_edges = detect_edges(rendered)
    reference_unattributed = np.logical_and(reference_edges, unattributed)
    rendered_unattributed = np.logical_and(rendered_edges, unattributed)
    edge_union = np.logical_or(reference_unattributed, rendered_unattributed)
    edge_xor = np.logical_xor(reference_unattributed, rendered_unattributed)
    absolute = np.abs(
        reference.astype(np.float32) / 255.0
        - rendered.astype(np.float32) / 255.0
    )
    pixel_max = absolute.max(axis=2)
    unattributed_pixels = int(unattributed.sum())
    structure = edge_geometry_metrics_from_edges(
        reference_unattributed, rendered_unattributed
    )
    unattributed_delta = (
        reference[unattributed].astype(np.float32)
        - rendered[unattributed].astype(np.float32)
    ) / 255.0
    return {
        "elementBoxCoverageFraction": float(covered.mean()),
        "referenceEdgeCoverageFraction": float(
            np.logical_and(reference_edges, covered).sum()
            / max(1, int(reference_edges.sum()))
        ),
        "renderedEdgeCoverageFraction": float(
            np.logical_and(rendered_edges, covered).sum()
            / max(1, int(rendered_edges.sum()))
        ),
        "unattributedReferenceEdgePixels": int(reference_unattributed.sum()),
        "unattributedRenderedEdgePixels": int(rendered_unattributed.sum()),
        "unattributedEdgeMismatchFraction": float(
            edge_xor.sum() / max(1, edge_union.sum())
        ),
        "unattributedMeanAbsolute": (
            float(absolute[unattributed].mean()) if unattributed_pixels else 0.0
        ),
        "unattributedRmse": (
            float(np.sqrt(np.mean(unattributed_delta * unattributed_delta)))
            if unattributed_pixels
            else 0.0
        ),
        "unattributedPixelExact": bool(
            not unattributed_pixels or np.max(np.abs(unattributed_delta)) == 0
        ),
        "unattributedChanged16Fraction": (
            float((pixel_max[unattributed] > 16 / 255.0).mean())
            if unattributed_pixels
            else 0.0
        ),
        "unattributedChanged32Fraction": (
            float((pixel_max[unattributed] > 32 / 255.0).mean())
            if unattributed_pixels
            else 0.0
        ),
        **{
            f"unattributed{key[0].upper()}{key[1:]}": value
            for key, value in structure.items()
        },
    }


def aggregate_group(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        values = row.get(key) or []
        if not isinstance(values, list):
            values = [values]
        for value in values:
            grouped[str(value)].append(row)
    baseline = statistics.mean(row["normalizedRmse"] for row in rows)
    output = []
    for value, members in grouped.items():
        rmses = [row["normalizedRmse"] for row in members]
        output.append(
            {
                "value": value,
                "slides": len(members),
                "meanRmse": statistics.mean(rmses),
                "medianRmse": statistics.median(rmses),
                "p95Rmse": percentile(rmses, 0.95),
                "meanLiftVsCorpus": statistics.mean(rmses) - baseline,
                "rmseAtLeast020": sum(value >= 0.20 for value in rmses),
                "rmseAtLeast030": sum(value >= 0.30 for value in rmses),
            }
        )
    output.sort(
        key=lambda item: (item["meanLiftVsCorpus"], item["slides"]), reverse=True
    )
    return output


def summarize_elements(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def summarize_group(members: list[dict[str, Any]]) -> dict[str, Any]:
        measured = [row for row in members if row["bboxAvailable"]]
        isolated = [
            row for row in measured if row.get("isolationConfidence") == "isolated"
        ]
        distances = [
            row["edgeDistanceP95Px"]
            for row in measured
            if row.get("edgeDistanceP95Px") is not None
        ]
        edge_f1 = [
            row["edgeF1At2Px"] for row in measured if row.get("edgeF1At2Px") is not None
        ]
        isolated_distances = [
            row["edgeDistanceP95Px"]
            for row in isolated
            if row.get("edgeDistanceP95Px") is not None
        ]
        isolated_edge_f1 = [
            row["edgeF1At2Px"] for row in isolated if row.get("edgeF1At2Px") is not None
        ]
        isolated_projection_x = [
            row["edgeProjectionXEmdPx"]
            for row in isolated
            if row.get("edgeProjectionXEmdPx") is not None
        ]
        isolated_projection_y = [
            row["edgeProjectionYEmdPx"]
            for row in isolated
            if row.get("edgeProjectionYEmdPx") is not None
        ]
        isolated_grid_distribution = [
            row["edgeGridDistributionL1"]
            for row in isolated
            if row.get("edgeGridDistributionL1") is not None
        ]
        projection_x = [
            row["edgeProjectionXEmdPx"]
            for row in measured
            if row.get("edgeProjectionXEmdPx") is not None
        ]
        projection_y = [
            row["edgeProjectionYEmdPx"]
            for row in measured
            if row.get("edgeProjectionYEmdPx") is not None
        ]
        grid_distribution = [
            row["edgeGridDistributionL1"]
            for row in measured
            if row.get("edgeGridDistributionL1") is not None
        ]
        presence_mismatches = [
            row
            for row in measured
            if row.get("edgePresenceStatus")
            in {"missing_in_render", "unexpected_in_render"}
        ]
        return {
            "elements": len(members),
            "bboxAvailable": len(measured),
            "isolatedElements": len(isolated),
            "meanLocalRmse": (
                statistics.mean(row["localRmse"] for row in measured)
                if measured
                else None
            ),
            "outlineMeasured": len(distances),
            "outlineP95Within1Px": sum(value <= 1 for value in distances),
            "outlineP95Within2Px": sum(value <= 2 for value in distances),
            "outlineDistanceMedianPx": (
                statistics.median(distances) if distances else None
            ),
            "outlineDistanceP95Px": percentile(distances, 0.95),
            "outlineF1At2PxAtLeast090": sum(value >= 0.90 for value in edge_f1),
            "outlinePresenceMismatch": len(presence_mismatches),
            "outlineStatusCounts": dict(
                Counter(row.get("outlineStatus", "unknown") for row in measured)
            ),
            "internalLayoutStatusCounts": dict(
                Counter(
                    row.get("internalLayoutStatus", "unknown") for row in measured
                )
            ),
            "internalTopologyChanged": sum(
                row.get("internalLayoutStatus") == "topology_changed"
                for row in measured
            ),
            "edgeProjectionXEmdMedianPx": (
                statistics.median(projection_x) if projection_x else None
            ),
            "edgeProjectionXEmdP95Px": percentile(projection_x, 0.95),
            "edgeProjectionYEmdMedianPx": (
                statistics.median(projection_y) if projection_y else None
            ),
            "edgeProjectionYEmdP95Px": percentile(projection_y, 0.95),
            "edgeGridDistributionL1Median": (
                statistics.median(grid_distribution) if grid_distribution else None
            ),
            "edgeGridDistributionL1P95": percentile(grid_distribution, 0.95),
            "isolatedOutlineMeasured": len(isolated_distances),
            "isolatedOutlineP95Within1Px": sum(
                value <= 1 for value in isolated_distances
            ),
            "isolatedOutlineP95Within2Px": sum(
                value <= 2 for value in isolated_distances
            ),
            "isolatedOutlineDistanceMedianPx": (
                statistics.median(isolated_distances) if isolated_distances else None
            ),
            "isolatedOutlineDistanceP95Px": percentile(isolated_distances, 0.95),
            "isolatedOutlineF1At2PxAtLeast090": sum(
                value >= 0.90 for value in isolated_edge_f1
            ),
            "isolatedInternalLayoutStatusCounts": dict(
                Counter(
                    row.get("internalLayoutStatus", "unknown") for row in isolated
                )
            ),
            "isolatedInternalTopologyChanged": sum(
                row.get("internalLayoutStatus") == "topology_changed"
                for row in isolated
            ),
            "isolatedEdgeProjectionXEmdMedianPx": (
                statistics.median(isolated_projection_x)
                if isolated_projection_x
                else None
            ),
            "isolatedEdgeProjectionXEmdP95Px": percentile(
                isolated_projection_x, 0.95
            ),
            "isolatedEdgeProjectionYEmdMedianPx": (
                statistics.median(isolated_projection_y)
                if isolated_projection_y
                else None
            ),
            "isolatedEdgeProjectionYEmdP95Px": percentile(
                isolated_projection_y, 0.95
            ),
            "isolatedEdgeGridDistributionL1Median": (
                statistics.median(isolated_grid_distribution)
                if isolated_grid_distribution
                else None
            ),
            "isolatedEdgeGridDistributionL1P95": percentile(
                isolated_grid_distribution, 0.95
            ),
        }

    available = [row for row in rows if row["bboxAvailable"]]
    exact = [row for row in available if row.get("pixelExact")]
    grouped = {
        kind: [row for row in rows if row["kind"] == kind]
        for kind in sorted({row["kind"] for row in rows})
    }
    grouped_by_text = {
        "withText": [row for row in rows if row.get("hasText")],
        "withoutText": [row for row in rows if not row.get("hasText")],
    }
    grouped_by_role: dict[str, list[dict[str, Any]]] = defaultdict(list)
    grouped_by_trait: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        for role in row.get("structuralRoles") or [row.get("kind") or "unknown"]:
            grouped_by_role[str(role)].append(row)
        for trait in row.get("structuralTraits") or []:
            grouped_by_trait[str(trait)].append(row)
    return {
        "elements": len(rows),
        "bboxAvailable": len(available),
        "bboxUnavailable": len(rows) - len(available),
        "pixelExactWithinBox": len(exact),
        "localRmseBelow005": sum(row["localRmse"] < 0.05 for row in available),
        "localRmseBelow010": sum(row["localRmse"] < 0.10 for row in available),
        "localRmseBelow020": sum(row["localRmse"] < 0.20 for row in available),
        "localRmseAtLeast020": sum(row["localRmse"] >= 0.20 for row in available),
        "outlineMeasured": sum(
            row.get("edgeDistanceP95Px") is not None for row in available
        ),
        "outlineP95Within1Px": sum(
            row.get("edgeDistanceP95Px") is not None and row["edgeDistanceP95Px"] <= 1
            for row in available
        ),
        "outlineP95Within2Px": sum(
            row.get("edgeDistanceP95Px") is not None and row["edgeDistanceP95Px"] <= 2
            for row in available
        ),
        "outlineF1At2PxAtLeast090": sum(
            (row.get("edgeF1At2Px") or 0) >= 0.90 for row in available
        ),
        "outlinePresenceMismatch": sum(
            row.get("edgePresenceStatus")
            in {"missing_in_render", "unexpected_in_render"}
            for row in available
        ),
        "outlineStatusCounts": dict(
            Counter(row.get("outlineStatus", "unknown") for row in available)
        ),
        "internalLayoutStatusCounts": dict(
            Counter(row.get("internalLayoutStatus", "unknown") for row in available)
        ),
        "internalTopologyChanged": sum(
            row.get("internalLayoutStatus") == "topology_changed"
            for row in available
        ),
        "byKind": {kind: summarize_group(members) for kind, members in grouped.items()},
        "byTextPresence": {
            key: summarize_group(members) for key, members in grouped_by_text.items()
        },
        "byStructuralRole": {
            role: summarize_group(members)
            for role, members in sorted(grouped_by_role.items())
        },
        "byStructuralTrait": {
            trait: summarize_group(members)
            for trait, members in sorted(grouped_by_trait.items())
        },
    }


def summarize_slides(rows: list[dict[str, Any]]) -> dict[str, Any]:
    rmses = [row["normalizedRmse"] for row in rows]
    summary = {
        "comparedSlides": len(rows),
        "meanRmse": statistics.mean(rmses),
        "medianRmse": statistics.median(rmses),
        "p95Rmse": percentile(rmses, 0.95),
        "pixelExactSlides": sum(value == 0 for value in rmses),
        "rmseBelow005": sum(value < 0.05 for value in rmses),
        "rmseBelow010": sum(value < 0.10 for value in rmses),
        "rmseBelow020": sum(value < 0.20 for value in rmses),
        "rmseAtLeast020": sum(value >= 0.20 for value in rmses),
        "rmseAtLeast030": sum(value >= 0.30 for value in rmses),
    }
    if rows and "unattributedInternalLayoutStatus" in rows[0]:
        summary.update(
            {
                "meanElementBoxCoverageFraction": statistics.mean(
                    row["elementBoxCoverageFraction"] for row in rows
                ),
                "meanReferenceEdgeCoverageFraction": statistics.mean(
                    row["referenceEdgeCoverageFraction"] for row in rows
                ),
                "meanRenderedEdgeCoverageFraction": statistics.mean(
                    row["renderedEdgeCoverageFraction"] for row in rows
                ),
                "unattributedInternalLayoutStatusCounts": dict(
                    Counter(
                        row["unattributedInternalLayoutStatus"] for row in rows
                    )
                ),
                "unattributedTopologyChangedSlides": sum(
                    row["unattributedInternalLayoutStatus"] == "topology_changed"
                    for row in rows
                ),
                "unattributedEdgeGridDistributionL1Median": statistics.median(
                    row["unattributedEdgeGridDistributionL1"] for row in rows
                ),
                "unattributedEdgeGridDistributionL1P95": percentile(
                    [row["unattributedEdgeGridDistributionL1"] for row in rows],
                    0.95,
                ),
            }
        )
    return summary


def worst_structural_elements(
    rows: list[dict[str, Any]], *, isolated_only: bool = False, limit: int = 100
) -> list[dict[str, Any]]:
    status_rank = {
        "presence_mismatch": 3,
        "displaced": 2,
        "aligned_2px": 1,
        "aligned_1px": 0,
        "empty": 0,
    }
    internal_status_rank = {
        "presence_mismatch": 3,
        "topology_changed": 2,
        "layout_displaced": 1,
        "aligned": 0,
        "empty": 0,
    }
    candidates = [
        row
        for row in rows
        if row.get("bboxAvailable")
        and (not isolated_only or row.get("isolationConfidence") == "isolated")
    ]
    return sorted(
        candidates,
        key=lambda row: (
            status_rank.get(row.get("outlineStatus"), 4),
            internal_status_rank.get(row.get("internalLayoutStatus"), 4),
            row.get("edgeDistanceP95Px") or 0,
            row.get("edgeGridDistributionL1") or 0,
            -(row.get("edgeF1At2Px") or 0),
        ),
        reverse=True,
    )[:limit]


def high_difference_concentration(rows: list[dict[str, Any]]) -> dict[str, Any]:
    high_rows = [row for row in rows if row["normalizedRmse"] >= 0.20]
    high_by_deck = Counter(row["deckId"] for row in high_rows)
    high_by_primary = Counter(row["primaryPattern"] for row in high_rows)
    top_two_high = sum(count for _, count in high_by_deck.most_common(2))
    return {
        "threshold": 0.20,
        "slides": len(high_rows),
        "byDeck": dict(high_by_deck.most_common()),
        "byPrimaryPattern": dict(high_by_primary.most_common()),
        "topTwoDeckSlides": top_two_high,
        "topTwoDeckFraction": top_two_high / len(high_rows) if high_rows else 0,
    }


def visual_cell(
    reference: np.ndarray, rendered: np.ndarray, row: dict[str, Any], width: int = 420
) -> np.ndarray:
    height = int(round(reference.shape[0] * width / reference.shape[1]))
    ref_small = cv2.resize(reference, (width, height), interpolation=cv2.INTER_AREA)
    out_small = cv2.resize(rendered, (width, height), interpolation=cv2.INTER_AREA)
    diff = cv2.absdiff(ref_small, out_small)
    diff = np.clip(diff.astype(np.float32) * 4.0, 0, 255).astype(np.uint8)
    triptych = np.hstack([ref_small, out_small, diff])
    header = np.full((58, triptych.shape[1], 3), 245, dtype=np.uint8)
    label = f"{row['corpus']} {row['deckId']} s{row['slideNumber']} RMSE={row['normalizedRmse']:.4f}"
    candidates = f"primary={row['primaryPattern']} | " + ", ".join(
        row["patternCandidates"][:3]
    )
    cv2.putText(
        header,
        label,
        (8, 22),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (20, 20, 20),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        header,
        candidates[:145],
        (8, 46),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.40,
        (50, 50, 50),
        1,
        cv2.LINE_AA,
    )
    return np.vstack([header, triptych])


def save_montage(
    path: Path,
    rows: list[dict[str, Any]],
    images: dict[str, tuple[np.ndarray, np.ndarray]],
) -> None:
    if not rows:
        return
    cells = []
    for row in rows:
        reference, rendered = images[row["key"]]
        cells.append(visual_cell(reference, rendered, row))
    target_width = max(cell.shape[1] for cell in cells)
    padded = [
        cv2.copyMakeBorder(
            cell,
            0,
            0,
            0,
            target_width - cell.shape[1],
            cv2.BORDER_CONSTANT,
            value=(255, 255, 255),
        )
        for cell in cells
    ]
    cv2.imwrite(str(path), np.vstack(padded), [cv2.IMWRITE_JPEG_QUALITY, 90])


def write_montages(
    output_dir: Path,
    slide_rows: list[dict[str, Any]],
    images: dict[str, tuple[np.ndarray, np.ndarray]],
) -> None:
    montage_dir = output_dir / "montages"
    montage_dir.mkdir(parents=True, exist_ok=True)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in slide_rows:
        for pattern in row["patternCandidates"]:
            groups[pattern].append(row)
    groups["worst_overall"] = list(slide_rows)
    for pattern, members in groups.items():
        members.sort(key=lambda item: item["normalizedRmse"], reverse=True)
        selected = members[:12] if pattern == "worst_overall" else members[:6]
        save_montage(montage_dir / f"{pattern}.jpg", selected, images)

    primary_dir = output_dir / "primary-montages"
    primary_dir.mkdir(parents=True, exist_ok=True)
    primary_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in slide_rows:
        primary_groups[row["primaryPattern"]].append(row)
    for pattern, members in primary_groups.items():
        members.sort(key=lambda item: item["normalizedRmse"], reverse=True)
        save_montage(primary_dir / f"{pattern}.jpg", members[:8], images)

    review_dir = output_dir / "review-montages"
    review_dir.mkdir(parents=True, exist_ok=True)
    worst_high_by_deck: dict[str, dict[str, Any]] = {}
    for row in slide_rows:
        if row["normalizedRmse"] < 0.20:
            continue
        previous = worst_high_by_deck.get(row["deckId"])
        if previous is None or row["normalizedRmse"] > previous["normalizedRmse"]:
            worst_high_by_deck[row["deckId"]] = row
    high_deck_rows = sorted(
        worst_high_by_deck.values(),
        key=lambda item: item["normalizedRmse"],
        reverse=True,
    )
    save_montage(
        review_dir / "high-difference-one-per-deck.jpg", high_deck_rows, images
    )
    for offset in range(0, len(high_deck_rows), 6):
        save_montage(
            review_dir / f"high-difference-decks-{offset // 6 + 1:02}.jpg",
            high_deck_rows[offset : offset + 6],
            images,
        )


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            flattened = dict(row)
            for key, value in list(flattened.items()):
                if isinstance(value, (list, dict)):
                    flattened[key] = json.dumps(
                        value, ensure_ascii=False, separators=(",", ":")
                    )
            writer.writerow(flattened)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--project-root", default=str(Path(__file__).resolve().parents[1])
    )
    parser.add_argument(
        "--output",
        default=".tmp-eval/results/render-difference-analysis-v13",
    )
    parser.add_argument("--public-report", default=PUBLIC_SPEC["report"])
    parser.add_argument("--public-results", default=PUBLIC_SPEC["results"])
    parser.add_argument("--real-report", default=REAL_SPEC["report"])
    parser.add_argument("--real-results", default=REAL_SPEC["results"])
    parser.add_argument("--skip-public", action="store_true")
    parser.add_argument("--skip-real", action="store_true")
    arguments = sys.argv[1:]
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    args = parser.parse_args(arguments)
    if args.skip_public and args.skip_real:
        parser.error("At least one corpus must be analyzed")
    root = Path(args.project_root).resolve()
    output_dir = (root / args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    slide_rows: list[dict[str, Any]] = []
    element_rows: list[dict[str, Any]] = []
    images: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    corpus_counts: dict[str, dict[str, int]] = {}

    specs = [
        {
            **PUBLIC_SPEC,
            "report": args.public_report,
            "results": args.public_results,
        },
        {
            **REAL_SPEC,
            "report": args.real_report,
            "results": args.real_results,
        },
    ]
    if args.skip_public:
        specs = [spec for spec in specs if spec["name"] != "public"]
    if args.skip_real:
        specs = [spec for spec in specs if spec["name"] != "real"]
    for spec in specs:
        report = read_json(root / spec["report"])
        manifest = read_json(root / spec["manifest"])
        manifest_decks = {deck["id"]: deck for deck in manifest["decks"]}
        results_root = root / spec["results"]
        references_root = root / spec["references"]
        compared = 0
        skipped = 0

        for deck in report["decks"]:
            graph = read_json(results_root / deck["id"] / "element-graph.json")
            graph_slides = {
                int(slide["slideIndex"]) + 1: slide for slide in graph["slides"]
            }
            source = resolve_source(root, spec, deck, manifest_decks)
            with zipfile.ZipFile(source) as archive:
                has_embedded_fonts = any(
                    name.startswith("ppt/fonts/") and name.endswith(".fntdata")
                    for name in archive.namelist()
                )
                for slide in deck["slides"]:
                    comparison = slide.get("comparison") or {}
                    if not isinstance(comparison.get("normalizedRmse"), (int, float)):
                        skipped += 1
                        continue
                    slide_number = int(slide["slideNumber"])
                    reference_path = (
                        references_root / deck["id"] / f"slide-{slide_number}.png"
                    )
                    rendered_path = results_root / slide["rendered"]
                    reference = load_image(reference_path)
                    rendered = normalize_render(load_image(rendered_path), reference)
                    metrics = image_difference_metrics(reference, rendered)
                    graph_slide = graph_slides[slide_number]
                    elements = graph_slide.get("elements") or []
                    flags = slide_feature_flags(archive, slide_number)
                    structural_roles = slide_element_structural_roles(
                        archive, slide_number
                    )
                    structural_traits = slide_element_structural_traits(
                        archive, slide_number
                    )
                    stroke_widths = slide_element_stroke_widths(archive, slide_number)
                    missing_fonts = deck.get("fontAudit", {}).get("missingFonts") or []
                    has_text = any(element.get("text") for element in elements)
                    candidates = classify_candidates(
                        flags,
                        bool(missing_fonts),
                        has_embedded_fonts,
                        has_text,
                        float(comparison["normalizedRmse"]),
                    )
                    primary = primary_pattern(
                        flags,
                        missing_fonts,
                        has_embedded_fonts,
                        has_text,
                        float(comparison["normalizedRmse"]),
                    )
                    measured_elements = [
                        {
                            **element,
                            "strokeWidthEmu": stroke_widths.get(
                                int(element.get("shapeId") or 0), 0
                            ),
                        }
                        for element in elements
                    ]
                    coverage_metrics = slide_element_coverage_metrics(
                        reference, rendered, measured_elements, graph
                    )
                    key = f"{spec['name']}:{deck['id']}:{slide_number}"
                    row = {
                        "key": key,
                        "corpus": spec["name"],
                        "deckId": deck["id"],
                        "sourceSha256": deck["sourceSha256"],
                        "slideNumber": slide_number,
                        "normalizedRmse": float(comparison["normalizedRmse"]),
                        "similarity": float(
                            comparison.get(
                                "similarity", 1 - comparison["normalizedRmse"]
                            )
                        ),
                        "comparisonStatus": comparison.get("status"),
                        "supportGrade": slide.get("supportGrade"),
                        "elementCount": len(elements),
                        "editableElementCount": sum(
                            bool(element.get("editable")) for element in elements
                        ),
                        "textElementCount": sum(
                            bool(element.get("text")) for element in elements
                        ),
                        "missingFonts": missing_fonts,
                        "missingFontCount": len(missing_fonts),
                        "hasEmbeddedFonts": has_embedded_fonts,
                        "ooxmlFeatures": sorted(flags),
                        "patternCandidates": candidates,
                        "primaryPattern": primary,
                        **metrics,
                        **coverage_metrics,
                    }
                    slide_rows.append(row)
                    images[key] = (reference, rendered)

                    for element, measured_element in zip(elements, measured_elements):
                        local = element_difference_metrics(
                            reference,
                            rendered,
                            measured_element,
                            graph,
                            measured_elements,
                        )
                        element_rows.append(
                            {
                                "key": f"{key}:{element.get('shapeId')}",
                                "slideKey": key,
                                "corpus": spec["name"],
                                "deckId": deck["id"],
                                "sourceSha256": deck["sourceSha256"],
                                "slideNumber": slide_number,
                                "elementId": element.get("elementId"),
                                "shapeId": element.get("shapeId"),
                                "kind": element.get("kind"),
                                "structuralRoles": structural_roles.get(
                                    int(element.get("shapeId") or 0),
                                    [element.get("kind") or "unknown"],
                                ),
                                "structuralTraits": structural_traits.get(
                                    int(element.get("shapeId") or 0), []
                                ),
                                "name": element.get("name"),
                                "strokeWidthEmu": measured_element.get(
                                    "strokeWidthEmu"
                                ),
                                "hasText": bool(element.get("text")),
                                "textLength": len(element.get("text") or ""),
                                "editable": bool(element.get("editable")),
                                "unsupportedReason": element.get("unsupportedReason"),
                                "slideRmse": row["normalizedRmse"],
                                "patternCandidates": candidates,
                                "primaryPattern": primary,
                                **local,
                            }
                        )
                    compared += 1
        corpus_counts[spec["name"]] = {
            "comparedSlides": compared,
            "skippedWithoutReference": skipped,
        }

    slide_summary = summarize_slides(slide_rows)
    pattern_counts = Counter(
        pattern for row in slide_rows for pattern in row["patternCandidates"]
    )
    primary_counts = Counter(row["primaryPattern"] for row in slide_rows)
    unique_rows = list(
        {
            (row["sourceSha256"], row["slideNumber"]): row
            for row in reversed(slide_rows)
        }.values()
    )
    decks_by_source: dict[str, set[str]] = defaultdict(set)
    for row in slide_rows:
        decks_by_source[row["sourceSha256"]].add(row["deckId"])
    duplicate_source_groups = [
        {
            "sourceSha256": source_sha,
            "deckIds": sorted(deck_ids),
            "deckCopies": len(deck_ids),
        }
        for source_sha, deck_ids in sorted(decks_by_source.items())
        if len(deck_ids) > 1
    ]
    analysis = {
        "contractVersion": "1.3",
        "method": {
            "primaryStructuralMetrics": "Per-element tolerant edge F1 at 1px and 2px plus symmetric edge-distance mean and p95.",
            "internalLayoutMetrics": f"Every slide and element also compares normalized x/y edge projections, stable connected components, centroids, and a {EDGE_LAYOUT_GRID_SIZE}x{EDGE_LAYOUT_GRID_SIZE} edge-distribution grid. These detect changed internal layout even when the outer box is unchanged.",
            "secondaryWholeSlideMetric": "Normalized RMSE from the existing exact-digest evaluator.",
            "localMetrics": "OpenCV Lanczos-normalized element bounding boxes with 2px edge padding; zero-width or zero-height connectors retain a one-pixel core box.",
            "changedPixelThresholds": [16, 32, 64],
            "edgeDetection": f"Canny thresholds {EDGE_CANNY_LOW}/{EDGE_CANNY_HIGH}, selected to retain low-contrast PowerPoint theme strokes.",
            "overlapControl": "Isolation uses unpadded source boxes. Overlap counts, union-area fraction, higher-z occlusion fraction, and pixel residuals inside overlap versus visible core regions expose z-order or clipping failures without treating contaminated crops as isolated evidence.",
            "coverageControl": "The union of all top-level element boxes is measured separately from every remaining pixel and edge, so master/layout/background or otherwise unattributed visual content is not dropped.",
            "missingOutlinePolicy": "A missing or unexpected outline is retained as a structural failure with the crop diagonal as finite worst-case distance.",
            "warning": "Pattern candidates are correlations and routing hints, not causal proof. Overlapping crops cannot assign pixels to one element, and inherited placeholders may have no stored geometry.",
            "primaryPattern": "A deterministic exclusive review route. It is a triage hypothesis backed by OOXML and corpus evidence, not causal proof.",
        },
        "corpora": corpus_counts,
        "slides": slide_summary,
        "elements": summarize_elements(element_rows),
        "worstStructuralElements": worst_structural_elements(element_rows),
        "worstIsolatedStructuralElements": worst_structural_elements(
            element_rows, isolated_only=True
        ),
        "worstStructuralElementsByRole": {
            role: worst_structural_elements(
                [
                    row
                    for row in element_rows
                    if role in (row.get("structuralRoles") or [])
                ],
                limit=20,
            )
            for role in sorted(
                {
                    role
                    for row in element_rows
                    for role in (row.get("structuralRoles") or [])
                }
            )
        },
        "worstStructuralElementsByTrait": {
            trait: worst_structural_elements(
                [
                    row
                    for row in element_rows
                    if trait in (row.get("structuralTraits") or [])
                ],
                limit=20,
            )
            for trait in sorted(
                {
                    trait
                    for row in element_rows
                    for trait in (row.get("structuralTraits") or [])
                }
            )
        },
        "patternCandidateCounts": dict(pattern_counts.most_common()),
        "primaryPatternCounts": dict(primary_counts.most_common()),
        "highDifferenceConcentration": high_difference_concentration(slide_rows),
        "uniqueContentWeighting": {
            "method": "Deduplicate exact source SHA-256 copies, then retain one row per source slide number.",
            "slides": summarize_slides(unique_rows),
            "primaryPatternCounts": dict(
                Counter(row["primaryPattern"] for row in unique_rows).most_common()
            ),
            "highDifferenceConcentration": high_difference_concentration(unique_rows),
            "duplicateSourceGroups": duplicate_source_groups,
        },
        "deckCorrelations": aggregate_group(slide_rows, "deckId"),
        "ooxmlFeatureCorrelations": aggregate_group(slide_rows, "ooxmlFeatures"),
        "patternCorrelations": aggregate_group(slide_rows, "patternCandidates"),
        "primaryPatternCorrelations": aggregate_group(slide_rows, "primaryPattern"),
        "missingFontCorrelations": aggregate_group(slide_rows, "missingFonts"),
        "worstSlides": sorted(
            slide_rows, key=lambda row: row["normalizedRmse"], reverse=True
        )[:50],
    }

    (output_dir / "analysis.json").write_text(
        json.dumps(analysis, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_csv(
        output_dir / "slides.csv",
        slide_rows,
        [
            "key",
            "corpus",
            "deckId",
            "sourceSha256",
            "slideNumber",
            "normalizedRmse",
            "similarity",
            "comparisonStatus",
            "supportGrade",
            "elementCount",
            "editableElementCount",
            "textElementCount",
            "missingFontCount",
            "missingFonts",
            "hasEmbeddedFonts",
            "ooxmlFeatures",
            "patternCandidates",
            "primaryPattern",
            "meanAbsolute",
            "changed16Fraction",
            "changed32Fraction",
            "changed64Fraction",
            "edgeMismatchFraction",
            "edgePresenceStatus",
            "outlineStatus",
            "edgeF1At1Px",
            "edgeF1At2Px",
            "edgeDistanceMeanPx",
            "edgeDistanceP95Px",
            "internalLayoutStatus",
            "referenceEdgeComponentCount",
            "renderedEdgeComponentCount",
            "edgeComponentCountDelta",
            "edgeComponentCountAbsoluteDelta",
            "edgeOccupancyFractionDelta",
            "edgeProjectionXEmdPx",
            "edgeProjectionYEmdPx",
            "edgeGridDistributionL1",
            "edgeCentroidDeltaPx",
            "elementBoxCoverageFraction",
            "referenceEdgeCoverageFraction",
            "renderedEdgeCoverageFraction",
            "unattributedReferenceEdgePixels",
            "unattributedRenderedEdgePixels",
            "unattributedEdgeMismatchFraction",
            "unattributedMeanAbsolute",
            "unattributedRmse",
            "unattributedPixelExact",
            "unattributedChanged16Fraction",
            "unattributedChanged32Fraction",
            "unattributedReferenceEdgeBounds",
            "unattributedRenderedEdgeBounds",
            "unattributedEdgePresenceStatus",
            "unattributedOutlineStatus",
            "unattributedEdgeBoundsWidthDeltaPx",
            "unattributedEdgeBoundsHeightDeltaPx",
            "unattributedEdgeBoundsCenterDeltaPx",
            "unattributedEdgeF1At1Px",
            "unattributedEdgeF1At2Px",
            "unattributedEdgeDistanceMeanPx",
            "unattributedEdgeDistanceP95Px",
            "unattributedInternalLayoutStatus",
            "unattributedReferenceEdgeComponentCount",
            "unattributedRenderedEdgeComponentCount",
            "unattributedEdgeComponentCountDelta",
            "unattributedEdgeComponentCountAbsoluteDelta",
            "unattributedEdgeOccupancyFractionDelta",
            "unattributedEdgeProjectionXEmdPx",
            "unattributedEdgeProjectionYEmdPx",
            "unattributedEdgeGridDistributionL1",
            "unattributedEdgeCentroidDeltaPx",
        ],
    )
    write_csv(
        output_dir / "elements.csv",
        element_rows,
        [
            "key",
            "slideKey",
            "corpus",
            "deckId",
            "sourceSha256",
            "slideNumber",
            "elementId",
            "shapeId",
            "kind",
            "structuralRoles",
            "structuralTraits",
            "name",
            "strokeWidthEmu",
            "hasText",
            "textLength",
            "editable",
            "unsupportedReason",
            "slideRmse",
            "patternCandidates",
            "primaryPattern",
            "bboxAvailable",
            "bbox",
            "overlappingElementCount",
            "higherZOverlapCount",
            "lowerOrEqualZOverlapCount",
            "overlapAreaFraction",
            "higherZOverlapAreaFraction",
            "overlapRegionRmse",
            "overlapRegionChanged32Fraction",
            "higherZOverlapRegionRmse",
            "higherZOverlapRegionChanged32Fraction",
            "visibleCoreRegionRmse",
            "visibleCoreRegionChanged32Fraction",
            "isolationConfidence",
            "localRmse",
            "meanAbsolute",
            "changed16Fraction",
            "changed32Fraction",
            "pixelExact",
            "referenceEdgeBounds",
            "renderedEdgeBounds",
            "edgePresenceStatus",
            "outlineStatus",
            "edgeBoundsWidthDeltaPx",
            "edgeBoundsHeightDeltaPx",
            "edgeBoundsCenterDeltaPx",
            "edgeF1At1Px",
            "edgeF1At2Px",
            "edgeDistanceMeanPx",
            "edgeDistanceP95Px",
            "internalLayoutStatus",
            "referenceEdgeComponentCount",
            "renderedEdgeComponentCount",
            "edgeComponentCountDelta",
            "edgeComponentCountAbsoluteDelta",
            "edgeOccupancyFractionDelta",
            "edgeProjectionXEmdPx",
            "edgeProjectionYEmdPx",
            "edgeGridDistributionL1",
            "edgeCentroidDeltaPx",
        ],
    )
    write_montages(output_dir, slide_rows, images)
    print(
        json.dumps(
            {"output": str(output_dir), **slide_summary, **analysis["elements"]},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
