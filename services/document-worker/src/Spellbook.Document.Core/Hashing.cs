using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;

namespace Spellbook.Document.Core;

public static class Hashing
{
    public static string FileSha256(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    public static string BytesSha256(ReadOnlySpan<byte> bytes) =>
        Convert.ToHexStringLower(SHA256.HashData(bytes));

    public static string ElementSha256(XElement element) =>
        BytesSha256(Encoding.UTF8.GetBytes(element.ToString(SaveOptions.DisableFormatting)));
}
