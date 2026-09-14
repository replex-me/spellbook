const exactFamilies = new Map(
  Object.entries({
    ArrangeMenu: "shape_geometry_arrangement",
    AbsoluteRecord: "macros_forms_external_automation",
    ArrowsToolbox: "shape_geometry_arrangement",
    AutoCorrectDlg: "character_formatting",
    AutoPilotMenu: "macros_forms_external_automation",
    AutoRedactDoc: "document_lifecycle",
    Break: "shape_geometry_arrangement",
    ClickChangeRotation: "shape_geometry_arrangement",
    CommandPopup: "view_navigation_presenter",
    Connect: "connectors_freeform_3d_fontwork",
    ConvertIntoBitmap: "pictures_media",
    ConvertIntoMetaFile: "pictures_media",
    ConvertMenu: "shape_geometry_arrangement",
    CrookRotate: "shape_geometry_arrangement",
    CrookSlant: "shape_geometry_arrangement",
    CustomShowDialog: "view_navigation_presenter",
    Cylinder: "connectors_freeform_3d_fontwork",
    DesignerDialog: "slide_background_master_theme",
    DevelopmentToolsDockingWindow: "view_navigation_presenter",
    EditMenu: "view_navigation_presenter",
    FormatBulletsMenu: "paragraph_list_textbox",
    FormatImageFilterMenu: "pictures_media",
    FormatImageMenu: "pictures_media",
    FormatMenu: "view_navigation_presenter",
    FormatObjectMenu: "shape_geometry_arrangement",
    FormatSpacingMenu: "paragraph_list_textbox",
    FormatStylesMenu: "shape_appearance",
    FormatTextMenu: "character_formatting",
    FormattingMarkMenu: "text_content",
    InsertDraw: "shape_geometry_arrangement",
    InsertFormMenu: "macros_forms_external_automation",
    InsertMenu: "view_navigation_presenter",
    InsertRowDialog: "tables",
    InsertToolbox: "view_navigation_presenter",
    MatchCase: "text_content",
    MatchDiacritics: "text_content",
    LineToolbox: "shape_geometry_arrangement",
    Merge: "shape_geometry_arrangement",
    MoreDictionaries: "character_formatting",
    NavigateMenu: "view_navigation_presenter",
    NewRouting: "connectors_freeform_3d_fontwork",
    NewWindow: "view_navigation_presenter",
    PasteSpecialMenu: "view_navigation_presenter",
    PickList: "document_lifecycle",
    PresentationDialog: "animations_transitions_timing",
    Scan: "macros_forms_external_automation",
    SendToMenu: "file_export_print_share",
    SetDefault: "shape_appearance",
    ShapesMenu: "shape_geometry_arrangement",
    ShowFmExplorer: "macros_forms_external_automation",
    SortDown: "macros_forms_external_automation",
    Sortup: "macros_forms_external_automation",
    StyleMenu: "shape_appearance",
    TabDialog: "paragraph_list_textbox",
    TemplateMenu: "slide_background_master_theme",
    ToolsMenu: "view_navigation_presenter",
    ToolsFormsMenu: "macros_forms_external_automation",
    TransformDialog: "shape_geometry_arrangement",
    TransliterateMenu: "character_formatting",
    ViewMenu: "view_navigation_presenter",
  }),
);

export const securityExcludedCommandPattern =
  /^\.uno:(?:Macro|BasicIDE|ScriptOrganizer|RunMacro|Form(?:Design|Filter|Properties)|AutoControlFocus|ControlProperties|ChangeControlType|CheckBox|ComboBox|CurrencyField|DateField|FileControl|FormattedField|GroupBox|ImageControl|Imagebutton|Label|ListBox|NumericField|PatternField|Pushbutton|RadioButton|ScrollBar|SpinButton|TimeField|Rec(?:FromText|Save|Search|Text|Total|Undo)|AbsoluteRecord|FirstRecord|LastRecord|NextRecord|PrevRecord|NewRecord|DeleteRecord|RefreshFormControl|ShowFmExplorer|SwitchControlDesignMode|UseWizards|AutoFilter|RemoveFilterSort|InsertFormMenu|ToolsFormsMenu|Twain|Scan|Scanner|AddressBook|ExternalEdit|ManageLinks)/iu;

