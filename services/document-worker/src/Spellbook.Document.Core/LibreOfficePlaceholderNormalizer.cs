using System.IO.Compression;
using System.Globalization;
using System.Text;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

/// <summary>
/// Materializes PowerPoint placeholder semantics that LibreOffice does not
/// inherit faithfully. This only runs against the disposable render copy.
/// </summary>
internal sealed class LibreOfficePlaceholderNormalizer
{
    private static readonly XNamespace Drawing =
        "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static readonly XNamespace Presentation =
        "http://schemas.openxmlformats.org/presentationml/2006/main";
    private static readonly XNamespace OfficeRelationships =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace PackageRelationships =
        "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace ContentTypes =
        "http://schemas.openxmlformats.org/package/2006/content-types";
    private const string SlideLayoutRelationship =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
    private const string ImageRelationship =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
    private readonly ZipArchive archive;
    private readonly Dictionary<string, XDocument> layoutDocuments = new(StringComparer.Ordinal);
    private readonly HashSet<(string LayoutPath, string Index)> materializedPlaceholders = [];

    public LibreOfficePlaceholderNormalizer(ZipArchive archive)
    {
        this.archive = archive;
    }

    public bool Normalize(string slidePath, XDocument slide)
    {
        var changed = SuppressEmptyNonVisualPlaceholders(slide);
        var layout = LoadSlideLayout(slidePath);
        return MaterializePicturePlaceholderGeometry(slidePath, slide, layout) || changed;
    }

    public void Complete()
    {
        foreach (var group in materializedPlaceholders.GroupBy(item => item.LayoutPath))
        {
            var layout = layoutDocuments[group.Key];
            var indices = group.Select(item => item.Index).ToHashSet(StringComparer.Ordinal);
            foreach (var shape in layout.Descendants(Presentation + "sp").ToArray())
            {
                var placeholder = Placeholder(shape);
                if (string.Equals(
                        (string?)placeholder?.Attribute("type"),
                        "pic",
                        StringComparison.Ordinal)
                    && indices.Contains((string?)placeholder?.Attribute("idx") ?? "0"))
                {
                    shape.Remove();
                }
            }
            Replace(archive, group.Key, layout);
        }
    }

    private static bool SuppressEmptyNonVisualPlaceholders(XDocument slide)
    {
        var changed = false;
        foreach (var shape in slide.Descendants(Presentation + "sp").ToArray())
        {
            var placeholder = Placeholder(shape);
            var type = (string?)placeholder?.Attribute("type");
            if (type is not ("media" or "tbl") || HasPayload(shape))
            {
                continue;
            }

            shape.Remove();
            changed = true;
        }
        return changed;
    }

    private static bool HasPayload(XElement shape) =>
        shape.Descendants(Drawing + "t").Any(text => !string.IsNullOrWhiteSpace(text.Value))
        || shape.Descendants(Drawing + "tbl").Any()
        || shape.Descendants(Drawing + "graphicData").Any()
        || shape.Descendants().Attributes(OfficeRelationships + "embed").Any()
        || shape.Descendants().Attributes(OfficeRelationships + "link").Any()
        || shape.Descendants(Presentation + "oleObj").Any();

    private bool MaterializePicturePlaceholderGeometry(
        string slidePath,
        XDocument slide,
        (string Path, XDocument Document)? layout)
    {
        if (layout is null)
        {
            return false;
        }

        var layoutPlaceholders = layout.Value.Document.Descendants(Presentation + "sp")
            .Select(shape => (Shape: shape, Placeholder: Placeholder(shape)))
            .Where(item => string.Equals(
                (string?)item.Placeholder?.Attribute("type"),
                "pic",
                StringComparison.Ordinal))
            .ToArray();
        var changed = false;

        foreach (var shape in slide.Descendants(Presentation + "sp").ToArray())
        {
            var placeholder = Placeholder(shape);
            if (!string.Equals(
                (string?)placeholder?.Attribute("type"),
                "pic",
                StringComparison.Ordinal))
            {
                continue;
            }

            var shapeProperties = shape.Element(Presentation + "spPr");
            if (shapeProperties is null || HasExplicitVisualProperties(shapeProperties))
            {
                continue;
            }

            var index = (string?)placeholder?.Attribute("idx") ?? "0";
            var inherited = layoutPlaceholders
                .Where(item => string.Equals(
                    (string?)item.Placeholder?.Attribute("idx") ?? "0",
                    index,
                    StringComparison.Ordinal))
                .Take(2)
                .ToArray();
            if (inherited.Length != 1)
            {
                continue;
            }
            var inheritedProperties = inherited[0].Shape.Element(Presentation + "spPr");
            if (inheritedProperties?.Element(Drawing + "custGeom") is null)
            {
                continue;
            }

            var svg = CreateStaticCustomGeometrySvg(inheritedProperties);
            if (svg is null
                || !TryAddSvgPicturePart(
                    archive,
                    slidePath,
                    shape,
                    svg.Value.Content,
                    svg.Value.Transform,
                    out var picture))
            {
                continue;
            }

            shape.ReplaceWith(picture);
            materializedPlaceholders.Add((layout.Value.Path, index));
            changed = true;
        }

        return changed;
    }

