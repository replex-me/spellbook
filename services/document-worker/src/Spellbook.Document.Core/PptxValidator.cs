using System.IO.Compression;
using System.Xml.Linq;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

namespace Spellbook.Document.Core;

public sealed class PptxValidator
{
    public ValidationReport Validate(string basePath, string candidatePath, IReadOnlySet<string> allowedChangedParts,
        IReadOnlyDictionary<string, IReadOnlySet<uint>>? allowedShapeIds = null,
        IReadOnlySet<string>? structuralSlides = null, IReadOnlySet<string>? backgroundSlides = null,
        IReadOnlySet<string>? nonSlideParts = null)
    {
        var errors = new List<string>();
        var warnings = new List<string>();
        var baseHashes = EntryHashes(basePath);
        var candidateHashes = EntryHashes(candidatePath);
        var changed = baseHashes.Keys.Union(candidateHashes.Keys, StringComparer.Ordinal)
            .Where(path => !baseHashes.TryGetValue(path, out var before) ||
                           !candidateHashes.TryGetValue(path, out var after) ||
                           !string.Equals(before, after, StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToList();

        foreach (var part in changed.Where(part => !allowedChangedParts.Contains(part)))
        {
            errors.Add($"Unexpected package part changed: {part}");
        }
        if (allowedShapeIds is not null)
        {
            using var before = ZipFile.OpenRead(basePath);
            using var after = ZipFile.OpenRead(candidatePath);
            foreach (var part in changed.Where(allowedChangedParts.Contains))
            {
                if (nonSlideParts?.Contains(part) == true) continue;
                if (!allowedShapeIds.TryGetValue(part, out var ids) ||
                    !PreservesNonTargets(before.GetEntry(part), after.GetEntry(part), ids,
                        structuralSlides?.Contains(part) == true, backgroundSlides?.Contains(part) == true))
                    errors.Add($"Non-target slide content changed: {part}");
            }
        }

        var baseValidation = TryOpenXmlErrors(basePath);
        var candidateValidation = TryOpenXmlErrors(candidatePath);
        foreach (var newError in candidateValidation.Errors.Except(baseValidation.Errors, StringComparer.Ordinal))
        {
            errors.Add($"Open XML validation: {newError}");
        }
        if (baseValidation.Failure is null && candidateValidation.Failure is not null)
        {
            errors.Add($"Open XML validation could not read the candidate package: {candidateValidation.Failure}");
        }
        else if (baseValidation.Failure is not null)
        {
            warnings.Add($"The source package could not be fully checked by the Open XML SDK ({baseValidation.Failure}); minimal changed-part and safety checks remain active.");
        }
        if (baseValidation.Errors.Count > 0)
        {
            warnings.Add($"The source document already had {baseValidation.Errors.Count} Open XML validation issue(s); no new issue is allowed.");
        }

        var candidateScan = new PptxSafetyScanner().Scan(candidatePath);
        if (candidateScan.HasExternalRelationships)
        {
            warnings.Add("The candidate retains external relationships from the source document.");
        }

        return new ValidationReport(
            ContractVersions.Current,
            errors.Count == 0,
            Hashing.FileSha256(basePath),
            candidateScan.DocumentSha256,
            changed,
            errors,
            warnings);
    }

    private static bool PreservesNonTargets(ZipArchiveEntry? before, ZipArchiveEntry? after, IReadOnlySet<uint> ids,
        bool allowTopology, bool allowBackground)
    {
        if (before is null || after is null) return false;
        using var beforeStream = before.Open();
        using var afterStream = after.Open();
        var original = XDocument.Load(beforeStream);
        var candidate = XDocument.Load(afterStream);
        // Replace only authorized top-level shapes with identity markers. Comparing
        // the remainder also protects z-order, backgrounds and slide metadata.
        foreach (var document in new[] { original, candidate })
        {
            var tree = document.Root?.Elements().FirstOrDefault(e => e.Name.LocalName == "cSld")?
                .Elements().FirstOrDefault(e => e.Name.LocalName == "spTree");
            if (tree is null) return false;
            if (allowBackground) tree.Parent?.Elements().Where(e => e.Name.LocalName == "bg").Remove();
            foreach (var id in ids)
            {
                var shapes = tree.Elements().Where(shape => shape.Elements()
                    .SelectMany(nv => nv.Elements())
                    .Any(nv => nv.Name.LocalName == "cNvPr" && (string?)nv.Attribute("id") == id.ToString(System.Globalization.CultureInfo.InvariantCulture)))
                    .ToList();
                if (allowTopology)
                {
                    if (shapes.Count > 1) return false;
                    shapes.Remove();
                }
                else
                {
                    if (shapes.Count != 1) return false;
                    shapes[0].ReplaceWith(new XElement("authorized-shape", new XAttribute("id", id)));
                }
            }
        }
        return XNode.DeepEquals(original.Root, candidate.Root);
    }

    private static Dictionary<string, string> EntryHashes(string path)
    {
        using var archive = ZipFile.OpenRead(path);
        var hashes = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name)))
        {
            using var stream = entry.Open();
            hashes[entry.FullName] = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(stream));
        }
        return hashes;
    }

    private static ValidationAttempt TryOpenXmlErrors(string path)
    {
        try
        {
            using var document = PresentationDocument.Open(path, false);
            var validator = new OpenXmlValidator();
            var issues = validator.Validate(document)
                    .Select(error => $"{error.Part?.Uri}:{error.Path?.XPath}:{error.Description}")
                    .ToHashSet(StringComparer.Ordinal);
            foreach (var part in document.PresentationPart?.SlideParts ?? [])
            {
                var index = 0;
                foreach (var data in part.Slide?.Descendants<DocumentFormat.OpenXml.Drawing.GraphicData>() ?? [])
                {
                    if (data.Elements<DocumentFormat.OpenXml.Drawing.Table>().Any() && data.Uri?.Value != DrawingMlGraphicTypes.Table)
                        issues.Add($"{part.Uri}:graphicData[{index}]:table payload requires the standard table graphic-data URI.");
                    index++;
                }
            }
            return new ValidationAttempt(issues, null);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or
            InvalidOperationException or
            IOException or
            ArgumentException or
            DocumentFormat.OpenXml.Packaging.OpenXmlPackageException)
        {
            return new ValidationAttempt([], exception.GetType().Name);
        }
    }

    private sealed record ValidationAttempt(
        HashSet<string> Errors,
        string? Failure);
}
