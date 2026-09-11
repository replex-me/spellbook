using System.IO.Compression;
using System.Text.Json;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

public sealed partial class PptxPatcher
{
    private static uint? ApplyImage(ZipArchive zip, XDocument document, SlideGraph slide, JsonElement command,
        IReadOnlyDictionary<string, byte[]>? assets, HashSet<string> allowed)
    {
        var assetId = RequiredString(command, "assetId");
        if (assets is null || !assets.TryGetValue(assetId, out var bytes) || bytes.Length is < 8 or > 5_000_000)
            throw new InvalidDataException("Missing authorized image asset.");
        var extension = bytes.AsSpan(0, 8).SequenceEqual(new byte[] {137,80,78,71,13,10,26,10}) ? "png" : bytes[0] == 255 && bytes[1] == 216 ? "jpeg" : throw new InvalidDataException("Only PNG and JPEG assets are supported.");
        var media = $"ppt/media/spellbook-{Guid.NewGuid():N}.{extension}";
        using (var output = zip.CreateEntry(media).Open()) output.Write(bytes);
        allowed.Add(media);
        var types = LoadXml(zip.GetEntry("[Content_Types].xml")!);
        var ct = types.Root!.Name.Namespace;
        types.Root.Add(new XElement(ct + "Override", new XAttribute("PartName", "/" + media), new XAttribute("ContentType", $"image/{extension}")));
        ReplaceEntry(zip, "[Content_Types].xml", types); allowed.Add("[Content_Types].xml");
        var part = slide.PartUri.TrimStart('/');
        var relPath = part[..(part.LastIndexOf('/') + 1)] + "_rels/" + part[(part.LastIndexOf('/') + 1)..] + ".rels";
        XNamespace rel = "http://schemas.openxmlformats.org/package/2006/relationships";
        XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        var rels = zip.GetEntry(relPath) is { } entry ? LoadXml(entry) : new XDocument(new XElement(rel + "Relationships"));
        var rid = "rIdSpellbook" + Guid.NewGuid().ToString("N");
        rels.Root!.Add(new XElement(rel + "Relationship", new XAttribute("Id", rid), new XAttribute("Type", r.NamespaceName + "/image"),
            new XAttribute("Target", new Uri("https://package.invalid/" + part).MakeRelativeUri(new Uri("https://package.invalid/" + media)).ToString())));
        ReplaceEntry(zip, relPath, rels); allowed.Add(relPath);
        if (RequiredString(command, "op") == "replace_image")
        {
            var shape = ResolveTarget(document, slide, command.GetProperty("target"));
            if (shape.Name != Presentation + "pic") throw new InvalidDataException("Image replacement requires a picture.");
            var blip = shape.Element(Presentation + "blipFill")?.Element(Drawing + "blip") ?? throw new InvalidDataException("Picture data is missing.");
            blip.SetAttributeValue(r + "embed", rid); blip.Attribute(r + "link")?.Remove();
            // Remove alternate SVG references so PowerPoint and LibreOffice both
            // display the newly selected image rather than the previous fallback.
            blip.Elements(Drawing + "extLst").Remove();
            return null;
        }
        var id = NextId(document);
        var picture = new XElement(Presentation + "pic",
            new XElement(Presentation + "nvPicPr", new XElement(Presentation + "cNvPr", new XAttribute("id", id), new XAttribute("name", $"Image {id}")),
                new XElement(Presentation + "cNvPicPr", new XElement(Drawing + "picLocks", new XAttribute("noChangeAspect", "1"))), new XElement(Presentation + "nvPr")),
            new XElement(Presentation + "blipFill", new XElement(Drawing + "blip", new XAttribute(r + "embed", rid)), new XElement(Drawing + "stretch", new XElement(Drawing + "fillRect"))),
            new XElement(Presentation + "spPr", Box(command), new XElement(Drawing + "prstGeom", new XAttribute("prst", "rect"), new XElement(Drawing + "avLst"))));
        var tree = Tree(document); var ext = tree.Element(Presentation + "extLst"); if (ext is null) tree.Add(picture); else ext.AddBeforeSelf(picture);
        return id;
    }

    private static void CropImage(XElement shape, JsonElement command)
    {
        var fill = shape.Element(Presentation + "blipFill") ?? throw new InvalidDataException("Cropping requires a picture.");
        var values = new[] { "left", "top", "right", "bottom" }.Select(key => command.GetProperty(key).GetDouble()).ToArray();
        if (values.Any(v => !double.IsFinite(v) || v is < 0 or >= 1) || values[0] + values[2] >= 1 || values[1] + values[3] >= 1)
            throw new InvalidDataException("Crop fractions must leave a nonempty visible image.");
        var rect = new XElement(Drawing + "srcRect", new[] { "l", "t", "r", "b" }.Select((key, i) => new XAttribute(key, (int)Math.Round(values[i] * 100000))));
        var existing = fill.Element(Drawing + "srcRect"); if (existing is null) InsertBefore(fill, rect, "tile", "stretch"); else existing.ReplaceWith(rect);
    }
}