const familyRules = [
  {
    family: "macros_forms_external_automation",
    pattern: securityExcludedCommandPattern,
  },
  {
    family: "hyperlinks_actions",
    pattern:
      /^\.uno:(?:CopyHyperlinkLocation|EditHyperlink|EditQrCode|Hyperlink|InsertHyperlink|InsertQrCode|RemoveHyperlink|ObjectInteraction|ActionSettings|ClickAction)/iu,
  },
  {
    family: "notes_comments_accessibility",
    pattern:
      /^\.uno:(?:DeleteAllAnnotation|DeleteAnnotation|HeaderAndFooter|InsertAnnotation|NextAnnotation|ObjectTitleDescription|PreviousAnnotation|ReplyToAnnotation|Comment|Notes|AltText|Accessibility)/iu,
  },
  {
    family: "animations_transitions_timing",
    pattern:
      /^\.uno:(?:Animation|CustomAnimation|ExecuteAnimationEffect|Presentation$|PresentationCurrentSlide|PresentationDialog|RehearseTimings|SlideTransition|Transition|Timing)/iu,
  },
  {
    family: "smartart_diagrams",
    pattern: /^\.uno:(?:SmartArt|Diagram|OrgChart)/iu,
  },
  {
    family: "charts_data",
    pattern: /^\.uno:(?:Chart|InsertObjectChart|DiagramData)/iu,
  },
  {
    family: "equations_embedded_objects",
    pattern: /^\.uno:(?:InsertMath|InsertObject$|OLE|Formula|CloseObject)/iu,
  },
  {
    family: "pictures_media",
    pattern:
      /^\.uno:(?:AVMedia|Bmp|ChangePicture|CompressGraphic|ConvertIntoBitmap|ConvertIntoMetaFile|Crop|Graf|Graphic|ImageMap|InsertAVMedia|InsertGraphic|PhotoAlbum|ProtectGraphic)/iu,
  },
  {
    family: "connectors_freeform_3d_fontwork",
    pattern:
      /^\.uno:(?:Bezier|ChangeBezier|ChangePolygon|Connector|ConvertInto3D|Extrusion|Fontwork|FontWork|Freeline|Glue|Polygon|PolyFormen|Cone|Cube|Cyramid|Cylinder|HalfSphere|Objects3D|Shell3D|Sphere|Torus|Window3D|NewRouting|Connect$)/iu,
  },
  {
    family: "tables",
    pattern:
      /^\.uno:(?:Table|Cell|Column|DeleteColumns|DeleteRows|DeleteTable|DistributeColumns|DistributeRows|EntireCell|EntireColumn|EntireRow|InsertColumn|InsertRows|InsertTable|MergeCells|OptimizeTable|SelectTable|SetBorder|SetColumn|SetMinimalColumn|SetMinimalRow|SetOptimalColumn|SetOptimalRow|SetRow|SplitCell)/iu,
  },
  {
    family: "slide_background_master_theme",
    pattern:
      /^\.uno:(?:AddTheme|DeleteMasterPage|DesignerDialog|DisplayMaster|InsertMasterPage|MasterLayouts|PageSetup|PresentationLayout|RenameMasterPage|SelectBackground|SlideMasterPagesAll|SlideSetup|TemplateMenu|ThemeDialog)/iu,
  },
  {
    family: "slide_structure",
    pattern:
      /^\.uno:(?:AddSlideSection|AssignLayout|DeletePage|DeleteSlide|DuplicatePage|DuplicateSlide|ExpandPage|HideSlide|ImportSlideFromFile|InsertPage$|InsertSlide$|LayoutStatus|ModifyPage|MoveSlide|RemoveSlideSection|RenameSlide|ShowSlide|SlideLayoutMenu|SlideMenu|SlideMoveMenu|SummaryPage)/iu,
  },
  {
    family: "character_formatting",
    pattern:
      /^\.uno:(?:Bold|ChangeCase|Char|ChineseConversion|Font|HangulHanjaConversion|Hyphenation|Italic|Language|MoreDictionaries|Overline|SetLanguage|SmallCaps|Spell|Spelling|Strikeout|SubScript|SuperScript|Thesaurus|Transliterate|Underline)/iu,
  },
  {
    family: "paragraph_list_textbox",
    pattern:
      /^\.uno:(?:CenterPara|DecrementIndent|DefaultBullet|DefaultNumbering|IncrementIndent|JustifyPara|LeftPara|LineSpacing|Outline|Para|RightPara|SetOutline|SpacePara|Spacing|TabDialog|TextAlign|TextAutoFit|TextFit|Textdirection|VerticalText)/iu,
  },
  {
    family: "text_content",
    pattern:
      /^\.uno:(?:AddField|Context$|DownSearch|ExitSearch|Field|Find|Insert(?:Author|Date|File|HardHyphen|LRM|NarrowNobreakSpace|NonBreakingSpace|PageField|PageTitleField|PagesField|RLM|SlideField|SlideTitleField|SlidesField|SoftHyphen|Symbol|Time|WJ|ZWSP)|MatchCase|MatchDiacritics|ModifyField|SearchLabel|Text$|TextAttributes|UpSearch)/iu,
  },
  {
    family: "shape_appearance",
    pattern:
      /^\.uno:(?:Color$|ColorControl|EditStyle|Fill|FormatArea|FormatLine|FormatPaintbrush|FrameLine|InteractiveGradient|InteractiveTransparence|LineEndStyle|LineStyle|LineWidth|SetDefault|Shadowed|StyleNewByExample|StyleUpdateByExample|XLine)/iu,
  },
  {
    family: "shape_geometry_arrangement",
    pattern:
      /^\.uno:(?:Align|Arc|ArrowShapes|Backward|BasicShapes|BeforeObject|BehindObject|Break$|BringToFront|CalloutShapes|CapturePoint|Circle|Combine|ConvertMenu|Crook|Dismantle|Distribute|DrawCaption|Ellipse|EnterGroup|Equalize|Flip|FlowChartShapes|FormatGroup|FormatUngroup|Forward|Grow|Group|InsertDraw|Intersect|LeaveAllGroups|LeaveGroup|Line$|LineArrow|LineArrows|LineCircleArrow|LineSquareArrow|Line_Diagonal|Measure|Merge$|Mirror|ModifyPresentationObject|NameGroup|Object|Order|OriginalSize|Pie|ProtectPos|ProtectSize|Rect|ReverseOrder|RotateFlipMenu|SelectObject|SendToBack|Shapes|Shear|Shrink|Size$|SolidCreate|Square|StarShapes|Substract|SymbolShapes|ToggleObject|TransformDialog|VerticalCaption|convert_to_contour)/iu,
  },
  {
    family: "view_navigation_presenter",
    pattern:
      /^\.uno:(?:AdvancedMode|CloseWin|ColorSettings|CommandPopup|DisplayMode|DoubleClickTextEdit|FirstSlide|GotoSlide|LastSlide|NavigateMenu|Navigation|NextSlide|PageStatus|PagesPerRow|PickThrough|PresentationMinimizer|PreviousSlide|QuickEdit|SlideChangeWindow|Window)/iu,
  },
  {
    family: "document_lifecycle",
    pattern:
      /^\.uno:(?:Classification|Config|Edit$|ExtendedHelp|Help|ImportFromFile|ModifiedStatus|PickList|ReadOnlyDoc|Redact|Refresh$|SecurityLabel|Settings|ShowLicense)/iu,
  },
];

export function semanticFamilyForCommand(command, category) {
  if (!/^\.uno:[A-Za-z0-9_]+$/u.test(command))
    throw new Error(`Invalid Impress command: ${command}`);
  if (category === "platform_owned")
    return /(?:Export|PDF|Print|SendMail|Sign)/iu.test(command)
      ? "file_export_print_share"
      : "document_lifecycle";
  if (category === "human_editor_state") return "view_navigation_presenter";
  if (category === "security_excluded")
    return "macros_forms_external_automation";
  const exactFamily = exactFamilies.get(command.slice(5));
  if (exactFamily) return exactFamily;
  return familyRules.find((rule) => rule.pattern.test(command))?.family ?? null;
}

export const semanticFamilyRules = familyRules;
