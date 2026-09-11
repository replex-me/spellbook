using System.Text.Json;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

public sealed partial class PptxPatcher
{
    private static readonly XNamespace Presentation = "http://schemas.openxmlformats.org/presentationml/2006/main";
    private static XElement Tree(XDocument document) => document.Root?.Element(Presentation + "cSld")?.Element(Presentation + "spTree")
        ?? throw new InvalidDataException("This operation requires a transitional PresentationML slide.");
    private static uint NextId(XDocument document) => checked(document.Descendants().Where(e => e.Name.LocalName == "cNvPr")
        .Select(e => (uint?)e.Attribute("id") ?? 0).DefaultIfEmpty(0U).Max() + 1);
    private static XElement Color(string rgb)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(rgb, "\\A[0-9a-fA-F]{6}\\z")) throw new InvalidDataException("Invalid RGB color.");
        return new XElement(Drawing + "solidFill", new XElement(Drawing + "srgbClr", new XAttribute("val", rgb)));
    }
    private static XElement Box(JsonElement command) => new(Drawing + "xfrm",
        new XElement(Drawing + "off", new XAttribute("x", command.GetProperty("x").GetInt64()), new XAttribute("y", command.GetProperty("y").GetInt64())),
        new XElement(Drawing + "ext", new XAttribute("cx", Positive(command, "width")), new XAttribute("cy", Positive(command, "height"))));
    private static long Positive(JsonElement command, string name)
    {
        var value = command.GetProperty(name).GetInt64();
        return value is > 0 and <= 100_000_000 ? value : throw new InvalidDataException("Invalid shape dimensions.");
    }
    private static XElement TextBody(string text, XNamespace ns) => new(ns + "txBody",
        new XElement(Drawing + "bodyPr"), new XElement(Drawing + "lstStyle"),
        text.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n').Select(line => new XElement(Drawing + "p",
            new XElement(Drawing + "r", new XElement(Drawing + "rPr", new XAttribute("lang", "ko-KR")), new XElement(Drawing + "t", line)))));

    private static uint AddShape(XDocument document, JsonElement command)
    {
        var tree = Tree(document);
        var id = NextId(document);
        var op = RequiredString(command, "op");
        XElement shape;
        if (op == "add_table")
        {
            var rows = command.GetProperty("rows").EnumerateArray().Select(row => row.EnumerateArray().Select(cell => cell.GetString() ?? "").ToArray()).ToArray();
            if (rows.Length is < 1 or > 30 || rows[0].Length is < 1 or > 15 || rows.Any(row => row.Length != rows[0].Length))
                throw new InvalidDataException("Table rows must be a nonempty rectangular grid (at most 30 by 15).");
            var width = Positive(command, "width"); var height = Positive(command, "height");
            var box = Box(command); box.Name = Presentation + "xfrm";
            shape = new XElement(Presentation + "graphicFrame",
                new XElement(Presentation + "nvGraphicFramePr", new XElement(Presentation + "cNvPr", new XAttribute("id", id), new XAttribute("name", $"Table {id}")),
                    new XElement(Presentation + "cNvGraphicFramePr"), new XElement(Presentation + "nvPr")), box,
                new XElement(Drawing + "graphic", new XElement(Drawing + "graphicData", new XAttribute("uri", DrawingMlGraphicTypes.Table),
                    new XElement(Drawing + "tbl", new XElement(Drawing + "tblPr"),
                        new XElement(Drawing + "tblGrid", Enumerable.Range(0, rows[0].Length).Select(i => new XElement(Drawing + "gridCol", new XAttribute("w", width / rows[0].Length + (i == rows[0].Length - 1 ? width % rows[0].Length : 0))))),
                        rows.Select((row, i) => new XElement(Drawing + "tr", new XAttribute("h", height / rows.Length + (i == rows.Length - 1 ? height % rows.Length : 0)),
                            row.Select(text => new XElement(Drawing + "tc", TextBody(text, Drawing), new XElement(Drawing + "tcPr")))))))));
        }
        else
        {
            var geometry = op == "add_text_box" ? "rect" : RequiredString(command, "geometry");
            if (!new[] { "rect", "roundRect", "ellipse", "triangle", "diamond", "chevron", "rightArrow", "line" }.Contains(geometry))
                throw new InvalidDataException("Unsupported basic shape geometry.");
            shape = new XElement(Presentation + "sp",
                new XElement(Presentation + "nvSpPr", new XElement(Presentation + "cNvPr", new XAttribute("id", id), new XAttribute("name", $"Spellbook {id}")),
                    new XElement(Presentation + "cNvSpPr", op == "add_text_box" ? new XAttribute("txBox", "1") : null), new XElement(Presentation + "nvPr")),
                new XElement(Presentation + "spPr", Box(command), new XElement(Drawing + "prstGeom", new XAttribute("prst", geometry), new XElement(Drawing + "avLst")),
                    op == "add_text_box" ? new XElement(Drawing + "noFill") : Color(RequiredString(command, "rgb"))),
                TextBody(op == "add_text_box" ? RequiredString(command, "text") : "", Presentation));
        }
        var extension = tree.Element(Presentation + "extLst");
        if (extension is null) tree.Add(shape); else extension.AddBeforeSelf(shape);
        return id;
    }

    private static uint? ApplyExtended(XDocument document, SlideGraph slide, JsonElement command)
    {
        var op = RequiredString(command, "op");
        if (op is "replace_text" or "move_shape" or "resize_shape" or "set_fill")
        {
            if (op == "replace_text" && ResolveTarget(document, slide, command.GetProperty("target")).Name.LocalName != "sp")
                throw new InvalidDataException("Use set_table_cell for tables; whole-object text replacement only supports text shapes.");
            ApplySingle(document, slide, command); return null;
        }
        var shape = ResolveTarget(document, slide, command.GetProperty("target"), op is "duplicate_shape" or "rotate_shape");
        switch (op)
        {
            case "crop_image": CropImage(shape, command); break;
            case "delete_shape":
                EnsureNoShapeReferences(document, shape); shape.Remove(); break;
            case "duplicate_shape":
                var copy = new XElement(shape);
                var nextId = NextId(document);
                var rootId = nextId;
                var idMap = new Dictionary<string, uint>();
                foreach (var identity in copy.Descendants().Where(e => e.Name.LocalName == "cNvPr"))
                {
                    idMap[(string)identity.Attribute("id")!] = nextId;
                    identity.SetAttributeValue("id", nextId++);
                    identity.SetAttributeValue("name", $"{(string?)identity.Attribute("name")} copy");
                }
                foreach (var link in copy.Descendants().Where(e => e.Name.LocalName is "stCxn" or "endCxn"))
                    if (idMap.TryGetValue((string?)link.Attribute("id") ?? "", out var mapped)) link.SetAttributeValue("id", mapped);
                SetOffset(copy, command.GetProperty("x").GetInt64(), command.GetProperty("y").GetInt64());
                shape.AddAfterSelf(copy); return rootId;
            case "rotate_shape":
                var degrees = command.GetProperty("degrees").GetDouble();
                if (!double.IsFinite(degrees) || Math.Abs(degrees) > 360) throw new InvalidDataException("Invalid rotation.");
                RequiredTransform(shape).SetAttributeValue("rot", (long)Math.Round((degrees % 360 + 360) % 360 * 60000)); break;
            case "reorder_shape":
                var siblings = shape.Parent!.Elements().Where(e => ShapeElementNames.Contains(e.Name.LocalName)).ToArray();
                var index = Array.IndexOf(siblings, shape);
                var destination = RequiredString(command, "position") switch
                {
                    "front" => siblings.Length - 1, "back" => 0, "forward" => Math.Min(index + 1, siblings.Length - 1), "backward" => Math.Max(0, index - 1),
                    _ => throw new InvalidDataException("Invalid stacking position.")
                };
                if (destination != index) { shape.Remove(); if (destination > index) siblings[destination].AddAfterSelf(shape); else siblings[destination].AddBeforeSelf(shape); }
                break;
            case "set_text_style": SetTextStyle(shape, command); break;
            case "set_paragraph_style": SetParagraphStyle(shape, command); break;
            case "set_line":
                var props = shape.Element(Presentation + "spPr") ?? throw new InvalidDataException("This object does not have a shape outline.");
                var line = props.Element(Drawing + "ln");
                var width = command.GetProperty("width").GetDouble();
                if (!double.IsFinite(width) || width is < 0 or > 100) throw new InvalidDataException("Invalid line width.");
                var replacement = new XElement(Drawing + "ln", new XAttribute("w", (long)Math.Round(width * 12700)), Color(RequiredString(command, "rgb")));
                if (line is not null) line.ReplaceWith(replacement); else InsertBefore(props, replacement, "effectLst", "effectDag", "scene3d", "sp3d", "extLst");
                break;
            case "set_table_cell":
                var table = shape.Descendants(Drawing + "tbl").SingleOrDefault() ?? throw new InvalidDataException("The target is not a table.");
                var rowIndex = command.GetProperty("row").GetInt32(); var column = command.GetProperty("column").GetInt32();
                if (rowIndex < 0 || column < 0) throw new InvalidDataException("Invalid table cell.");
                var cell = table.Elements(Drawing + "tr").ElementAtOrDefault(rowIndex)?.Elements(Drawing + "tc").ElementAtOrDefault(column)
                    ?? throw new InvalidDataException("Table cell does not exist.");
                if ((string?)cell.Attribute("hMerge") is "1" or "true" || (string?)cell.Attribute("vMerge") is "1" or "true")
                    throw new InvalidDataException("Edit the anchor cell of a merged range.");
                PptxTextContent.Replace(cell, RequiredString(command, "text")); break;
            default: throw new InvalidDataException($"Unsupported edit operation '{op}'.");
        }
        return null;
    }

    private static void EnsureNoShapeReferences(XDocument document, XElement shape)
    {
        var ids = shape.Descendants().Where(e => e.Name.LocalName == "cNvPr").Select(e => (string?)e.Attribute("id")).ToHashSet();
        if (document.Descendants().Where(e => !e.AncestorsAndSelf().Contains(shape)).Any(e =>
            e.Attributes().Any(a => (a.Name.LocalName == "spid" || (a.Name.LocalName == "id" && e.Name.LocalName is "stCxn" or "endCxn")) && ids.Contains(a.Value))))
            throw new InvalidDataException("The object has animation or connector references; remove those references before deleting it.");
    }
    private static void InsertBefore(XElement parent, XElement value, params string[] later)
    {
        var next = parent.Elements().FirstOrDefault(e => later.Contains(e.Name.LocalName));
        if (next is null) parent.Add(value); else next.AddBeforeSelf(value);
    }
    private static void SetTextStyle(XElement shape, JsonElement command)
    {
        var body = shape.Element(Presentation + "txBody") ?? throw new InvalidDataException("Text styling requires a text shape.");
        foreach (var paragraph in body.Elements(Drawing + "p"))
        {
            var paragraphProperties = paragraph.Element(Drawing + "pPr");
            if (paragraphProperties is null) { paragraphProperties = new XElement(Drawing + "pPr"); paragraph.AddFirst(paragraphProperties); }
            var defaults = paragraphProperties.Element(Drawing + "defRPr");
            if (defaults is null) { defaults = new XElement(Drawing + "defRPr"); InsertBefore(paragraphProperties, defaults, "extLst"); }
            var properties = paragraph.Elements(Drawing + "r").Select(run => {
                var p = run.Element(Drawing + "rPr"); if (p is null) { p = new XElement(Drawing + "rPr"); run.AddFirst(p); } return p;
            }).Append(defaults).Concat(paragraph.Elements(Drawing + "endParaRPr"));
            foreach (var p in properties)
            {
                if (command.TryGetProperty("fontSize", out var size))
                {
                    var pt = size.GetDouble(); if (!double.IsFinite(pt) || pt is < 1 or > 400) throw new InvalidDataException("Invalid font size.");
                    p.SetAttributeValue("sz", (int)Math.Round(pt * 100));
                }
                if (command.TryGetProperty("bold", out var bold)) p.SetAttributeValue("b", bold.GetBoolean() ? "1" : "0");
                if (command.TryGetProperty("italic", out var italic)) p.SetAttributeValue("i", italic.GetBoolean() ? "1" : "0");
                if (command.TryGetProperty("rgb", out var color))
                {
                    p.Elements().Where(e => e.Name.LocalName is "noFill" or "solidFill" or "gradFill" or "blipFill" or "pattFill" or "grpFill").Remove();
                    InsertBefore(p, Color(color.GetString()!), "effectLst", "effectDag", "highlight", "uLnTx", "uLn", "uFillTx", "uFill", "latin", "ea", "cs", "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst");
                }
                if (command.TryGetProperty("fontFamily", out var family))
                {
                    var name = family.GetString(); if (string.IsNullOrWhiteSpace(name) || name.Length > 100) throw new InvalidDataException("Invalid font family.");
                    foreach (var tag in new[] { "latin", "ea", "cs" }) p.Elements(Drawing + tag).Remove();
                    foreach (var tag in new[] { "latin", "ea", "cs" }) InsertBefore(p, new XElement(Drawing + tag, new XAttribute("typeface", name)), "sym", "hlinkClick", "hlinkMouseOver", "rtl", "extLst");
                }
            }
        }
    }
    private static void SetParagraphStyle(XElement shape, JsonElement command)
    {
        var body = shape.Element(Presentation + "txBody") ?? throw new InvalidDataException("Paragraph styling requires a text shape.");
        foreach (var paragraph in body.Elements(Drawing + "p"))
        {
            var props = paragraph.Element(Drawing + "pPr"); if (props is null) { props = new XElement(Drawing + "pPr"); paragraph.AddFirst(props); }
            if (command.TryGetProperty("alignment", out var alignment)) props.SetAttributeValue("algn", alignment.GetString() switch {
                "left" => "l", "center" => "ctr", "right" => "r", "justify" => "just", _ => throw new InvalidDataException("Invalid paragraph alignment.") });
            if (command.TryGetProperty("bullet", out var bullet))
            {
                props.Elements().Where(e => e.Name.LocalName is "buNone" or "buChar" or "buAutoNum" or "buBlip").Remove();
                var value = bullet.GetString() switch {
                    "none" => new XElement(Drawing + "buNone"), "bullet" => new XElement(Drawing + "buChar", new XAttribute("char", "•")),
                    "number" => new XElement(Drawing + "buAutoNum", new XAttribute("type", "arabicPeriod")), _ => throw new InvalidDataException("Invalid bullet style.") };
                InsertBefore(props, value, "tabLst", "defRPr", "extLst");
            }
        }
    }
    private static void SetBackground(XDocument document, string rgb)
    {
        var common = Tree(document).Parent!;
        var background = new XElement(Presentation + "bg", new XElement(Presentation + "bgPr", Color(rgb), new XElement(Drawing + "effectLst")));
        var current = common.Element(Presentation + "bg"); if (current is null) common.AddFirst(background); else current.ReplaceWith(background);
    }
    private static void ApplyDistribution(XDocument document, SlideGraph slide, JsonElement command)
    {
        var horizontal = RequiredString(command, "axis") switch { "horizontal" => true, "vertical" => false, _ => throw new InvalidDataException("Invalid distribution axis.") };
        var shapes = command.GetProperty("targets").EnumerateArray().Select(t => ResolveTarget(document, slide, t, true)).Distinct().Select(s => (Shape: s, Box: ReadBox(s)))
            .OrderBy(s => horizontal ? s.Box.X : s.Box.Y).ToArray();
        if (shapes.Length < 3) throw new InvalidDataException("Distribution requires three distinct shapes.");
        var start = horizontal ? shapes[0].Box.X : shapes[0].Box.Y;
        var end = horizontal ? shapes[^1].Box.X + shapes[^1].Box.Width : shapes[^1].Box.Y + shapes[^1].Box.Height;
        var total = shapes.Sum(s => horizontal ? s.Box.Width : s.Box.Height);
        var gap = (end - start - total) / (double)(shapes.Length - 1);
        double cursor = start;
        foreach (var item in shapes) { SetOffset(item.Shape, horizontal ? (long)Math.Round(cursor) : item.Box.X, horizontal ? item.Box.Y : (long)Math.Round(cursor)); cursor += (horizontal ? item.Box.Width : item.Box.Height) + gap; }
    }
}
