namespace Spellbook.Document.Core;

internal static class DrawingMlGraphicTypes
{
    // Graphic data discriminators are not child XML namespace URIs.
    // MS-OI29500 20.1.2.2.17 maps this URI specifically to the a:tbl payload.
    internal const string Table = "http://schemas.openxmlformats.org/drawingml/2006/table";
}
