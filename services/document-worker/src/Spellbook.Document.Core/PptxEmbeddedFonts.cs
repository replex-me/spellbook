using System.Buffers.Binary;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

public sealed record EmbeddedFontFace(string Typeface, string Style, byte[] FontData);
public sealed record ExtractedEmbeddedFontFace(string Typeface, string Style, string Path);

/// <summary>
/// Loads edit-enabled fonts that already travel inside a PPTX. The decoded
/// faces are used only from a per-render temporary directory and are never
/// copied into the stored or downloaded presentation.
/// </summary>
public sealed class PptxEmbeddedFontExtractor
{
    private static readonly XNamespace Presentation =
        "http://schemas.openxmlformats.org/presentationml/2006/main";
    private static readonly XNamespace OfficeRelationships =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace PackageRelationships =
        "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly HashSet<string> FaceNames =
        ["regular", "bold", "italic", "boldItalic"];
    private const int MaxEmbeddedFaceBytes = 32 * 1024 * 1024;

    public IReadOnlyList<EmbeddedFontFace> ReadUsableFaces(string pptxPath)
    {
        using var archive = ZipFile.OpenRead(pptxPath);
        var presentationEntry = archive.GetEntry("ppt/presentation.xml");
        var relationshipsEntry = archive.GetEntry("ppt/_rels/presentation.xml.rels");
        if (presentationEntry is null || relationshipsEntry is null)
        {
            return [];
        }

        var presentation = Load(presentationEntry);
        var requiresHangulCoverage = EastAsianFamiliesUsedForHangul(archive);
        var relationships = Load(relationshipsEntry)
            .Root?
            .Elements(PackageRelationships + "Relationship")
            .Where(element => !string.Equals(
                (string?)element.Attribute("TargetMode"),
                "External",
                StringComparison.OrdinalIgnoreCase))
            .Select(element => new
            {
                Id = (string?)element.Attribute("Id"),
                Target = (string?)element.Attribute("Target")
            })
            .Where(item => !string.IsNullOrWhiteSpace(item.Id) && IsSafeFontTarget(item.Target))
            .ToDictionary(item => item.Id!, item => $"ppt/{item.Target!.Replace('\\', '/')}", StringComparer.Ordinal)
            ?? new Dictionary<string, string>(StringComparer.Ordinal);

        var faces = new List<EmbeddedFontFace>();
        var seenRelationships = new HashSet<string>(StringComparer.Ordinal);
        foreach (var embeddedFont in presentation.Descendants(Presentation + "embeddedFont"))
        {
            var typeface = ((string?)embeddedFont.Element(Presentation + "font")?.Attribute("typeface"))?.Trim();
            if (string.IsNullOrWhiteSpace(typeface))
            {
                continue;
            }

            foreach (var face in embeddedFont.Elements().Where(element => FaceNames.Contains(element.Name.LocalName)))
            {
                var relationshipId = (string?)face.Attribute(OfficeRelationships + "id");
                if (string.IsNullOrWhiteSpace(relationshipId)
                    || !seenRelationships.Add(relationshipId)
                    || !relationships.TryGetValue(relationshipId, out var partPath))
                {
                    continue;
                }

                var entry = archive.GetEntry(partPath);
                if (entry is null || entry.Length is < 36 or > MaxEmbeddedFaceBytes)
                {
                    continue;
                }

                var eot = Read(entry);
                var font = ConvertForEditing(eot);
                if (font is not null
                    && (!requiresHangulCoverage.Contains(typeface) || SfntContainsHangul(font)))
                {
                    faces.Add(new EmbeddedFontFace(typeface, face.Name.LocalName, font));
                }
            }
        }

        return faces;
    }

    public IReadOnlyList<string> ExtractToDirectory(string pptxPath, string outputDirectory)
        => ExtractFacesToDirectory(pptxPath, outputDirectory)
            .Select(face => face.Path)
            .ToList();

    public IReadOnlyList<ExtractedEmbeddedFontFace> ExtractFacesToDirectory(
        string pptxPath,
        string outputDirectory)
    {
        var faces = ReadUsableFaces(pptxPath);
        if (faces.Count == 0)
        {
            return [];
        }

        Directory.CreateDirectory(outputDirectory);
        var extracted = new List<ExtractedEmbeddedFontFace>();
        foreach (var face in faces)
        {
            var digest = Convert.ToHexString(SHA256.HashData(face.FontData)).ToLowerInvariant();
            var extension = FontExtension(face.FontData);
            var path = Path.Combine(outputDirectory, $"{digest}-{face.Style}{extension}");
            if (!File.Exists(path))
            {
                File.WriteAllBytes(path, face.FontData);
            }
            extracted.Add(new ExtractedEmbeddedFontFace(face.Typeface, face.Style, path));
        }

        return extracted;
    }

