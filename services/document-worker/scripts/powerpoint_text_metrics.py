#!/usr/bin/env python3
"""PowerPoint-compatible baseline metrics for LibreOffice fixed-cell text."""

from dataclasses import dataclass
import os
import struct
import subprocess
from urllib.parse import unquote


POWERPOINT_LINE_HEIGHT_MULTIPLIER = 1.2


@dataclass(frozen=True)
class FontVerticalMetrics:
    units_per_em: int
    ascent: int
    descent: int
    bold: bool

    @property
    def baseline_shift_percent(self):
        total = self.ascent + self.descent
        if self.units_per_em <= 0 or total <= 0:
            raise ValueError("Font vertical metrics must be positive")
        return 100 * (
            1
            - POWERPOINT_LINE_HEIGHT_MULTIPLIER
            * self.ascent
            / total
        )


@dataclass(frozen=True)
class ResolvedFontMetrics:
    requested_family: str
    resolved_family: str
    resolved_style: str
    path: str
    face_index: int
    metrics: FontVerticalMetrics


def _read_at(stream, offset, length):
    stream.seek(offset)
    value = stream.read(length)
    if len(value) != length:
        raise ValueError("Font table is truncated")
    return value


def _face_offset(stream, face_index):
    signature = _read_at(stream, 0, 4)
    if signature != b"ttcf":
        if face_index != 0:
            raise ValueError("A standalone font only has face index zero")
        return 0

    header = _read_at(stream, 8, 4)
    face_count = struct.unpack(">I", header)[0]
    if face_index < 0 or face_index >= face_count:
        raise ValueError(f"TTC face index {face_index} is outside 0..{face_count - 1}")
    return struct.unpack(
        ">I", _read_at(stream, 12 + face_index * 4, 4)
    )[0]


def _table_offsets(stream, face_offset):
    table_count = struct.unpack(">H", _read_at(stream, face_offset + 4, 2))[0]
    tables = {}
    for index in range(table_count):
        record = _read_at(stream, face_offset + 12 + index * 16, 16)
        tag, _, offset, length = struct.unpack(">4sIII", record)
        tables[tag] = (offset, length)
    return tables


def read_font_vertical_metrics(path, face_index=0):
    with open(path, "rb") as stream:
        face_offset = _face_offset(stream, face_index)
        tables = _table_offsets(stream, face_offset)
        if b"head" not in tables or b"hhea" not in tables:
            raise ValueError("Font does not contain required head and hhea tables")

        head_offset, head_length = tables[b"head"]
        hhea_offset, hhea_length = tables[b"hhea"]
        if head_length < 46 or hhea_length < 10:
            raise ValueError("Font head or hhea table is truncated")

        units_per_em = struct.unpack(
            ">H", _read_at(stream, head_offset + 18, 2)
        )[0]
        mac_style = struct.unpack(
            ">H", _read_at(stream, head_offset + 44, 2)
        )[0]
        ascent, signed_descent = struct.unpack(
            ">hh", _read_at(stream, hhea_offset + 4, 4)
        )
        descent = abs(signed_descent)

        bold = bool(mac_style & 0x0001)
        os2 = tables.get(b"OS/2")
        if os2 is not None and os2[1] >= 64:
            fs_selection = struct.unpack(
                ">H", _read_at(stream, os2[0] + 62, 2)
            )[0]
            bold = bold or bool(fs_selection & 0x0020)

    metrics = FontVerticalMetrics(units_per_em, ascent, descent, bold)
    _ = metrics.baseline_shift_percent
    return metrics


def _fontconfig_escape(value):
    escaped = value.replace("\\", "\\\\")
    for character in (":", ","):
        escaped = escaped.replace(character, f"\\{character}")
    return escaped


class FontMetricResolver:
    def __init__(self, executable="fc-match", embedded_index_path=None):
        self.executable = executable
        self._cache = {}
        self._embedded = self._read_embedded_index(
            embedded_index_path
            if embedded_index_path is not None
            else os.environ.get("SPELLBOOK_EMBEDDED_FONT_INDEX")
        )

    @staticmethod
    def _read_embedded_index(path):
        faces = {}
        if not path:
            return faces
        with open(path, "r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                fields = line.rstrip("\n").split("\t")
                if len(fields) != 3:
                    raise ValueError(
                        f"Invalid embedded font index line {line_number}: {line!r}"
                    )
                encoded_family, style, font_path = fields
                family = unquote(encoded_family)
                faces.setdefault(family.casefold(), {})[style.casefold()] = font_path
        return faces

    def _resolve_embedded(self, family, bold, italic):
        faces = self._embedded.get(family.casefold())
        if not faces:
            return None
        requested_styles = []
        if bold and italic:
            requested_styles.extend(["bolditalic", "bold", "italic"])
        elif bold:
            requested_styles.append("bold")
        elif italic:
            requested_styles.append("italic")
        requested_styles.append("regular")
        for style in requested_styles:
            path = faces.get(style)
            if path:
                return ResolvedFontMetrics(
                    requested_family=family,
                    resolved_family=family,
                    resolved_style=style,
                    path=path,
                    face_index=0,
                    metrics=read_font_vertical_metrics(path),
                )
        return None

    def resolve(self, family, bold=False, italic=False):
        key = (family.casefold(), bool(bold), bool(italic))
        if key in self._cache:
            return self._cache[key]

        embedded = self._resolve_embedded(family, bold, italic)
        if embedded is not None:
            self._cache[key] = embedded
            return embedded

        styles = []
        if bold:
            styles.append("Bold")
        if italic:
            styles.append("Italic")
        pattern = _fontconfig_escape(family)
        if styles:
            pattern += ":style=" + " ".join(styles)
        result = subprocess.run(
            [
                self.executable,
                "--format=%{file}\\t%{index}\\t%{family}\\t%{style}\\n",
                pattern,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        line = result.stdout.splitlines()[0] if result.stdout else ""
        fields = line.split("\t", 3)
        if len(fields) != 4 or not fields[0]:
            raise ValueError(f"Fontconfig did not resolve {family!r}")
        path, raw_index, resolved_family, resolved_style = fields
        face_index = int(raw_index or "0")
        resolved = ResolvedFontMetrics(
            requested_family=family,
            resolved_family=resolved_family,
            resolved_style=resolved_style,
            path=path,
            face_index=face_index,
            metrics=read_font_vertical_metrics(path, face_index),
        )
        self._cache[key] = resolved
        return resolved
