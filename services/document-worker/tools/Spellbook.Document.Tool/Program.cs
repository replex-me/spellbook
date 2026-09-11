using System.Text.Json;
using Spellbook.Document.Core;

if (args.Length < 1)
{
    Usage();
    return 2;
}

switch (args[0])
{
    case "inspect" when args.Length == 3:
    {
        var scanner = new PptxSafetyScanner();
        var scan = scanner.Scan(args[1]);
        var graph = new PresentationInspector().Inspect(args[1], scan);
        await WriteJson(args[2], graph, DocumentJsonContext.Default.ElementGraph);
        break;
    }
    case "patch" when args.Length == 4:
    {
        await using var stream = File.OpenRead(args[2]);
        var command = await JsonSerializer.DeserializeAsync(stream, DocumentJsonContext.Default.EditCommandBatch)
            ?? throw new InvalidDataException("Edit command JSON is empty.");
        var result = new PptxPatcher().Apply(args[1], args[3], command);
        await JsonSerializer.SerializeAsync(Console.OpenStandardOutput(), result, DocumentJsonContext.Default.PatchResult);
        Console.WriteLine();
        if (!result.Validation.Valid) return 1;
        break;
    }
    case "smoke-replace-first-text" when args.Length == 4:
    {
        var graph = new PresentationInspector().Inspect(args[1]);
        var element = graph.Slides.SelectMany(slide => slide.Elements)
            .FirstOrDefault(candidate => candidate.Editable && candidate.Kind == "shape" && !string.IsNullOrWhiteSpace(candidate.Text))
            ?? throw new InvalidDataException("The presentation has no editable text shape.");
        var command = new EditCommandBatch(
            ContractVersions.Current,
            graph.DocumentSha256,
            "Smoke-test text replacement",
            [JsonSerializer.SerializeToElement(new
            {
                op = "replace_text",
                target = new { slideIndex = graph.Slides.First(slide => slide.Elements.Contains(element)).SlideIndex, elementId = element.ElementId, sourceHash = element.SourceHash },
                text = args[3]
            })]);
        var result = new PptxPatcher().Apply(args[1], args[2], command);
        await JsonSerializer.SerializeAsync(Console.OpenStandardOutput(), result, DocumentJsonContext.Default.PatchResult);
        Console.WriteLine();
        if (!result.Validation.Valid) return 1;
        break;
    }
    case "render" when args.Length == 3:
    {
        IPresentationRenderer renderer = new LibreOfficeRenderer();
        var images = await renderer.RenderAsync(args[1], args[2], CancellationToken.None);
        foreach (var image in images) Console.WriteLine(image);
        break;
    }
    case "extract-embedded-fonts" when args.Length == 3:
    {
        var paths = new PptxEmbeddedFontExtractor().ExtractToDirectory(args[1], args[2]);
        foreach (var path in paths) Console.WriteLine(path);
        break;
    }
    default:
        Usage();
        return 2;
}

return 0;

static async Task WriteJson<T>(string path, T value, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
{
    await using var stream = File.Create(path);
    await JsonSerializer.SerializeAsync(stream, value, typeInfo);
}

static void Usage() => Console.Error.WriteLine(
    "Usage: inspect <source.pptx> <graph.json> | patch <source.pptx> <command.json> <candidate.pptx> | smoke-replace-first-text <source.pptx> <candidate.pptx> <text> | render <source.pptx> <output-dir> | extract-embedded-fonts <source.pptx> <output-dir>");
