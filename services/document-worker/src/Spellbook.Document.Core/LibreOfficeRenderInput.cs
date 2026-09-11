using System.IO.Compression;
using System.Globalization;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

/// <summary>
/// Creates a disposable PPTX copy that selects fidelity-preserving OOXML
/// fallbacks for features that LibreOffice claims but does not render safely.
/// The canonical presentation is never modified.
/// </summary>
public sealed class LibreOfficeRenderInput
{
    private static readonly XNamespace MarkupCompatibility =
        "http://schemas.openxmlformats.org/markup-compatibility/2006";
    private static readonly XNamespace Drawing =
        "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static readonly XNamespace Presentation =
        "http://schemas.openxmlformats.org/presentationml/2006/main";
    private static readonly XNamespace PackageRelationships =
        "http://schemas.openxmlformats.org/package/2006/relationships";
    private const string ChartExNamespace =
        "http://schemas.microsoft.com/office/drawing/2014/chartex";
    private const string UnsupportedChartExRequirement = "presentUnsupportedChartEx";
    private const string BlockedExternalTarget =
        "file:///nonexistent/spellbook-blocked-external-relationship";
    private readonly Func<DateTimeOffset> utcNow;
    private readonly TimeZoneInfo renderTimeZone;

    public LibreOfficeRenderInput(
        Func<DateTimeOffset>? utcNow = null,
        TimeZoneInfo? renderTimeZone = null)
    {
        this.utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
        this.renderTimeZone = renderTimeZone ?? ResolveRenderTimeZone();
    }

    public void Create(string sourcePath, string outputPath)
    {
        File.Copy(sourcePath, outputPath, overwrite: true);

        using var archive = ZipFile.Open(outputPath, ZipArchiveMode.Update);
        NeutralizeExternalRelationships(archive);
        var slidePaths = archive.Entries
            .Where(entry =>
                entry.FullName.StartsWith("ppt/slides/slide", StringComparison.Ordinal)
                && entry.FullName.EndsWith(".xml", StringComparison.Ordinal))
            .Select(entry => entry.FullName)
            .ToArray();
        var placeholderNormalizer = new LibreOfficePlaceholderNormalizer(archive);

        foreach (var slidePath in slidePaths)
        {
            var entry = archive.GetEntry(slidePath)
                ?? throw new InvalidDataException($"Missing PPTX slide part: {slidePath}");
            var document = Load(entry);
            var changed = placeholderNormalizer.Normalize(slidePath, document);

            foreach (var choice in document.Descendants(MarkupCompatibility + "Choice"))
            {
                var alternateContent = choice.Parent;
                var hasFallback = alternateContent?.Element(MarkupCompatibility + "Fallback") is not null;
                var containsChartEx = choice
                    .Descendants(Drawing + "graphicData")
                    .Any(element => string.Equals(
                        (string?)element.Attribute("uri"),
                        ChartExNamespace,
                        StringComparison.Ordinal));
                if (!hasFallback || !containsChartEx)
                {
                    continue;
                }

                choice.SetAttributeValue("Requires", UnsupportedChartExRequirement);
                changed = true;
            }

            foreach (var field in document
                .Descendants(Drawing + "fld")
                .Where(element => string.Equals(
                    (string?)element.Attribute("type"),
                    "datetime1",
                    StringComparison.OrdinalIgnoreCase))
                .ToArray())
            {
                var text = field.Element(Drawing + "t");
                if (text is null)
                {
                    continue;
                }

                var language = (string?)field.Element(Drawing + "rPr")?.Attribute("lang") ?? "en-US";
                text.Value = FormatShortDate(language);
                field.Name = Drawing + "r";
                field.RemoveAttributes();
                changed = true;
            }

            foreach (var textBody in TextBodies(document))
            {
                var bodyProperties = textBody.Element(Drawing + "bodyPr");
                var shapeAutoFit = bodyProperties?.Element(Drawing + "spAutoFit");
                var wrap = (string?)bodyProperties?.Attribute("wrap");
                if (bodyProperties is null
                    || !(string.Equals(wrap, "square", StringComparison.Ordinal)
                        || string.Equals(wrap, "none", StringComparison.Ordinal))
                    || shapeAutoFit is null)
                {
                    continue;
                }

                var paragraphs = textBody.Elements(Drawing + "p").ToArray();
                if (paragraphs.Length == 0)
                {
                    continue;
                }

                var value = string.Concat(
                    paragraphs.SelectMany(paragraph =>
                        paragraph.Descendants(Drawing + "t").Select(element => element.Value)))
                    .Trim();
                var explicitlySingleLine = string.Equals(wrap, "none", StringComparison.Ordinal);
                var numericLabel = paragraphs.Length == 1
                    && !paragraphs[0].Descendants(Drawing + "br").Any()
                    && value.Length > 0
                    && value.All(char.IsDigit);
                if (value.Length == 0 || (!explicitlySingleLine && !numericLabel))
                {
                    continue;
                }

                bodyProperties.SetAttributeValue("wrap", "none");
                // Preserve the stored geometry and declared character size for
                // this render-only snapshot. spAutoFit resizes the shape, not
                // the text: replacing it with normAutofit authorizes unwanted
                // font shrinking when LibreOffice recomputes the layout.
                shapeAutoFit.ReplaceWith(new XElement(Drawing + "noAutofit"));
                if (numericLabel)
                {
                    var paragraphProperties = paragraphs[0].Element(Drawing + "pPr");
                    if (string.Equals(
                        (string?)paragraphProperties?.Attribute("algn"),
                        "dist",
                        StringComparison.Ordinal))
                    {
                        paragraphProperties!.SetAttributeValue("algn", "ctr");
                    }
                }
                changed = true;
            }

            if (changed)
            {
                Replace(archive, slidePath, document);
            }
        }

        placeholderNormalizer.Complete();
    }

