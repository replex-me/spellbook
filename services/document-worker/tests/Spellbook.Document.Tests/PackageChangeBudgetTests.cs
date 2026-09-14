using System.IO.Compression;
using System.Text.Json;
using System.Xml.Linq;
using Spellbook.Document.Core;
using Xunit;

namespace Spellbook.Document.Tests;

public sealed class PackageChangeBudgetTests : IDisposable
{
    private readonly string directory = Path.Combine(
        Path.GetTempPath(),
        $"spellbook-change-budget-tests-{Guid.NewGuid():N}");

    public PackageChangeBudgetTests() => Directory.CreateDirectory(directory);

    [Fact]
    public void AllowsOnlyTheDeclaredCategoryAndTargetSlide()
    {
        var source = TestPresentationFactory.Create(directory);
        var twoSlides = Path.Combine(directory, "two-slides.pptx");
        var addSlide = new EditCommandBatch(
            ContractVersions.Current,
            Hashing.FileSha256(source),
            "add fixture slide",
            [JsonSerializer.SerializeToElement(new
            {
                op = "duplicate_slide",
                slideIndex = 0,
                insertIndex = 1
            })]);
        var created = new PptxPatcher().Apply(source, twoSlides, addSlide);
        Assert.True(created.Validation.Valid, string.Join("\n", created.Validation.Errors));

        var target = created.CandidateGraph.Slides[1].Elements[0];
        var candidate = Path.Combine(directory, "second-slide-edited.pptx");
        var edit = new EditCommandBatch(
            ContractVersions.Current,
            Hashing.FileSha256(twoSlides),
            "edit second slide",
            [JsonSerializer.SerializeToElement(new
            {
                op = "replace_text",
                target = new
                {
                    slideIndex = 1,
                    elementId = target.ElementId,
                    sourceHash = target.SourceHash
                },
                text = "두 번째 슬라이드만 변경"
            })]);
        var changed = new PptxPatcher().Apply(twoSlides, candidate, edit);
        Assert.True(changed.Validation.Valid, string.Join("\n", changed.Validation.Errors));
        var validator = new PptxPackageChangeBudgetValidator();

        var accepted = validator.Validate(
            twoSlides,
            candidate,
            new PackageChangeBudgetRequest(ContractVersions.Current, ["slide_parts"], [1]));
        var rejected = validator.Validate(
            twoSlides,
            candidate,
            new PackageChangeBudgetRequest(ContractVersions.Current, ["slide_parts"], [0]));

        Assert.True(accepted.Valid, string.Join("\n", accepted.Errors));
        Assert.Single(accepted.Changes);
        Assert.Equal(
            created.CandidateGraph.Slides[1].PartUri.TrimStart('/'),
            accepted.Changes[0].Part);
        Assert.Equal("slide_parts", accepted.Changes[0].Category);
        Assert.False(rejected.Valid);
        Assert.Contains(
            rejected.Errors,
            error => error.Contains("outside the targeted slide scope"));
    }

    [Fact]
    public void RejectsUndeclaredPartsAndPartCreation()
    {
        var baseline = TestPresentationFactory.Create(directory);
        var candidate = Path.Combine(directory, "unexpected-part.pptx");
        File.Copy(baseline, candidate);
        using (var archive = ZipFile.Open(candidate, ZipArchiveMode.Update))
        {
            using var output = archive.CreateEntry("customXml/item1.xml").Open();
            output.Write("<unexpected/>"u8);
        }

        var report = new PptxPackageChangeBudgetValidator().Validate(
            baseline,
            candidate,
            new PackageChangeBudgetRequest(ContractVersions.Current, ["slide_parts"]));

        Assert.False(report.Valid);
        Assert.Equal("custom_xml", Assert.Single(report.Changes).Category);
        Assert.Contains(
            report.Errors,
            error => error.Contains("exceeds the declared change budget"));
        Assert.Contains(
            report.Errors,
            error => error.Contains("without creation/deletion authority"));
    }

