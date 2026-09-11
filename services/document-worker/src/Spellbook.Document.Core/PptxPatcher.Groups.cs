using System.Text.Json;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

public sealed partial class PptxPatcher
{
    private static IEnumerable<uint> ApplyGrouping(XDocument document, SlideGraph slide, JsonElement command)
    {
        if (RequiredString(command, "op") == "group_shapes")
        {
            var selected = command.GetProperty("targets").EnumerateArray().Select(target => ResolveTarget(document, slide, target, true)).ToHashSet();
            if (selected.Count < 2) throw new InvalidDataException("Grouping requires two distinct objects.");
            var shapes = Tree(document).Elements().Where(selected.Contains).ToArray();
            if (shapes.Length != selected.Count) throw new InvalidDataException("Grouping requires top-level objects on the same slide.");
            foreach (var shape in shapes) EnsureNoShapeReferences(document, shape);
            var boxes = shapes.Select(ReadBox).ToArray();
            var x = boxes.Min(b => b.X); var y = boxes.Min(b => b.Y);
            var w = boxes.Max(b => b.X + b.Width) - x; var h = boxes.Max(b => b.Y + b.Height) - y;
            var id = NextId(document);
            var group = new XElement(Presentation + "grpSp",
                new XElement(Presentation + "nvGrpSpPr", new XElement(Presentation + "cNvPr", new XAttribute("id", id), new XAttribute("name", $"Group {id}")),
                    new XElement(Presentation + "cNvGrpSpPr"), new XElement(Presentation + "nvPr")),
                new XElement(Presentation + "grpSpPr", new XElement(Drawing + "xfrm",
                    new XElement(Drawing + "off", new XAttribute("x", x), new XAttribute("y", y)),
                    new XElement(Drawing + "ext", new XAttribute("cx", w), new XAttribute("cy", h)),
                    new XElement(Drawing + "chOff", new XAttribute("x", x), new XAttribute("y", y)),
                    new XElement(Drawing + "chExt", new XAttribute("cx", w), new XAttribute("cy", h)))));
            shapes[^1].AddAfterSelf(group);
            foreach (var shape in shapes) { shape.Remove(); group.Add(shape); }
            return [id];
        }
        var target = ResolveTarget(document, slide, command.GetProperty("target"));
        if (target.Name != Presentation + "grpSp") throw new InvalidDataException("Ungrouping requires a group.");
        EnsureNoShapeReferences(document, target);
        if (target.Element(Presentation + "grpSpPr")!.Elements().Any(element => element.Name.LocalName != "xfrm"))
            throw new InvalidDataException("Ungrouping a group with shared visual effects requires effect flattening; keep it grouped to preserve appearance.");
        var transform = RequiredTransform(target); var box = ReadBox(target);
        var childOffset = transform.Element(Drawing + "chOff")!; var childExtent = transform.Element(Drawing + "chExt")!;
        // Flatten translation only. Nonuniform scaling and rotation also affect
        // text metrics, outlines and child transforms and cannot be guessed.
        if (((long?)transform.Attribute("rot") ?? 0) != 0 || (string?)transform.Attribute("flipH") is "1" or "true" || (string?)transform.Attribute("flipV") is "1" or "true" ||
            (long?)childExtent.Attribute("cx") != box.Width || (long?)childExtent.Attribute("cy") != box.Height)
            throw new InvalidDataException("Ungrouping a rotated, flipped or scaled group needs transform flattening; keep it grouped to preserve its appearance.");
        var children = target.Elements().Where(e => ShapeElementNames.Contains(e.Name.LocalName)).ToArray();
        var ids = new List<uint>();
        foreach (var child in children)
        {
            var childBox = ReadBox(child);
            SetOffset(child, childBox.X + box.X - (long)childOffset.Attribute("x")!, childBox.Y + box.Y - (long)childOffset.Attribute("y")!);
            ids.Add((uint)child.Descendants().First(e => e.Name.LocalName == "cNvPr").Attribute("id")!);
            child.Remove(); target.AddBeforeSelf(child);
        }
        target.Remove(); return ids;
    }
}
