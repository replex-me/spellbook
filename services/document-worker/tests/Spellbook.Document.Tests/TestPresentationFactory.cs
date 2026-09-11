using A = DocumentFormat.OpenXml.Drawing;
using P = DocumentFormat.OpenXml.Presentation;
using DocumentFormat.OpenXml.Packaging;

namespace Spellbook.Document.Tests;

internal static class TestPresentationFactory
{
    public static string Create(string directory, string text = "원본 제목", string? fontFamily = null)
    {
        var path = Path.Combine(directory, "fixture.pptx");
        using var document = PresentationDocument.Create(path, DocumentFormat.OpenXml.PresentationDocumentType.Presentation);
        var presentationPart = document.AddPresentationPart();
        var slidePart = presentationPart.AddNewPart<SlidePart>();

        var runProperties = new A.RunProperties { Language = "ko-KR" };
        if (!string.IsNullOrWhiteSpace(fontFamily))
        {
            runProperties.Append(
                new A.LatinFont { Typeface = fontFamily },
                new A.EastAsianFont { Typeface = fontFamily },
                new A.ComplexScriptFont { Typeface = fontFamily });
        }

        var shape = new P.Shape(
            new P.NonVisualShapeProperties(
                new P.NonVisualDrawingProperties { Id = 2U, Name = "Title Box" },
                new P.NonVisualShapeDrawingProperties(new A.ShapeLocks { NoGrouping = true }),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.ShapeProperties(
                new A.Transform2D(
                    new A.Offset { X = 914400L, Y = 914400L },
                    new A.Extents { Cx = 4572000L, Cy = 914400L }),
                new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle },
                new A.SolidFill(new A.RgbColorModelHex { Val = "FFFFFF" })),
            new P.TextBody(
                new A.BodyProperties(),
                new A.ListStyle(),
                    new A.Paragraph(
                    new A.Run(
                        runProperties,
                        new A.Text(text)),
                    new A.EndParagraphRunProperties { Language = "ko-KR" })));

        var shapeTree = new P.ShapeTree(
            new P.NonVisualGroupShapeProperties(
                new P.NonVisualDrawingProperties { Id = 1U, Name = string.Empty },
                new P.NonVisualGroupShapeDrawingProperties(),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.GroupShapeProperties(
                new A.TransformGroup(
                    new A.Offset { X = 0L, Y = 0L },
                    new A.Extents { Cx = 0L, Cy = 0L },
                    new A.ChildOffset { X = 0L, Y = 0L },
                    new A.ChildExtents { Cx = 0L, Cy = 0L })),
            shape);
        slidePart.Slide = new P.Slide(
            new P.CommonSlideData(shapeTree),
            new P.ColorMapOverride(new A.MasterColorMapping()));
        slidePart.Slide.Save();

        var slideId = new P.SlideId
        {
            Id = 256U,
            RelationshipId = presentationPart.GetIdOfPart(slidePart)
        };
        presentationPart.Presentation = new P.Presentation(
            new P.SlideIdList(slideId),
            new P.SlideSize { Cx = 12192000, Cy = 6858000, Type = P.SlideSizeValues.Screen16x9 },
            new P.NotesSize { Cx = 6858000L, Cy = 9144000L });
        presentationPart.Presentation.Save();
        return path;
    }
}
