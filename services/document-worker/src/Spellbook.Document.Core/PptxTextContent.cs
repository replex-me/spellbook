using System.Xml.Linq;

namespace Spellbook.Document.Core;

/// <summary>Logical text and local replacements share the same paragraph/run boundaries.</summary>
public static class PptxTextContent
{
    private static readonly XNamespace Drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private const string StrictDrawing = "http://purl.oclc.org/ooxml/drawingml/main";

    private static XNamespace TextNamespace(XElement shape) => shape.DescendantsAndSelf()
        .FirstOrDefault(x => x.Name.LocalName == "p"
            && (x.Name.Namespace == Drawing || x.Name.NamespaceName == StrictDrawing))?.Name.Namespace ?? Drawing;

    public static string Read(XElement shape) => string.Join("\n",
        shape.Descendants(TextNamespace(shape) + "p").Select(ParagraphText));

    private static string ParagraphText(XElement paragraph) => string.Concat(
        paragraph.Elements().Select(element => element.Name == paragraph.Name.Namespace + "br"
            ? "\v"
            : element.Element(paragraph.Name.Namespace + "t")?.Value ?? ""));

    public static void Replace(XElement shape, string value)
    {
        value = value.Replace("\r\n", "\n", StringComparison.Ordinal);
        if (Read(shape) == value) return;
        var candidate = new XElement(shape);
        ReplaceCore(candidate, value);
        // Stage the complete edit before touching the caller's tree.
        shape.ReplaceNodes(candidate.Nodes());
    }

    private static void ReplaceCore(XElement shape, string value)
    {
        var drawing = TextNamespace(shape);
        var paragraphs = shape.Descendants(drawing + "p").ToArray();
        var replacement = value.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n');
        if (paragraphs.Length == 0)
            throw new InvalidDataException("The selected shape has no editable paragraphs.");
        if (replacement.Length != paragraphs.Length)
        {
            ReplaceParagraphStructure(paragraphs, replacement);
            return;
        }

        // Validate every paragraph before changing any of them.
        var edits = new List<(XElement Text, string Value)>();
        for (var index = 0; index < paragraphs.Length; index++)
        {
            var paragraph = paragraphs[index];
            var original = ParagraphText(paragraph);
            var updated = replacement[index];
            if (original == updated) continue;
            if (paragraph.Elements(drawing + "fld").Any())
                throw new InvalidDataException("Replacing dynamic fields as plain text is not supported.");
            var originalSegments = original.Split('\v');
            var updatedSegments = updated.Split('\v');
            if (originalSegments.Length != updatedSegments.Length)
            {
                paragraph.ReplaceWith(BuildParagraph(paragraph, updated));
                continue;
            }
            if (!paragraph.Descendants(drawing + "t").Any())
            {
                paragraph.ReplaceWith(BuildParagraph(paragraph, updated));
                continue;
            }

            var segment = new List<XElement>();
            var segmentIndex = 0;
            foreach (var child in paragraph.Elements().ToArray())
            {
                if (child.Name == drawing + "br")
                {
                    PlanSegment(segment, originalSegments[segmentIndex], updatedSegments[segmentIndex], edits, paragraph, child);
                    segment.Clear();
                    segmentIndex++;
                }
                else if (child.Element(drawing + "t") is { } text)
                    segment.Add(text);
            }
            PlanSegment(segment, originalSegments[segmentIndex], updatedSegments[segmentIndex], edits, paragraph, null);
        }
        foreach (var edit in edits) edit.Text.Value = edit.Value;
    }

