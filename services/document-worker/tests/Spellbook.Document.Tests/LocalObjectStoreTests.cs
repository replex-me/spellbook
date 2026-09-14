namespace Spellbook.Document.Tests;

using Xunit;

public sealed class LocalObjectStoreTests
{
    [Fact]
    public void ReserveConfigurationIsBounded()
    {
        Assert.Equal(LocalObjectStore.DefaultReserveBytes, LocalObjectStore.ParseReserveBytes(null));
        Assert.Equal(LocalObjectStore.MinimumReserveBytes, LocalObjectStore.ParseReserveBytes(LocalObjectStore.MinimumReserveBytes.ToString()));
        Assert.Throws<InvalidDataException>(() => LocalObjectStore.ParseReserveBytes("0"));
        Assert.Throws<InvalidDataException>(() => LocalObjectStore.ParseReserveBytes("1.5"));
        Assert.Throws<InvalidDataException>(() => LocalObjectStore.ParseReserveBytes((LocalObjectStore.MaximumReserveBytes + 1).ToString()));
    }

    [Fact]
    public async Task RejectsWriteBeforeConsumingReserveAndLeavesNoPartialObject()
    {
        var root = Path.Combine(Path.GetTempPath(), $"spellbook-storage-{Guid.NewGuid():N}");
        var source = Path.Combine(Path.GetTempPath(), $"spellbook-source-{Guid.NewGuid():N}.bin");
        try
        {
            await File.WriteAllBytesAsync(
                source,
                new byte[10],
                TestContext.Current.CancellationToken);
            var storage = new LocalObjectStore(root, LocalObjectStore.MinimumReserveBytes, _ => LocalObjectStore.MinimumReserveBytes + 9);

            var error = await Assert.ThrowsAsync<InvalidDataException>(
                () => storage.UploadFileAsync("objects/value.bin", source, TestContext.Current.CancellationToken));

            Assert.Equal("storage_capacity_exhausted", error.Message);
            Assert.False(File.Exists(Path.Combine(root, "objects", "value.bin")));
            Assert.Empty(Directory.GetFiles(root, "*.tmp", SearchOption.AllDirectories));
        }
        finally
        {
            if (File.Exists(source))
                File.Delete(source);
            if (Directory.Exists(root))
                Directory.Delete(root, true);
        }
    }

    [Fact]
    public async Task CommitsACompleteWriteByAtomicRename()
    {
        var root = Path.Combine(Path.GetTempPath(), $"spellbook-storage-{Guid.NewGuid():N}");
        var source = Path.Combine(Path.GetTempPath(), $"spellbook-source-{Guid.NewGuid():N}.bin");
        try
        {
            var expected = new byte[] { 1, 2, 3, 4 };
            await File.WriteAllBytesAsync(
                source,
                expected,
                TestContext.Current.CancellationToken);
            var storage = new LocalObjectStore(root, LocalObjectStore.MinimumReserveBytes, _ => long.MaxValue);

            await storage.UploadFileAsync("objects/value.bin", source, TestContext.Current.CancellationToken);

            Assert.Equal(expected, await storage.ReadAsync("objects/value.bin", TestContext.Current.CancellationToken));
            Assert.Empty(Directory.GetFiles(root, "*.tmp", SearchOption.AllDirectories));
        }
        finally
        {
            if (File.Exists(source))
                File.Delete(source);
            if (Directory.Exists(root))
                Directory.Delete(root, true);
        }
    }

    [Fact]
    public async Task UsesOnlyTheIsolatedEmergencyMarginForBoundedControlReceipts()
    {
        var root = Path.Combine(Path.GetTempPath(), $"spellbook-storage-{Guid.NewGuid():N}");
        try
        {
            var storage = new LocalObjectStore(
                root,
                LocalObjectStore.MinimumReserveBytes,
                _ => LocalObjectStore.ControlReserveBytes + 1024);

            await storage.UploadControlReceiptAsync(
                "jobs/result.json",
                new { status = "failed" },
                TestContext.Current.CancellationToken);

            Assert.True(File.Exists(Path.Combine(root, "jobs", "result.json")));
            await Assert.ThrowsAsync<InvalidDataException>(() =>
                storage.UploadControlReceiptAsync(
                    "jobs/oversized.json",
                    new { payload = new string('x', (int)LocalObjectStore.MaximumControlWriteBytes) },
                    TestContext.Current.CancellationToken));
        }
        finally
        {
            if (Directory.Exists(root))
                Directory.Delete(root, true);
        }
    }
}
