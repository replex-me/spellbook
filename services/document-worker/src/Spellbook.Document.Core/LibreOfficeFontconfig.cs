using System.Xml.Linq;

namespace Spellbook.Document.Core;

/// <summary>
/// Creates a render-scoped fontconfig which adds fonts extracted from the
/// current PPTX without installing or retaining them on the worker.
/// </summary>
public sealed class LibreOfficeFontconfig
{
    private readonly string systemConfigPath;

    public LibreOfficeFontconfig(string? systemConfigPath = null)
    {
        this.systemConfigPath = systemConfigPath
            ?? Environment.GetEnvironmentVariable("SPELLBOOK_FONTCONFIG_SYSTEM_FILE")
            ?? "/etc/fonts/fonts.conf";
    }

    public string Create(string workDirectory, string fontDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(fontDirectory);

        var absoluteFontDirectory = Path.GetFullPath(fontDirectory);
        if (!Directory.Exists(absoluteFontDirectory))
        {
            throw new DirectoryNotFoundException(
                $"Render-scoped font directory does not exist: {absoluteFontDirectory}");
        }

        Directory.CreateDirectory(workDirectory);
        var path = Path.Combine(workDirectory, "fontconfig-render.conf");
        var document = new XDocument(
            new XDeclaration("1.0", null, null),
            new XDocumentType("fontconfig", null, "urn:fontconfig:fonts.dtd", null),
            new XElement(
                "fontconfig",
                new XElement(
                    "include",
                    new XAttribute("ignore_missing", "no"),
                    Path.GetFullPath(systemConfigPath)),
                new XElement("dir", absoluteFontDirectory)));
        document.Save(path);
        return path;
    }
}