    private static byte[]? ConvertForEditing(byte[] eot)
    {
        if (eot.Length < 36)
        {
            return null;
        }

        var totalSize = BinaryPrimitives.ReadUInt32LittleEndian(eot.AsSpan(0, 4));
        var fontDataSize = BinaryPrimitives.ReadUInt32LittleEndian(eot.AsSpan(4, 4));
        var flags = BinaryPrimitives.ReadUInt32LittleEndian(eot.AsSpan(12, 4));
        var permissions = BinaryPrimitives.ReadUInt16LittleEndian(eot.AsSpan(32, 2));
        var magic = BinaryPrimitives.ReadUInt16LittleEndian(eot.AsSpan(34, 2));
        if (magic != 0x504c
            || totalSize > eot.Length
            || fontDataSize is < 12 or > MaxEmbeddedFaceBytes
            || !AllowsEditing(permissions))
        {
            return null;
        }

        const uint compressed = 0x00000004;
        byte[]? font;
        if ((flags & compressed) == 0)
        {
            if (fontDataSize > eot.Length)
            {
                return null;
            }
            font = eot.AsSpan(eot.Length - checked((int)fontDataSize), checked((int)fontDataSize)).ToArray();
        }
        else
        {
            font = LibEot.TryConvertForEditing(eot);
        }

        return font is not null && IsSfnt(font) ? font : null;
    }

    private static bool AllowsEditing(ushort permissions)
    {
        const ushort restrictedLicense = 0x0002;
        const ushort editableEmbedding = 0x0008;
        const ushort bitmapEmbeddingOnly = 0x0200;
        return (permissions & restrictedLicense) == 0
            && (permissions & bitmapEmbeddingOnly) == 0
            && (permissions == 0 || (permissions & editableEmbedding) != 0);
    }

    private static bool IsSfnt(byte[] font) =>
        font.Length >= 12
        && (font.AsSpan(0, 4).SequenceEqual(new byte[] { 0x00, 0x01, 0x00, 0x00 })
            || font.AsSpan(0, 4).SequenceEqual("OTTO"u8)
            || font.AsSpan(0, 4).SequenceEqual("ttcf"u8)
            || font.AsSpan(0, 4).SequenceEqual("true"u8));

    private static string FontExtension(byte[] font) => font.AsSpan(0, 4) switch
    {
        var signature when signature.SequenceEqual("OTTO"u8) => ".otf",
        var signature when signature.SequenceEqual("ttcf"u8) => ".ttc",
        _ => ".ttf"
    };

    private static HashSet<string> EastAsianFamiliesUsedForHangul(ZipArchive archive)
    {
        var documents = archive.Entries
            .Where(entry => IsRelevantTextPart(entry.FullName))
            .Select(entry => (entry.FullName, Document: Load(entry)))
            .ToList();
        var families = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var hangulPlaceholderStyles = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (_, document) in documents)
        {
            foreach (var textBody in document.Descendants().Where(element => element.Name.LocalName == "txBody"))
            {
                if (!ElementContainsHangul(textBody))
                {
                    continue;
                }

                foreach (var run in textBody.Descendants().Where(element => element.Name.LocalName == "r" && ElementContainsHangul(element)))
                {
                    AddEastAsianFamilies(run.Elements().FirstOrDefault(element => element.Name.LocalName == "rPr"), families);
                }
                foreach (var paragraph in textBody.Descendants().Where(element => element.Name.LocalName == "p" && ElementContainsHangul(element)))
                {
                    AddEastAsianFamilies(paragraph.Elements().FirstOrDefault(element => element.Name.LocalName == "pPr"), families);
                }
                AddEastAsianFamilies(textBody.Elements().FirstOrDefault(element => element.Name.LocalName == "lstStyle"), families);

                var placeholder = textBody.Parent?
                    .Elements().FirstOrDefault(element => element.Name.LocalName == "nvSpPr")?
                    .Elements().FirstOrDefault(element => element.Name.LocalName == "nvPr")?
                    .Elements().FirstOrDefault(element => element.Name.LocalName == "ph");
                var placeholderType = ((string?)placeholder?.Attribute("type"))?.Trim();
                hangulPlaceholderStyles.Add(placeholderType switch
                {
                    "title" or "ctrTitle" or "subTitle" => "titleStyle",
                    "body" or "obj" => "bodyStyle",
                    _ => "otherStyle"
                });
            }
        }

        foreach (var (_, document) in documents.Where(item => item.FullName.StartsWith("ppt/slideMasters/", StringComparison.Ordinal)))
        {
            foreach (var styleName in hangulPlaceholderStyles)
            {
                AddEastAsianFamilies(
                    document.Descendants().FirstOrDefault(element => element.Name.LocalName == styleName),
                    families);
            }
        }