    private static bool HasExplicitVisualProperties(XElement shapeProperties) =>
        shapeProperties.Elements().Any(element => element.Name != Drawing + "extLst");

    private static (string Content, XElement Transform)? CreateStaticCustomGeometrySvg(
        XElement shapeProperties)
    {
        var transform = shapeProperties.Element(Drawing + "xfrm");
        var customGeometry = shapeProperties.Element(Drawing + "custGeom");
        var fill = shapeProperties.Element(Drawing + "solidFill")?.Element(Drawing + "srgbClr");
        var color = (string?)fill?.Attribute("val");
        var line = shapeProperties.Element(Drawing + "ln");
        if (transform is null
            || customGeometry is null
            || color is null
            || color.Length != 6
            || color.Any(character => !Uri.IsHexDigit(character))
            || (line is not null && line.Element(Drawing + "noFill") is null))
        {
            return null;
        }

        var paths = customGeometry.Element(Drawing + "pathLst")?.Elements(Drawing + "path").ToArray();
        if (paths is not { Length: > 0 })
        {
            return null;
        }

        var width = ParsePositiveCoordinate(paths[0].Attribute("w")?.Value);
        var height = ParsePositiveCoordinate(paths[0].Attribute("h")?.Value);
        if (width is null || height is null
            || paths.Any(path =>
                ParsePositiveCoordinate(path.Attribute("w")?.Value) != width
                || ParsePositiveCoordinate(path.Attribute("h")?.Value) != height))
        {
            return null;
        }

        var data = new StringBuilder();
        foreach (var path in paths)
        {
            var fillMode = (string?)path.Attribute("fill");
            if (fillMode is not (null or "norm"))
            {
                return null;
            }

            foreach (var command in path.Elements())
            {
                if (command.Name == Drawing + "close")
                {
                    data.Append(" Z");
                    continue;
                }
                if (command.Name is not ({ } name)
                    || (name != Drawing + "moveTo" && name != Drawing + "lnTo"))
                {
                    return null;
                }

                var point = command.Element(Drawing + "pt");
                if (!TryParseCoordinate(point?.Attribute("x")?.Value, out var x)
                    || !TryParseCoordinate(point?.Attribute("y")?.Value, out var y))
                {
                    return null;
                }
                data.Append(name == Drawing + "moveTo" ? " M " : " L ");
                data.Append(x.ToString(CultureInfo.InvariantCulture));
                data.Append(' ');
                data.Append(y.ToString(CultureInfo.InvariantCulture));
            }
        }

        var content = string.Create(
            CultureInfo.InvariantCulture,
            $"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\"><path d=\"{data.ToString().Trim()}\" fill=\"#{color}\" fill-rule=\"evenodd\"/></svg>");
        return (content, new XElement(transform));
    }

    private static bool TryAddSvgPicturePart(
        ZipArchive archive,
        string slidePath,
        XElement shape,
        string svg,
        XElement transform,
        out XElement picture)
    {
        picture = null!;
        var relationshipPath = RelationshipPartPath(slidePath);
        var relationshipEntry = archive.GetEntry(relationshipPath);
        var contentTypesEntry = archive.GetEntry("[Content_Types].xml");
        var nonVisual = shape.Element(Presentation + "nvSpPr");
        var nonVisualProperties = nonVisual?.Element(Presentation + "cNvPr");
        if (relationshipEntry is null || contentTypesEntry is null || nonVisualProperties is null)
        {
            return false;
        }

        var relationships = Load(relationshipEntry);
        var relationshipRoot = relationships.Root;
        var contentTypes = Load(contentTypesEntry);
        var contentTypesRoot = contentTypes.Root;
        if (relationshipRoot is null || contentTypesRoot is null)
        {
            return false;
        }

        var relationshipId = NextRelationshipId(relationshipRoot);
        var mediaPath = NextMediaPath(archive, slidePath, nonVisualProperties);
        relationshipRoot.Add(new XElement(
            PackageRelationships + "Relationship",
            new XAttribute("Id", relationshipId),
            new XAttribute("Type", ImageRelationship),
            new XAttribute("Target", $"../media/{Path.GetFileName(mediaPath)}")));

        if (!contentTypesRoot.Elements(ContentTypes + "Default").Any(element =>
            string.Equals((string?)element.Attribute("Extension"), "svg", StringComparison.OrdinalIgnoreCase)))
        {
            contentTypesRoot.Add(new XElement(
                ContentTypes + "Default",
                new XAttribute("Extension", "svg"),
                new XAttribute("ContentType", "image/svg+xml")));
        }

        var mediaEntry = archive.CreateEntry(mediaPath, CompressionLevel.Optimal);
        using (var stream = mediaEntry.Open())
        using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
        {
            writer.Write(svg);
        }
        Replace(archive, relationshipPath, relationships);
        Replace(archive, "[Content_Types].xml", contentTypes);

        picture = new XElement(
            Presentation + "pic",
            new XElement(
                Presentation + "nvPicPr",
                new XElement(nonVisualProperties),
                new XElement(Presentation + "cNvPicPr"),
                new XElement(Presentation + "nvPr")),
            new XElement(
                Presentation + "blipFill",
                new XElement(
                    Drawing + "blip",
                    new XAttribute(OfficeRelationships + "embed", relationshipId)),
                new XElement(Drawing + "stretch", new XElement(Drawing + "fillRect"))),
            new XElement(
                Presentation + "spPr",
                transform,
                new XElement(Drawing + "prstGeom",
                    new XAttribute("prst", "rect"),
                    new XElement(Drawing + "avLst"))));
        return true;
    }

