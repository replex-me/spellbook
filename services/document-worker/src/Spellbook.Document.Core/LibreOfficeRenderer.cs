using System.Diagnostics;
using System.Text.Json;

namespace Spellbook.Document.Core;

public sealed class LibreOfficeRenderer : IPresentationRenderer
{
    private const int RasterDotsPerInch = 144;
    private const int MaxRenderAttempts = 2;

    public string Name => "LibreOffice";

    public string Version => Environment.GetEnvironmentVariable("SPELLBOOK_RENDERER_VERSION") ?? "unversioned";

    public async Task<IReadOnlyList<string>> RenderAsync(string pptxPath, string outputDirectory, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(outputDirectory);
        var rasterSize = PptxRasterSize.Read(pptxPath, RasterDotsPerInch);
        var workDirectory = Path.Combine(Path.GetTempPath(), $"spellbook-render-{Guid.NewGuid():N}");
        Directory.CreateDirectory(workDirectory);
        try
        {
            var renderInputPath = Path.Combine(workDirectory, Path.GetFileName(pptxPath));
            new LibreOfficeRenderInput().Create(pptxPath, renderInputPath);
            var embeddedFontDirectory = Path.Combine(workDirectory, ".fonts");
            var embeddedFonts = new PptxEmbeddedFontExtractor()
                .ExtractFacesToDirectory(renderInputPath, embeddedFontDirectory);
            IReadOnlyDictionary<string, string>? renderEnvironment = null;
            if (embeddedFonts.Count > 0)
            {
                var fontconfigPath = new LibreOfficeFontconfig()
                    .Create(workDirectory, embeddedFontDirectory);
                var embeddedFontIndexPath = Path.Combine(
                    workDirectory,
                    "embedded-fonts.tsv");
                File.WriteAllLines(
                    embeddedFontIndexPath,
                    embeddedFonts.Select(face => string.Join(
                        '\t',
                        Uri.EscapeDataString(face.Typeface),
                        face.Style,
                        face.Path)));
                renderEnvironment = new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["FONTCONFIG_FILE"] = fontconfigPath,
                    ["SPELLBOOK_EMBEDDED_FONT_INDEX"] = embeddedFontIndexPath
                };
                await RunAsync(
                    Environment.GetEnvironmentVariable("FCCACHE_PATH") ?? "fc-cache",
                    ["--force", embeddedFontDirectory],
                    workDirectory,
                    cancellationToken,
                    renderEnvironment);
            }
            var soffice = Environment.GetEnvironmentVariable("SOFFICE_PATH") ?? "soffice";
            var diagnosticsPath = Path.Combine(outputDirectory, "render-diagnostics.jsonl");
            if (File.Exists(diagnosticsPath))
            {
                File.Delete(diagnosticsPath);
            }
            var pdfPath = string.Empty;
            for (var pass = 0; pass < MaxRenderAttempts; pass++)
            {
                try
                {
                    pdfPath = await ConvertToPdfAsync(
                        soffice,
                        renderInputPath,
                        workDirectory,
                        pass,
                        cancellationToken,
                        renderEnvironment,
                        diagnosticsPath);
                    break;
                }
                catch (InvalidOperationException exception)
                    when (pass + 1 < MaxRenderAttempts && IsRetryableLibreOfficeFailure(exception.Message))
                {
                    await File.AppendAllTextAsync(
                        diagnosticsPath,
                        $"{JsonSerializer.Serialize(new { kind = "render-retry", attempt = pass + 1, reason = "libreoffice-process-terminated" })}\n",
                        cancellationToken);
                }
            }

            if (string.IsNullOrEmpty(pdfPath))
            {
                throw new InvalidOperationException("LibreOffice did not create a PDF.");
            }

            // Diagnostics only: keep the intermediate PDF so text geometry can be
            // compared against a PowerPoint export of the same deck.
            if (string.Equals(
                Environment.GetEnvironmentVariable("SPELLBOOK_KEEP_RENDER_PDF"),
                "1",
                StringComparison.Ordinal))
            {
                File.Copy(pdfPath, Path.Combine(outputDirectory, "render.pdf"), overwrite: true);
            }

            var prefix = Path.Combine(outputDirectory, "slide");
            await RunAsync(
                Environment.GetEnvironmentVariable("PDFTOPPM_PATH") ?? "pdftoppm",
                [
                    "-png",
                    "-scale-to-x", rasterSize.Width.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    "-scale-to-y", rasterSize.Height.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    pdfPath,
                    prefix
                ],
                workDirectory,
                cancellationToken);
            var images = Directory.GetFiles(outputDirectory, "slide-*.png")
                .OrderBy(path => SlideNumber(path))
                .ToList();
            if (images.Count == 0 || !images.Select(SlideNumber).SequenceEqual(Enumerable.Range(1, images.Count)))
            {
                throw new InvalidOperationException("PDF renderer did not create slide images.");
            }
            return images;
        }
        finally
        {
            Directory.Delete(workDirectory, true);
        }
    }

    private static async Task<string> ConvertToPdfAsync(
        string soffice,
        string renderInputPath,
        string workDirectory,
        int pass,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, string>? environment,
        string diagnosticsPath)
    {
        var profileDirectory = Path.Combine(workDirectory, $"lo-profile-{pass}");
        Directory.CreateDirectory(profileDirectory);
        var processDirectory = Path.Combine(workDirectory, $"process-{pass}");
        Directory.CreateDirectory(processDirectory);
        var pdfDirectory = Path.Combine(workDirectory, $"pdf-{pass}");
        Directory.CreateDirectory(pdfDirectory);
        var pdfPath = Path.Combine(
            pdfDirectory,
            $"{Path.GetFileNameWithoutExtension(renderInputPath)}.pdf");
        if (string.Equals(
            Environment.GetEnvironmentVariable("SPELLBOOK_DISABLE_CJK_SCRIPT_SPACING"),
            "1",
            StringComparison.Ordinal))
        {
            await File.AppendAllTextAsync(
                diagnosticsPath,
                $"{{\"kind\":\"pdf-pass\",\"pass\":{pass}}}\n",
                cancellationToken);
            await RunAsync(
                Environment.GetEnvironmentVariable("LIBREOFFICE_PYTHON_PATH")
                    ?? "/opt/libreoffice26.8/program/python",
                [
                    Environment.GetEnvironmentVariable("SPELLBOOK_LIBREOFFICE_RENDER_SCRIPT")
                        ?? "/app/render_with_libreoffice.py",
                    renderInputPath,
                    pdfPath
                ],
                processDirectory,
                cancellationToken,
                environment,
                diagnosticsPath);
        }
        else
        {
            await RunAsync(
                soffice,
                ["--headless", "--nologo", "--nodefault", "--nolockcheck", $"-env:UserInstallation=file://{profileDirectory}", "--convert-to", "pdf", "--outdir", pdfDirectory, renderInputPath],
                processDirectory,
                cancellationToken,
                environment);
        }

        if (!File.Exists(pdfPath))
        {
            throw new InvalidOperationException("LibreOffice did not create a PDF.");
        }
        return pdfPath;
    }

    private static int SlideNumber(string path)
    {
        var stem = Path.GetFileNameWithoutExtension(path);
        return int.TryParse(stem.Split('-').LastOrDefault(), out var value) ? value : int.MaxValue;
    }

    internal static bool IsRetryableLibreOfficeFailure(string message) =>
        message.Contains("Binary URP bridge already disposed", StringComparison.OrdinalIgnoreCase)
        || message.Contains("couldn't connect to pipe", StringComparison.OrdinalIgnoreCase)
        || message.Contains("free(): invalid pointer", StringComparison.OrdinalIgnoreCase)
        || message.Contains("Unspecified Application Error", StringComparison.OrdinalIgnoreCase)
        || message.Contains("segmentation fault", StringComparison.OrdinalIgnoreCase);

    private static async Task RunAsync(
        string executable,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, string>? environment = null,
        string? standardOutputLogPath = null)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = workingDirectory,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false
            }
        };
        foreach (var argument in arguments)
        {
            process.StartInfo.ArgumentList.Add(argument);
        }
        var cacheDirectory = Path.Combine(workingDirectory, ".cache");
        var configDirectory = Path.Combine(workingDirectory, ".config");
        Directory.CreateDirectory(cacheDirectory);
        Directory.CreateDirectory(configDirectory);
        process.StartInfo.Environment["XDG_CACHE_HOME"] = cacheDirectory;
        process.StartInfo.Environment["XDG_CONFIG_HOME"] = configDirectory;
        if (environment is not null)
        {
            foreach (var (name, value) in environment)
            {
                process.StartInfo.Environment[name] = value;
            }
        }
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Disposing Process does not stop LibreOffice or its children.
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            await Task.WhenAll(stdout, stderr);
            throw;
        }
        var output = await stdout;
        var error = await stderr;
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{executable} exited with {process.ExitCode}. {output} {error}".Trim());
        }
        if (standardOutputLogPath is not null && !string.IsNullOrWhiteSpace(output))
        {
            await File.AppendAllTextAsync(
                standardOutputLogPath,
                output.EndsWith('\n') ? output : $"{output}\n",
                cancellationToken);
        }
    }
}
