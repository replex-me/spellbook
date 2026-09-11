using System.IO.Compression;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

/// <summary>One topology change per batch; original parts are never reserialized incidentally.</summary>
internal sealed class SlideStructureEditor(PresentationInspector inspector)
{
    internal static readonly HashSet<string> Operations = ["add_slide", "duplicate_slide", "delete_slide", "move_slide"];
    private static readonly XNamespace P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace Ct = "http://schemas.openxmlformats.org/package/2006/content-types";
    public PatchResult Apply(string basePath, string outputPath, EditCommandBatch batch, ElementGraph graph)
    {
        if (batch.Commands.Count != 1) throw new InvalidDataException("Slide structure changes require a separate single-command batch. Observe the new graph before editing again.");
        var command = batch.Commands[0]; var op = command.GetProperty("op").GetString()!;
        var sourceIndex = command.GetProperty(op == "add_slide" ? "templateSlideIndex" : "slideIndex").GetInt32();
        var source = graph.Slides.SingleOrDefault(s => s.SlideIndex == sourceIndex) ?? throw new InvalidDataException("Source slide does not exist.");
        if (op == "delete_slide" && graph.Slides.Count == 1) throw new InvalidDataException("The last slide cannot be deleted.");
        if (op is "add_slide" or "duplicate_slide" && graph.Slides.Count >= 200) throw new InvalidDataException("The document slide limit is 200.");
        var insertIndex = op == "delete_slide" ? 0 : command.GetProperty("insertIndex").GetInt32();
        if (insertIndex < 0 || insertIndex > graph.Slides.Count - (op == "move_slide" ? 1 : 0)) throw new InvalidDataException("Insertion index is outside the document.");
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
        File.Copy(basePath, outputPath, true);
        var allowed = new HashSet<string>(StringComparer.Ordinal) { "ppt/presentation.xml" };
        using (var zip = ZipFile.Open(outputPath, ZipArchiveMode.Update))
        {
            var presentation = Read(zip, "ppt/presentation.xml");
            if (presentation.Root?.Name != P + "presentation") throw new InvalidDataException("Structural editing currently requires transitional PresentationML.");
            if (presentation.Descendants().Any(e => e.Name.LocalName is "sectionLst" or "custShowLst"))
                throw new InvalidDataException("Slides in sections or custom shows require an explicit structure migration before changing slide order.");
            var list = presentation.Root.Element(P + "sldIdLst")!;
            var ids = list.Elements(P + "sldId").ToList();
            if (op == "move_slide")
            {
                var id = ids[sourceIndex]; ids.RemoveAt(sourceIndex); ids.Insert(insertIndex, id); list.ReplaceNodes(ids);
            }
            else if (op == "delete_slide")
            {
                var sourcePath = source.PartUri.TrimStart('/');
                var before = Reachable(zip);
                foreach (var other in graph.Slides.Where(s => s.PartUri != source.PartUri))
                {
                    var part = other.PartUri.TrimStart('/'); var relPath = RelationshipsPath(part);
                    if (zip.GetEntry(relPath) is not null && Read(zip, relPath).Root!.Elements().Any(rel =>
                        (string?)rel.Attribute("TargetMode") != "External" && Resolve(part, (string)rel.Attribute("Target")!) == sourcePath))
                        throw new InvalidDataException("Another slide links to this slide. Remove that link before deleting the slide.");
                }
                var relationships = Read(zip, "ppt/_rels/presentation.xml.rels");
                var rid = (string)ids[sourceIndex].Attribute(R + "id")!;
                relationships.Root!.Elements().Where(rel => (string?)rel.Attribute("Id") == rid).Remove();
                Write(zip, "ppt/_rels/presentation.xml.rels", relationships); allowed.Add("ppt/_rels/presentation.xml.rels");
                ids[sourceIndex].Remove();
                var after = Reachable(zip);
                var removed = before.Except(after).ToHashSet(StringComparer.Ordinal);
                foreach (var part in removed)
                {
                    zip.GetEntry(part)?.Delete(); allowed.Add(part);
                    var relPath = RelationshipsPath(part); if (zip.GetEntry(relPath) is { } relEntry) { relEntry.Delete(); allowed.Add(relPath); }
                }
                var types = Read(zip, "[Content_Types].xml");
                types.Root!.Elements(Ct + "Override").Where(e => removed.Contains(((string?)e.Attribute("PartName"))?.TrimStart('/') ?? "")).Remove();
                Write(zip, "[Content_Types].xml", types); allowed.Add("[Content_Types].xml");
            }
            else
            {
                var relationships = Read(zip, "ppt/_rels/presentation.xml.rels");
                var types = Read(zip, "[Content_Types].xml");
                var sourcePath = source.PartUri.TrimStart('/');
                var newPath = NewPart(sourcePath);
                var copied = new Dictionary<string, string>(StringComparer.Ordinal) { [sourcePath] = newPath };
                if (op == "duplicate_slide") ClonePart(zip, sourcePath, newPath, copied, types, allowed);
                else
                {
                    var slide = Read(zip, sourcePath);
                    var common = slide.Root!.Element(P + "cSld")!;
                    var tree = common.Element(P + "spTree")!;
                    tree.Elements().Where(e => e.Name.LocalName is not ("nvGrpSpPr" or "grpSpPr")).Remove();
                    // Keep layout/theme and background, but no timing, comments,
                    // transitions, or per-slide extension references from the template.
                    slide.Root.Elements().Where(e => e.Name.LocalName is not ("cSld" or "clrMapOvr")).Remove();
                    common.Elements().Where(e => e.Name.LocalName is not ("bg" or "spTree")).Remove();
                    Write(zip, newPath, slide); allowed.Add(newPath); CopyContentType(types, sourcePath, newPath);
                    var sourceRels = RelationshipsPath(sourcePath);
                    if (zip.GetEntry(sourceRels) is not null)
                    {
                        var rels = Read(zip, sourceRels);
                        // Backgrounds can reference images; keep immutable image and
                        // layout dependencies, with paths normalized to their parts.
                        rels.Root!.Elements().Where(e => !new[] { "slideLayout", "image" }.Contains(((string?)e.Attribute("Type"))?.Split('/').Last())).Remove();
                        Write(zip, RelationshipsPath(newPath), rels); allowed.Add(RelationshipsPath(newPath));
                    }
                }
                var rid = "rIdSpellbook" + Guid.NewGuid().ToString("N");
                relationships.Root!.Add(new XElement(Rel + "Relationship", new XAttribute("Id", rid), new XAttribute("Type", R.NamespaceName + "/slide"), new XAttribute("Target", Relative("ppt/presentation.xml", newPath))));
                var maxId = ids.Select(id => (uint)id.Attribute("id")!).Max();
                var newId = new XElement(P + "sldId", new XAttribute("id", checked(maxId + 1)), new XAttribute(R + "id", rid));
                if (insertIndex == ids.Count) list.Add(newId); else ids[insertIndex].AddBeforeSelf(newId);
                Write(zip, "ppt/_rels/presentation.xml.rels", relationships); allowed.Add("ppt/_rels/presentation.xml.rels");
                Write(zip, "[Content_Types].xml", types); allowed.Add("[Content_Types].xml");
            }
            Write(zip, "ppt/presentation.xml", presentation);
        }
        var validation = new PptxValidator().Validate(basePath, outputPath, allowed);
        return new PatchResult(inspector.Inspect(outputPath), validation);
    }
    private static HashSet<string> Reachable(ZipArchive zip)
    {
        var reachable = new HashSet<string>(StringComparer.Ordinal);
        void Visit(string source, string relPath)
        {
            if (zip.GetEntry(relPath) is null) return;
            foreach (var rel in Read(zip, relPath).Root!.Elements())
            {
                if ((string?)rel.Attribute("TargetMode") == "External") continue;
                var target = Resolve(source, (string)rel.Attribute("Target")!);
                if (reachable.Add(target)) Visit(target, RelationshipsPath(target));
            }
        }
        Visit("", "_rels/.rels"); return reachable;
    }
    private static string NewPart(string source) => $"{source[..(source.LastIndexOf('/') + 1)]}{(source.StartsWith("ppt/slides/", StringComparison.Ordinal) ? "slide-" : "")}spellbook-{Guid.NewGuid():N}{Path.GetExtension(source)}";
    private static string RelationshipsPath(string part) => $"{part[..(part.LastIndexOf('/') + 1)]}_rels/{part[(part.LastIndexOf('/') + 1)..]}.rels";
    private static Uri PartUri(string part) => new("https://package.invalid/" + part);
    private static string Resolve(string source, string target)
    {
        var uri = new Uri(PartUri(source), target);
        if (uri.Host != "package.invalid" || uri.Scheme != "https" || target.Contains('\\')) throw new InvalidDataException("Unsafe internal relationship.");
        return Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
    }
    private static string Relative(string source, string target) => PartUri(source).MakeRelativeUri(PartUri(target)).ToString();
    private static void ClonePart(ZipArchive zip, string source, string destination, Dictionary<string, string> copied, XDocument types, HashSet<string> allowed)
    {
        if (copied.Count > 500) throw new InvalidDataException("Slide dependency graph exceeds the safe copy limit.");
        var entry = zip.GetEntry(source) ?? throw new InvalidDataException($"Missing slide dependency: {source}");
        byte[] bytes; using (var input = entry.Open()) { using var buffer = new MemoryStream(); input.CopyTo(buffer); bytes = buffer.ToArray(); }
        using (var output = zip.CreateEntry(destination).Open()) output.Write(bytes);
        allowed.Add(destination); CopyContentType(types, source, destination);
        var relPath = RelationshipsPath(source); if (zip.GetEntry(relPath) is null) return;
        var rels = Read(zip, relPath);
        foreach (var rel in rels.Root!.Elements())
        {
            if ((string?)rel.Attribute("TargetMode") == "External") continue;
            var target = Resolve(source, (string)rel.Attribute("Target")!);
            var kind = ((string?)rel.Attribute("Type"))?.Split('/').Last();
            if (!copied.TryGetValue(target, out var mapped))
            {
                if (kind is "slideLayout" or "slideMaster" or "notesMaster" or "theme" or "image" or "audio" or "video" or "slide") mapped = target;
                else { mapped = NewPart(target); copied.Add(target, mapped); ClonePart(zip, target, mapped, copied, types, allowed); }
            }
            rel.SetAttributeValue("Target", Relative(destination, mapped));
        }
        Write(zip, RelationshipsPath(destination), rels); allowed.Add(RelationshipsPath(destination));
    }
    private static void CopyContentType(XDocument types, string source, string destination)
    {
        var original = types.Root!.Elements(Ct + "Override").SingleOrDefault(e => (string?)e.Attribute("PartName") == "/" + source);
        if (original is not null) { var copy = new XElement(original); copy.SetAttributeValue("PartName", "/" + destination); types.Root.Add(copy); }
    }
    private static XDocument Read(ZipArchive zip, string path)
    {
        using var stream = (zip.GetEntry(path) ?? throw new InvalidDataException($"Missing part {path}")).Open();
        using var reader = System.Xml.XmlReader.Create(stream, new System.Xml.XmlReaderSettings { DtdProcessing = System.Xml.DtdProcessing.Prohibit, XmlResolver = null });
        return XDocument.Load(reader);
    }
    private static void Write(ZipArchive zip, string path, XDocument document)
    {
        zip.GetEntry(path)?.Delete(); using var stream = zip.CreateEntry(path, CompressionLevel.Optimal).Open(); document.Save(stream);
    }
}
