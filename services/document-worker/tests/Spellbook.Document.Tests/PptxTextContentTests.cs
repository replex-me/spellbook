using System.Xml.Linq;
using Spellbook.Document.Core;
using Xunit;

namespace Spellbook.Document.Tests;

public sealed class PptxTextContentTests
{
    private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static XElement Shape(params XElement[] paragraphs) => new("shape", paragraphs);
    private static XElement Run(string text, string bold = "0") => new(A + "r",
        new XElement(A + "rPr", new XAttribute("b", bold)), new XElement(A + "t", text));

    [Fact]
    public void NoOpPreservesMixedFormattingAndParagraphsExactly()
    {
        var shape = Shape(new XElement(A + "p", Run("첫 문장 "), Run("강조", "1")),
            new XElement(A + "p", Run("다음"), new XElement(A + "br"), Run("줄")));
        var before = shape.ToString(SaveOptions.DisableFormatting);
        Assert.Equal("첫 문장 강조\n다음\v줄", PptxTextContent.Read(shape));
        PptxTextContent.Replace(shape, PptxTextContent.Read(shape));
        Assert.Equal(before, shape.ToString(SaveOptions.DisableFormatting));
    }

    [Theory]
    [InlineData("앞 새강조 뒤", "앞 ", "새강조", " 뒤")]
    [InlineData("앞 강조 끝", "앞 ", "강조", " 끝")]
    [InlineData("앞  뒤", "앞 ", "", " 뒤")]
    public void LocalChangesRetainUnaffectedRuns(string target, string first, string second, string third)
    {
        var shape = Shape(new XElement(A + "p", Run("앞 "), Run("강조", "1"), Run(" 뒤")));
        PptxTextContent.Replace(shape, target);
        Assert.Equal(target, PptxTextContent.Read(shape));
        Assert.Equal(new[] { first, second, third }, shape.Descendants(A + "t").Select(x => x.Value));
        Assert.Equal("1", shape.Descendants(A + "rPr").ElementAt(1).Attribute("b")?.Value);
    }

    [Fact]
    public void ReplacementAcrossRunsKeepsSuffixFormatting()
    {
        var shape = Shape(new XElement(A + "p", Run("abc"), Run("def", "1"), Run("ghi")));
        PptxTextContent.Replace(shape, "abXYZhi");
        Assert.Equal("abXYZhi", PptxTextContent.Read(shape));
        Assert.Equal(new[] { "abXYZ", "", "hi" }, shape.Descendants(A + "t").Select(x => x.Value));
    }

    [Fact]
    public void ExplicitParagraphRewriteRemovesOldParagraphsInsteadOfLeavingEmptyOnes()
    {
        var shape = Shape(new XElement(A + "p", Run("one")), new XElement(A + "p", Run("two")));
        PptxTextContent.Replace(shape, "joined");
        Assert.Single(shape.Descendants(A + "p"));
        Assert.Equal("joined", PptxTextContent.Read(shape));
    }

    [Fact]
    public void UnsupportedLaterFieldDoesNotPartiallyChangeEarlierParagraph()
    {
        var shape = Shape(new XElement(A + "p", Run("one")),
            new XElement(A + "p", new XElement(A + "fld", new XElement(A + "t", "date"))));
        var before = shape.ToString();
        Assert.Throws<InvalidDataException>(() => PptxTextContent.Replace(shape, "changed\nother"));
        Assert.Equal(before, shape.ToString());
    }

    [Fact]
    public void ParagraphInsertionPreservesUnchangedPrefixAndSuffixFormatting()
    {
        var first = new XElement(A + "p", Run("first", "1"));
        var last = new XElement(A + "p", Run("last"));
        var shape = Shape(first, last);
        PptxTextContent.Replace(shape, "first\ninserted\nlast");
        var paragraphs = shape.Descendants(A + "p").ToArray();
        Assert.Equal(3, paragraphs.Length);
        Assert.True(XNode.DeepEquals(first, paragraphs[0]));
        Assert.True(XNode.DeepEquals(last, paragraphs[2]));
    }