    [Fact]
    public void IgnoresOnlyVolatileOfficeSaveMetadata()
    {
        var source = TestPresentationFactory.Create(directory);
        var baseline = Path.Combine(directory, "volatile-baseline.pptx");
        var candidate = Path.Combine(directory, "volatile-candidate.pptx");
        File.Copy(source, baseline);
        File.Copy(source, candidate);
        AddOfficeSaveMetadata(
            baseline,
            "11111111-1111-1111-1111-111111111111",
            "1",
            "2026-01-01T00:00:00Z",
            "<#>");
        AddOfficeSaveMetadata(
            candidate,
            "22222222-2222-2222-2222-222222222222",
            "2",
            "2026-02-02T00:00:00Z",
            "<#>");

        var ignored = new PptxPackageChangeBudgetValidator().Validate(
            baseline,
            candidate,
            new PackageChangeBudgetRequest(ContractVersions.Current, []));
        Assert.True(ignored.Valid, string.Join("\n", ignored.Errors));
        Assert.Empty(ignored.Changes);

        using (var archive = ZipFile.Open(candidate, ZipArchiveMode.Update))
        {
            var slide = ReadXml(archive, "ppt/slides/slide1.xml");
            XNamespace drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
            slide.Descendants(drawing + "t").Last().Value = "changed";
            Replace(archive, "ppt/slides/slide1.xml", slide);
        }
        var semanticChange = new PptxPackageChangeBudgetValidator().Validate(
            baseline,
            candidate,
            new PackageChangeBudgetRequest(ContractVersions.Current, []));
        Assert.False(semanticChange.Valid);
        Assert.Equal("slide_parts", Assert.Single(semanticChange.Changes).Category);
    }

    [Theory]
    [InlineData("[Content_Types].xml", "package_manifest")]
    [InlineData("ppt/_rels/presentation.xml.rels", "presentation_relationships")]
    [InlineData("ppt/slides/slide2.xml", "slide_parts")]
    [InlineData("ppt/slides/_rels/slide2.xml.rels", "slide_relationships")]
    [InlineData("ppt/charts/chart1.xml", "chart_parts")]
    [InlineData("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx", "embedded_workbooks")]
    [InlineData("ppt/diagrams/data1.xml", "diagram_parts")]
    [InlineData("mystery.bin", "unknown")]
    public void ClassifiesEveryPackagePartDeterministically(string part, string expected) =>
        Assert.Equal(expected, PptxPackageChangeBudgetValidator.Classify(part));

    public void Dispose()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    private static void AddOfficeSaveMetadata(
        string path,
        string fieldId,
        string revision,
        string modified,
        string fieldText)
    {
        using var archive = ZipFile.Open(path, ZipArchiveMode.Update);
        XNamespace drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
        XNamespace core = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
        XNamespace terms = "http://purl.org/dc/terms/";
        XNamespace xsi = "http://www.w3.org/2001/XMLSchema-instance";
        Replace(
            archive,
            "docProps/core.xml",
            new XDocument(
                new XElement(
                    core + "coreProperties",
                    new XElement(core + "lastModifiedBy", "editor"),
                    new XElement(core + "revision", revision),
                    new XElement(
                        terms + "modified",
                        new XAttribute(xsi + "type", "dcterms:W3CDTF"),
                        modified))));
        var slide = ReadXml(archive, "ppt/slides/slide1.xml");
        slide.Root?.Add(
            new XElement(
                drawing + "fld",
                new XAttribute("id", $"{{{fieldId}}}"),
                new XAttribute("type", "slidenum"),
                new XElement(drawing + "t", fieldText)));
        Replace(archive, "ppt/slides/slide1.xml", slide);
    }

    private static void Replace(ZipArchive archive, string part, XDocument document)
    {
        archive.GetEntry(part)?.Delete();
        var entry = archive.CreateEntry(part);
        using var stream = entry.Open();
        document.Save(stream, SaveOptions.DisableFormatting);
    }

    private static XDocument ReadXml(ZipArchive archive, string part)
    {
        var entry = archive.GetEntry(part)
            ?? throw new InvalidDataException($"Missing test archive entry: {part}");
        using var stream = entry.Open();
        return XDocument.Load(stream);
    }
}
