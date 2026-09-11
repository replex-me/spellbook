namespace Spellbook.Document.Core;

/// <summary>
/// Owns every format-specific operation needed by the common job pipeline.
/// A new document type is added by implementing this contract; the worker,
/// storage, versioning and callback layers must not learn that format's internals.
/// </summary>
public interface IDocumentFormatAdapter
{
    string FormatId { get; }
    string FileExtension { get; }
    DocumentScan Scan(string path);
    ElementGraph Inspect(string path, DocumentScan? scan = null);
    PatchResult Patch(
        string inputPath,
        string outputPath,
        EditCommandBatch command,
        IReadOnlyDictionary<string, byte[]>? assets = null);
    Task<IReadOnlyList<string>> RenderAsync(
        string inputPath,
        string outputDirectory,
        CancellationToken cancellationToken = default);
    string RendererName { get; }
    string RendererVersion { get; }
}

public sealed class PptxDocumentFormatAdapter(
    PptxSafetyScanner scanner,
    PresentationInspector inspector,
    PptxPatcher patcher,
    IPresentationRenderer renderer) : IDocumentFormatAdapter
{
    public string FormatId => "pptx";
    public string FileExtension => ".pptx";
    public string RendererName => renderer.Name;
    public string RendererVersion => renderer.Version;

    public DocumentScan Scan(string path) => scanner.Scan(path);

    public ElementGraph Inspect(string path, DocumentScan? scan = null) =>
        inspector.Inspect(path, scan);

    public PatchResult Patch(
        string inputPath,
        string outputPath,
        EditCommandBatch command,
        IReadOnlyDictionary<string, byte[]>? assets = null) =>
        patcher.Apply(inputPath, outputPath, command, assets);

    public Task<IReadOnlyList<string>> RenderAsync(
        string inputPath,
        string outputDirectory,
        CancellationToken cancellationToken = default) =>
        renderer.RenderAsync(inputPath, outputDirectory, cancellationToken);
}