    [Theory]
    [InlineData("first\nlast\nadded")]
    [InlineData("added\nfirst\nlast")]
    [InlineData("first")]
    [InlineData("last")]
    [InlineData("")]
    public void ParagraphStructureExactlyMatchesRequestedText(string target)
    {
        var shape = Shape(new XElement(A + "p", Run("first")), new XElement(A + "p", Run("last")));
        PptxTextContent.Replace(shape, target);
        Assert.Equal(target, PptxTextContent.Read(shape));
        Assert.Equal(target.Split('\n').Length, shape.Descendants(A + "p").Count());
    }

    [Fact]
    public void ManualBreakInsertionUsesNativeBreaksAndKeepsEndParagraphPropertiesLast()
    {
        var shape = Shape(new XElement(A + "p", Run("first last", "1"), new XElement(A + "endParaRPr")));
        PptxTextContent.Replace(shape, "first\vlast");
        Assert.Equal("first\vlast", PptxTextContent.Read(shape));
        Assert.Single(shape.Descendants(A + "br"));
        Assert.Equal(A + "endParaRPr", shape.Element(A + "p")!.Elements().Last().Name);
    }

    [Theory]
    [InlineData("😀끝", "😁끝")]
    [InlineData("시작😀", "시작😁")]
    [InlineData("a", "")]
    [InlineData("a", "ab")]
    [InlineData("a", "ba")]
    public void BoundariesPreserveUnicodeAndRequestedText(string source, string target)
    {
        var shape = Shape(new XElement(A + "p", Run(source)));
        PptxTextContent.Replace(shape, target);
        Assert.Equal(target, PptxTextContent.Read(shape));
    }

    [Theory]
    [InlineData("새 텍스트")]
    [InlineData("첫째\n둘째")]
    public void StrictOoxmlKeepsItsNamespaceDuringTextAndParagraphEdits(string target)
    {
        XNamespace strict = "http://purl.oclc.org/ooxml/drawingml/main";
        var shape = new XElement("shape", new XElement(strict + "p",
            new XElement(strict + "r", new XElement(strict + "t", "원본"))));
        Assert.Equal("원본", PptxTextContent.Read(shape));
        PptxTextContent.Replace(shape, target);
        Assert.Equal(target, PptxTextContent.Read(shape));
        Assert.All(shape.Descendants(), element => Assert.Equal(strict, element.Name.Namespace));
    }

    [Fact]
    public void FillingAnEmptyManualLinePreservesNeighboringRuns()
    {
        var left = Run("first", "1");
        var right = Run("last");
        var shape = Shape(new XElement(A + "p", left, new XElement(A + "br"), new XElement(A + "br"), right));
        PptxTextContent.Replace(shape, "first\vadded\vlast");
        Assert.Equal("first\vadded\vlast", PptxTextContent.Read(shape));
        Assert.True(XNode.DeepEquals(left, shape.Descendants(A + "r").First()));
        Assert.True(XNode.DeepEquals(right, shape.Descendants(A + "r").Last()));
    }

    [Fact]
    public void ReplacementTextIsExactAcrossRunBoundariesAndEmptyRuns()
    {
        var random = new Random(20260908);
        for (var trial = 0; trial < 500; trial++)
        {
            string Word() => new(Enumerable.Range(0, random.Next(9))
                .Select(_ => "abc 한글"[random.Next(6)]).ToArray());
            var runs = Enumerable.Range(0, random.Next(1, 6)).Select(_ => Run(Word())).ToArray();
            var shape = Shape(new XElement(A + "p", runs));
            var target = Word();
            PptxTextContent.Replace(shape, target);
            Assert.Equal(target, PptxTextContent.Read(shape));
        }
    }
}
