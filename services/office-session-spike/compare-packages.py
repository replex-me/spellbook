"""Compare exported packages without conflating XML rewriting with visual damage."""
import json
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


def shapes(archive):
    result = {}
    for name in archive.namelist():
        if not name.startswith("ppt/slides/slide") or not name.endswith(".xml"):
            continue
        root = ET.fromstring(archive.read(name))
        result[name] = []
        for shape in root.findall(".//p:sp", NS):
            identity = shape.find("p:nvSpPr/p:cNvPr", NS)
            offset = shape.find("p:spPr/a:xfrm/a:off", NS)
            result[name].append({
                "id": identity.get("id") if identity is not None else None,
                "name": identity.get("name") if identity is not None else None,
                "text": "".join(t.text or "" for t in shape.findall(".//a:t", NS)),
                "offset": dict(offset.attrib) if offset is not None else None,
            })
    return result


def compare(before, after):
    with zipfile.ZipFile(before) as left, zipfile.ZipFile(after) as right:
        a, b = set(left.namelist()), set(right.namelist())
        changed = sorted(n for n in a & b if left.read(n) != right.read(n))
        return {
            "before": before, "after": after,
            "originalPartCount": len(a), "savedPartCount": len(b),
            "changedSharedParts": changed, "addedParts": sorted(b - a), "removedParts": sorted(a - b),
            "unchangedSharedPartCount": len(a & b) - len(changed),
            "beforeShapes": shapes(left), "afterShapes": shapes(right),
            "interpretation": "Package differences and shape observations only; not a visual-fidelity or semantic-loss score.",
        }


if __name__ == "__main__":
    print(json.dumps(compare(*sys.argv[1:3]), ensure_ascii=False, indent=2))