    private static IEnumerable<XElement> TextBodies(XDocument document) =>
        document.Descendants().Where(element =>
            element.Name == Presentation + "txBody"
            || element.Name == Drawing + "txBody");

    private static void NeutralizeExternalRelationships(ZipArchive archive)
    {
        var relationshipPaths = archive.Entries
            .Where(entry => entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase))
            .Select(entry => entry.FullName)
            .ToArray();

        foreach (var relationshipPath in relationshipPaths)
        {
            var entry = archive.GetEntry(relationshipPath)
                ?? throw new InvalidDataException($"Missing PPTX relationship part: {relationshipPath}");
            var document = Load(entry);
            var externalRelationships = document
                .Descendants(PackageRelationships + "Relationship")
                .Where(element => string.Equals(
                    (string?)element.Attribute("TargetMode"),
                    "External",
                    StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (externalRelationships.Length == 0)
            {
                continue;
            }

            foreach (var relationship in externalRelationships)
            {
                relationship.SetAttributeValue("Target", BlockedExternalTarget);
            }
            Replace(archive, relationshipPath, document);
        }
    }

    private string FormatShortDate(string language)
    {
        CultureInfo culture;
        try
        {
            culture = CultureInfo.GetCultureInfo(language);
        }
        catch (CultureNotFoundException)
        {
            culture = CultureInfo.InvariantCulture;
        }

        var localNow = TimeZoneInfo.ConvertTime(utcNow(), renderTimeZone);
        return localNow.ToString("d", culture);
    }

    private static TimeZoneInfo ResolveRenderTimeZone()
    {
        var configured = Environment.GetEnvironmentVariable("SPELLBOOK_RENDER_TIME_ZONE");
        if (string.IsNullOrWhiteSpace(configured))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(configured);
        }
        catch (TimeZoneNotFoundException exception)
        {
            throw new InvalidOperationException($"Unknown render time zone '{configured}'.", exception);
        }
        catch (InvalidTimeZoneException exception)
        {
            throw new InvalidOperationException($"Invalid render time zone '{configured}'.", exception);
        }
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
