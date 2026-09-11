using System.IO.Compression;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

public sealed partial class PptxPatcher
{
    private static readonly HashSet<string> ShapeElementNames = ["sp", "pic", "graphicFrame", "grpSp", "cxnSp"];
    private static readonly XNamespace Drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private readonly PresentationInspector inspector;

    public PptxPatcher(PresentationInspector? inspector = null)
    {
        this.inspector = inspector ?? new PresentationInspector();
    }

    public PatchResult Apply(string basePath, string outputPath, EditCommandBatch batch, IReadOnlyDictionary<string, byte[]>? imageAssets = null)
    {
        if (batch.ContractVersion != ContractVersions.Current)
        {
            throw new InvalidDataException($"Unsupported edit contract version '{batch.ContractVersion}'.");
        }

        var baseScan = new PptxSafetyScanner().Scan(basePath);
        if (!string.Equals(baseScan.DocumentSha256, batch.BaseDocumentSha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The edit command targets a different document version.");
        }

        var baseGraph = inspector.Inspect(basePath, baseScan);
        if (batch.Commands.Any(command => SlideStructureEditor.Operations.Contains(RequiredString(command, "op"))))
            return new SlideStructureEditor(inspector).Apply(basePath, outputPath, batch, baseGraph);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
        File.Copy(basePath, outputPath, true);
        var allowedParts = new HashSet<string>(StringComparer.Ordinal);
        var allowedShapeIds = new Dictionary<string, IReadOnlySet<uint>>(StringComparer.Ordinal);
        var structuralSlides = new HashSet<string>(StringComparer.Ordinal);
        var backgroundSlides = new HashSet<string>(StringComparer.Ordinal);
        var assetParts = new HashSet<string>(StringComparer.Ordinal);

        using (var archive = ZipFile.Open(outputPath, ZipArchiveMode.Update))
        {
            foreach (var slideGroup in GroupBySlide(batch.Commands))
            {
                var slide = baseGraph.Slides.SingleOrDefault(item => item.SlideIndex == slideGroup.Key) ??
                    throw new InvalidDataException($"Slide index {slideGroup.Key} does not exist.");
                var partPath = slide.PartUri.TrimStart('/');
                var entry = archive.GetEntry(partPath) ??
                    throw new InvalidDataException($"Slide part '{partPath}' does not exist.");
                var document = LoadXml(entry);
                var targets = slideGroup.Value.SelectMany(command => command.TryGetProperty("targets", out _)
                    ? command.GetProperty("targets").EnumerateArray().ToArray()
                    : command.TryGetProperty("target", out var target) ? new[] { target } : []);
                var ids = targets.Select(target => slide.Elements.Single(element =>
                    element.ElementId == RequiredString(target, "elementId")).ShapeId).ToHashSet();
                allowedShapeIds[partPath] = ids;

                foreach (var command in slideGroup.Value)
                {
                    var op = RequiredString(command, "op");
                    if (op is "add_image" or "replace_image")
                    {
                        var imageId = ApplyImage(archive, document, slide, command, imageAssets, assetParts);
                        if (imageId.HasValue) { ids.Add(imageId.Value); structuralSlides.Add(partPath); }
                    }
                    else if (op is "add_text_box" or "add_shape" or "add_table")
                    {
                        ids.Add(AddShape(document, command));
                        structuralSlides.Add(partPath);
                    }
                    else if (op == "set_background")
                    {
                        SetBackground(document, RequiredString(command, "rgb"));
                        backgroundSlides.Add(partPath);
                    }
                    else if (op is "group_shapes" or "ungroup_shape")
                    {
                        ids.UnionWith(ApplyGrouping(document, slide, command)); structuralSlides.Add(partPath);
                    }
                    else if (op == "align_shapes") ApplyAlignment(document, slide, command);
                    else if (op == "distribute_shapes") ApplyDistribution(document, slide, command);
                    else
                    {
                        if (op is "delete_shape" or "duplicate_shape" or "reorder_shape") structuralSlides.Add(partPath);
                        var added = ApplyExtended(document, slide, command);
                        if (added.HasValue) ids.Add(added.Value);
                    }
                }

                ReplaceEntry(archive, partPath, document);
                allowedParts.Add(partPath);
            }
        }

        allowedParts.UnionWith(assetParts);
        var validation = new PptxValidator().Validate(basePath, outputPath, allowedParts, allowedShapeIds, structuralSlides, backgroundSlides, assetParts);
        var candidateGraph = inspector.Inspect(outputPath);
        return new PatchResult(candidateGraph, validation);
    }

    private static SortedDictionary<int, List<JsonElement>> GroupBySlide(IReadOnlyList<JsonElement> commands)
    {
        var groups = new SortedDictionary<int, List<JsonElement>>();
        foreach (var command in commands)
        {
            var op = RequiredString(command, "op");
            if (op is "align_shapes" or "distribute_shapes" or "group_shapes")
            {
                var targets = command.GetProperty("targets").EnumerateArray().ToList();
                if (targets.Count < 2)
                {
                    throw new InvalidDataException("align_shapes requires at least two targets.");
                }
                var slideIndex = targets[0].GetProperty("slideIndex").GetInt32();
                if (targets.Any(target => target.GetProperty("slideIndex").GetInt32() != slideIndex))
                {
                    throw new InvalidDataException("All alignment targets must be on the same slide.");
                }
                Add(groups, slideIndex, command);
                continue;
            }

            var slideIndexValue = command.TryGetProperty("target", out var target)
                ? target.GetProperty("slideIndex") : command.GetProperty("slideIndex");
            Add(groups, slideIndexValue.GetInt32(), command);
        }
        return groups;
    }

    private static void Add(IDictionary<int, List<JsonElement>> groups, int slideIndex, JsonElement command)
    {
        if (!groups.TryGetValue(slideIndex, out var items))
        {
            items = [];
            groups[slideIndex] = items;
        }
        items.Add(command);
    }

    private static void ApplySingle(XDocument document, SlideGraph slide, JsonElement command)
    {
        var op = RequiredString(command, "op");
        var target = command.GetProperty("target");
        var shape = ResolveTarget(document, slide, target, op is "move_shape" or "resize_shape");
        switch (op)
        {
            case "replace_text":
                ReplaceText(shape, RequiredString(command, "text"));
                break;
            case "move_shape":
                SetOffset(shape, command.GetProperty("x").GetInt64(), command.GetProperty("y").GetInt64());
                break;
            case "resize_shape":
                SetExtent(shape, command.GetProperty("width").GetInt64(), command.GetProperty("height").GetInt64());
                break;
            case "set_fill":
                SetFill(shape, RequiredString(command, "rgb"));
                break;
            default:
                throw new InvalidDataException($"Unsupported edit operation '{op}'.");
        }
    }

    private static void ApplyAlignment(XDocument document, SlideGraph slide, JsonElement command)
    {
        var targets = command.GetProperty("targets").EnumerateArray()
            .Select(target => (Target: target, Shape: ResolveTarget(document, slide, target, true)))
            .ToList();
        var boxes = targets.Select(item => (item.Shape, Box: ReadBox(item.Shape))).ToList();
        var alignment = RequiredString(command, "alignment");
        var left = boxes.Min(item => item.Box.X);
        var right = boxes.Max(item => item.Box.X + item.Box.Width);
        var top = boxes.Min(item => item.Box.Y);
        var bottom = boxes.Max(item => item.Box.Y + item.Box.Height);

        foreach (var item in boxes)
        {
            var x = alignment switch
            {
                "left" => left,
                "center" => left + (right - left - item.Box.Width) / 2,
                "right" => right - item.Box.Width,
                _ => item.Box.X
            };
            var y = alignment switch
            {
                "top" => top,
                "middle" => top + (bottom - top - item.Box.Height) / 2,
                "bottom" => bottom - item.Box.Height,
                _ => item.Box.Y
            };
            SetOffset(item.Shape, x, y);
        }
    }

    private static XElement ResolveTarget(XDocument document, SlideGraph slide, JsonElement target, bool requireGeometry = false)
    {
        var targetSlide = target.GetProperty("slideIndex").GetInt32();
        if (targetSlide != slide.SlideIndex)
        {
            throw new InvalidDataException("Target slide does not match the command group.");
        }

        var elementId = RequiredString(target, "elementId");
        var expected = slide.Elements.SingleOrDefault(element => element.ElementId == elementId) ??
            throw new InvalidDataException($"Element '{elementId}' does not exist in the base graph.");
        if (!expected.Editable)
        {
            throw new InvalidDataException($"Element '{elementId}' is not editable: {expected.UnsupportedReason}");
        }

        var sourceHash = RequiredString(target, "sourceHash");
        if (!string.Equals(sourceHash, expected.SourceHash, StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Element '{elementId}' has changed since it was selected.");
        }

        var cNvPr = document.Descendants().FirstOrDefault(element =>
            element.Name.LocalName == "cNvPr" &&
            uint.TryParse((string?)element.Attribute("id"), out var id) &&
            id == expected.ShapeId) ?? throw new InvalidDataException($"Shape id {expected.ShapeId} is missing.");
        var shape = cNvPr.Ancestors().FirstOrDefault(element => ShapeElementNames.Contains(element.Name.LocalName)) ??
            throw new InvalidDataException($"Shape id {expected.ShapeId} has an unsupported XML structure.");
        if (requireGeometry && PresentationInspector.ShapeTransform(shape) is null)
        {
            if (expected.Width <= 0 || expected.Height <= 0 || shape.Name != Presentation + "sp")
                throw new InvalidDataException("The inherited geometry cannot be resolved safely.");
            var props = shape.Element(Presentation + "spPr") ?? throw new InvalidDataException("Missing shape properties.");
            props.AddFirst(new XElement(Drawing + "xfrm", new XAttribute("rot", (long)Math.Round(expected.Rotation * 60000)),
                new XAttribute("flipH", expected.FlipHorizontal ? "1" : "0"), new XAttribute("flipV", expected.FlipVertical ? "1" : "0"),
                new XElement(Drawing + "off", new XAttribute("x", expected.X), new XAttribute("y", expected.Y)),
                new XElement(Drawing + "ext", new XAttribute("cx", expected.Width), new XAttribute("cy", expected.Height))));
        }
        return shape;
    }

    private static void ReplaceText(XElement shape, string value)
    {
        PptxTextContent.Replace(shape, value);
    }

    private static void SetOffset(XElement shape, long x, long y)
    {
        var transform = RequiredTransform(shape);
        var offset = transform.Elements().FirstOrDefault(element => element.Name.LocalName == "off") ??
            throw new InvalidDataException("The selected shape has no position.");
        offset.SetAttributeValue("x", x);
        offset.SetAttributeValue("y", y);
    }

    private static void SetExtent(XElement shape, long width, long height)
    {
        if (width <= 0 || height <= 0)
        {
            throw new InvalidDataException("Shape width and height must be positive.");
        }
        var transform = RequiredTransform(shape);
        var extent = transform.Elements().FirstOrDefault(element => element.Name.LocalName == "ext") ??
            throw new InvalidDataException("The selected shape has no size.");
        extent.SetAttributeValue("cx", width);
        extent.SetAttributeValue("cy", height);
    }

    private static void SetFill(XElement shape, string rgb)
    {
        if (rgb.Length != 6 || rgb.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new InvalidDataException("Fill color must be a six-digit RGB value.");
        }
        var shapeProperties = shape.Elements().FirstOrDefault(element => element.Name.LocalName == "spPr") ??
            throw new InvalidDataException("The selected shape has no shape properties.");
        var existingFill = shapeProperties.Elements().FirstOrDefault(element =>
            element.Name.LocalName is "noFill" or "solidFill" or "gradFill" or "blipFill" or "pattFill" or "grpFill");
        existingFill?.Remove();
        var fill = new XElement(Drawing + "solidFill", new XElement(Drawing + "srgbClr", new XAttribute("val", rgb.ToUpperInvariant())));
        var next = shapeProperties.Elements().FirstOrDefault(element =>
            element.Name.LocalName is "ln" or "effectLst" or "effectDag" or "scene3d" or "sp3d" or "extLst");
        if (next is null)
        {
            shapeProperties.Add(fill);
        }
        else
        {
            next.AddBeforeSelf(fill);
        }
    }

    private static (long X, long Y, long Width, long Height) ReadBox(XElement shape)
    {
        var transform = RequiredTransform(shape);
        var offset = transform.Elements().First(element => element.Name.LocalName == "off");
        var extent = transform.Elements().First(element => element.Name.LocalName == "ext");
        return (
            long.Parse((string?)offset.Attribute("x") ?? "0"),
            long.Parse((string?)offset.Attribute("y") ?? "0"),
            long.Parse((string?)extent.Attribute("cx") ?? "0"),
            long.Parse((string?)extent.Attribute("cy") ?? "0"));
    }

    private static XElement RequiredTransform(XElement shape) =>
        PresentationInspector.ShapeTransform(shape) ??
        throw new InvalidDataException("The selected shape has no transform.");

    private static string RequiredString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"Property '{propertyName}' is required.");
        }
        return property.GetString()!;
    }

    private static XDocument LoadXml(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = 20_000_000
        });
        return XDocument.Load(reader, LoadOptions.PreserveWhitespace);
    }

    private static void ReplaceEntry(ZipArchive archive, string path, XDocument document)
    {
        archive.GetEntry(path)?.Delete();
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        using var stream = entry.Open();
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings
        {
            Encoding = new System.Text.UTF8Encoding(false),
            Indent = false,
            OmitXmlDeclaration = false
        });
        document.Save(writer);
    }
}