        return families;
    }

    private static void AddEastAsianFamilies(XElement? scope, HashSet<string> families)
    {
        if (scope is null)
        {
            return;
        }

        foreach (var typeface in scope
            .DescendantsAndSelf()
            .Where(element => element.Name.LocalName == "ea")
            .Select(element => ((string?)element.Attribute("typeface"))?.Trim())
            .Where(typeface => !string.IsNullOrWhiteSpace(typeface)))
        {
            families.Add(typeface!);
        }
    }

    private static bool ElementContainsHangul(XElement element) =>
        element
            .DescendantsAndSelf()
            .Where(descendant => descendant.Name.LocalName == "t")
            .SelectMany(descendant => descendant.Value.EnumerateRunes())
            .Any(rune => IsHangul(rune.Value));

    private static bool IsRelevantTextPart(string path) =>
        path.Equals("ppt/presentation.xml", StringComparison.Ordinal)
        || IsXmlPartUnder(path, "ppt/slides/")
        || IsXmlPartUnder(path, "ppt/slideLayouts/")
        || IsXmlPartUnder(path, "ppt/slideMasters/")
        || IsXmlPartUnder(path, "ppt/theme/");

    private static bool IsXmlPartUnder(string path, string prefix) =>
        path.StartsWith(prefix, StringComparison.Ordinal)
        && path.EndsWith(".xml", StringComparison.Ordinal)
        && !path.Contains("/_rels/", StringComparison.Ordinal);

    private static bool SfntContainsHangul(byte[] font)
    {
        if (font.AsSpan(0, 4).SequenceEqual("ttcf"u8))
        {
            if (!TryReadUInt32(font, 8, out var fontCount) || fontCount > 64)
            {
                return false;
            }

            for (var index = 0u; index < fontCount; index++)
            {
                if (TryReadUInt32(font, 12 + checked((int)index * 4), out var offset)
                    && offset <= int.MaxValue
                    && SfntAtOffsetContainsHangul(font, (int)offset))
                {
                    return true;
                }
            }

            return false;
        }

        return SfntAtOffsetContainsHangul(font, 0);
    }

    private static bool SfntAtOffsetContainsHangul(byte[] font, int sfntOffset)
    {
        if (!TryReadUInt16(font, sfntOffset + 4, out var tableCount) || tableCount > 256)
        {
            return false;
        }

        for (var index = 0; index < tableCount; index++)
        {
            var recordOffset = sfntOffset + 12 + index * 16;
            if (!HasRange(font, recordOffset, 16)
                || !font.AsSpan(recordOffset, 4).SequenceEqual("cmap"u8)
                || !TryReadUInt32(font, recordOffset + 8, out var relativeOffset))
            {
                continue;
            }

            if (relativeOffset > int.MaxValue - sfntOffset)
            {
                return false;
            }
            var cmapOffset = sfntOffset + (int)relativeOffset;
            if (!TryReadUInt16(font, cmapOffset + 2, out var encodingCount) || encodingCount > 256)
            {
                return false;
            }

            for (var encoding = 0; encoding < encodingCount; encoding++)
            {
                var encodingOffset = cmapOffset + 4 + encoding * 8;
                if (TryReadUInt32(font, encodingOffset + 4, out var subtableOffset)
                    && subtableOffset <= int.MaxValue - cmapOffset
                    && CmapSubtableContainsHangul(font, cmapOffset + (int)subtableOffset))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool CmapSubtableContainsHangul(byte[] font, int offset)
    {
        if (!TryReadUInt16(font, offset, out var format))
        {
            return false;
        }

        if (format == 4)
        {
            if (!TryReadUInt16(font, offset + 6, out var segmentCountX2) || segmentCountX2 % 2 != 0)
            {
                return false;
            }

            var segmentCount = segmentCountX2 / 2;
            var endCodesOffset = offset + 14;
            var startCodesOffset = endCodesOffset + segmentCount * 2 + 2;
            for (var index = 0; index < segmentCount; index++)
            {
                if (TryReadUInt16(font, endCodesOffset + index * 2, out var end)
                    && TryReadUInt16(font, startCodesOffset + index * 2, out var start)
                    && RangeContainsHangul(start, end))
                {
                    return true;
                }
            }

            return false;
        }

        if (format is not (12 or 13)
            || !TryReadUInt32(font, offset + 12, out var groupCount)
            || groupCount > 1_000_000)
        {
            return false;
        }

        for (var index = 0u; index < groupCount; index++)
        {
            var groupOffset = offset + 16 + checked((int)index * 12);
            if (TryReadUInt32(font, groupOffset, out var start)
                && TryReadUInt32(font, groupOffset + 4, out var end)
                && RangeContainsHangul(start, end))
            {
                return true;
            }
        }

        return false;
    }

    private static bool RangeContainsHangul(uint start, uint end) =>
        start <= end
        && (RangesOverlap(start, end, 0x1100, 0x11ff)
            || RangesOverlap(start, end, 0x3130, 0x318f)
            || RangesOverlap(start, end, 0xa960, 0xa97f)
            || RangesOverlap(start, end, 0xac00, 0xd7af)
            || RangesOverlap(start, end, 0xd7b0, 0xd7ff));

    private static bool RangesOverlap(uint start, uint end, uint rangeStart, uint rangeEnd) =>
        start <= rangeEnd && end >= rangeStart;

    private static bool IsHangul(int value) =>
        value is >= 0x1100 and <= 0x11ff
        || value is >= 0x3130 and <= 0x318f
        || value is >= 0xa960 and <= 0xa97f
        || value is >= 0xac00 and <= 0xd7af
        || value is >= 0xd7b0 and <= 0xd7ff;

    private static bool TryReadUInt16(byte[] data, int offset, out ushort value)
    {
        value = 0;
        if (!HasRange(data, offset, sizeof(ushort)))
        {
            return false;
        }
        value = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(offset, sizeof(ushort)));
        return true;
    }

    private static bool TryReadUInt32(byte[] data, int offset, out uint value)
    {
        value = 0;
        if (!HasRange(data, offset, sizeof(uint)))
        {
            return false;
        }
        value = BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(offset, sizeof(uint)));
        return true;
    }

    private static bool HasRange(byte[] data, int offset, int length) =>
        offset >= 0 && length >= 0 && offset <= data.Length - length;

    private static bool IsSafeFontTarget(string? target)
    {
        if (string.IsNullOrWhiteSpace(target))
        {
            return false;
        }

        var normalized = target.Replace('\\', '/');
        return normalized.StartsWith("fonts/", StringComparison.Ordinal)
            && normalized.EndsWith(".fntdata", StringComparison.OrdinalIgnoreCase)
            && !normalized.Contains("..", StringComparison.Ordinal)
            && !normalized.StartsWith("/", StringComparison.Ordinal);
    }

    private static XDocument Load(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        return XDocument.Load(stream, LoadOptions.PreserveWhitespace);
    }

    private static byte[] Read(ZipArchiveEntry entry)
    {
        using var source = entry.Open();
        using var destination = new MemoryStream(checked((int)entry.Length));
        source.CopyTo(destination);
        return destination.ToArray();
    }

    private static class LibEot
    {
        private const int MetadataBufferSize = 512;

        public static byte[]? TryConvertForEditing(byte[] eot)
        {
            var metadata = Marshal.AllocHGlobal(MetadataBufferSize);
            Marshal.Copy(new byte[MetadataBufferSize], 0, metadata, MetadataBufferSize);
            var output = IntPtr.Zero;
            var metadataInitialized = false;
            try
            {
                uint outputSize;
                int error;
                try
                {
                    error = EotToTtfBuffer(eot, checked((uint)eot.Length), metadata, out output, out outputSize);
                }
                catch (Exception exception) when (exception is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
                {
                    return null;
                }

                metadataInitialized = error == 0;
                if (error != 0
                    || output == IntPtr.Zero
                    || outputSize is < 12 or > MaxEmbeddedFaceBytes
                    || !EotCanLegallyEdit(metadata))
                {
                    return null;
                }

                var font = new byte[checked((int)outputSize)];
                Marshal.Copy(output, font, 0, font.Length);
                return font;
            }
            finally
            {
                if (output != IntPtr.Zero)
                {
                    EotFreeBuffer(output);
                }
                if (metadataInitialized)
                {
                    EotFreeMetadata(metadata);
                }
                Marshal.FreeHGlobal(metadata);
            }
        }

        [DllImport("libeot.so.0", EntryPoint = "EOT2ttf_buffer", CallingConvention = CallingConvention.Cdecl)]
        private static extern int EotToTtfBuffer(
            byte[] font,
            uint fontSize,
            IntPtr metadataOut,
            out IntPtr fontOut,
            out uint fontSizeOut);

        [DllImport("libeot.so.0", EntryPoint = "EOTcanLegallyEdit", CallingConvention = CallingConvention.Cdecl)]
        [return: MarshalAs(UnmanagedType.I1)]
        private static extern bool EotCanLegallyEdit(IntPtr metadata);

        [DllImport("libeot.so.0", EntryPoint = "EOTfreeBuffer", CallingConvention = CallingConvention.Cdecl)]
        private static extern void EotFreeBuffer(IntPtr buffer);

        [DllImport("libeot.so.0", EntryPoint = "EOTfreeMetadata", CallingConvention = CallingConvention.Cdecl)]
        private static extern void EotFreeMetadata(IntPtr metadata);
    }
}