    private static string NextRelationshipId(XElement relationshipRoot)
    {
        var existing = relationshipRoot.Elements(PackageRelationships + "Relationship")
            .Select(element => (string?)element.Attribute("Id"))
            .Where(value => value is not null)
            .ToHashSet(StringComparer.Ordinal);
        var index = 1;
        while (existing.Contains($"rIdPresentPlaceholder{index}"))
        {
            index++;
        }
        return $"rIdPresentPlaceholder{index}";
    }

    private static string NextMediaPath(
        ZipArchive archive,
        string slidePath,
        XElement nonVisualProperties)
    {
        var slideName = Path.GetFileNameWithoutExtension(slidePath);
        var shapeId = (string?)nonVisualProperties.Attribute("id") ?? "shape";
        var stem = $"spellbook-{slideName}-placeholder-{shapeId}";
        var candidate = $"ppt/media/{stem}.svg";
        var index = 1;
        while (archive.GetEntry(candidate) is not null)
        {
            candidate = $"ppt/media/{stem}-{index}.svg";
            index++;
        }
        return candidate;
    }

    private static long? ParsePositiveCoordinate(string? value) =>
        TryParseCoordinate(value, out var parsed) && parsed > 0 ? parsed : null;

    private static bool TryParseCoordinate(string? value, out long parsed) =>
        long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed);

    private static XElement? Placeholder(XElement shape) =>
        shape.Element(Presentation + "nvSpPr")?
            .Element(Presentation + "nvPr")?
            .Element(Presentation + "ph");

    private (string Path, XDocument Document)? LoadSlideLayout(string slidePath)
    {
        var relationshipPath = RelationshipPartPath(slidePath);
        var relationshipEntry = archive.GetEntry(relationshipPath);
        if (relationshipEntry is null)
        {
            return null;
        }

        var relationships = Load(relationshipEntry);
        var target = relationships
            .Descendants(PackageRelationships + "Relationship")
            .Where(element => string.Equals(
                (string?)element.Attribute("Type"),
                SlideLayoutRelationship,
                StringComparison.Ordinal))
            .Select(element => (string?)element.Attribute("Target"))
            .SingleOrDefault();
        var layoutPath = ResolvePartPath(slidePath, target);
        if (layoutPath is null)
        {
            return null;
        }
        if (!layoutDocuments.TryGetValue(layoutPath, out var layout))
        {
            var layoutEntry = archive.GetEntry(layoutPath);
            if (layoutEntry is null)
            {
                return null;
            }
            layout = Load(layoutEntry);
            layoutDocuments.Add(layoutPath, layout);
        }
        return (layoutPath, layout);
    }

    private static string RelationshipPartPath(string partPath)
    {
        var separator = partPath.LastIndexOf('/');
        var directory = separator < 0 ? string.Empty : partPath[..(separator + 1)];
        var fileName = separator < 0 ? partPath : partPath[(separator + 1)..];
        return $"{directory}_rels/{fileName}.rels";
    }

    private static string? ResolvePartPath(string sourcePartPath, string? target)
    {
        if (string.IsNullOrWhiteSpace(target)
            || target.StartsWith("/", StringComparison.Ordinal)
            || target.Contains('\\'))
        {
            return null;
        }

        var separator = sourcePartPath.LastIndexOf('/');
        var sourceDirectory = separator < 0 ? string.Empty : sourcePartPath[..separator];
        var segments = new List<string>(sourceDirectory.Split('/', StringSplitOptions.RemoveEmptyEntries));
        foreach (var segment in target.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (segment == ".")
            {
                continue;
            }
            if (segment == "..")
            {
                if (segments.Count == 0)
                {
                    return null;
                }
                segments.RemoveAt(segments.Count - 1);
                continue;
            }
            segments.Add(segment);
        }

        return string.Join('/', segments);
    }

    private static XDocument Load(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        return XDocument.Load(stream, LoadOptions.PreserveWhitespace);
    }

    private static void Replace(ZipArchive archive, string path, XDocument document)
    {
        archive.GetEntry(path)?.Delete();
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        using var stream = entry.Open();
        document.Save(stream, SaveOptions.DisableFormatting);
    }
}