    private static void ReplaceParagraphStructure(XElement[] paragraphs, string[] replacement)
    {
        var prefix = 0;
        while (prefix < paragraphs.Length && prefix < replacement.Length
            && ParagraphText(paragraphs[prefix]) == replacement[prefix]) prefix++;
        var suffix = 0;
        while (suffix < paragraphs.Length - prefix && suffix < replacement.Length - prefix
            && ParagraphText(paragraphs[^(suffix + 1)]) == replacement[^(suffix + 1)]) suffix++;
        var removed = paragraphs.Skip(prefix).Take(paragraphs.Length - prefix - suffix).ToArray();
        if (removed.Any(p => p.Descendants(p.Name.Namespace + "fld").Any()))
            throw new InvalidDataException("Replacing dynamic fields as plain text is not supported.");
        var template = paragraphs[Math.Min(prefix, paragraphs.Length - 1)];
        var added = replacement.Skip(prefix).Take(replacement.Length - prefix - suffix)
            .Select(text => BuildParagraph(template, text)).ToArray();
        if (prefix < paragraphs.Length) paragraphs[prefix].AddBeforeSelf(added);
        else paragraphs[^1].AddAfterSelf(added);
        foreach (var paragraph in removed) paragraph.Remove();
    }

    private static XElement BuildParagraph(XElement template, string text)
    {
        var drawing = template.Name.Namespace;
        var paragraph = new XElement(template);
        var properties = template.Elements(drawing + "r").FirstOrDefault()?.Element(drawing + "rPr");
        paragraph.Elements().Where(x => x.Name == drawing + "r" || x.Name == drawing + "br" || x.Name == drawing + "fld").Remove();
        var content = new List<XElement>();
        foreach (var segment in text.Split('\v'))
        {
            if (content.Count > 0) content.Add(new XElement(drawing + "br"));
            content.Add(new XElement(drawing + "r", properties is null ? null : new XElement(properties),
                new XElement(drawing + "t", segment)));
        }
        var end = paragraph.Element(drawing + "endParaRPr");
        if (end is not null) end.AddBeforeSelf(content);
        else paragraph.Add(content);
        return paragraph;
    }

    private static void PlanSegment(List<XElement> runs, string original, string updated,
        List<(XElement Text, string Value)> edits, XElement paragraph, XElement? nextBreak)
    {
        if (original == updated) return;
        if (runs.Count == 0)
        {
            var drawing = paragraph.Name.Namespace;
            var properties = paragraph.Elements(drawing + "r").FirstOrDefault()?.Element(drawing + "rPr");
            var text = new XElement(drawing + "t", "");
            var run = new XElement(drawing + "r", properties is null ? null : new XElement(properties), text);
            var anchor = nextBreak ?? paragraph.Element(drawing + "endParaRPr");
            if (anchor is not null) anchor.AddBeforeSelf(run);
            else paragraph.Add(run);
            runs.Add(text);
        }

        var prefix = 0;
        while (prefix < original.Length && prefix < updated.Length && original[prefix] == updated[prefix]) prefix++;
        // Do not divide a UTF-16 surrogate pair at a replacement boundary.
        if (prefix > 0 && prefix < original.Length && char.IsLowSurrogate(original[prefix])) prefix--;
        var suffix = 0;
        while (suffix < original.Length - prefix && suffix < updated.Length - prefix
            && original[^(suffix + 1)] == updated[^(suffix + 1)]) suffix++;
        if (suffix > 0 && char.IsLowSurrogate(original[original.Length - suffix])) suffix--;

        var end = original.Length - suffix;
        var inserted = updated.Substring(prefix, updated.Length - prefix - suffix);
        var offset = 0;
        var insertedOnce = false;
        foreach (var run in runs)
        {
            var text = run.Value;
            var runEnd = offset + text.Length;
            var before = text[..Math.Clamp(prefix - offset, 0, text.Length)];
            var after = text[Math.Clamp(end - offset, 0, text.Length)..];
            var anchor = !insertedOnce && (prefix < runEnd || ReferenceEquals(run, runs[^1]));
            var result = before + (anchor ? inserted : "") + after;
            if (anchor) insertedOnce = true;
            if (result != text) edits.Add((run, result));
            offset = runEnd;
        }
    }
}
