/* Fixed engine-side program. Models supply validated data, never executable
 * JavaScript. This function is serialized by cool.callRemote and runs against
 * the same open Collabora document the user is editing.
 */
function spellbookDocumentOperation(request) {
  const engineIdentity = {
    patchLevel: "__SPELLBOOK_ENGINE_PATCH_LEVEL__",
    publicCommit: "__SPELLBOOK_PUBLIC_SOURCE_REVISION__",
    engineImage: "__SPELLBOOK_COLLABORA_ENGINE_IMAGE__",
    patchSeriesSha256: "__SPELLBOOK_COLLABORA_PATCH_SERIES_SHA256__",
    collaboraSourceCommit: "__SPELLBOOK_COLLABORA_SOURCE_COMMIT__",
  };
  const enginePatchLevel = engineIdentity.patchLevel;
  const patchLevelMatch = /^undo-v([1-9][0-9]*)$/.exec(enginePatchLevel);
  const enginePatchVersion = patchLevelMatch ? Number(patchLevelMatch[1]) : 0;
  const hasEnginePatch = (minimumVersion) =>
    enginePatchVersion >= minimumVersion;
  const runtimeOperations = new Set(
    Array.isArray(request.nativeAdapter?.supportedOperations)
      ? request.nativeAdapter.supportedOperations.filter(
          (operation) => typeof operation === "string",
        )
      : [],
  );
  const runtimeSupports = (operation) => runtimeOperations.has(operation);
  const patchedUndoEngine = hasEnginePatch(2);
  const patchedObjectPropertyEngine = hasEnginePatch(3);
  const patchedTextRangeEngine = hasEnginePatch(4);
  const patchedTableStructureEngine = hasEnginePatch(5);
  const patchedTextPropertiesEngine = hasEnginePatch(5);
  const patchedTextFormattingEngine = hasEnginePatch(13);
  const patchedTableCellPropertiesEngine = hasEnginePatch(6);
  const patchedGraphicCropEngine = hasEnginePatch(6);
  const patchedSlideLayoutEngine = hasEnginePatch(12);
  const patchedSlideTransitionEngine = hasEnginePatch(7);
  const patchedAnimationTimingEngine = hasEnginePatch(8);
  const patchedSlideInsertionEngine = hasEnginePatch(9);
  const patchedObjectLifecycleEngine = hasEnginePatch(14);
  const patchedObjectInteractionEngine = hasEnginePatch(18);
  if (request.expiresAt && Date.now() > request.expiresAt)
    throw new Error("expired_operation");
  const mutationContracts = request.mutationContracts;
  if (!mutationContracts || typeof mutationContracts !== "object")
    throw new Error("native_mutation_contract_unavailable");
  const mutationContractFor = (operation) => {
    const contract = mutationContracts[operation];
    if (!contract || typeof contract !== "object")
      throw new Error("unsupported_native_operation");
    if (contract.availability === "format_excluded")
      throw new Error("operation_not_supported_for_pptx");
    if (
      !Number.isInteger(contract.minEnginePatch) ||
      contract.minEnginePatch < 0 ||
      (enginePatchVersion < contract.minEnginePatch &&
        !runtimeSupports(operation))
    )
      throw new Error(
        `native_engine_patch_level_${contract.minEnginePatch}_required`,
      );
    return contract;
  };

  const desktop = uno.idl.com.sun.star.frame.Desktop.create(
    uno.componentContext,
  );
  const frame = desktop.getCurrentFrame();
  const controller = frame.getController();
  const model = controller.getModel();
  const pages = model.getDrawPages();
  const prop = (Name, type, value) =>
    new uno.idl.com.sun.star.beans.PropertyValue({
      Name,
      Value: new uno.Any(type, value),
    });
  const slideTransitionPresets = {
    none: { Type: 0, Subtype: 0, Direction: true, FadeColor: 0 },
    fade: { Type: 37, Subtype: 101, Direction: true, FadeColor: 0 },
    "fade-through-black": {
      Type: 37,
      Subtype: 104,
      Direction: true,
      FadeColor: 0,
    },
    "fade-through-white": {
      Type: 37,
      Subtype: 104,
      Direction: true,
      FadeColor: 16777215,
    },
    "wipe-left-to-right": {
      Type: 1,
      Subtype: 1,
      Direction: true,
      FadeColor: 0,
    },
    "wipe-top-to-bottom": {
      Type: 1,
      Subtype: 2,
      Direction: true,
      FadeColor: 0,
    },
    "push-from-left": {
      Type: 35,
      Subtype: 97,
      Direction: true,
      FadeColor: 0,
    },
    "push-from-top": {
      Type: 35,
      Subtype: 98,
      Direction: true,
      FadeColor: 0,
    },
    "push-from-right": {
      Type: 35,
      Subtype: 99,
      Direction: true,
      FadeColor: 0,
    },
    "push-from-bottom": {
      Type: 35,
      Subtype: 100,
      Direction: true,
      FadeColor: 0,
    },
  };
  const dispatch = (command, args = []) =>
    uno.idl.com.sun.star.frame.DispatchHelper.create(
      uno.componentContext,
    ).executeDispatch(frame, command, "", 0, args);
  const transformSlides = (commands) => {
    if (
      typeof request.nativeAdapter?.transformSlides === "function" &&
      request.nativeAdapter?.supportsTransform?.(commands) === true
    )
      return request.nativeAdapter.transformSlides({
        commands,
        controller,
        dispatch,
        model,
        pages,
      });
    return dispatch(".uno:TransformDocumentStructure", [
      prop(
        "DataJson",
        uno.type.string,
        JSON.stringify({
          Strict: true,
          Transforms: { SlideCommands: commands },
        }),
      ),
    ]);
  };
  const activateSlide = (slideIndex) =>
    transformSlides([{ JumpToSlide: slideIndex }]);
  const safeProperty = (shape, name) => {
    try {
      return shape.getPropertyValue(name);
    } catch (_) {
      return null;
    }
  };
  const safePropertyState = (value, name) => {
    try {
      return enumName(value.getPropertyState(name));
    } catch (_) {
      return null;
    }
  };
  const safeMember = (value, name) => {
    try {
      return value[name];
    } catch (_) {
      return null;
    }
  };
  const safeCall = (value, method, fallback = null) => {
    try {
      return value[method]();
    } catch (_) {
      return fallback;
    }
  };
  const shapeGeometryType = (shape, kind) => {
    const serviceKind = String(kind ?? "");
    if (serviceKind.endsWith("LineShape")) return "line";
    if (serviceKind.endsWith("EllipseShape")) return "ellipse";
    if (
      serviceKind.endsWith("RectangleShape") ||
      serviceKind.endsWith("TextShape")
    )
      return "rect";
    let geometry;
    try {
      geometry = Array.from(safeProperty(shape, "CustomShapeGeometry") ?? []);
    } catch (_) {
      return null;
    }
    const type = geometry.find((entry) => safeMember(entry, "Name") === "Type");
    const value = String(safeMember(type, "Value") ?? "")
      .toLowerCase()
      .replace(/^ooxml-/u, "");
    return (
      {
        rectangle: "rect",
        rect: "rect",
        ellipse: "ellipse",
        line: "line",
      }[value] ??
      (value || null)
    );
  };
  const safeTextProperty = (shape, name) => {
    try {
      return shape.createTextCursor().getPropertyValue(name);
    } catch (_) {
      return safeProperty(shape, name);
    }
  };
  const collectPropertyStates = (value, mappings) => {
    const propertyNames = [
      ...new Set(mappings.map(([, property]) => property)),
    ];
    try {
      const states = Array.from(value.getPropertyStates(propertyNames));
      if (states.length === propertyNames.length) {
        const byProperty = new Map(
          propertyNames.map((property, index) => [
            property,
            enumName(states[index]),
          ]),
        );
        return Object.fromEntries(
          mappings.map(([field, property]) => [
            field,
            byProperty.get(property),
          ]),
        );
      }
    } catch (_) {}
    return Object.fromEntries(
      mappings
        .map(([field, property]) => [field, safePropertyState(value, property)])
        .filter(([, state]) => state !== null),
    );
  };
  const shapePropertyStates = (shape, text) => {
    const states = collectPropertyStates(shape, [
      ["fillStyle", "FillStyle"],
      ["fill", "FillColor"],
      ["lineColor", "LineColor"],
      ["lineWidth", "LineWidth"],
      ["textVerticalAlignment", "TextVerticalAdjust"],
      ["textAutoGrowHeight", "TextAutoGrowHeight"],
      ["textAutoGrowWidth", "TextAutoGrowWidth"],
      ["textFitToSize", "TextFitToSize"],
      ["textWordWrap", "TextWordWrap"],
      ["textMargins.left", "TextLeftDistance"],
      ["textMargins.right", "TextRightDistance"],
      ["textMargins.top", "TextUpperDistance"],
      ["textMargins.bottom", "TextLowerDistance"],
      ["title", "Title"],
      ["description", "Description"],
      ["decorative", "Decorative"],
      ["hyperlink", "Hyperlink"],
      ["clickAction", "OnClick"],
      ["presentationOrder", "PresentationOrder"],
      ["moveProtected", "MoveProtect"],
      ["sizeProtected", "SizeProtect"],
      ["printable", "Printable"],
      ["shadow.enabled", "Shadow"],
      ["shadow.color", "ShadowColor"],
      ["shadow.transparency", "ShadowTransparence"],
      ["shadow.offsetX", "ShadowXDistance"],
      ["shadow.offsetY", "ShadowYDistance"],
      ["shadow.blur", "ShadowBlur"],
      ["lineStyle", "LineStyle"],
      ["lineDashName", "LineDashName"],
      ["lineStartName", "LineStartName"],
      ["lineEndName", "LineEndName"],
      ["graphicCrop", "GraphicCrop"],
      ["fillOpacity", "FillTransparence"],
      ["lineOpacity", "LineTransparence"],
      ["mirroredX", "MirroredX"],
      ["mirroredY", "MirroredY"],
    ]);
    if (text === null) return states;
    try {
      const cursor = shape.createTextCursor();
      cursor.gotoEnd(true);
      Object.assign(
        states,
        collectPropertyStates(cursor, [
          ["fontFamily", "CharFontName"],
          ["wholeTextFormatting.fontFamily", "CharFontName"],
          ["wholeTextFormatting.fontFamilyAsian", "CharFontNameAsian"],
          ["wholeTextFormatting.fontFamilyComplex", "CharFontNameComplex"],
          ["fontSize", "CharHeight"],
          ["wholeTextFormatting.fontSize", "CharHeight"],
          ["wholeTextFormatting.fontSizeAsian", "CharHeightAsian"],
          ["wholeTextFormatting.fontSizeComplex", "CharHeightComplex"],
          ["fontWeight", "CharWeight"],
          ["wholeTextFormatting.fontWeight", "CharWeight"],
          ["wholeTextFormatting.fontWeightAsian", "CharWeightAsian"],
          ["wholeTextFormatting.fontWeightComplex", "CharWeightComplex"],
          ["fontStyle", "CharPosture"],
          ["wholeTextFormatting.fontStyle", "CharPosture"],
          ["wholeTextFormatting.fontStyleAsian", "CharPostureAsian"],
          ["wholeTextFormatting.fontStyleComplex", "CharPostureComplex"],
          ["underline", "CharUnderline"],
          ["strikethrough", "CharStrikeout"],
          ["textShadow", "CharShadowed"],
          ["color", "CharColor"],
          ["paragraphAlignment", "ParaAdjust"],
          ["characterSpacing", "CharKerning"],
          ["scriptPosition.escapement", "CharEscapement"],
          ["scriptPosition.relativeHeight", "CharEscapementHeight"],
        ]),
      );
    } catch (_) {}
    return states;
  };
  const wholeTextFormatting = (shape, text) => {
    if (text === null) return null;
    try {
      const cursor = shape.createTextCursor();
      cursor.gotoEnd(true);
      return {
        fontFamily: cursor.getPropertyValue("CharFontName"),
        fontFamilyAsian: cursor.getPropertyValue("CharFontNameAsian"),
        fontFamilyComplex: cursor.getPropertyValue("CharFontNameComplex"),
        fontSize: cursor.getPropertyValue("CharHeight"),
        fontSizeAsian: cursor.getPropertyValue("CharHeightAsian"),
        fontSizeComplex: cursor.getPropertyValue("CharHeightComplex"),
        fontWeight: cursor.getPropertyValue("CharWeight"),
        fontWeightAsian: cursor.getPropertyValue("CharWeightAsian"),
        fontWeightComplex: cursor.getPropertyValue("CharWeightComplex"),
        fontStyle: enumName(cursor.getPropertyValue("CharPosture")),
        fontStyleAsian: enumName(cursor.getPropertyValue("CharPostureAsian")),
        fontStyleComplex: enumName(
          cursor.getPropertyValue("CharPostureComplex"),
        ),
      };
    } catch (_) {
      return null;
    }
  };
  // The public command contract follows PowerPoint and expresses character
  // spacing in points. LibreOffice stores SvxKerningItem values in twips, but
  // the native text transform accepts 1/100 mm before converting to twips.
  // Keep those boundaries explicit so observations never leak engine units
  // and table-cell edits do not accidentally treat 1/100 mm as twips.
  const pointsToKerningTwips = (value) => Math.round(Number(value) * 20);
  const pointsToKerningMm100 = (value) =>
    Math.round((Number(value) * 2540) / 72);
  const mm100ToKerningTwips = (value) => Math.round((Number(value) * 72) / 127);
  const kerningTwipsToPoints = (value) => {
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric / 20 : null;
  };
  const stableJson = (value) => {
    const normalize = (candidate) => {
      if (Array.isArray(candidate)) return candidate.map(normalize);
      if (candidate && typeof candidate === "object") {
        const result = {};
        for (const key of Object.keys(candidate).sort())
          result[key] = normalize(candidate[key]);
        return result;
      }
      return candidate;
    };
    return JSON.stringify(normalize(value));
  };
  const withoutPropertyStates = (value) => {
    if (Array.isArray(value)) return value.map(withoutPropertyStates);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "propertyStates")
          .map(([key, candidate]) => [key, withoutPropertyStates(candidate)]),
      );
    return value;
  };
  // Effect and Speed are legacy UI projections derived by LibreOffice from
  // the standard transition fields. They are useful observations but are not
  // part of the typed command's persisted state and must not make an exact
  // native readback look like a failed mutation.
  const persistedSlideTransition = (transition) => ({
    type: transition?.type,
    subtype: transition?.subtype,
    direction: transition?.direction,
    duration: transition?.duration,
    fadeColor: transition?.fadeColor,
  });
  const firstDifferencePath = (left, right, path = "slides") => {
    if (Object.is(left, right)) return null;
    if (
      !left ||
      !right ||
      typeof left !== "object" ||
      typeof right !== "object"
    )
      return path;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const difference = firstDifferencePath(
        left[key],
        right[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    // Two separately observed UNO objects can be structurally equal. Reaching
    // the end of both key sets therefore means there is no difference below
    // this node; returning the parent path here blamed the first equal object
    // (often speaker notes) instead of the real later difference.
    return null;
  };
  const documentStateJson = stableJson;
  const revisionOf = (value) => {
    const text = documentStateJson(value);
    let first = 2166136261;
    let second = 2166136261;
    for (let index = 0; index < text.length; index++) {
      first ^= text.charCodeAt(index);
      first = Math.imul(first, 16777619);
      second ^= text.charCodeAt(text.length - index - 1);
      second = Math.imul(second, 16777619);
    }
    return `v2-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
      .toString(16)
      .padStart(8, "0")}`;
  };
  const childCount = (shape) => {
    try {
      return shape.getCount();
    } catch (_) {
      return 0;
    }
  };
  const tableDetails = (shape) => {
    if (!String(shape.getShapeType()).endsWith("TableShape")) return null;
    try {
      const table = shape.getPropertyValue("Model");
      const rowCollection = table.getRows();
      const columnCollection = table.getColumns();
      const rows = rowCollection.getCount();
      const columns = columnCollection.getCount();
      const mergedRanges = [];
      const borderDetails = (cell, propertyName) => {
        const border = safeProperty(cell, propertyName);
        if (!border) return null;
        return {
          style: Number(border.LineStyle),
          width: Number(border.LineWidth),
          color: Number(border.Color),
          innerWidth: Number(border.InnerLineWidth),
          outerWidth: Number(border.OuterLineWidth),
          distance: Number(border.LineDistance),
        };
      };
      const cellDetails = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) => {
          const cell = table.getCellByPosition(column, row);
          const fillTransparency = safeProperty(cell, "FillTransparence");
          let text = null;
          try {
            text = cell.getString();
          } catch (_) {
            try {
              text = cell.getFormula();
            } catch (_) {}
          }
          return {
            row,
            column,
            text,
            merged: Boolean(safeCall(cell, "isMerged", false)),
            rowSpan: Number(safeCall(cell, "getRowSpan", 1)),
            columnSpan: Number(safeCall(cell, "getColumnSpan", 1)),
            fillColor: safeProperty(cell, "FillColor"),
            fillOpacity:
              fillTransparency === null ? null : 100 - Number(fillTransparency),
            fontFamily: safeTextProperty(cell, "CharFontName"),
            fontSize: safeTextProperty(cell, "CharHeight"),
            fontWeight: safeTextProperty(cell, "CharWeight"),
            fontStyle: enumName(safeTextProperty(cell, "CharPosture")),
            underline: safeTextProperty(cell, "CharUnderline"),
            strikethrough: safeTextProperty(cell, "CharStrikeout"),
            textShadow: safeTextProperty(cell, "CharShadowed"),
            color: safeTextProperty(cell, "CharColor"),
            characterSpacing: kerningTwipsToPoints(
              safeTextProperty(cell, "CharKerning"),
            ),
            paragraphAlignment: safeTextProperty(cell, "ParaAdjust"),
            textMargins: {
              left: safeProperty(cell, "TextLeftDistance"),
              right: safeProperty(cell, "TextRightDistance"),
              top: safeProperty(cell, "TextUpperDistance"),
              bottom: safeProperty(cell, "TextLowerDistance"),
            },
            borders: {
              top: borderDetails(cell, "TopBorder"),
              right: borderDetails(cell, "RightBorder"),
              bottom: borderDetails(cell, "BottomBorder"),
              left: borderDetails(cell, "LeftBorder"),
            },
            propertyStates: collectPropertyStates(cell, [
              ["fillColor", "FillColor"],
              ["fillOpacity", "FillTransparence"],
              ["fontFamily", "CharFontName"],
              ["fontSize", "CharHeight"],
              ["fontWeight", "CharWeight"],
              ["fontStyle", "CharPosture"],
              ["underline", "CharUnderline"],
              ["strikethrough", "CharStrikeout"],
              ["textShadow", "CharShadowed"],
              ["color", "CharColor"],
              ["characterSpacing", "CharKerning"],
              ["paragraphAlignment", "ParaAdjust"],
              ["textMargins.left", "TextLeftDistance"],
              ["textMargins.right", "TextRightDistance"],
              ["textMargins.top", "TextUpperDistance"],
              ["textMargins.bottom", "TextLowerDistance"],
              ["borders.top", "TopBorder"],
              ["borders.right", "RightBorder"],
              ["borders.bottom", "BottomBorder"],
              ["borders.left", "LeftBorder"],
            ]),
          };
        }),
      );
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const cell = cellDetails[row][column];
          const merged = cell.merged;
          const rowSpan = cell.rowSpan;
          const columnSpan = cell.columnSpan;
          if (!merged && (rowSpan > 1 || columnSpan > 1))
            mergedRanges.push({
              startRow: row,
              startColumn: column,
              endRow: row + rowSpan - 1,
              endColumn: column + columnSpan - 1,
            });
        }
      }
      return {
        rows,
        columns,
        rowHeights: Array.from({ length: rows }, (_, row) =>
          safeProperty(rowCollection.getByIndex(row), "Height"),
        ),
        columnWidths: Array.from({ length: columns }, (_, column) =>
          safeProperty(columnCollection.getByIndex(column), "Width"),
        ),
        mergedRanges,
        // Keep the compact text matrix for compatibility with existing AI
        // prompts and persistence checks. cellDetails is the richer source of
        // truth for safe style and outline edits.
        cells: cellDetails.map((row) => row.map((cell) => cell.text)),
        cellDetails,
      };
    } catch (_) {
      return null;
    }
  };
  const textDetails = (shape, elementId) => {
    try {
      const paragraphs = [];
      const paragraphEnumeration = shape.createEnumeration();
      let paragraphIndex = 0;
      let shapeOffset = 0;
      while (paragraphEnumeration.hasMoreElements()) {
        const paragraph = paragraphEnumeration.nextElement();
        const paragraphText = paragraph.getString();
        const portions = [];
        let paragraphOffset = 0;
        try {
          const portionEnumeration = paragraph.createEnumeration();
          let portionIndex = 0;
          while (portionEnumeration.hasMoreElements()) {
            const portion = portionEnumeration.nextElement();
            const text = portion.getString();
            const startOffset = shapeOffset + paragraphOffset;
            portions.push({
              rangeId: `${elementId}:p${paragraphIndex}:r${portionIndex}`,
              portionIndex,
              startOffset,
              endOffset: startOffset + text.length,
              text,
              fontFamily: safeProperty(portion, "CharFontName"),
              fontFamilyAsian: safeProperty(portion, "CharFontNameAsian"),
              fontFamilyComplex: safeProperty(portion, "CharFontNameComplex"),
              fontSize: safeProperty(portion, "CharHeight"),
              fontSizeAsian: safeProperty(portion, "CharHeightAsian"),
              fontSizeComplex: safeProperty(portion, "CharHeightComplex"),
              fontWeight: safeProperty(portion, "CharWeight"),
              fontWeightAsian: safeProperty(portion, "CharWeightAsian"),
              fontWeightComplex: safeProperty(portion, "CharWeightComplex"),
              fontStyle: enumName(safeProperty(portion, "CharPosture")),
              fontStyleAsian: enumName(
                safeProperty(portion, "CharPostureAsian"),
              ),
              fontStyleComplex: enumName(
                safeProperty(portion, "CharPostureComplex"),
              ),
              underline: safeProperty(portion, "CharUnderline"),
              strikethrough: safeProperty(portion, "CharStrikeout"),
              shadow: safeProperty(portion, "CharShadowed"),
              color: safeProperty(portion, "CharColor"),
              spacing: kerningTwipsToPoints(
                safeProperty(portion, "CharKerning"),
              ),
              escapement: safeProperty(portion, "CharEscapement"),
              escapementHeight: safeProperty(portion, "CharEscapementHeight"),
              locale: safeProperty(portion, "CharLocale"),
              localeAsian: safeProperty(portion, "CharLocaleAsian"),
              localeComplex: safeProperty(portion, "CharLocaleComplex"),
            });
            paragraphOffset += text.length;
            portionIndex++;
          }
        } catch (_) {}
        paragraphs.push({
          paragraphId: `${elementId}:p${paragraphIndex}`,
          paragraphIndex,
          startOffset: shapeOffset,
          endOffset: shapeOffset + paragraphText.length,
          text: paragraphText,
          alignment: safeProperty(paragraph, "ParaAdjust"),
          lastLineAlignment: safeProperty(paragraph, "ParaLastLineAdjust"),
          leftMargin: safeProperty(paragraph, "ParaLeftMargin"),
          rightMargin: safeProperty(paragraph, "ParaRightMargin"),
          firstLineIndent: safeProperty(paragraph, "ParaFirstLineIndent"),
          topMargin: safeProperty(paragraph, "ParaTopMargin"),
          bottomMargin: safeProperty(paragraph, "ParaBottomMargin"),
          lineSpacing: safeProperty(paragraph, "ParaLineSpacing"),
          writingMode: enumName(safeProperty(paragraph, "WritingMode")),
          portions,
        });
        // UNO paragraph enumeration omits the paragraph separator from each
        // paragraph string. Count one logical separator between paragraphs so
        // offsets remain unambiguous inside the shape's full string.
        shapeOffset += paragraphText.length + 1;
        paragraphIndex++;
      }
      return paragraphs;
    } catch (_) {
      return null;
    }
  };
  const notesDetails = (page) => {
    try {
      const notesPage = page.getNotesPage();
      const items = [];
      for (let index = 0; index < notesPage.getCount(); index++) {
        const shape = notesPage.getByIndex(index);
        const kind = safeCall(shape, "getShapeType");
        let text = null;
        try {
          text = shape.getString();
        } catch (_) {}
        if (text === null) continue;
        // Page number, date, header, and footer placeholders expose their
        // currently rendered label through getString(). That label is a
        // view/localization result, not persisted presentation content, and
        // can change after Undo/Redo without changing the PPTX. Keep those
        // objects in the structural observation, but hash only the authored
        // speaker-note body text as document state.
        const isNotesBody = String(kind).endsWith("NotesShape");
        items.push({
          shapeIndex: index,
          kind,
          text: isNotesBody ? text : null,
          presentationObject: safeProperty(shape, "IsPresentationObject"),
        });
      }
      return {
        text: items
          .filter((item) => String(item.kind).endsWith("NotesShape"))
          .map((item) => item.text)
          .filter(Boolean)
          .join("\n"),
        items,
      };
    } catch (_) {
      return null;
    }
  };
  const enumName = (value) => {
    if (value === null || value === undefined) return null;
    try {
      return String(value);
    } catch (_) {
      return null;
    }
  };
  const normalizeUnoValue = (value, depth = 0) => {
    if (depth > 8) return null;
    if (
      value === null ||
      value === undefined ||
      ["string", "number", "boolean"].includes(typeof value)
    )
      return value ?? null;
    if (Array.isArray(value))
      return value
        .slice(0, 200)
        .map((entry) => normalizeUnoValue(entry, depth + 1));
    if (typeof value === "object") {
      const name = safeMember(value, "Name");
      const namedValue = safeMember(value, "Value");
      if (typeof name === "string")
        return {
          name,
          value: normalizeUnoValue(namedValue, depth + 1),
        };
      const trigger = safeMember(value, "Trigger");
      if (trigger !== null)
        return {
          trigger: Number(trigger),
          offset: normalizeUnoValue(safeMember(value, "Offset"), depth + 1),
          repeat: Number(safeMember(value, "Repeat") ?? 0),
        };
    }
    const text = enumName(value);
    return text && !/^0x[0-9a-f]+$/i.test(text) ? text : null;
  };
  const masterDetails = () => {
    const masterPages = safeCall(model, "getMasterPages");
    if (!masterPages) return [];
    return Array.from({ length: masterPages.getCount() }, (_, masterIndex) => {
      const master = masterPages.getByIndex(masterIndex);
      const background = safeProperty(master, "Background");
      return {
        masterIndex,
        name: safeCall(master, "getName", ""),
        layout: safeProperty(master, "SlideLayout"),
        backgroundColor: background
          ? safeProperty(background, "FillColor")
          : null,
        backgroundFullSize: safeProperty(master, "BackgroundFullSize"),
        isBackgroundDark: safeProperty(master, "IsBackgroundDark"),
        shapeCount: safeCall(master, "getCount", 0),
        theme: normalizeUnoValue(
          safeProperty(master, "ThemeUnoRepresentation"),
        ),
      };
    });
  };
  const animationDetails = (page, shapeReferences, slideIndex) => {
    const root = safeCall(page, "getAnimationNode");
    if (!root) return { nodeCount: 0, roots: [] };
    let nodeCount = 0;
    let truncated = false;
    const targetDetails = (target) => {
      if (!target) return null;
      const paragraphTarget = safeMember(target, "Shape");
      const shape = paragraphTarget || target;
      for (const reference of shapeReferences) {
        try {
          if (uno.sameUnoObject(reference.shape, shape))
            return {
              elementId: reference.elementId,
              paragraphIndex:
                paragraphTarget &&
                Number.isInteger(Number(safeMember(target, "Paragraph")))
                  ? Number(safeMember(target, "Paragraph"))
                  : null,
            };
        } catch (_) {}
      }
      return null;
    };
    const visit = (node, path, depth) => {
      if (!node || nodeCount >= 200 || depth > 12) {
        truncated = true;
        return null;
      }
      nodeCount++;
      const children = [];
      try {
        const enumeration = node.createEnumeration();
        while (enumeration.hasMoreElements() && children.length < 50)
          children.push(enumeration.nextElement());
        if (enumeration.hasMoreElements()) truncated = true;
      } catch (_) {}
      const userData = normalizeUnoValue(safeMember(node, "UserData")) ?? [];
      const preset = Object.fromEntries(
        (Array.isArray(userData) ? userData : [])
          .filter(
            (entry) =>
              entry &&
              typeof entry.name === "string" &&
              entry.name.startsWith("preset-"),
          )
          .map((entry) => [entry.name.slice(7), entry.value]),
      );
      const semanticNodeType = (Array.isArray(userData) ? userData : []).find(
        (entry) => entry?.name === "node-type",
      )?.value;
      return {
        animationId: `${slideIndex}:${path.join("/")}`,
        kind: safeCall(node, "getImplementationName"),
        nodeType: safeMember(node, "Type"),
        semanticNodeType:
          typeof semanticNodeType === "number" ? semanticNodeType : null,
        begin: normalizeUnoValue(safeMember(node, "Begin")),
        duration: normalizeUnoValue(safeMember(node, "Duration")),
        end: normalizeUnoValue(safeMember(node, "End")),
        fill: safeMember(node, "Fill"),
        restart: safeMember(node, "Restart"),
        target: targetDetails(safeMember(node, "Target")),
        attributeName: safeMember(node, "AttributeName"),
        preset,
        childCount: children.length,
        children: children
          .map((child, index) => visit(child, [...path, index], depth + 1))
          .filter(Boolean),
      };
    };
    const rootNode = visit(root, [0], 0);
    const effects = [];
    const nextEffectIndexByElement = new Map();
    const collectEffects = (node) => {
      if (typeof node?.preset?.id === "string" && node.preset.id) {
        const targets = [];
        const durations = [];
        const collectSurface = (candidate) => {
          if (candidate.target?.elementId) targets.push(candidate.target);
          if (
            typeof candidate.duration === "number" &&
            Number.isFinite(candidate.duration)
          )
            durations.push(candidate.duration);
          candidate.children.forEach(collectSurface);
        };
        collectSurface(node);
        const target = targets[0] ?? null;
        if (target) {
          const effectIndex =
            nextEffectIndexByElement.get(target.elementId) ?? 0;
          nextEffectIndexByElement.set(target.elementId, effectIndex + 1);
          effects.push({
            animationId: node.animationId,
            elementId: target.elementId,
            paragraphIndex: target.paragraphIndex,
            effectIndex,
            preset: node.preset,
            start:
              {
                1: "on-click",
                2: "with-previous",
                3: "after-previous",
              }[node.semanticNodeType] ?? null,
            delay: typeof node.begin === "number" ? node.begin : null,
            duration: durations.length ? Math.max(...durations) : null,
          });
        }
      }
      node?.children.forEach(collectEffects);
    };
    if (rootNode) collectEffects(rootNode);
    return {
      nodeCount,
      truncated,
      roots: rootNode ? [rootNode] : [],
      effects,
    };
  };
  const cropFractions = (crop, size) => ({
    left: Math.round((Number(crop.Left) / Number(size.Width)) * 1e6) / 1e6,
    top: Math.round((Number(crop.Top) / Number(size.Height)) * 1e6) / 1e6,
    right: Math.round((Number(crop.Right) / Number(size.Width)) * 1e6) / 1e6,
    bottom: Math.round((Number(crop.Bottom) / Number(size.Height)) * 1e6) / 1e6,
  });
  const pictureDetails = (shape) => {
    const shapeType = safeCall(shape, "getShapeType");
    const fillStyle = enumName(safeProperty(shape, "FillStyle"));
    if (
      !String(shapeType).endsWith("GraphicObjectShape") &&
      !String(fillStyle).endsWith("BITMAP")
    )
      return null;
    const bitmap = safeProperty(shape, "Bitmap");
    const sourcePixelSize = safeCall(bitmap, "getSize");
    const sourceSize = safeProperty(bitmap, "Size100thMM");
    const crop = safeProperty(shape, "GraphicCrop");
    if (
      !sourcePixelSize ||
      !sourceSize ||
      !crop ||
      Number(sourcePixelSize.Width) <= 0 ||
      Number(sourcePixelSize.Height) <= 0 ||
      Number(sourceSize.Width) <= 0 ||
      Number(sourceSize.Height) <= 0
    )
      return null;
    return {
      sourcePixelSize: {
        width: Number(sourcePixelSize.Width),
        height: Number(sourcePixelSize.Height),
      },
      sourceSize: {
        width: Number(sourceSize.Width),
        height: Number(sourceSize.Height),
      },
      crop: cropFractions(crop, sourceSize),
    };
  };
  const chartSeriesState = (chart) => {
    if (!chart) return [];
    const columnFor = (sequence) => {
      const value = Number(sequence?.sourceRange);
      return Number.isInteger(value) && value >= 0 ? value : null;
    };
    return chart.chartTypes.flatMap((chartType) =>
      chartType.series.map((series, seriesIndex) => {
        const ySequence =
          series.sequences.find((sequence) => sequence.role === "values-y") ??
          series.sequences.find((sequence) => sequence.role === "values");
        const xSequence = series.sequences.find(
          (sequence) => sequence.role === "values-x",
        );
        const yColumn = columnFor(ySequence);
        const xColumn = columnFor(xSequence);
        return {
          label:
            ySequence?.label?.[0] ??
            (yColumn === null ? null : chart.columnDescriptions[yColumn]) ??
            `Series ${seriesIndex + 1}`,
          values:
            yColumn === null
              ? []
              : chart.data.map((row) => row[yColumn] ?? null),
          xValues:
            xColumn === null
              ? null
              : chart.data.map((row) => row[xColumn] ?? null),
        };
      }),
    );
  };
  const chartDetails = (shape) => {
    const chartModel = safeProperty(shape, "Model");
    const services = safeCall(chartModel, "getSupportedServiceNames", []);
    if (!services.includes("com.sun.star.chart2.ChartDocument")) return null;
    const diagram = safeCall(chartModel, "getFirstDiagram");
    const dataProvider = safeCall(chartModel, "getDataProvider");
    const fullData = safeCall(dataProvider, "getData", []);
    const rowDescriptions = safeCall(dataProvider, "getRowDescriptions", []);
    const columnDescriptions = safeCall(
      dataProvider,
      "getColumnDescriptions",
      [],
    );
    const maximumRows = 100;
    const maximumColumns = 50;
    const data = fullData
      .slice(0, maximumRows)
      .map((row) =>
        row.slice(0, maximumColumns).map((value) => normalizeUnoValue(value)),
      );
    const coordinateSystems = safeCall(diagram, "getCoordinateSystems", []);
    const chartTypes = coordinateSystems.flatMap((coordinateSystem) =>
      safeCall(coordinateSystem, "getChartTypes", []).map((chartType) => ({
        type: safeCall(chartType, "getChartType"),
        series: safeCall(chartType, "getDataSeries", []).map((series) => ({
          // Chart import, clipboard paste and PPTX reopen can return the same
          // role-addressed sequences in different array orders. Their Role
          // and source range carry the semantics, so canonicalize by those
          // stable fields before revisions or transaction checks see them.
          sequences: safeCall(series, "getDataSequences", [])
            .map((labeled) => {
              const values = safeCall(labeled, "getValues");
              const label = safeCall(labeled, "getLabel");
              return {
                role: values ? safeProperty(values, "Role") : null,
                sourceRange: values
                  ? safeCall(values, "getSourceRangeRepresentation")
                  : null,
                label: label
                  ? normalizeUnoValue(safeCall(label, "getData", []))
                  : null,
              };
            })
            .sort((left, right) =>
              `${left.role ?? ""}\u0000${left.sourceRange ?? ""}`.localeCompare(
                `${right.role ?? ""}\u0000${right.sourceRange ?? ""}`,
              ),
            ),
        })),
      })),
    );
    const xValueColumns = new Set(
      chartTypes.flatMap((chartType) =>
        chartType.series.flatMap((series) =>
          series.sequences
            .filter((sequence) => sequence.role === "values-x")
            .map((sequence) => Number(sequence.sourceRange))
            .filter(Number.isInteger),
        ),
      ),
    );
    const observedRowDescriptions = rowDescriptions.slice(0, maximumRows);
    const observedColumnDescriptions = columnDescriptions
      .slice(0, maximumColumns)
      .map((description, index) =>
        xValueColumns.has(index) ? "" : description,
      );
    return {
      internalData: Boolean(
        safeCall(chartModel, "hasInternalDataProvider", false),
      ),
      chartTypes,
      rowCount: fullData.length,
      columnCount: fullData.reduce(
        (maximum, row) => Math.max(maximum, row.length),
        0,
      ),
      rowDescriptions: observedRowDescriptions.some(Boolean)
        ? observedRowDescriptions
        : [],
      columnDescriptions: observedColumnDescriptions,
      data,
      truncated:
        fullData.length > maximumRows ||
        fullData.some((row) => row.length > maximumColumns),
    };
  };
  const diagramDetails = (shape, name) => {
    const importedAsGroup = String(
      safeCall(shape, "getShapeType", ""),
    ).endsWith("GroupShape");
    const diagramData = safeProperty(shape, "DiagramData");
    const engineMarksDiagram = safeProperty(shape, "IsDiagram") === true;
    const namedAsDiagram = /^Diagram(?:\s|$)/i.test(name);
    if (!engineMarksDiagram && !diagramData && !namedAsDiagram) return null;
    return {
      importedAsGroup,
      semanticModelAvailable: engineMarksDiagram && Boolean(diagramData),
      sourcePreservationDataAvailable: Boolean(
        safeProperty(shape, "InteropGrabBag"),
      ),
      childCount: childCount(shape),
    };
  };
  const resolveShape = (elementId) => {
    const path = elementId.split("/").map(Number);
    let container = pages.getByIndex(path.shift());
    let shape;
    for (const index of path) {
      shape = container.getByIndex(index);
      container = shape;
    }
    return shape;
  };

  function read(detailSlideIndex) {
    const slides = [];
    const masters = masterDetails();
    const selectedElementIds = [];
    const currentPage = controller.getCurrentPage();
    let selection;
    try {
      selection = controller.getSelection();
    } catch (_) {}
    const selected = (shape) => {
      if (!selection) return false;
      try {
        if (uno.sameUnoObject(shape, selection)) return true;
      } catch (_) {}
      try {
        for (let index = 0; index < selection.getCount(); index++)
          if (uno.sameUnoObject(shape, selection.getByIndex(index)))
            return true;
      } catch (_) {}
      return false;
    };

    let activeSlide = 0;
    for (let slideIndex = 0; slideIndex < pages.getCount(); slideIndex++) {
      const page = pages.getByIndex(slideIndex);
      if (uno.sameUnoObject(page, currentPage)) activeSlide = slideIndex;
      const elements = [];
      const shapeReferences = [];
      const visit = (container, prefix, parentElementId, stablePrefix) => {
        const nameOccurrences = {};
        for (let index = 0; index < container.getCount(); index++) {
          const shape = container.getByIndex(index);
          const elementId = `${prefix}/${index}`;
          const children = childCount(shape);
          const shapeKind = safeCall(shape, "getShapeType", "unknown");
          const objectName = safeCall(shape, "getName", "");
          const shapeName = objectName || `unnamed-${shapeKind}`;
          const occurrence = nameOccurrences[shapeName] ?? 0;
          nameOccurrences[shapeName] = occurrence + 1;
          const stableId = `${stablePrefix}/${encodeURIComponent(shapeName)}#${occurrence}`;
          shapeReferences.push({ elementId, shape });
          const position = shape.getPosition();
          const size = shape.getSize();
          const fillTransparency = safeProperty(shape, "FillTransparence");
          const lineTransparency = safeProperty(shape, "LineTransparence");
          let text = null;
          try {
            text = shape.getString();
          } catch (_) {}
          if (selected(shape)) selectedElementIds.push(elementId);
          elements.push({
            elementId,
            stableId,
            parentElementId,
            childElementIds: Array.from(
              { length: children },
              (_, child) => `${elementId}/${child}`,
            ),
            zIndex: index,
            name: shapeName,
            objectName,
            kind: shapeKind,
            presentationObject: safeProperty(shape, "IsPresentationObject"),
            emptyPresentationObject: safeProperty(
              shape,
              "IsEmptyPresentationObject",
            ),
            geometryType: shapeGeometryType(shape, shapeKind),
            propertyStates: shapePropertyStates(shape, text),
            text,
            wholeTextFormatting: wholeTextFormatting(shape, text),
            x: position.X,
            y: position.Y,
            width: size.Width,
            height: size.Height,
            rotation: safeProperty(shape, "RotateAngle"),
            fillStyle: enumName(safeProperty(shape, "FillStyle")),
            fill: safeProperty(shape, "FillColor"),
            lineColor: safeProperty(shape, "LineColor"),
            lineWidth: safeProperty(shape, "LineWidth"),
            fontFamily: safeProperty(shape, "CharFontName"),
            fontSize: safeProperty(shape, "CharHeight"),
            fontWeight: safeProperty(shape, "CharWeight"),
            fontStyle: enumName(safeProperty(shape, "CharPosture")),
            underline: safeProperty(shape, "CharUnderline"),
            strikethrough: safeTextProperty(shape, "CharStrikeout"),
            textShadow: safeTextProperty(shape, "CharShadowed"),
            color: safeProperty(shape, "CharColor"),
            paragraphAlignment: safeProperty(shape, "ParaAdjust"),
            textVerticalAlignment: enumName(
              safeProperty(shape, "TextVerticalAdjust"),
            ),
            textAutoGrowHeight: safeProperty(shape, "TextAutoGrowHeight"),
            textAutoGrowWidth: safeProperty(shape, "TextAutoGrowWidth"),
            textFitToSize: enumName(safeProperty(shape, "TextFitToSize")),
            textWordWrap: safeProperty(shape, "TextWordWrap"),
            textMargins: {
              left: safeProperty(shape, "TextLeftDistance"),
              right: safeProperty(shape, "TextRightDistance"),
              top: safeProperty(shape, "TextUpperDistance"),
              bottom: safeProperty(shape, "TextLowerDistance"),
            },
            characterSpacing: kerningTwipsToPoints(
              safeTextProperty(shape, "CharKerning"),
            ),
            scriptPosition: {
              escapement: safeTextProperty(shape, "CharEscapement"),
              relativeHeight: safeTextProperty(shape, "CharEscapementHeight"),
            },
            title: safeProperty(shape, "Title"),
            description: safeProperty(shape, "Description"),
            decorative: safeProperty(shape, "Decorative"),
            hyperlink: safeProperty(shape, "Hyperlink"),
            bookmark: safeProperty(shape, "Bookmark"),
            clickAction: enumName(safeProperty(shape, "OnClick")),
            presentationOrder: safeProperty(shape, "PresentationOrder"),
            moveProtected: safeProperty(shape, "MoveProtect"),
            sizeProtected: safeProperty(shape, "SizeProtect"),
            printable: safeProperty(shape, "Printable"),
            shadow: {
              enabled: safeProperty(shape, "Shadow"),
              color: safeProperty(shape, "ShadowColor"),
              transparency: safeProperty(shape, "ShadowTransparence"),
              offsetX: safeProperty(shape, "ShadowXDistance"),
              offsetY: safeProperty(shape, "ShadowYDistance"),
              blur: safeProperty(shape, "ShadowBlur"),
            },
            lineStyle: enumName(safeProperty(shape, "LineStyle")),
            lineDashName: safeProperty(shape, "LineDashName"),
            lineStartName: safeProperty(shape, "LineStartName"),
            lineEndName: safeProperty(shape, "LineEndName"),
            graphicCrop: safeProperty(shape, "GraphicCrop"),
            picture: pictureDetails(shape),
            fillOpacity:
              fillTransparency === null ? null : 100 - Number(fillTransparency),
            lineOpacity:
              lineTransparency === null ? null : 100 - Number(lineTransparency),
            mirroredX: safeProperty(shape, "MirroredX"),
            mirroredY: safeProperty(shape, "MirroredY"),
            table: tableDetails(shape),
            chart: chartDetails(shape),
            diagram: diagramDetails(shape, shapeName),
          });
          if (children) visit(shape, elementId, elementId, stableId);
        }
      };
      visit(
        page,
        String(slideIndex),
        null,
        `slide:${encodeURIComponent(page.getName() || String(slideIndex))}`,
      );
      const background = safeProperty(page, "Background");
      const layoutIssues = [];
      const pageWidth = page.getPropertyValue("Width");
      const pageHeight = page.getPropertyValue("Height");
      const pageArea = pageWidth * pageHeight;
      for (const element of elements) {
        element.alignedWith = [];
        element.overlapsWith = [];
        if (element.width <= 0 || element.height <= 0)
          layoutIssues.push({
            code: "invalid_size",
            elementId: element.elementId,
            stableId: element.stableId,
          });
        if (
          element.x < 0 ||
          element.y < 0 ||
          element.x + element.width > pageWidth ||
          element.y + element.height > pageHeight
        )
          layoutIssues.push({
            code: "out_of_slide_bounds",
            elementId: element.elementId,
            stableId: element.stableId,
            bounds: {
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
            },
          });
      }
      // Alignment, overlap relationships, and layout warnings share one
      // unordered pair scan. The previous implementation scanned both pair
      // directions and then scanned top-level pairs a third time.
      for (let leftIndex = 0; leftIndex < elements.length; leftIndex++) {
        const left = elements[leftIndex];
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < elements.length;
          rightIndex++
        ) {
          const right = elements[rightIndex];
          const edges = [];
          if (Math.abs(left.x - right.x) <= 10) edges.push("left");
          if (
            Math.abs(left.x + left.width / 2 - (right.x + right.width / 2)) <=
            10
          )
            edges.push("center_x");
          if (Math.abs(left.x + left.width - (right.x + right.width)) <= 10)
            edges.push("right");
          if (Math.abs(left.y - right.y) <= 10) edges.push("top");
          if (
            Math.abs(left.y + left.height / 2 - (right.y + right.height / 2)) <=
            10
          )
            edges.push("center_y");
          if (Math.abs(left.y + left.height - (right.y + right.height)) <= 10)
            edges.push("bottom");
          if (edges.length) {
            left.alignedWith.push({ elementId: right.elementId, edges });
            right.alignedWith.push({ elementId: left.elementId, edges });
          }
          const overlapWidth = Math.max(
            0,
            Math.min(left.x + left.width, right.x + right.width) -
              Math.max(left.x, right.x),
          );
          const overlapHeight = Math.max(
            0,
            Math.min(left.y + left.height, right.y + right.height) -
              Math.max(left.y, right.y),
          );
          if (overlapWidth > 0 && overlapHeight > 0) {
            left.overlapsWith.push(right.elementId);
            right.overlapsWith.push(left.elementId);
          }
          if (
            left.parentElementId !== null ||
            right.parentElementId !== null ||
            overlapWidth === 0 ||
            overlapHeight === 0 ||
            [left.kind, right.kind].some((kind) =>
              String(kind).endsWith("LineShape"),
            ) ||
            [left, right].some(
              (element) => element.width * element.height >= pageArea * 0.8,
            )
          )
            continue;
          const overlapArea = overlapWidth * overlapHeight;
          const smallerArea = Math.min(
            left.width * left.height,
            right.width * right.height,
          );
          if (smallerArea > 0 && overlapArea / smallerArea >= 0.2)
            layoutIssues.push({
              code: "possible_element_overlap",
              severity: "warning",
              elementIds: [left.elementId, right.elementId],
              stableIds: [left.stableId, right.stableId].sort(),
              overlapRatio:
                Math.round((overlapArea / smallerArea) * 1000) / 1000,
            });
        }
      }
      slides.push({
        slideIndex,
        name: page.getName(),
        width: pageWidth,
        height: pageHeight,
        backgroundColor: background
          ? safeProperty(background, "FillColor")
          : null,
        hidden: safeProperty(page, "Visible") === false,
        layout: safeProperty(page, "Layout"),
        masterName: (() => {
          try {
            return page.getMasterPage().getName();
          } catch (_) {
            return null;
          }
        })(),
        masterIndex: (() => {
          try {
            const master = page.getMasterPage();
            const masterPages = model.getMasterPages();
            for (let index = 0; index < masterPages.getCount(); index++)
              if (uno.sameUnoObject(masterPages.getByIndex(index), master))
                return index;
            return null;
          } catch (_) {
            return null;
          }
        })(),
        speakerNotes: notesDetails(page),
        transition: {
          type: safeProperty(page, "TransitionType"),
          subtype: safeProperty(page, "TransitionSubtype"),
          direction: safeProperty(page, "TransitionDirection"),
          duration: safeProperty(page, "TransitionDuration"),
          fadeColor: safeProperty(page, "TransitionFadeColor"),
          effect: enumName(safeProperty(page, "Effect")),
          speed: enumName(safeProperty(page, "Speed")),
        },
        timing: {
          duration: safeProperty(page, "Duration"),
          highResolutionDuration: safeProperty(page, "HighResDuration"),
        },
        animations: animationDetails(page, shapeReferences, slideIndex),
        footer: {
          visible: safeProperty(page, "IsFooterVisible"),
          text: safeProperty(page, "FooterText"),
          pageNumberVisible: safeProperty(page, "IsPageNumberVisible"),
          dateTimeVisible: safeProperty(page, "IsDateTimeVisible"),
          dateTimeFixed: safeProperty(page, "IsDateTimeFixed"),
          dateTimeText: safeProperty(page, "DateTimeText"),
          dateTimeFormat: safeProperty(page, "DateTimeFormat"),
        },
        backgroundObjectsVisible: safeProperty(
          page,
          "IsBackgroundObjectsVisible",
        ),
        topLevelElementCount: page.getCount(),
        elements,
        layoutIssues,
      });
    }
    const actionByUnoName = {
      NONE: "none",
      DOCUMENT: "external_url",
      BOOKMARK: "internal_slide",
      NEXTPAGE: "next_slide",
      PREVPAGE: "previous_slide",
      FIRSTPAGE: "first_slide",
      LASTPAGE: "last_slide",
      STOPPRESENTATION: "end_show",
    };
    const slideIndexByName = new Map(
      slides.map((slide) => [slide.name, slide.slideIndex]),
    );
    for (const slide of slides) {
      for (const element of slide.elements) {
        const unoAction = String(element.clickAction ?? "")
          .split(/[.:]/u)
          .at(-1)
          ?.toUpperCase();
        const mappedAction = actionByUnoName[unoAction] ?? "unsupported";
        const targetSlideIndex =
          mappedAction === "internal_slide"
            ? (slideIndexByName.get(element.bookmark) ?? null)
            : null;
        const action =
          mappedAction === "internal_slide" && targetSlideIndex === null
            ? "unsupported"
            : mappedAction;
        element.interaction = {
          action,
          url: action === "external_url" ? element.bookmark || null : null,
          targetSlideIndex:
            action === "internal_slide" ? targetSlideIndex : null,
        };
      }
    }
    const issues = slides.flatMap((slide) =>
      slide.layoutIssues.map((issue) => ({
        slideIndex: slide.slideIndex,
        ...issue,
      })),
    );
    const requestedDetailSlide =
      detailSlideIndex === undefined || detailSlideIndex === null
        ? activeSlide
        : detailSlideIndex;
    if (
      !Number.isInteger(requestedDetailSlide) ||
      requestedDetailSlide < 0 ||
      requestedDetailSlide >= slides.length
    )
      throw new Error("invalid_detail_slide");
    const detailedTextElements = slides[requestedDetailSlide]
      ? slides[requestedDetailSlide].elements
          .filter((element) => element.text !== null)
          .map((element) => ({
            elementId: element.elementId,
            paragraphs: textDetails(
              resolveShape(element.elementId),
              element.elementId,
            ),
          }))
          .filter((element) => element.paragraphs !== null)
      : [];
    // Master shapeCount is diagnostic only. Import/export may lazily
    // materialize empty layout placeholders without changing authored
    // content; the persistence validator applies the same rule. Keeping that
    // implementation count in a live concurrency revision makes a save look
    // like an unrelated user edit and prevents a real Undo from restoring its
    // prior revision.
    const revisionMasters = masters.map(
      ({ shapeCount: _shapeCount, ...master }) => master,
    );
    return {
      unit: "1/100mm",
      engine: engineIdentity,
      revision: revisionOf({ slides, masters: revisionMasters }),
      masters,
      slides,
      activeSlide,
      selectedElementIds,
      textDetails: {
        slideIndex: requestedDetailSlide,
        elements: detailedTextElements,
      },
      layoutAudit: { issueCount: issues.length, issues },
    };
  }

  function capture(slideIndex) {
    const page = pages.getByIndex(slideIndex);
    const out = uno.idl.com.sun.star.io.SequenceOutputStream.create(
      uno.componentContext,
    );
    const exporter = uno.idl.com.sun.star.drawing.GraphicExportFilter.create(
      uno.componentContext,
    );
    exporter.setSourceDocument(page);
    const filterData = [
      prop("PixelWidth", uno.type.long, 1280),
      prop(
        "PixelHeight",
        uno.type.long,
        Math.round(
          (1280 * page.getPropertyValue("Height")) /
            page.getPropertyValue("Width"),
        ),
      ),
    ];
    if (
      !exporter.filter([
        prop("MediaType", uno.type.string, "image/png"),
        prop(
          "OutputStream",
          uno.type.interface(uno.idl.com.sun.star.io.XOutputStream),
          out,
        ),
        prop(
          "FilterData",
          uno.type.sequence(
            uno.type.struct(uno.idl.com.sun.star.beans.PropertyValue),
          ),
          filterData,
        ),
      ])
    )
      throw new Error("capture_failed");
    return { slideIndex, pngBytes: out.getWrittenBytes() };
  }

  const layoutIssueKey = (issue) =>
    stableJson({
      slideIndex: issue.slideIndex,
      code: issue.code,
      stableId: issue.stableId ?? null,
      stableIds: issue.stableIds ?? null,
    });
  const withAuditDelta = (previous, next) => {
    const previousKeys = new Set(
      (previous.layoutAudit?.issues ?? []).map(layoutIssueKey),
    );
    const introducedIssues = (next.layoutAudit?.issues ?? []).filter(
      (issue) => !previousKeys.has(layoutIssueKey(issue)),
    );
    return {
      ...next.layoutAudit,
      introducedIssueCount: introducedIssues.length,
      introducedIssues,
    };
  };
  const visualEvidence = (
    previous,
    next,
    requestedSlideIndexes,
    fallbackSlideIndex,
    suppressCapture = false,
  ) => {
    const changed =
      documentStateJson(previous.slides) !== documentStateJson(next.slides);
    const changedSlideIndexes = changed
      ? [
          ...new Set(
            requestedSlideIndexes.filter(
              (slideIndex) =>
                Number.isInteger(slideIndex) &&
                slideIndex >= 0 &&
                slideIndex < next.slides.length,
            ),
          ),
        ].sort((left, right) => left - right)
      : [];
    if (
      changed &&
      changedSlideIndexes.length === 0 &&
      Number.isInteger(fallbackSlideIndex) &&
      fallbackSlideIndex >= 0 &&
      fallbackSlideIndex < next.slides.length
    )
      changedSlideIndexes.push(fallbackSlideIndex);
    const captureSlideIndexes = changedSlideIndexes.length
      ? changedSlideIndexes
      : [fallbackSlideIndex].filter(
          (slideIndex) =>
            Number.isInteger(slideIndex) &&
            slideIndex >= 0 &&
            slideIndex < next.slides.length,
        );
    return {
      changedSlideIndexes,
      images: suppressCapture
        ? []
        : captureSlideIndexes.map((slideIndex) => capture(slideIndex)),
      visualEvidenceComplete:
        !changed ||
        (!suppressCapture &&
          captureSlideIndexes.length === changedSlideIndexes.length),
    };
  };

  const detailSlideForCommand = (command) => {
    if (
      [
        "replace_text_range",
        "set_character_spacing",
        "set_script_position",
        "font_size",
        "bold",
        "italic",
        "font_family",
      ].includes(command?.op) &&
      typeof command.elementId === "string" &&
      /^\d+(?:\/\d+)+$/.test(command.elementId)
    )
      return Number(command.elementId.split("/")[0]);
    return null;
  };

  const executeSingle = (request) => {
    // Batch dry-runs all share the same immutable observation, and each
    // committed command already returns the next observation. Reusing it here
    // avoids rescanning the whole deck two or three times per command while
    // keeping the same revision and permission checks.
    const before =
      request.observedBefore ??
      read(
        request.operation === "observe"
          ? request.detailSlideIndex
          : detailSlideForCommand(request.command),
      );
    const result = (state, slideIndex) => ({
      ...state,
      layoutAudit: withAuditDelta(before, state),
      ...visualEvidence(
        before,
        state,
        [slideIndex],
        slideIndex,
        request.suppressCapture,
      ),
    });
    if (request.operation === "observe") {
      if (request.captureSlideIndexes !== undefined) {
        if (
          !Array.isArray(request.captureSlideIndexes) ||
          request.captureSlideIndexes.length > 8
        )
          throw new Error("invalid_capture_slide_indexes");
        const captureSlideIndexes = [
          ...new Set(request.captureSlideIndexes),
        ].sort((left, right) => left - right);
        if (
          captureSlideIndexes.some(
            (slideIndex) =>
              !Number.isInteger(slideIndex) ||
              slideIndex < 0 ||
              slideIndex >= before.slides.length,
          )
        )
          throw new Error("invalid_capture_slide_indexes");
        return {
          ...before,
          layoutAudit: withAuditDelta(before, before),
          changedSlideIndexes: [],
          images: captureSlideIndexes.map((slideIndex) => capture(slideIndex)),
          visualEvidenceComplete: true,
        };
      }
      return result(before, before.textDetails.slideIndex);
    }
    if (request.operation !== "edit")
      throw new Error("unsupported_native_operation");
    let expectedSlides;
    try {
      expectedSlides = JSON.parse(request.expectedSlides);
    } catch (_) {
      throw new Error("invalid_expected_document");
    }
    if (
      typeof request.expectedRevision === "string"
        ? before.revision !== request.expectedRevision
        : documentStateJson(before.slides) !== documentStateJson(expectedSlides)
    )
      throw new Error("document_changed_observe_again");

    const command = request.command;
    if (!command || typeof command.op !== "string")
      throw new Error("invalid_command");
    const mutationContract = mutationContractFor(command.op);
    const permission = request.permission;
    if (!permission || permission.mode === "read_only")
      throw new Error("read_only");
    const slideOperation = [
      "slide_structure",
      "slide_properties",
      "speaker_notes",
      "slide_transition",
    ].includes(mutationContract.family);
    if (slideOperation) {
      const slideIndex = command.slideIndex;
      if (
        !Number.isInteger(slideIndex) ||
        slideIndex < 0 ||
        slideIndex >= before.slides.length
      )
        throw new Error("invalid_slide_target");
      const documentOnly = ["insert_slide", "move_slide"].includes(command.op);
      const allowed =
        permission.mode === "document" ||
        (!documentOnly &&
          permission.mode === "slides" &&
          permission.slideIndexes.includes(slideIndex));
      if (!allowed) throw new Error("outside_edit_permission");
      if (command.op === "delete_slide" && before.slides.length === 1)
        throw new Error("cannot_delete_only_slide");
      if (
        command.op === "move_slide" &&
        (!Number.isInteger(command.targetSlideIndex) ||
          command.targetSlideIndex < 0 ||
          command.targetSlideIndex >= before.slides.length)
      )
        throw new Error("invalid_slide_destination");
      if (
        command.op === "set_slide_hidden" &&
        typeof command.hidden !== "boolean"
      )
        throw new Error("invalid_slide_visibility");
      if (
        command.op === "rename_slide" &&
        (typeof command.name !== "string" ||
          !command.name.trim() ||
          command.name.length > 255 ||
          /[\u0000-\u001f]/.test(command.name))
      )
        throw new Error("invalid_slide_name");
      if (
        command.op === "set_background" &&
        (!Number.isInteger(command.color) ||
          command.color < 0 ||
          command.color > 16777215)
      )
        throw new Error("invalid_background_color");
      if (
        command.op === "set_speaker_notes" &&
        (typeof command.text !== "string" || command.text.length > 50000)
      )
        throw new Error("invalid_speaker_notes");
      if (
        command.op === "set_slide_transition" &&
        ((!patchedSlideTransitionEngine && !runtimeSupports(command.op)) ||
          !Object.hasOwn(slideTransitionPresets, command.transitionEffect) ||
          typeof command.transitionDuration !== "number" ||
          !Number.isFinite(command.transitionDuration) ||
          command.transitionDuration < 0 ||
          command.transitionDuration > 60)
      )
        throw new Error(
          !patchedSlideTransitionEngine && !runtimeSupports(command.op)
            ? "native_engine_slide_transition_patch_required"
            : "invalid_slide_transition",
        );
      if (
        command.op === "set_slide_layout" &&
        !patchedSlideLayoutEngine &&
        !runtimeSupports(command.op)
      )
        throw new Error("native_engine_slide_layout_patch_required");
      if (
        command.op === "insert_slide" &&
        !patchedSlideInsertionEngine &&
        !runtimeSupports(command.op)
      )
        throw new Error("native_engine_slide_insertion_patch_required");
      if (
        command.op === "set_slide_layout" &&
        (!Number.isInteger(command.masterIndex) ||
          command.masterIndex < 0 ||
          command.masterIndex >= before.masters.length ||
          (command.layout !== null &&
            command.layout !== undefined &&
            command.layout !== before.masters[command.masterIndex].layout))
      )
        throw new Error("invalid_slide_layout");
      const selectedLayoutMaster =
        command.op === "set_slide_layout"
          ? before.masters[command.masterIndex]
          : null;
      if (
        selectedLayoutMaster &&
        before.slides[slideIndex].masterIndex === command.masterIndex &&
        before.slides[slideIndex].masterName === selectedLayoutMaster.name &&
        before.slides[slideIndex].layout === selectedLayoutMaster.layout
      )
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const targetPage = pages.getByIndex(slideIndex);
      const expectedPagesAfterDelete =
        command.op === "delete_slide"
          ? Array.from({ length: pages.getCount() }, (_, index) =>
              pages.getByIndex(index),
            ).filter((_, index) => index !== slideIndex)
          : null;
      if (command.op === "insert_slide")
        transformSlides([
          { JumpToSlide: slideIndex },
          { InsertMasterSlide: before.slides[slideIndex].masterIndex },
        ]);
      else if (command.op === "duplicate_slide")
        transformSlides([{ DuplicateSlide: slideIndex }]);
      else if (command.op === "delete_slide") {
        try {
          transformSlides([{ DeleteSlide: slideIndex }]);
        } catch (error) {
          throw new Error(
            `native_slide_delete_failed:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else if (command.op === "move_slide")
        transformSlides([
          {
            [`MoveSlide.${slideIndex}`]: command.targetSlideIndex,
          },
        ]);
      else if (command.op === "rename_slide")
        transformSlides([
          { JumpToSlide: slideIndex },
          { RenameSlide: command.name.trim() },
        ]);
      else if (command.op === "set_slide_hidden")
        transformSlides([
          { JumpToSlide: slideIndex },
          { SetSlideVisible: !command.hidden },
        ]);
      else if (command.op === "set_slide_layout")
        transformSlides([
          { JumpToSlide: slideIndex },
          {
            ChangeLayout: {
              MasterIndex: command.masterIndex,
              Layout: selectedLayoutMaster.layout,
            },
          },
        ]);
      else if (command.op === "set_background") {
        activateSlide(slideIndex);
        dispatch(".uno:FillPageColor", [
          prop("FillColor", uno.type.long, command.color),
        ]);
      } else if (command.op === "set_speaker_notes")
        transformSlides([
          { JumpToSlide: slideIndex },
          { SetNotes: command.text },
        ]);
      else if (command.op === "set_slide_transition")
        transformSlides([
          { JumpToSlide: slideIndex },
          {
            SetSlideTransition: {
              ...slideTransitionPresets[command.transitionEffect],
              Duration: command.transitionDuration,
            },
          },
        ]);
      else throw new Error("unsupported_slide_command");
      const after = read();
      const pageIndexAfter = () => {
        for (let index = 0; index < pages.getCount(); index++)
          if (uno.sameUnoObject(targetPage, pages.getByIndex(index)))
            return index;
        return -1;
      };
      const applied =
        command.op === "delete_slide"
          ? after.slides.length === before.slides.length - 1 &&
            pages.getCount() === expectedPagesAfterDelete.length &&
            expectedPagesAfterDelete.every((page, index) =>
              uno.sameUnoObject(page, pages.getByIndex(index)),
            )
          : ["insert_slide", "duplicate_slide"].includes(command.op)
            ? after.slides.length === before.slides.length + 1 &&
              pageIndexAfter() === slideIndex &&
              !uno.sameUnoObject(targetPage, pages.getByIndex(slideIndex + 1))
            : command.op === "move_slide"
              ? pageIndexAfter() === command.targetSlideIndex
              : command.op === "rename_slide"
                ? after.slides[pageIndexAfter()]?.name === command.name.trim()
                : command.op === "set_slide_hidden"
                  ? safeProperty(targetPage, "Visible") === !command.hidden
                  : command.op === "set_slide_layout"
                    ? after.slides[pageIndexAfter()]?.layout ===
                        selectedLayoutMaster.layout &&
                      after.slides[pageIndexAfter()]?.masterIndex ===
                        command.masterIndex &&
                      after.slides[pageIndexAfter()]?.masterName ===
                        selectedLayoutMaster.name
                    : command.op === "set_speaker_notes"
                      ? after.slides[pageIndexAfter()]?.speakerNotes?.text ===
                        command.text
                      : command.op === "set_slide_transition"
                        ? stableJson(
                            persistedSlideTransition(
                              after.slides[pageIndexAfter()]?.transition,
                            ),
                          ) ===
                          stableJson({
                            type: slideTransitionPresets[
                              command.transitionEffect
                            ].Type,
                            subtype:
                              slideTransitionPresets[command.transitionEffect]
                                .Subtype,
                            direction:
                              slideTransitionPresets[command.transitionEffect]
                                .Direction,
                            duration: command.transitionDuration,
                            fadeColor:
                              slideTransitionPresets[command.transitionEffect]
                                .FadeColor,
                          })
                        : after.slides[pageIndexAfter()]?.backgroundColor ===
                          command.color;
      const changed =
        documentStateJson(before.slides) !== documentStateJson(after.slides);
      if (
        !applied ||
        (changed &&
          !request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          !applied ? "native_command_not_applied" : "native_undo_not_recorded",
        );
      }
      return result(
        after,
        Math.min(after.activeSlide, after.slides.length - 1),
      );
    }
    const createOperation = ["add_text_box", "add_shape", "add_table"].includes(
      command.op,
    );
    if (createOperation) {
      const slideIndex = command.slideIndex;
      const finite = (value, min, max) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max;
      if (
        !Number.isInteger(slideIndex) ||
        slideIndex < 0 ||
        slideIndex >= before.slides.length
      )
        throw new Error("invalid_slide_target");
      if (
        permission.mode !== "document" &&
        !(
          permission.mode === "slides" &&
          permission.slideIndexes.includes(slideIndex)
        )
      )
        throw new Error("outside_edit_permission");
      if (
        !finite(command.x, -100000, 100000) ||
        !finite(command.y, -100000, 100000) ||
        !finite(command.width, 1, 100000) ||
        !finite(command.height, 1, 100000)
      )
        throw new Error("invalid_geometry");
      if (
        command.op === "add_text_box" &&
        (typeof command.text !== "string" || command.text.length > 10000)
      )
        throw new Error("invalid_text");
      if (
        command.op === "add_shape" &&
        (!["rectangle", "ellipse", "line"].includes(command.geometry) ||
          !Number.isInteger(command.color) ||
          command.color < 0 ||
          command.color > 16777215)
      )
        throw new Error("invalid_shape");
      if (
        command.op === "add_table" &&
        (!Array.isArray(command.cells) ||
          command.cells.length < 1 ||
          command.cells.length > 20 ||
          !Array.isArray(command.cells[0]) ||
          command.cells[0].length < 1 ||
          command.cells[0].length > 20 ||
          command.cells.some(
            (row) =>
              !Array.isArray(row) ||
              row.length !== command.cells[0].length ||
              row.some(
                (cell) => typeof cell !== "string" || cell.length > 2000,
              ),
          ) ||
          command.cells.flat().join("").length > 20000)
      )
        throw new Error("invalid_table");
      if (request.dryRun) return result(before, before.activeSlide);
      const page = pages.getByIndex(slideIndex);
      const objectNameStem =
        command.op === "add_text_box"
          ? "Text Box"
          : command.op === "add_table"
            ? "Table"
            : {
                rectangle: "Rectangle",
                ellipse: "Oval",
                line: "Line",
              }[command.geometry];
      const existingObjectNames = new Set(
        before.slides[slideIndex].elements
          .map((element) => element.objectName)
          .filter(Boolean),
      );
      let objectNameIndex = 1;
      while (existingObjectNames.has(`${objectNameStem} ${objectNameIndex}`))
        objectNameIndex++;
      const generatedObjectName = `${objectNameStem} ${objectNameIndex}`;
      if (command.op === "add_table") {
        const undo = model.getUndoManager();
        const undoCount = undo.getAllUndoActionTitles().length;
        const ownsUndoContext = !request.transactionActive;
        let undoContextOpen = false;
        const beforeIds = new Set(
          before.slides[slideIndex].elements
            .filter((element) => element.parentElementId === null)
            .map((element) => element.elementId),
        );
        try {
          if (ownsUndoContext) {
            undo.enterUndoContext("AI add table");
            undoContextOpen = true;
          }
          activateSlide(slideIndex);
          dispatch(".uno:InsertTable", [
            prop("Rows", uno.type.long, command.cells.length),
            prop("Columns", uno.type.long, command.cells[0].length),
          ]);
          const inserted = read();
          const tableElement = inserted.slides[slideIndex].elements.find(
            (element) =>
              element.parentElementId === null &&
              element.table &&
              !beforeIds.has(element.elementId),
          );
          if (!tableElement) throw new Error("native_command_not_applied");
          const tableShape = resolveShape(tableElement.elementId);
          tableShape.setName(generatedObjectName);
          tableShape.setPosition(
            new uno.idl.com.sun.star.awt.Point({
              X: Math.round(command.x),
              Y: Math.round(command.y),
            }),
          );
          tableShape.setSize(
            new uno.idl.com.sun.star.awt.Size({
              Width: Math.round(command.width),
              Height: Math.round(command.height),
            }),
          );
          const table = tableShape.getPropertyValue("Model");
          // XShape.setSize() changes the outer table rectangle but does not
          // necessarily distribute that geometry into the row/column model.
          // Keep both representations consistent so later structural edits
          // and their native Undo restore the exact rectangle.
          const distribute = (total, count) => {
            const base = Math.floor(total / count);
            return Array.from({ length: count }, (_, index) =>
              index === count - 1 ? total - base * (count - 1) : base,
            );
          };
          const rowHeights = distribute(
            Math.round(command.height),
            command.cells.length,
          );
          const columnWidths = distribute(
            Math.round(command.width),
            command.cells[0].length,
          );
          for (let row = 0; row < rowHeights.length; row++)
            table
              .getRows()
              .getByIndex(row)
              .setPropertyValue("Height", rowHeights[row]);
          for (let column = 0; column < columnWidths.length; column++)
            table
              .getColumns()
              .getByIndex(column)
              .setPropertyValue("Width", columnWidths[column]);
          for (let row = 0; row < command.cells.length; row++)
            for (let column = 0; column < command.cells[row].length; column++)
              table
                .getCellByPosition(column, row)
                .setString(command.cells[row][column]);
          if (undoContextOpen) {
            undo.leaveUndoContext();
            undoContextOpen = false;
          }
          const after = read();
          const target = after.slides[slideIndex].elements.find(
            (element) => element.elementId === tableElement.elementId,
          );
          const applied =
            target?.x === Math.round(command.x) &&
            target?.y === Math.round(command.y) &&
            target?.width === Math.round(command.width) &&
            target?.height === Math.round(command.height) &&
            stableJson(target?.table?.cells) === stableJson(command.cells);
          const undoActionsAdded =
            undo.getAllUndoActionTitles().length - undoCount;
          if (
            !applied ||
            (!request.transactionActive && undoActionsAdded !== 1)
          )
            throw new Error(
              !applied
                ? `native_command_not_applied:${stableJson({
                    expected: {
                      x: Math.round(command.x),
                      y: Math.round(command.y),
                      width: Math.round(command.width),
                      height: Math.round(command.height),
                      cells: command.cells,
                    },
                    actual: target
                      ? {
                          x: target.x,
                          y: target.y,
                          width: target.width,
                          height: target.height,
                          cells: target.table?.cells,
                          rowHeights: target.table?.rowHeights,
                          columnWidths: target.table?.columnWidths,
                        }
                      : null,
                  })}`
                : "native_undo_not_recorded",
            );
          return result(after, slideIndex);
        } catch (error) {
          if (!ownsUndoContext) throw error;
          if (undoContextOpen) {
            try {
              undo.leaveUndoContext();
            } catch (_) {}
          }
          while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
          const rolledBack = read();
          if (
            documentStateJson(rolledBack.slides) !==
            documentStateJson(before.slides)
          )
            throw new Error(
              `add_table_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}`,
            );
          throw error;
        }
      }
      const service =
        command.op === "add_text_box"
          ? "com.sun.star.drawing.TextShape"
          : {
              rectangle: "com.sun.star.drawing.RectangleShape",
              ellipse: "com.sun.star.drawing.EllipseShape",
              line: "com.sun.star.drawing.LineShape",
            }[command.geometry];
      const shape = model.createInstance(service);
      shape.setPosition(
        new uno.idl.com.sun.star.awt.Point({
          X: Math.round(command.x),
          Y: Math.round(command.y),
        }),
      );
      shape.setSize(
        new uno.idl.com.sun.star.awt.Size({
          Width: Math.round(command.width),
          Height: Math.round(command.height),
        }),
      );
      if (command.op !== "add_text_box" && command.geometry === "line")
        shape.setPropertyValue(
          "LineColor",
          new uno.Any(uno.type.long, command.color),
        );
      else if (command.op !== "add_text_box")
        shape.setPropertyValue(
          "FillColor",
          new uno.Any(uno.type.long, command.color),
        );
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const ownsUndoContext = !request.transactionActive;
      let undoContextOpen = false;
      activateSlide(slideIndex);
      const beforeStableIds = new Set(
        before.slides[slideIndex].elements
          .filter((element) => element.parentElementId === null)
          .map((element) => element.stableId),
      );
      try {
        if (ownsUndoContext) {
          undo.enterUndoContext(
            command.op === "add_text_box" ? "AI add text box" : "AI add shape",
          );
          undoContextOpen = true;
        }
        if (patchedObjectLifecycleEngine || runtimeSupports(command.op)) {
          // The patched Impress XShapes.add boundary records one native
          // creation action. Text must be assigned after insertion because an
          // unattached UNO TextShape does not retain its text model.
          page.add(shape);
          shape.setName(generatedObjectName);
          if (command.op === "add_text_box") shape.setString(command.text);
        } else {
          page.add(shape);
          if (command.op === "add_text_box") shape.setString(command.text);
          controller.select(shape);
          // Compatibility path for older engines. The strict semantic check
          // below rejects the command if clipboard paste changes its content
          // or geometry, so an old runtime fails closed.
          dispatch(".uno:Copy");
          page.remove(shape);
          dispatch(".uno:Paste");
          const pasted = read().slides[slideIndex].elements.find(
            (element) =>
              element.parentElementId === null &&
              !beforeStableIds.has(element.stableId),
          );
          if (!pasted) throw new Error("native_command_not_applied");
          resolveShape(pasted.elementId).setName(generatedObjectName);
        }
        if (undoContextOpen) {
          undo.leaveUndoContext();
          undoContextOpen = false;
        }
      } catch (error) {
        if (!ownsUndoContext) throw error;
        if (undoContextOpen) {
          try {
            undo.leaveUndoContext();
          } catch (_) {}
        }
        while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        const rolledBack = read();
        if (
          documentStateJson(rolledBack.slides) !==
          documentStateJson(before.slides)
        )
          throw new Error(
            `${command.op}_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}`,
          );
        throw error;
      }
      const after = read();
      const created = after.slides[slideIndex].elements.find(
        (element) =>
          element.parentElementId === null &&
          !beforeStableIds.has(element.stableId),
      );
      const geometryApplied =
        created?.x === Math.round(command.x) &&
        created?.y === Math.round(command.y) &&
        created?.width === Math.round(command.width) &&
        created?.height === Math.round(command.height);
      const contentApplied =
        command.op === "add_text_box"
          ? created?.text === command.text
          : command.geometry === "line"
            ? created?.lineColor === Math.round(command.color)
            : created?.fill === Math.round(command.color);
      const applied =
        after.slides[slideIndex].topLevelElementCount ===
          before.slides[slideIndex].topLevelElementCount + 1 &&
        geometryApplied &&
        contentApplied;
      if (
        !applied ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length - undoCount !== 1)
      ) {
        const error = new Error(
          !applied
            ? `native_command_not_applied:${stableJson({
                expected: {
                  x: Math.round(command.x),
                  y: Math.round(command.y),
                  width: Math.round(command.width),
                  height: Math.round(command.height),
                  text:
                    command.op === "add_text_box" ? command.text : undefined,
                  color: command.op === "add_shape" ? command.color : undefined,
                },
                actual: created
                  ? {
                      x: created.x,
                      y: created.y,
                      width: created.width,
                      height: created.height,
                      text: created.text,
                      fill: created.fill,
                      lineColor: created.lineColor,
                    }
                  : null,
              })}`
            : "native_undo_not_recorded",
        );
        if (!ownsUndoContext) throw error;
        while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        const rolledBack = read();
        if (
          documentStateJson(rolledBack.slides) !==
          documentStateJson(before.slides)
        )
          throw new Error(
            `${command.op}_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}`,
          );
        throw error;
      }
      return result(after, slideIndex);
    }
    const multiOperation = ["align", "distribute", "group"].includes(
      command.op,
    );
    if (multiOperation) {
      const elementIds = command.elementIds;
      const minimum = command.op === "distribute" ? 3 : 2;
      if (
        !Array.isArray(elementIds) ||
        elementIds.length < minimum ||
        elementIds.length > 12 ||
        new Set(elementIds).size !== elementIds.length ||
        elementIds.some((id) => !/^\d+\/\d+$/.test(id))
      )
        throw new Error("invalid_targets");
      const slideIndexes = new Set(
        elementIds.map((elementId) => Number(elementId.split("/")[0])),
      );
      if (slideIndexes.size !== 1) throw new Error("targets_span_slides");
      const slideIndex = Number(elementIds[0].split("/")[0]);
      const elements = elementIds.map((elementId) =>
        before.slides[slideIndex]?.elements.find(
          (candidate) => candidate.elementId === elementId,
        ),
      );
      if (
        elements.some(
          (element) =>
            !element ||
            element.parentElementId !== null ||
            element.childElementIds.length,
        )
      )
        throw new Error("unsupported_structural_target");
      const allowed =
        permission.mode === "document" ||
        (permission.mode === "slides" &&
          permission.slideIndexes.includes(slideIndex)) ||
        (permission.mode === "selection" &&
          elementIds.every((elementId) =>
            permission.elementIds.includes(elementId),
          ));
      if (!allowed) throw new Error("outside_edit_permission");
      const commands = {
        align: {
          left: ".uno:ObjectAlignLeft",
          center: ".uno:AlignCenter",
          right: ".uno:ObjectAlignRight",
          top: ".uno:AlignUp",
          middle: ".uno:AlignMiddle",
          bottom: ".uno:AlignDown",
        },
        distribute: {
          horizontal: ".uno:DistributeHorzDistance",
          vertical: ".uno:DistributeVertDistance",
        },
      };
      const unoCommand =
        command.op === "group"
          ? ".uno:FormatGroup"
          : commands[command.op]?.[command.alignment ?? command.axis];
      if (!unoCommand) throw new Error("invalid_command_option");
      if (request.dryRun) return result(before, before.activeSlide);
      const collection = uno.idl.com.sun.star.drawing.ShapeCollection.create(
        uno.componentContext,
      );
      for (const elementId of elementIds)
        collection.add(resolveShape(elementId));
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      activateSlide(slideIndex);
      controller.select(collection);
      dispatch(unoCommand);
      const after = read();
      const changed =
        documentStateJson(before.slides) !== documentStateJson(after.slides);
      const grouped =
        command.op !== "group" ||
        after.slides[slideIndex].topLevelElementCount ===
          before.slides[slideIndex].topLevelElementCount -
            elementIds.length +
            1;
      if (
        (changed &&
          !request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount) ||
        !grouped
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          !grouped ? "native_command_not_applied" : "native_undo_not_recorded",
        );
      }
      return result(changed ? after : before, slideIndex);
    }
    if (!/^\d+(?:\/\d+)+$/.test(command.elementId ?? ""))
      throw new Error("invalid_target");
    const slideIndex = Number(command.elementId.split("/")[0]);
    const element = before.slides[slideIndex]?.elements.find(
      (candidate) => candidate.elementId === command.elementId,
    );
    if (!element) throw new Error("invalid_target");
    const allowed =
      permission.mode === "document" ||
      (permission.mode === "slides" &&
        permission.slideIndexes.includes(slideIndex)) ||
      (permission.mode === "selection" &&
        permission.elementIds.includes(command.elementId));
    if (!allowed) throw new Error("outside_edit_permission");

    if (command.op === "set_object_interaction") {
      if (!patchedObjectInteractionEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_object_interaction_patch_required");
      const actions = new Set([
        "none",
        "external_url",
        "internal_slide",
        "next_slide",
        "previous_slide",
        "first_slide",
        "last_slide",
        "end_show",
      ]);
      if (!actions.has(command.interaction))
        throw new Error("invalid_object_interaction");
      let normalizedUrl = null;
      let targetSlideIndex = null;
      if (command.interaction === "external_url") {
        if (
          typeof command.url !== "string" ||
          !command.url ||
          command.url.length > 2048 ||
          (command.targetSlideIndex !== null &&
            command.targetSlideIndex !== undefined)
        )
          throw new Error("invalid_external_link");
        let parsed;
        try {
          parsed = new URL(command.url);
        } catch (_) {
          throw new Error("invalid_external_link");
        }
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          !parsed.hostname
        )
          throw new Error("unsafe_external_link");
        normalizedUrl = parsed.href;
      } else if (command.interaction === "internal_slide") {
        if (
          (command.url !== null && command.url !== undefined) ||
          !Number.isInteger(command.targetSlideIndex) ||
          command.targetSlideIndex < 0 ||
          command.targetSlideIndex >= before.slides.length
        )
          throw new Error("invalid_internal_slide_link");
        targetSlideIndex = command.targetSlideIndex;
      } else if (
        (command.url !== null && command.url !== undefined) ||
        (command.targetSlideIndex !== null &&
          command.targetSlideIndex !== undefined)
      ) {
        throw new Error("unexpected_interaction_target");
      }
      const expectedInteraction = {
        action: command.interaction,
        url: normalizedUrl,
        targetSlideIndex,
      };
      if (stableJson(element.interaction) === stableJson(expectedInteraction))
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const objectPath = command.elementId.split("/").slice(1).join("/");
      const payload = { Action: command.interaction };
      if (normalizedUrl !== null) payload.Target = normalizedUrl;
      if (targetSlideIndex !== null)
        payload.TargetSlideIndex = targetSlideIndex;
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      transformSlides([
        { JumpToSlide: slideIndex },
        { [`SetObjectInteraction.${objectPath}`]: payload },
      ]);
      const after = read();
      const target = after.slides[slideIndex]?.elements.find(
        (candidate) => candidate.elementId === command.elementId,
      );
      const stripInteractions = (slides) =>
        slides.map((slide) => ({
          ...slide,
          elements: slide.elements.map(
            ({ interaction, bookmark, clickAction, ...candidate }) => candidate,
          ),
        }));
      const unrelatedChanged =
        documentStateJson(after.masters) !==
          documentStateJson(before.masters) ||
        documentStateJson(stripInteractions(after.slides)) !==
          documentStateJson(stripInteractions(before.slides));
      const applied =
        target &&
        stableJson(target.interaction) === stableJson(expectedInteraction);
      if (
        !applied ||
        unrelatedChanged ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          unrelatedChanged
            ? "unexpected_edit_scope"
            : !applied
              ? "native_command_not_applied"
              : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    if (command.op === "set_animation_timing") {
      if (!patchedAnimationTimingEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_animation_timing_patch_required");
      if (
        element.parentElementId !== null ||
        !/^\d+\/\d+$/.test(command.elementId) ||
        typeof command.animationId !== "string" ||
        typeof command.duration !== "number" ||
        !Number.isFinite(command.duration) ||
        command.duration < 0.001 ||
        command.duration > 60 ||
        typeof command.delay !== "number" ||
        !Number.isFinite(command.delay) ||
        command.delay < 0 ||
        command.delay > 60 ||
        !["on-click", "with-previous", "after-previous"].includes(command.start)
      )
        throw new Error("invalid_animation_timing");
      const effect = before.slides[slideIndex]?.animations?.effects?.find(
        (candidate) =>
          candidate.animationId === command.animationId &&
          candidate.elementId === command.elementId,
      );
      if (
        !effect ||
        !Number.isInteger(effect.effectIndex) ||
        typeof effect.preset?.id !== "string" ||
        !effect.preset.id ||
        effect.preset.id.length > 128
      )
        throw new Error("observed_animation_effect_not_found");
      if (
        effect.duration === command.duration &&
        effect.delay === command.delay &&
        effect.start === command.start
      )
        return result(before, slideIndex);
      if (request.dryRun) return result(before, slideIndex);

      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      transformSlides([
        { JumpToSlide: slideIndex },
        {
          [`SetAnimationTiming.${element.zIndex}`]: {
            EffectIndex: effect.effectIndex,
            ExpectedPresetId: effect.preset.id,
            Duration: command.duration,
            Delay: command.delay,
            Start: command.start,
          },
        },
      ]);
      const after = read();
      const afterEffect = after.slides[slideIndex]?.animations?.effects?.find(
        (candidate) =>
          candidate.animationId === command.animationId &&
          candidate.elementId === command.elementId,
      );
      const withoutAnimations = (slides) =>
        slides.map((slide) => ({ ...slide, animations: null }));
      const otherEffects = (state) =>
        state.slides[slideIndex].animations.effects.filter(
          (candidate) => candidate.animationId !== command.animationId,
        );
      const applied =
        afterEffect?.duration === command.duration &&
        afterEffect.delay === command.delay &&
        afterEffect.start === command.start;
      const unrelatedChanged =
        documentStateJson(after.masters) !==
          documentStateJson(before.masters) ||
        documentStateJson(withoutAnimations(after.slides)) !==
          documentStateJson(withoutAnimations(before.slides)) ||
        stableJson(otherEffects(after)) !== stableJson(otherEffects(before));
      if (
        !applied ||
        unrelatedChanged ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          unrelatedChanged
            ? "unexpected_edit_scope"
            : !applied
              ? "native_command_not_applied"
              : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    if (command.op === "replace_text_range") {
      if (!patchedTextRangeEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_text_range_patch_required");
      if (
        element.parentElementId !== null ||
        !/^\d+\/\d+$/.test(command.elementId)
      )
        throw new Error("unsupported_nested_text_range_target");
      if (
        typeof command.paragraphId !== "string" ||
        !Number.isInteger(command.startOffset) ||
        !Number.isInteger(command.endOffset) ||
        command.startOffset < 0 ||
        command.endOffset < command.startOffset ||
        typeof command.expectedText !== "string" ||
        typeof command.text !== "string" ||
        command.expectedText.length > 10000 ||
        command.text.length > 10000 ||
        /[\r\n]/.test(command.text)
      )
        throw new Error("invalid_text_range");
      if (before.textDetails?.slideIndex !== slideIndex)
        throw new Error("observe_text_details_for_target_slide_first");
      const details = before.textDetails.elements.find(
        (candidate) => candidate.elementId === command.elementId,
      );
      const paragraph = details?.paragraphs.find(
        (candidate) => candidate.paragraphId === command.paragraphId,
      );
      if (!paragraph) throw new Error("observed_paragraph_not_found");
      const paragraphIndex = paragraph.paragraphIndex;
      const localStart = command.startOffset - paragraph.startOffset;
      const localEnd = command.endOffset - paragraph.startOffset;
      if (
        !Number.isInteger(paragraphIndex) ||
        localStart < 0 ||
        localEnd < localStart ||
        localEnd > paragraph.text.length ||
        paragraph.text.slice(localStart, localEnd) !== command.expectedText
      )
        throw new Error("observed_text_range_changed");
      if (command.expectedText === command.text)
        return result(before, slideIndex);
      if (request.dryRun) return result(before, slideIndex);

      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const objectIndex = Number(command.elementId.split("/")[1]);
      transformSlides([
        { JumpToSlide: slideIndex },
        {
          [`SetTextRange.${objectIndex}`]: {
            Paragraph: paragraphIndex,
            Start: localStart,
            End: localEnd,
            ExpectedText: command.expectedText,
            Text: command.text,
          },
        },
      ]);
      const after = read(slideIndex);
      const afterParagraph = after.textDetails.elements
        .find((candidate) => candidate.elementId === command.elementId)
        ?.paragraphs.find(
          (candidate) => candidate.paragraphIndex === paragraphIndex,
        );
      const expectedParagraph =
        paragraph.text.slice(0, localStart) +
        command.text +
        paragraph.text.slice(localEnd);
      const unrelatedChanged = before.slides.some((slide, index) =>
        slide.elements.some((candidate) => {
          if (index === slideIndex && candidate.elementId === command.elementId)
            return false;
          const next = after.slides[index]?.elements.find(
            (value) => value.elementId === candidate.elementId,
          );
          return documentStateJson(candidate) !== documentStateJson(next);
        }),
      );
      const applied = afterParagraph?.text === expectedParagraph;
      if (
        !applied ||
        unrelatedChanged ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          unrelatedChanged
            ? "unexpected_edit_scope"
            : !applied
              ? "native_command_not_applied"
              : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    if (command.op === "set_character_spacing") {
      if (!patchedTextPropertiesEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_text_property_patch_required");
      if (
        typeof command.spacing !== "number" ||
        !Number.isFinite(command.spacing) ||
        command.spacing < -100 ||
        command.spacing > 100
      )
        throw new Error("invalid_character_spacing");
      if (
        (!patchedTextFormattingEngine &&
          !runtimeSupports(command.op) &&
          element.parentElementId !== null) ||
        !element.text
      )
        throw new Error("unsupported_character_spacing_target");

      // The typed engine command accepts 1/100 mm, then stores kerning in
      // integer twips. Readback is normalized back to PowerPoint points.
      const nativeSpacing = pointsToKerningMm100(command.spacing);
      const expectedSpacing = kerningTwipsToPoints(
        mm100ToKerningTwips(nativeSpacing),
      );
      const beforeDetails = read(slideIndex);
      const beforePortions =
        beforeDetails.textDetails.elements
          .find((candidate) => candidate.elementId === command.elementId)
          ?.paragraphs.flatMap((paragraph) => paragraph.portions) ?? [];
      if (
        beforePortions.length > 0 &&
        beforePortions.every(
          (portion) => Number(portion.spacing ?? 0) === expectedSpacing,
        )
      )
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const objectPath = command.elementId.split("/").slice(1).join("/");
      transformSlides([
        { JumpToSlide: slideIndex },
        {
          [`SetTextProperties.${objectPath}`]: {
            Kerning: nativeSpacing,
          },
        },
      ]);

      const after = read(slideIndex);
      const afterPortions =
        after.textDetails.elements
          .find((candidate) => candidate.elementId === command.elementId)
          ?.paragraphs.flatMap((paragraph) => paragraph.portions) ?? [];
      const unrelatedChanged = before.slides.some((slide, index) =>
        slide.elements.some((candidate) => {
          if (index === slideIndex && candidate.elementId === command.elementId)
            return false;
          const next = after.slides[index]?.elements.find(
            (value) => value.elementId === candidate.elementId,
          );
          return documentStateJson(candidate) !== documentStateJson(next);
        }),
      );
      const applied =
        afterPortions.length > 0 &&
        afterPortions.every(
          (portion) => Number(portion.spacing ?? 0) === expectedSpacing,
        );
      if (
        !applied ||
        unrelatedChanged ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          unrelatedChanged
            ? "unexpected_edit_scope"
            : !applied
              ? `native_command_not_applied:expected_${expectedSpacing}:observed_${afterPortions
                  .map((portion) => Number(portion.spacing ?? 0))
                  .join(",")}`
              : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    if (command.op === "set_script_position") {
      if (!patchedTextPropertiesEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_text_property_patch_required");
      const expectedScript = {
        normal: [0, 100],
        superscript: [33, 58],
        subscript: [-33, 58],
      }[command.script];
      if (!expectedScript) throw new Error("invalid_script_position");
      if (
        (!patchedTextFormattingEngine &&
          !runtimeSupports(command.op) &&
          element.parentElementId !== null) ||
        !element.text
      )
        throw new Error("unsupported_script_position_target");

      const portionsFor = (state) =>
        state.textDetails.elements
          .find((candidate) => candidate.elementId === command.elementId)
          ?.paragraphs.flatMap((paragraph) => paragraph.portions) ?? [];
      const hasScript = (portions, [escapement, relativeHeight]) =>
        portions.length > 0 &&
        portions.every(
          (portion) =>
            Number(portion.escapement ?? 0) === escapement &&
            Number(portion.escapementHeight ?? 100) === relativeHeight,
        );
      const beforeDetails = read(slideIndex);
      const beforePortions = portionsFor(beforeDetails);
      if (hasScript(beforePortions, expectedScript))
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const objectPath = command.elementId.split("/").slice(1).join("/");
      transformSlides([
        { JumpToSlide: slideIndex },
        {
          [`SetTextProperties.${objectPath}`]: {
            Escapement: expectedScript[0],
            EscapementHeight: expectedScript[1],
          },
        },
      ]);

      const after = read(slideIndex);
      const afterPortions = portionsFor(after);
      const unrelatedChanged = before.slides.some((slide, index) =>
        slide.elements.some((candidate) => {
          if (index === slideIndex && candidate.elementId === command.elementId)
            return false;
          const next = after.slides[index]?.elements.find(
            (value) => value.elementId === candidate.elementId,
          );
          return documentStateJson(candidate) !== documentStateJson(next);
        }),
      );
      const applied = hasScript(afterPortions, expectedScript);
      if (
        !applied ||
        unrelatedChanged ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          unrelatedChanged
            ? "unexpected_edit_scope"
            : !applied
              ? "native_command_not_applied"
              : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    const objectPropertyOperations = new Set([
      "set_alt_text",
      "set_shape_name",
      "set_text_box",
      "set_shape_shadow",
      "set_object_lock",
      "set_printable",
    ]);
    if (objectPropertyOperations.has(command.op)) {
      if (!patchedObjectPropertyEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_object_property_patch_required");
      if (element.parentElementId !== null)
        throw new Error("unsupported_nested_property_target");
      const finite = (value, min, max) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max;
      const optionalBoolean = (value) =>
        value === null || value === undefined || typeof value === "boolean";
      const optionalText = (value, maximum) =>
        value === null ||
        value === undefined ||
        (typeof value === "string" &&
          value.length <= maximum &&
          !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
      const properties = {};
      if (command.op === "set_alt_text") {
        if (
          !optionalText(command.title, 1024) ||
          !optionalText(command.description, 4096) ||
          !optionalBoolean(command.decorative)
        )
          throw new Error("invalid_alt_text");
        if (command.title !== null && command.title !== undefined)
          properties.Title = command.title;
        if (command.description !== null && command.description !== undefined)
          properties.Description = command.description;
        if (command.decorative !== null && command.decorative !== undefined)
          properties.Decorative = command.decorative;
      } else if (command.op === "set_shape_name") {
        if (
          typeof command.name !== "string" ||
          !command.name.trim() ||
          command.name.length > 255 ||
          /[\u0000-\u001f]/.test(command.name)
        )
          throw new Error("invalid_shape_name");
        properties.Name = command.name.trim();
      } else if (command.op === "set_text_box") {
        for (const [inputName, propertyName] of [
          ["marginLeft", "TextLeftDistance"],
          ["marginRight", "TextRightDistance"],
          ["marginTop", "TextUpperDistance"],
          ["marginBottom", "TextLowerDistance"],
        ]) {
          const value = command[inputName];
          if (value !== null && value !== undefined) {
            if (!finite(value, 0, 100000))
              throw new Error("invalid_text_box_margin");
            properties[propertyName] = Math.round(value);
          }
        }
        for (const [inputName, propertyName] of [
          ["autoGrowHeight", "TextAutoGrowHeight"],
          ["autoGrowWidth", "TextAutoGrowWidth"],
          ["wordWrap", "TextWordWrap"],
        ]) {
          const value = command[inputName];
          if (!optionalBoolean(value))
            throw new Error("invalid_text_box_behavior");
          if (value !== null && value !== undefined)
            properties[propertyName] = value;
        }
      } else if (command.op === "set_shape_shadow") {
        if (
          typeof command.shadow !== "boolean" ||
          (command.color !== null &&
            command.color !== undefined &&
            !Number.isInteger(command.color)) ||
          (command.color !== null &&
            command.color !== undefined &&
            !finite(command.color, 0, 16777215)) ||
          (command.opacity !== null &&
            command.opacity !== undefined &&
            !finite(command.opacity, 0, 100)) ||
          (command.shadowOffsetX !== null &&
            command.shadowOffsetX !== undefined &&
            !finite(command.shadowOffsetX, -100000, 100000)) ||
          (command.shadowOffsetY !== null &&
            command.shadowOffsetY !== undefined &&
            !finite(command.shadowOffsetY, -100000, 100000)) ||
          (command.shadowBlur !== null &&
            command.shadowBlur !== undefined &&
            !finite(command.shadowBlur, 0, 100000))
        )
          throw new Error("invalid_shape_shadow");
        properties.Shadow = command.shadow;
        if (command.color !== null && command.color !== undefined)
          properties.ShadowColor = Math.round(command.color);
        if (command.opacity !== null && command.opacity !== undefined)
          properties.ShadowTransparence = 100 - Math.round(command.opacity);
        if (
          command.shadowOffsetX !== null &&
          command.shadowOffsetX !== undefined
        )
          properties.ShadowXDistance = Math.round(command.shadowOffsetX);
        if (
          command.shadowOffsetY !== null &&
          command.shadowOffsetY !== undefined
        )
          properties.ShadowYDistance = Math.round(command.shadowOffsetY);
        if (command.shadowBlur !== null && command.shadowBlur !== undefined)
          properties.ShadowBlur = Math.round(command.shadowBlur);
      } else if (command.op === "set_object_lock") {
        if (
          !optionalBoolean(command.lockPosition) ||
          !optionalBoolean(command.lockSize)
        )
          throw new Error("invalid_object_lock");
        if (command.lockPosition !== null && command.lockPosition !== undefined)
          properties.MoveProtect = command.lockPosition;
        if (command.lockSize !== null && command.lockSize !== undefined)
          properties.SizeProtect = command.lockSize;
      } else if (command.op === "set_printable") {
        if (typeof command.printable !== "boolean")
          throw new Error("invalid_printable");
        properties.Printable = command.printable;
      }
      if (!Object.keys(properties).length)
        throw new Error("no_object_properties_supplied");
      const expected = {
        Name: "objectName",
        Title: "title",
        Description: "description",
        Decorative: "decorative",
        TextLeftDistance: ["textMargins", "left"],
        TextRightDistance: ["textMargins", "right"],
        TextUpperDistance: ["textMargins", "top"],
        TextLowerDistance: ["textMargins", "bottom"],
        TextAutoGrowHeight: "textAutoGrowHeight",
        TextAutoGrowWidth: "textAutoGrowWidth",
        TextWordWrap: "textWordWrap",
        Shadow: ["shadow", "enabled"],
        ShadowColor: ["shadow", "color"],
        ShadowTransparence: ["shadow", "transparency"],
        ShadowXDistance: ["shadow", "offsetX"],
        ShadowYDistance: ["shadow", "offsetY"],
        ShadowBlur: ["shadow", "blur"],
        MoveProtect: "moveProtected",
        SizeProtect: "sizeProtected",
        Printable: "printable",
      };
      const readPath = (value, path) =>
        (Array.isArray(path) ? path : [path]).reduce(
          (candidate, key) => candidate?.[key],
          value,
        );
      const unchanged = Object.entries(properties).every(
        ([name, value]) => readPath(element, expected[name]) === value,
      );
      if (unchanged) return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const objectIndex = Number(command.elementId.split("/")[1]);
      transformSlides([
        { JumpToSlide: slideIndex },
        { [`SetObjectProperties.${objectIndex}`]: properties },
      ]);
      const after = read();
      const target = after.slides[slideIndex].elements.find(
        (candidate) => candidate.elementId === command.elementId,
      );
      const applied =
        target &&
        Object.entries(properties).every(
          ([name, value]) => readPath(target, expected[name]) === value,
        );
      if (
        !applied ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          !applied ? "native_command_not_applied" : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    if (command.op === "set_table_cell_format") {
      if (!patchedTableCellPropertiesEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_table_cell_property_patch_required");
      if (
        !element.table ||
        !Number.isInteger(command.row) ||
        !Number.isInteger(command.column) ||
        command.row < 0 ||
        command.column < 0 ||
        command.row >= element.table.rows ||
        command.column >= element.table.columns ||
        !command.tableCellFormat ||
        typeof command.tableCellFormat !== "object" ||
        Array.isArray(command.tableCellFormat)
      )
        throw new Error("invalid_table_cell_format");
      const format = command.tableCellFormat;
      const allowedKeys = new Set([
        "fillColor",
        "fillOpacity",
        "fontColor",
        "fontSize",
        "fontFamily",
        "bold",
        "underline",
        "strikethrough",
        "textShadow",
        "characterSpacing",
        "paragraphAlignment",
        "marginLeft",
        "marginRight",
        "marginTop",
        "marginBottom",
        "borderTop",
        "borderRight",
        "borderBottom",
        "borderLeft",
      ]);
      if (Object.keys(format).some((key) => !allowedKeys.has(key)))
        throw new Error("unsupported_table_cell_format_property");
      const optionalFinite = (value, minimum, maximum) =>
        value === null ||
        value === undefined ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          value >= minimum &&
          value <= maximum);
      const optionalColor = (value) =>
        value === null ||
        value === undefined ||
        (Number.isInteger(value) && value >= 0 && value <= 16777215);
      const optionalBoolean = (value) =>
        value === null || value === undefined || typeof value === "boolean";
      const optionalFontFamily = (value) =>
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.length >= 1 && value.length <= 200);
      const optionalBorder = (value) =>
        value === null ||
        value === undefined ||
        (typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).every((key) => ["color", "width"].includes(key)) &&
          Object.hasOwn(value, "color") &&
          Object.hasOwn(value, "width") &&
          optionalColor(value.color) &&
          optionalFinite(value.width, 0, 100));
      const alignmentValues = {
        left: 0,
        right: 1,
        justify: 2,
        center: 3,
      };
      if (
        !optionalColor(format.fillColor) ||
        !optionalFinite(format.fillOpacity, 0, 100) ||
        !optionalColor(format.fontColor) ||
        !optionalFinite(format.fontSize, 1, 400) ||
        !optionalFontFamily(format.fontFamily) ||
        !optionalBoolean(format.bold) ||
        !optionalBoolean(format.underline) ||
        !optionalBoolean(format.strikethrough) ||
        !optionalBoolean(format.textShadow) ||
        !optionalFinite(format.characterSpacing, -100, 100) ||
        (format.paragraphAlignment !== null &&
          format.paragraphAlignment !== undefined &&
          !Object.hasOwn(alignmentValues, format.paragraphAlignment)) ||
        !optionalFinite(format.marginLeft, 0, 100000) ||
        !optionalFinite(format.marginRight, 0, 100000) ||
        !optionalFinite(format.marginTop, 0, 100000) ||
        !optionalFinite(format.marginBottom, 0, 100000) ||
        !optionalBorder(format.borderTop) ||
        !optionalBorder(format.borderRight) ||
        !optionalBorder(format.borderBottom) ||
        !optionalBorder(format.borderLeft)
      )
        throw new Error("invalid_table_cell_format_value");

      const beforeCell = element.table.cellDetails[command.row][command.column];
      const properties = {};
      const expected = {};
      const setOptional = (inputName, propertyName, expectedName, convert) => {
        const value = format[inputName];
        if (value === null || value === undefined) return;
        const converted = convert ? convert(value) : value;
        properties[propertyName] = converted;
        expected[expectedName] = converted;
      };
      setOptional("fillColor", "FillColor", "fillColor", Math.round);
      if (format.fillOpacity !== null && format.fillOpacity !== undefined) {
        properties.FillTransparence = 100 - Math.round(format.fillOpacity);
        expected.fillOpacity = Math.round(format.fillOpacity);
      }
      if (format.fontColor !== null && format.fontColor !== undefined) {
        // A direct RGB edit must stop inheriting the prior theme reference.
        // Otherwise the live UNO value changes but PPTX export writes the old
        // scheme color and the text reverts when PowerPoint reopens the file.
        properties.CharColorTheme = -1;
        properties.CharColorTintOrShade = 0;
        properties.CharColor = Math.round(format.fontColor);
        expected.color = properties.CharColor;
      }
      setOptional("fontSize", "CharHeight", "fontSize");
      setOptional("fontFamily", "CharFontName", "fontFamily");
      setOptional("bold", "CharWeight", "fontWeight", (value) =>
        value ? 150 : 100,
      );
      setOptional("underline", "CharUnderline", "underline", (value) =>
        value ? 1 : 0,
      );
      setOptional("strikethrough", "CharStrikeout", "strikethrough", (value) =>
        value ? 1 : 0,
      );
      setOptional("textShadow", "CharShadowed", "textShadow");
      if (
        format.characterSpacing !== null &&
        format.characterSpacing !== undefined
      ) {
        properties.CharKerning = pointsToKerningTwips(format.characterSpacing);
        expected.characterSpacing = kerningTwipsToPoints(
          properties.CharKerning,
        );
      }
      setOptional(
        "paragraphAlignment",
        "ParaAdjust",
        "paragraphAlignment",
        (value) => alignmentValues[value],
      );
      for (const [inputName, propertyName, marginName] of [
        ["marginLeft", "TextLeftDistance", "left"],
        ["marginRight", "TextRightDistance", "right"],
        ["marginTop", "TextUpperDistance", "top"],
        ["marginBottom", "TextLowerDistance", "bottom"],
      ]) {
        const value = format[inputName];
        if (value === null || value === undefined) continue;
        properties[propertyName] = Math.round(value);
        expected.textMargins ??= {};
        expected.textMargins[marginName] = Math.round(value);
      }
      for (const [inputName, propertyName, edgeName] of [
        ["borderTop", "TopBorder", "top"],
        ["borderRight", "RightBorder", "right"],
        ["borderBottom", "BottomBorder", "bottom"],
        ["borderLeft", "LeftBorder", "left"],
      ]) {
        const requested = format[inputName];
        if (requested === null || requested === undefined) continue;
        const previous = beforeCell.borders?.[edgeName];
        if (!previous) throw new Error("unsupported_table_cell_border");
        if (requested.color === null && requested.width === null) continue;
        const borderValue = {
          Color:
            requested.color === null
              ? previous.color
              : Math.round(requested.color),
          InnerLineWidth: 0,
          OuterLineWidth:
            requested.width === null
              ? previous.outerWidth
              : Math.round((requested.width * 2540) / 72),
          LineDistance: 0,
        };
        properties[propertyName] = {
          kind: "tableBorderLine",
          value: borderValue,
        };
        expected.borders ??= { ...beforeCell.borders };
        expected.borders[edgeName] = {
          style: previous.style,
          width: borderValue.OuterLineWidth,
          color: borderValue.Color,
          innerWidth: borderValue.InnerLineWidth,
          outerWidth: borderValue.OuterLineWidth,
          distance: borderValue.LineDistance,
        };
      }
      if (!Object.keys(properties).length)
        throw new Error("no_table_cell_format_properties_supplied");

      const expectedCell = {
        ...beforeCell,
        ...expected,
        textMargins: expected.textMargins
          ? { ...beforeCell.textMargins, ...expected.textMargins }
          : beforeCell.textMargins,
      };
      if (stableJson(beforeCell) === stableJson(expectedCell))
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const shape = resolveShape(command.elementId);
      const table = shape.getPropertyValue("Model");
      const cell = table.getCellByPosition(command.column, command.row);
      const textCursor = cell.createTextCursor();
      textCursor.gotoEnd(true);
      const textPropertyNames = new Set([
        "CharColor",
        "CharColorTheme",
        "CharColorTintOrShade",
        "CharHeight",
        "CharFontName",
        "CharWeight",
        "CharUnderline",
        "CharStrikeout",
        "CharShadowed",
        "CharKerning",
        "ParaAdjust",
      ]);
      const propertyTarget = (name) =>
        textPropertyNames.has(name) ? textCursor : cell;
      const unoTypeFor = (target, name) => {
        const typeName = String(
          target.getPropertySetInfo().getPropertyByName(name).Type,
        );
        return {
          boolean: uno.type.boolean,
          byte: uno.type.byte,
          short: uno.type.short,
          long: uno.type.long,
          float: uno.type.float,
          double: uno.type.double,
          string: uno.type.string,
        }[typeName];
      };
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const ownsUndoContext = !request.transactionActive;
      let undoContextOpen = false;
      try {
        activateSlide(slideIndex);
        if (ownsUndoContext) {
          undo.enterUndoContext("Format table cell");
          undoContextOpen = true;
        }
        for (const [name, value] of Object.entries(properties)) {
          const targetPropertySet = propertyTarget(name);
          if (value?.kind === "tableBorderLine") {
            targetPropertySet.setPropertyValue(
              name,
              new uno.idl.com.sun.star.table.BorderLine(value.value),
            );
            continue;
          }
          const type = unoTypeFor(targetPropertySet, name);
          if (!type) throw new Error(`unsupported_table_cell_property:${name}`);
          targetPropertySet.setPropertyValue(name, new uno.Any(type, value));
        }
        if (ownsUndoContext) {
          undo.leaveUndoContext();
          undoContextOpen = false;
        }

        const after = read();
        const target = after.slides[slideIndex].elements.find(
          (candidate) => candidate.elementId === command.elementId,
        );
        const afterCell =
          target?.table?.cellDetails?.[command.row]?.[command.column];
        const expectedTarget = {
          ...element,
          table: {
            ...element.table,
            cellDetails: element.table.cellDetails.map((row, rowIndex) =>
              row.map((candidate, columnIndex) =>
                rowIndex === command.row && columnIndex === command.column
                  ? expectedCell
                  : candidate,
              ),
            ),
          },
        };
        const expectedSlides = before.slides.map((slide, index) => ({
          ...slide,
          elements: slide.elements.map((candidate) =>
            index === slideIndex && candidate.elementId === command.elementId
              ? expectedTarget
              : candidate,
          ),
        }));
        const applied =
          stableJson(withoutPropertyStates(afterCell)) ===
          stableJson(withoutPropertyStates(expectedCell));
        const comparableExpectedSlides = withoutPropertyStates(expectedSlides);
        const comparableAfterSlides = withoutPropertyStates(after.slides);
        const comparableBeforeMasters = withoutPropertyStates(before.masters);
        const comparableAfterMasters = withoutPropertyStates(after.masters);
        const unrelatedChanged =
          documentStateJson(comparableAfterMasters) !==
            documentStateJson(comparableBeforeMasters) ||
          documentStateJson(comparableAfterSlides) !==
            documentStateJson(comparableExpectedSlides);
        const scopeDifference =
          firstDifferencePath(
            comparableExpectedSlides,
            comparableAfterSlides,
          ) ??
          firstDifferencePath(
            comparableBeforeMasters,
            comparableAfterMasters,
            "masters",
          ) ??
          "unknown";
        const undoActionsAdded =
          undo.getAllUndoActionTitles().length - undoCount;
        if (
          !applied ||
          unrelatedChanged ||
          (!request.transactionActive && undoActionsAdded !== 1)
        )
          throw new Error(
            unrelatedChanged
              ? `unexpected_edit_scope:${scopeDifference}`
              : !applied
                ? "native_command_not_applied"
                : "native_undo_not_recorded",
          );
        return result(after, slideIndex);
      } catch (error) {
        if (!ownsUndoContext) throw error;
        if (undoContextOpen) {
          try {
            undo.leaveUndoContext();
          } catch (_) {}
        }
        while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        const rolledBack = read();
        if (
          documentStateJson(rolledBack.slides) !==
            documentStateJson(before.slides) ||
          documentStateJson(rolledBack.masters) !==
            documentStateJson(before.masters)
        )
          throw new Error(
            `table_cell_format_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}`,
          );
        throw error;
      }
    }

    if (command.op === "set_table_cell") {
      if (
        !element.table ||
        !Number.isInteger(command.row) ||
        !Number.isInteger(command.column) ||
        command.row < 0 ||
        command.column < 0 ||
        command.row >= element.table.rows ||
        command.column >= element.table.columns ||
        typeof command.text !== "string" ||
        command.text.length > 4000
      )
        throw new Error("invalid_table_cell");
      if (request.dryRun) return result(before, before.activeSlide);
      if (element.table.cells[command.row][command.column] === command.text)
        return result(before, slideIndex);
      const shape = resolveShape(command.elementId);
      const table = shape.getPropertyValue("Model");
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      activateSlide(slideIndex);
      table
        .getCellByPosition(command.column, command.row)
        .setString(command.text);
      const after = read();
      const target = after.slides[slideIndex].elements.find(
        (candidate) => candidate.elementId === command.elementId,
      );
      const applied =
        target?.table?.cells?.[command.row]?.[command.column] === command.text;
      if (
        !applied ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length <= undoCount)
      ) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw new Error(
          !applied ? "native_command_not_applied" : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    if (command.op === "crop_image") {
      if (!patchedGraphicCropEngine && !runtimeSupports(command.op))
        throw new Error("native_undo_unavailable");
      if (
        element.parentElementId !== null ||
        !String(element.kind).endsWith("GraphicObjectShape") ||
        !element.picture ||
        [command.left, command.top, command.right, command.bottom].some(
          (value) =>
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < 0 ||
            value >= 1,
        ) ||
        command.left + command.right >= 1 ||
        command.top + command.bottom >= 1
      )
        throw new Error("invalid_image_crop");
      const sourceSize = {
        Width: element.picture.sourceSize.width,
        Height: element.picture.sourceSize.height,
      };
      const expectedCrop = {
        Left: Math.round(sourceSize.Width * command.left),
        Top: Math.round(sourceSize.Height * command.top),
        Right: Math.round(sourceSize.Width * command.right),
        Bottom: Math.round(sourceSize.Height * command.bottom),
      };
      if (stableJson(element.graphicCrop) === stableJson(expectedCrop))
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      transformSlides([
        { JumpToSlide: slideIndex },
        { [`SetGraphicCrop.${element.zIndex}`]: expectedCrop },
      ]);
      const after = read();
      const target = after.slides[slideIndex].elements.find(
        (candidate) => candidate.elementId === command.elementId,
      );
      const expectedTarget = {
        ...element,
        graphicCrop: expectedCrop,
        picture: {
          ...element.picture,
          crop: cropFractions(expectedCrop, sourceSize),
        },
      };
      const expectedSlides = before.slides.map((slide, index) => ({
        ...slide,
        elements: slide.elements.map((candidate) =>
          index === slideIndex && candidate.elementId === command.elementId
            ? expectedTarget
            : candidate,
        ),
      }));
      const applied = stableJson(target) === stableJson(expectedTarget);
      const unrelatedChanged =
        documentStateJson(after.masters) !==
          documentStateJson(before.masters) ||
        documentStateJson(after.slides) !== documentStateJson(expectedSlides);
      if (
        !applied ||
        unrelatedChanged ||
        (!request.transactionActive &&
          undo.getAllUndoActionTitles().length - undoCount !== 1)
      ) {
        if (!request.transactionActive) {
          while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        }
        throw new Error(
          unrelatedChanged
            ? "unexpected_edit_scope"
            : !applied
              ? "native_command_not_applied"
              : "native_undo_not_recorded",
        );
      }
      return result(after, slideIndex);
    }

    if (command.op === "set_chart_type") {
      const chartTypeTemplates = {
        column: {
          service: "com.sun.star.chart.BarDiagram",
          observedType: "com.sun.star.chart2.ColumnChartType",
        },
        line: {
          service: "com.sun.star.chart.LineDiagram",
          observedType: "com.sun.star.chart2.LineChartType",
        },
        area: {
          service: "com.sun.star.chart.AreaDiagram",
          observedType: "com.sun.star.chart2.AreaChartType",
        },
        pie: {
          service: "com.sun.star.chart.PieDiagram",
          observedType: "com.sun.star.chart2.PieChartType",
        },
        scatter: {
          service: "com.sun.star.chart.XYDiagram",
          observedType: "com.sun.star.chart2.ScatterChartType",
        },
        radar: {
          service: "com.sun.star.chart.NetDiagram",
          observedType: "com.sun.star.chart2.NetChartType",
        },
      };
      const template = chartTypeTemplates[command.chartType];
      if (
        element.parentElementId !== null ||
        !element.chart?.internalData ||
        element.chart.truncated ||
        element.chart.chartTypes.length !== 1 ||
        !template
      )
        throw new Error("invalid_chart_type");
      if (element.chart.chartTypes[0].type === template.observedType)
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const sourceSeries = chartSeriesState(element.chart);
      if (
        sourceSeries.length < 1 ||
        sourceSeries.some(
          (series) =>
            series.values.length !== element.chart.rowCount ||
            series.values.some(
              (value) =>
                value !== null &&
                (typeof value !== "number" || !Number.isFinite(value)),
            ),
        )
      )
        throw new Error("invalid_chart_type_source");
      const categoricalData = Array.from(
        { length: element.chart.rowCount },
        (_, rowIndex) => sourceSeries.map((series) => series.values[rowIndex]),
      );
      const sourceCategoryLabels =
        element.chart.rowDescriptions.length === element.chart.rowCount &&
        element.chart.rowDescriptions.some(Boolean)
          ? element.chart.rowDescriptions
          : null;
      const sharedXValues = (() => {
        const first = sourceSeries.find((series) => series.xValues)?.xValues;
        if (
          !first ||
          first.length !== element.chart.rowCount ||
          sourceSeries.some(
            (series) =>
              series.xValues &&
              stableJson(series.xValues) !== stableJson(first),
          )
        )
          return null;
        return first;
      })();
      const targetCategoryLabels =
        sourceCategoryLabels ??
        sharedXValues?.map((value) => String(value ?? "")) ??
        Array.from({ length: element.chart.rowCount }, (_, rowIndex) =>
          String(rowIndex + 1),
        );
      const targetSeriesLabels = sourceSeries.map(
        (series, seriesIndex) => series.label ?? `Series ${seriesIndex + 1}`,
      );

      const page = pages.getByIndex(slideIndex);
      const sourceShape = resolveShape(command.elementId);
      const sourceName = sourceShape.getName();
      const chartForShape = (shape) => {
        const chartModel = safeProperty(shape, "Model");
        return safeCall(chartModel, "getSupportedServiceNames", []).includes(
          "com.sun.star.chart2.ChartDocument",
        )
          ? chartModel
          : null;
      };
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const ownsUndoContext = !request.transactionActive;
      let undoContextOpen = false;
      try {
        if (ownsUndoContext) {
          undo.enterUndoContext("Change chart type");
          undoContextOpen = true;
        }
        activateSlide(slideIndex);
        controller.select(sourceShape);
        dispatch(".uno:Copy");
        dispatch(".uno:Paste");

        let workingShape = null;
        let workingChart = null;
        for (let index = 0; index < page.getCount(); index++) {
          const candidate = page.getByIndex(index);
          const candidateChart = chartForShape(candidate);
          if (candidateChart && !uno.sameUnoObject(candidate, sourceShape)) {
            workingShape = candidate;
            workingChart = candidateChart;
            break;
          }
        }
        if (!workingShape || !workingChart)
          throw new Error("chart_copy_not_found");
        workingChart.setDiagram(workingChart.createInstance(template.service));
        const workingProvider = workingChart.getDataProvider();
        if (command.chartType === "scatter") {
          const scatterData = Array.from(
            { length: element.chart.rowCount },
            (_, rowIndex) =>
              sourceSeries.flatMap((series) => {
                const numericCategory = Number(targetCategoryLabels[rowIndex]);
                const generatedX = Number.isFinite(numericCategory)
                  ? numericCategory
                  : rowIndex + 1;
                return [
                  series.values[rowIndex],
                  series.xValues?.[rowIndex] ?? generatedX,
                ];
              }),
          );
          workingProvider.setData(scatterData);
          workingProvider.setRowDescriptions([]);
          workingProvider.setColumnDescriptions(
            targetSeriesLabels.flatMap((label) => [label, ""]),
          );
          const chartSeries = workingChart
            .getFirstDiagram()
            .getCoordinateSystems()[0]
            .getChartTypes()[0]
            .getDataSeries();
          if (chartSeries.length !== sourceSeries.length)
            throw new Error("chart_series_count_changed");
          const labeledSequence = (column, role, withLabel) => {
            const values =
              workingProvider.createDataSequenceByRangeRepresentation(
                String(column),
              );
            values.setPropertyValue("Role", role);
            const sequence =
              uno.idl.com.sun.star.chart2.data.LabeledDataSequence.create(
                uno.componentContext,
              );
            sequence.setValues(values);
            if (withLabel)
              sequence.setLabel(
                workingProvider.createDataSequenceByRangeRepresentation(
                  `label ${column}`,
                ),
              );
            return sequence;
          };
          for (
            let seriesIndex = 0;
            seriesIndex < chartSeries.length;
            seriesIndex++
          )
            chartSeries[seriesIndex].setData([
              labeledSequence(seriesIndex * 2, "values-y", true),
              labeledSequence(seriesIndex * 2 + 1, "values-x", false),
            ]);
          const xAxis = workingChart
            .getFirstDiagram()
            .getCoordinateSystems()[0]
            .getAxisByDimension(0, 0);
          // The categorical source axis can carry a date number-format key.
          // Generated ordinal X values must use General, otherwise values 1,
          // 2, 3... render as 1904 dates after conversion and reopen.
          xAxis.setPropertyValue("LinkNumberFormatToSource", false);
          xAxis.setPropertyValue("NumberFormat", 0);
        } else {
          let providerColumnCount = workingProvider
            .getData()
            .reduce((maximum, row) => Math.max(maximum, row.length), 0);
          while (providerColumnCount > sourceSeries.length) {
            workingProvider.deleteSequence(providerColumnCount - 1);
            providerColumnCount--;
          }
          workingProvider.setData(categoricalData);
          workingProvider.setRowDescriptions(targetCategoryLabels);
          workingProvider.setColumnDescriptions(targetSeriesLabels);
          const chartType = workingChart
            .getFirstDiagram()
            .getCoordinateSystems()[0]
            .getChartTypes()[0];
          const chartSeries = chartType
            .getDataSeries()
            .slice(0, sourceSeries.length);
          if (chartSeries.length !== sourceSeries.length)
            throw new Error("chart_series_count_changed");
          chartType.setDataSeries(chartSeries);
          for (
            let seriesIndex = 0;
            seriesIndex < chartSeries.length;
            seriesIndex++
          ) {
            const values =
              workingProvider.createDataSequenceByRangeRepresentation(
                String(seriesIndex),
              );
            values.setPropertyValue("Role", "values-y");
            const sequence =
              uno.idl.com.sun.star.chart2.data.LabeledDataSequence.create(
                uno.componentContext,
              );
            sequence.setValues(values);
            sequence.setLabel(
              workingProvider.createDataSequenceByRangeRepresentation(
                `label ${seriesIndex}`,
              ),
            );
            chartSeries[seriesIndex].setData([sequence]);
          }
        }

        // Direct chart-model changes do not participate in the presentation
        // Undo manager. Copy the fully transformed scratch chart again, then
        // make the final paste the committed object. The single surrounding
        // Undo context now owns both Undo and Redo of the completed chart,
        // while the untouched source remains available until commit.
        controller.select(workingShape);
        dispatch(".uno:Copy");
        dispatch(".uno:Delete");
        controller.select(sourceShape);
        dispatch(".uno:Delete");
        dispatch(".uno:Paste");
        workingShape = null;
        workingChart = null;
        for (let index = 0; index < page.getCount(); index++) {
          const candidate = page.getByIndex(index);
          const candidateChart = chartForShape(candidate);
          if (candidateChart) {
            workingShape = candidate;
            workingChart = candidateChart;
            break;
          }
        }
        if (!workingShape || !workingChart)
          throw new Error("chart_final_paste_not_found");
        workingShape.setName(sourceName);
        controller.select(workingShape);
        dispatch(".uno:TransformDialog", [
          prop("TransformPosX", uno.type.long, element.x),
          prop("TransformPosY", uno.type.long, element.y),
        ]);
        let workingIndex = -1;
        for (let index = 0; index < page.getCount(); index++)
          if (uno.sameUnoObject(page.getByIndex(index), workingShape)) {
            workingIndex = index;
            break;
          }
        if (workingIndex < 0) throw new Error("chart_copy_not_found");
        while (workingIndex > element.zIndex) {
          dispatch(".uno:ObjectBackOne");
          workingIndex--;
        }
        while (workingIndex < element.zIndex) {
          dispatch(".uno:ObjectForwardOne");
          workingIndex++;
        }
        if (ownsUndoContext) {
          undo.leaveUndoContext();
          undoContextOpen = false;
        }

        const after = read();
        const target = after.slides[slideIndex].elements.find(
          (candidate) => candidate.elementId === command.elementId,
        );
        const targetChart = target?.chart;
        const targetSeries = chartSeriesState(targetChart);
        const expectedTargetSeries = sourceSeries.map(
          (series, seriesIndex) => ({
            label: targetSeriesLabels[seriesIndex],
            values: series.values,
            xValues:
              command.chartType === "scatter"
                ? (series.xValues ??
                  targetCategoryLabels.map((label, rowIndex) => {
                    const numericLabel = Number(label);
                    return Number.isFinite(numericLabel)
                      ? numericLabel
                      : rowIndex + 1;
                  }))
                : null,
          }),
        );
        const targetSurface = target
          ? { ...target, chart: element.chart }
          : null;
        const chartTypeApplied =
          targetChart?.chartTypes.length === 1 &&
          targetChart.chartTypes[0].type === template.observedType;
        const seriesPreserved =
          stableJson(
            targetSeries.map(({ label, values, xValues }) => ({
              label,
              values,
              xValues,
            })),
          ) === stableJson(expectedTargetSeries);
        const chartBoundsPreserved =
          targetChart?.internalData === element.chart.internalData &&
          targetChart?.truncated === element.chart.truncated;
        const surfacePreserved =
          stableJson(targetSurface) === stableJson(element);
        const applied =
          chartTypeApplied &&
          seriesPreserved &&
          chartBoundsPreserved &&
          surfacePreserved;
        const expectedSlides = before.slides.map((slide, index) => ({
          ...slide,
          elements: slide.elements.map((candidate) =>
            index === slideIndex && candidate.elementId === command.elementId
              ? target
              : candidate,
          ),
        }));
        const unrelatedChanged =
          documentStateJson(after.masters) !==
            documentStateJson(before.masters) ||
          documentStateJson(after.slides) !== documentStateJson(expectedSlides);
        const undoActionsAdded =
          undo.getAllUndoActionTitles().length - undoCount;
        if (
          !applied ||
          unrelatedChanged ||
          (!request.transactionActive && undoActionsAdded !== 1)
        )
          throw new Error(
            unrelatedChanged
              ? "unexpected_edit_scope"
              : !applied
                ? `native_command_not_applied:${[
                    chartTypeApplied ? null : "type",
                    seriesPreserved ? null : "series",
                    chartBoundsPreserved ? null : "bounds",
                    surfacePreserved ? null : "surface",
                  ]
                    .filter(Boolean)
                    .join(",")}`
                : "native_undo_not_recorded",
          );
        return result(after, slideIndex);
      } catch (error) {
        if (!ownsUndoContext) throw error;
        if (undoContextOpen) {
          try {
            undo.leaveUndoContext();
          } catch (_) {}
        }
        while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        const rolledBack = read();
        if (
          documentStateJson(rolledBack.slides) !==
            documentStateJson(before.slides) ||
          documentStateJson(rolledBack.masters) !==
            documentStateJson(before.masters)
        )
          throw new Error(
            `chart_type_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}`,
          );
        throw error;
      }
    }

    if (command.op === "set_chart_data") {
      const hasData = command.data !== null && command.data !== undefined;
      const hasRowDescriptions =
        command.rowDescriptions !== null &&
        command.rowDescriptions !== undefined;
      const hasColumnDescriptions =
        command.columnDescriptions !== null &&
        command.columnDescriptions !== undefined;
      const validDescriptions = (values, length, maximum) =>
        Array.isArray(values) &&
        values.length === length &&
        values.length <= maximum &&
        values.every(
          (value) =>
            typeof value === "string" &&
            value.length <= 1000 &&
            !value.includes("\u0000"),
        );
      if (
        element.parentElementId !== null ||
        !element.chart?.internalData ||
        (!hasData && !hasRowDescriptions && !hasColumnDescriptions) ||
        (hasData &&
          (!Array.isArray(command.data) ||
            command.data.length !== element.chart.rowCount ||
            command.data.length > 100 ||
            command.data.some(
              (row) =>
                !Array.isArray(row) ||
                row.length !== element.chart.columnCount ||
                row.length > 50 ||
                row.some(
                  (value) =>
                    value !== null &&
                    (typeof value !== "number" || !Number.isFinite(value)),
                ),
            ))) ||
        (hasRowDescriptions &&
          !validDescriptions(
            command.rowDescriptions,
            element.chart.rowCount,
            100,
          )) ||
        (hasColumnDescriptions &&
          !validDescriptions(
            command.columnDescriptions,
            element.chart.columnCount,
            50,
          ))
      )
        throw new Error("invalid_chart_data");
      const requestedChart = {
        ...element.chart,
        data: hasData ? command.data : element.chart.data,
        rowDescriptions: hasRowDescriptions
          ? command.rowDescriptions
          : element.chart.rowDescriptions,
        columnDescriptions: hasColumnDescriptions
          ? command.columnDescriptions
          : element.chart.columnDescriptions,
        chartTypes: hasColumnDescriptions
          ? element.chart.chartTypes.map((chartType) => ({
              ...chartType,
              series: chartType.series.map((series) => ({
                ...series,
                sequences: series.sequences.map((sequence) => {
                  const sourceColumn = Number(sequence.sourceRange);
                  return Array.isArray(sequence.label) &&
                    Number.isInteger(sourceColumn) &&
                    sourceColumn >= 0 &&
                    sourceColumn < command.columnDescriptions.length
                    ? {
                        ...sequence,
                        label: [command.columnDescriptions[sourceColumn]],
                      }
                    : sequence;
                }),
              })),
            }))
          : element.chart.chartTypes,
      };
      if (stableJson(requestedChart) === stableJson(element.chart))
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const page = pages.getByIndex(slideIndex);
      const shape = resolveShape(command.elementId);
      const chartModel = safeProperty(shape, "Model");
      const provider = safeCall(chartModel, "getDataProvider");
      if (!provider) throw new Error("unsupported_chart_target");
      const originalData = safeCall(provider, "getData", []).map((row) => [
        ...row,
      ]);
      const originalRowDescriptions = [
        ...safeCall(provider, "getRowDescriptions", []),
      ];
      const originalColumnDescriptions = [
        ...safeCall(provider, "getColumnDescriptions", []),
      ];
      const requestedData = hasData
        ? command.data.map((row) =>
            row.map((value) => (value === null ? Number.NaN : value)),
          )
        : originalData;
      const requestedRowDescriptions = hasRowDescriptions
        ? [...command.rowDescriptions]
        : originalRowDescriptions;
      const requestedColumnDescriptions = hasColumnDescriptions
        ? [...command.columnDescriptions]
        : originalColumnDescriptions;
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const ownsUndoContext = !request.transactionActive;
      let undoContextOpen = false;
      let sourceModified = false;
      const restoreSource = () => {
        provider.setData(originalData);
        provider.setRowDescriptions(originalRowDescriptions);
        provider.setColumnDescriptions(originalColumnDescriptions);
        const restored =
          stableJson(safeCall(provider, "getData", [])) ===
            stableJson(originalData) &&
          stableJson(safeCall(provider, "getRowDescriptions", [])) ===
            stableJson(originalRowDescriptions) &&
          stableJson(safeCall(provider, "getColumnDescriptions", [])) ===
            stableJson(originalColumnDescriptions);
        if (!restored) throw new Error("chart_source_restore_failed");
        sourceModified = false;
      };
      try {
        // The chart provider applies data but records no undo in either the
        // presentation or embedded chart. Put the complete changed chart on
        // the native clipboard, restore the live source, then replace that
        // source inside one presentation undo context. This keeps human and
        // AI edits in the same ordered native history.
        sourceModified = true;
        provider.setData(requestedData);
        provider.setRowDescriptions(requestedRowDescriptions);
        provider.setColumnDescriptions(requestedColumnDescriptions);
        controller.select(shape);
        dispatch(".uno:Copy");
        restoreSource();

        if (ownsUndoContext) {
          undo.enterUndoContext("Edit chart data");
          undoContextOpen = true;
        }
        activateSlide(slideIndex);
        controller.select(shape);
        dispatch(".uno:Delete");
        dispatch(".uno:Paste");

        let replacement = null;
        let replacementIndex = -1;
        for (let index = 0; index < page.getCount(); index++) {
          const candidate = page.getByIndex(index);
          const candidateModel = safeProperty(candidate, "Model");
          const candidateProvider = safeCall(candidateModel, "getDataProvider");
          if (
            candidateProvider &&
            stableJson(safeCall(candidateProvider, "getData", [])) ===
              stableJson(requestedData) &&
            stableJson(
              safeCall(candidateProvider, "getRowDescriptions", []),
            ) === stableJson(requestedRowDescriptions) &&
            stableJson(
              safeCall(candidateProvider, "getColumnDescriptions", []),
            ) === stableJson(requestedColumnDescriptions)
          ) {
            replacement = candidate;
            replacementIndex = index;
            break;
          }
        }
        if (!replacement) throw new Error("chart_replacement_not_found");
        controller.select(replacement);
        // Native paste preserves the chart size but resets its position to
        // the slide origin. Restore only the properties that paste changed.
        // Rewriting the unchanged size needlessly quantizes OOXML EMUs through
        // UNO's 1/100 mm coordinate unit on save.
        dispatch(".uno:TransformDialog", [
          prop("TransformPosX", uno.type.long, element.x),
          prop("TransformPosY", uno.type.long, element.y),
        ]);
        while (replacementIndex > element.zIndex) {
          dispatch(".uno:ObjectBackOne");
          replacementIndex--;
        }
        while (replacementIndex < element.zIndex) {
          dispatch(".uno:ObjectForwardOne");
          replacementIndex++;
        }
        if (ownsUndoContext) {
          undo.leaveUndoContext();
          undoContextOpen = false;
        }

        const after = read();
        const target = after.slides[slideIndex].elements.find(
          (candidate) => candidate.elementId === command.elementId,
        );
        const expectedTarget = {
          ...element,
          chart: requestedChart,
        };
        const expectedSlides = before.slides.map((slide, index) => ({
          ...slide,
          elements: slide.elements.map((candidate) =>
            index === slideIndex && candidate.elementId === command.elementId
              ? expectedTarget
              : candidate,
          ),
        }));
        const applied = stableJson(target) === stableJson(expectedTarget);
        const unrelatedChanged =
          documentStateJson(after.masters) !==
            documentStateJson(before.masters) ||
          documentStateJson(after.slides) !== documentStateJson(expectedSlides);
        const undoActionsAdded =
          undo.getAllUndoActionTitles().length - undoCount;
        if (
          !applied ||
          unrelatedChanged ||
          (!request.transactionActive && undoActionsAdded !== 1)
        )
          throw new Error(
            unrelatedChanged
              ? "unexpected_edit_scope"
              : !applied
                ? "native_command_not_applied"
                : "native_undo_not_recorded",
          );
        return result(after, slideIndex);
      } catch (error) {
        if (sourceModified) {
          try {
            restoreSource();
          } catch (restoreError) {
            throw new Error(
              `chart_operation_source_restore_failed:${error.message}:${restoreError.message}`,
            );
          }
        }
        if (!ownsUndoContext) throw error;
        if (undoContextOpen) {
          try {
            undo.leaveUndoContext();
          } catch (_) {}
        }
        while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        const rolledBack = read();
        if (
          documentStateJson(rolledBack.slides) !==
            documentStateJson(before.slides) ||
          documentStateJson(rolledBack.masters) !==
            documentStateJson(before.masters)
        )
          throw new Error(
            `chart_operation_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}`,
          );
        throw error;
      }
    }

    const tableStructureOperations = [
      "insert_table_rows",
      "delete_table_rows",
      "insert_table_columns",
      "delete_table_columns",
      "merge_table_cells",
      "split_table_cell",
      "set_table_row_height",
      "set_table_column_width",
    ];
    if (tableStructureOperations.includes(command.op)) {
      if (!patchedTableStructureEngine && !runtimeSupports(command.op))
        throw new Error("native_engine_table_structure_patch_required");
      if (!element.table) throw new Error("unsupported_table_target");
      const integer = (value, minimum, maximum) =>
        Number.isInteger(value) && value >= minimum && value <= maximum;
      const rowOperation = [
        "insert_table_rows",
        "delete_table_rows",
        "set_table_row_height",
      ].includes(command.op);
      const columnOperation = [
        "insert_table_columns",
        "delete_table_columns",
        "set_table_column_width",
      ].includes(command.op);
      if (
        rowOperation &&
        !integer(
          command.index,
          0,
          command.op === "insert_table_rows"
            ? element.table.rows
            : element.table.rows - 1,
        )
      )
        throw new Error("invalid_table_row");
      if (
        columnOperation &&
        !integer(
          command.index,
          0,
          command.op === "insert_table_columns"
            ? element.table.columns
            : element.table.columns - 1,
        )
      )
        throw new Error("invalid_table_column");
      if (
        [
          "insert_table_rows",
          "delete_table_rows",
          "insert_table_columns",
          "delete_table_columns",
        ].includes(command.op) &&
        !integer(command.count, 1, 20)
      )
        throw new Error("invalid_table_structure_count");
      if (
        command.op === "delete_table_rows" &&
        (command.index + command.count > element.table.rows ||
          command.count >= element.table.rows)
      )
        throw new Error("cannot_delete_all_table_rows");
      if (
        command.op === "delete_table_columns" &&
        (command.index + command.count > element.table.columns ||
          command.count >= element.table.columns)
      )
        throw new Error("cannot_delete_all_table_columns");
      if (
        command.op === "set_table_row_height" &&
        !integer(command.height, 1, 100000)
      )
        throw new Error("invalid_table_row_height");
      if (
        command.op === "set_table_column_width" &&
        !integer(command.width, 1, 100000)
      )
        throw new Error("invalid_table_column_width");
      if (command.op === "merge_table_cells") {
        if (
          !integer(command.startRow, 0, element.table.rows - 1) ||
          !integer(command.endRow, command.startRow, element.table.rows - 1) ||
          !integer(command.startColumn, 0, element.table.columns - 1) ||
          !integer(
            command.endColumn,
            command.startColumn,
            element.table.columns - 1,
          ) ||
          (command.startRow === command.endRow &&
            command.startColumn === command.endColumn)
        )
          throw new Error("invalid_table_merge_range");
      }
      if (command.op === "split_table_cell") {
        if (
          !integer(command.row, 0, element.table.rows - 1) ||
          !integer(command.column, 0, element.table.columns - 1) ||
          !integer(command.columns, 1, 20) ||
          !integer(command.rows, 1, 20) ||
          (command.columns === 1 && command.rows === 1)
        )
          throw new Error("invalid_table_split");
      }
      if (
        command.op === "set_table_row_height" &&
        element.table.rowHeights?.[command.index] === command.height
      )
        return result(before, slideIndex);
      if (
        command.op === "set_table_column_width" &&
        element.table.columnWidths?.[command.index] === command.width
      )
        return result(before, slideIndex);
      if (request.dryRun) return result(before, before.activeSlide);

      const shape = resolveShape(command.elementId);
      const table = shape.getPropertyValue("Model");
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      activateSlide(slideIndex);
      try {
        if (command.op === "insert_table_rows")
          table.getRows().insertByIndex(command.index, command.count);
        else if (command.op === "delete_table_rows")
          table.getRows().removeByIndex(command.index, command.count);
        else if (command.op === "insert_table_columns")
          table.getColumns().insertByIndex(command.index, command.count);
        else if (command.op === "delete_table_columns")
          table.getColumns().removeByIndex(command.index, command.count);
        else if (command.op === "merge_table_cells") {
          const cursor = table.createCursorByRange(
            table.getCellRangeByPosition(
              command.startColumn,
              command.startRow,
              command.endColumn,
              command.endRow,
            ),
          );
          if (!cursor.isMergeable())
            throw new Error("table_range_not_mergeable");
          cursor.merge();
        } else if (command.op === "split_table_cell") {
          table
            .createCursorByRange(
              table.getCellRangeByPosition(
                command.column,
                command.row,
                command.column,
                command.row,
              ),
            )
            .split(command.columns - 1, command.rows - 1);
        } else if (command.op === "set_table_row_height")
          table
            .getRows()
            .getByIndex(command.index)
            .setPropertyValue("Height", command.height);
        else
          table
            .getColumns()
            .getByIndex(command.index)
            .setPropertyValue("Width", command.width);

        const after = read();
        const target = after.slides[slideIndex].elements.find(
          (candidate) => candidate.elementId === command.elementId,
        );
        const nextTable = target?.table;
        const applied =
          command.op === "insert_table_rows"
            ? nextTable?.rows === element.table.rows + command.count
            : command.op === "delete_table_rows"
              ? nextTable?.rows === element.table.rows - command.count
              : command.op === "insert_table_columns"
                ? nextTable?.columns === element.table.columns + command.count
                : command.op === "delete_table_columns"
                  ? nextTable?.columns === element.table.columns - command.count
                  : command.op === "merge_table_cells"
                    ? nextTable?.mergedRanges?.some(
                        (range) =>
                          range.startRow === command.startRow &&
                          range.startColumn === command.startColumn &&
                          range.endRow === command.endRow &&
                          range.endColumn === command.endColumn,
                      )
                    : command.op === "split_table_cell"
                      ? documentStateJson(nextTable) !==
                          documentStateJson(element.table) &&
                        !nextTable?.mergedRanges?.some(
                          (range) =>
                            range.startRow <= command.row &&
                            range.endRow >= command.row &&
                            range.startColumn <= command.column &&
                            range.endColumn >= command.column,
                        )
                      : command.op === "set_table_row_height"
                        ? nextTable?.rowHeights?.[command.index] ===
                          command.height
                        : nextTable?.columnWidths?.[command.index] ===
                          command.width;
        const undoActionsAdded =
          undo.getAllUndoActionTitles().length - undoCount;
        if (!applied || (!request.transactionActive && undoActionsAdded !== 1))
          throw new Error(
            !applied
              ? "native_command_not_applied"
              : "native_undo_not_recorded",
          );
        return result(after, slideIndex);
      } catch (error) {
        if (!request.transactionActive) {
          while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
          const rolledBack = read();
          if (
            documentStateJson(rolledBack.slides) !==
            documentStateJson(before.slides)
          )
            throw new Error(
              `table_operation_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}`,
            );
        }
        throw error;
      }
    }

    const finite = (value, min, max) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max;
    const colorOperation = ["font_color", "fill_color", "line_color"].includes(
      command.op,
    );
    if (
      command.op === "replace_text" &&
      (typeof command.text !== "string" ||
        command.text.length > 10000 ||
        element.text === null)
    )
      throw new Error("unsupported_text_target");
    if (
      command.op === "move" &&
      (!finite(command.x, -100000, 100000) ||
        !finite(command.y, -100000, 100000))
    )
      throw new Error("invalid_position");
    if (
      command.op === "resize" &&
      (!finite(command.width, 1, 100000) || !finite(command.height, 1, 100000))
    )
      throw new Error("invalid_size");
    if (command.op === "font_size" && !finite(command.size, 1, 400))
      throw new Error("invalid_font_size");
    if (command.op === "line_width" && !finite(command.size, 0, 100))
      throw new Error("invalid_line_width");
    if (command.op === "rotate" && !finite(command.degrees, -360, 360))
      throw new Error("invalid_rotation");
    if (command.op === "bold" && typeof command.bold !== "boolean")
      throw new Error("invalid_bold");
    if (command.op === "italic" && typeof command.italic !== "boolean")
      throw new Error("invalid_italic");
    if (command.op === "underline" && typeof command.underline !== "boolean")
      throw new Error("invalid_underline");
    if (
      command.op === "strikethrough" &&
      typeof command.strikethrough !== "boolean"
    )
      throw new Error("invalid_strikethrough");
    if (command.op === "text_shadow" && typeof command.shadow !== "boolean")
      throw new Error("invalid_text_shadow");
    if (
      ["fill_opacity", "line_opacity"].includes(command.op) &&
      !finite(command.opacity, 0, 100)
    )
      throw new Error("invalid_opacity");
    if (command.op === "text_autofit" && typeof command.autofit !== "boolean")
      throw new Error("invalid_text_autofit");
    if (
      command.op === "font_family" &&
      (typeof command.family !== "string" ||
        !command.family.trim() ||
        command.family.length > 100 ||
        /[\u0000-\u001f]/.test(command.family))
    )
      throw new Error("invalid_font_family");
    if (colorOperation && !finite(command.color, 0, 16777215))
      throw new Error("invalid_color");
    if (
      command.op === "z_order" &&
      !["front", "forward", "backward", "back"].includes(command.position)
    )
      throw new Error("invalid_z_order");
    if (
      command.op === "paragraph_alignment" &&
      !["left", "center", "right", "justify"].includes(command.alignment)
    )
      throw new Error("invalid_paragraph_alignment");
    if (
      command.op === "flip" &&
      !["horizontal", "vertical"].includes(command.axis)
    )
      throw new Error("invalid_flip_axis");
    if (
      (command.op === "delete_element" ||
        (command.op === "duplicate_element" &&
          !patchedObjectLifecycleEngine &&
          !runtimeSupports(command.op))) &&
      (element.parentElementId !== null || element.childElementIds.length)
    )
      throw new Error("unsupported_structural_target");
    const supported = [
      "replace_text",
      "move",
      "resize",
      "font_size",
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "text_shadow",
      "font_family",
      "font_color",
      "fill_color",
      "line_color",
      "line_width",
      "fill_opacity",
      "line_opacity",
      "text_autofit",
      "rotate",
      "z_order",
      "paragraph_alignment",
      "flip",
      "ungroup",
      "duplicate_element",
      "delete_element",
    ];
    if (!supported.includes(command.op)) throw new Error("unsupported_command");
    if (request.dryRun) return result(before, before.activeSlide);

    const italic = (value) =>
      value !== null && !String(value).toUpperCase().includes("NONE");
    const underlined = (value) => Number(value ?? 0) !== 0;
    const struck = (value) => Number(value ?? 0) !== 0;
    const autofit = (value) =>
      value !== null && !String(value).toUpperCase().includes("NONE");
    const typedTextFormattingOperations = new Set([
      "font_size",
      "bold",
      "italic",
      "font_family",
    ]);
    const usesTypedTextFormatting = typedTextFormattingOperations.has(
      command.op,
    );
    const browserShapeAppearanceOperations = new Set([
      "line_color",
      "line_width",
      "fill_opacity",
      "line_opacity",
      "rotate",
    ]);
    const usesBrowserShapeAppearance =
      browserShapeAppearanceOperations.has(command.op) &&
      runtimeSupports(command.op) &&
      typeof request.nativeAdapter?.transformSlides === "function";
    if (
      usesTypedTextFormatting &&
      !patchedTextFormattingEngine &&
      !runtimeSupports(command.op)
    )
      throw new Error("native_engine_text_formatting_patch_required");
    if (usesTypedTextFormatting && element.text === null)
      throw new Error("unsupported_text_target");
    const wholeTextFormat = (state) =>
      state.slides[slideIndex]?.elements.find(
        (candidate) => candidate.elementId === command.elementId,
      )?.wholeTextFormatting;
    const expectedFontSize =
      command.op === "font_size" ? Math.round(command.size * 20) / 20 : null;
    const typedTextFormattingMatches = (state) => {
      if (!usesTypedTextFormatting) return false;
      const formatting = wholeTextFormat(state);
      return (
        formatting !== null &&
        (command.op === "font_size"
          ? [
              formatting.fontSize,
              formatting.fontSizeAsian,
              formatting.fontSizeComplex,
            ].every((value) => Number(value) === expectedFontSize)
          : command.op === "font_family"
            ? [
                formatting.fontFamily,
                formatting.fontFamilyAsian,
                formatting.fontFamilyComplex,
              ].every((value) => value === command.family.trim())
            : command.op === "bold"
              ? [
                  formatting.fontWeight,
                  formatting.fontWeightAsian,
                  formatting.fontWeightComplex,
                ].every((value) => Number(value) === (command.bold ? 150 : 100))
              : [
                  formatting.fontStyle,
                  formatting.fontStyleAsian,
                  formatting.fontStyleComplex,
                ].every((value) => italic(value) === command.italic))
      );
    };
    const unchanged =
      command.op === "replace_text"
        ? command.text === element.text
        : command.op === "move"
          ? Math.round(command.x) === element.x &&
            Math.round(command.y) === element.y
          : command.op === "resize"
            ? Math.round(command.width) === element.width &&
              Math.round(command.height) === element.height
            : command.op === "font_size"
              ? typedTextFormattingMatches(before)
              : command.op === "bold"
                ? typedTextFormattingMatches(before)
                : command.op === "italic"
                  ? typedTextFormattingMatches(before)
                  : command.op === "underline"
                    ? underlined(element.underline) === command.underline
                    : command.op === "strikethrough"
                      ? struck(element.strikethrough) === command.strikethrough
                      : command.op === "text_shadow"
                        ? element.textShadow === command.shadow
                        : command.op === "font_family"
                          ? typedTextFormattingMatches(before)
                          : command.op === "font_color"
                            ? element.color === Math.round(command.color)
                            : command.op === "fill_color"
                              ? element.fill === Math.round(command.color)
                              : command.op === "line_color"
                                ? element.lineColor ===
                                  Math.round(command.color)
                                : command.op === "line_width"
                                  ? element.lineWidth ===
                                    Math.round(command.size * 100)
                                  : command.op === "fill_opacity"
                                    ? element.fillOpacity ===
                                      Math.round(command.opacity)
                                    : command.op === "line_opacity"
                                      ? element.lineOpacity ===
                                        Math.round(command.opacity)
                                      : command.op === "text_autofit"
                                        ? autofit(element.textFitToSize) ===
                                          command.autofit
                                        : command.op === "rotate"
                                          ? element.rotation ===
                                            Math.round(command.degrees * 100)
                                          : false;
    if (unchanged) return result(before, slideIndex);

    const shape = resolveShape(command.elementId);
    const undo = model.getUndoManager();
    const undoCount = undo.getAllUndoActionTitles().length;
    activateSlide(slideIndex);
    controller.select(shape);
    if (usesTypedTextFormatting) {
      const objectPath = command.elementId.split("/").slice(1).join("/");
      const properties =
        command.op === "font_size"
          ? { FontHeightPoints: command.size }
          : command.op === "font_family"
            ? { FontFamily: command.family.trim() }
            : command.op === "bold"
              ? { Bold: command.bold }
              : { Italic: command.italic };
      transformSlides([
        { JumpToSlide: slideIndex },
        { [`SetTextProperties.${objectPath}`]: properties },
      ]);
    } else if (usesBrowserShapeAppearance) {
      const objectPath = command.elementId.split("/").slice(1).join("/");
      const properties =
        command.op === "line_color"
          ? { LineColor: Math.round(command.color) }
          : command.op === "line_width"
            ? { LineWidth: Math.round(command.size * 100) }
            : command.op === "fill_opacity"
              ? { FillTransparence: 100 - Math.round(command.opacity) }
              : command.op === "line_opacity"
                ? { LineTransparence: 100 - Math.round(command.opacity) }
                : { RotateAngle: Math.round(command.degrees * 100) };
      transformSlides([
        { JumpToSlide: slideIndex },
        { [`SetObjectProperties.${objectPath}`]: properties },
      ]);
    } else if (command.op === "replace_text")
      dispatch(".uno:ExecuteSearch", [
        prop("SearchItem.SearchString", uno.type.string, element.text),
        prop("SearchItem.ReplaceString", uno.type.string, command.text),
        prop("SearchItem.Command", uno.type.short, 3),
        prop("SearchItem.Selection", uno.type.boolean, true),
        prop("SearchItem.Pattern", uno.type.boolean, false),
        prop("SearchItem.Backward", uno.type.boolean, false),
      ]);
    else if (command.op === "move")
      dispatch(".uno:TransformDialog", [
        prop("TransformPosX", uno.type.long, Math.round(command.x)),
        prop("TransformPosY", uno.type.long, Math.round(command.y)),
      ]);
    else if (command.op === "resize")
      dispatch(".uno:TransformDialog", [
        prop("TransformWidth", uno.type.long, Math.round(command.width)),
        prop("TransformHeight", uno.type.long, Math.round(command.height)),
      ]);
    else if (command.op === "underline")
      dispatch(".uno:Underline", [
        prop("Underline", uno.type.boolean, command.underline),
      ]);
    else if (command.op === "strikethrough")
      dispatch(".uno:Strikeout", [
        prop("Strikeout", uno.type.boolean, command.strikethrough),
      ]);
    else if (command.op === "text_shadow")
      dispatch(".uno:Shadowed", [
        prop("Shadowed", uno.type.boolean, command.shadow),
      ]);
    else if (command.op === "font_color")
      dispatch(".uno:Color", [
        prop("Color.Color", uno.type.long, Math.round(command.color)),
      ]);
    else if (command.op === "fill_color")
      dispatch(".uno:FillColor", [
        prop("FillColor.Color", uno.type.long, Math.round(command.color)),
      ]);
    else if (command.op === "line_color")
      dispatch(".uno:XLineColor", [
        prop("XLineColor.Color", uno.type.long, Math.round(command.color)),
      ]);
    else if (command.op === "line_width")
      dispatch(".uno:LineWidth", [
        prop("LineWidth", uno.type.long, Math.round(command.size * 100)),
      ]);
    else if (command.op === "fill_opacity")
      dispatch(".uno:FillTransparence", [
        prop(
          "FillTransparence",
          uno.type.short,
          100 - Math.round(command.opacity),
        ),
      ]);
    else if (command.op === "line_opacity")
      dispatch(".uno:LineTransparence", [
        prop(
          "LineTransparence",
          uno.type.short,
          100 - Math.round(command.opacity),
        ),
      ]);
    else if (command.op === "text_autofit") dispatch(".uno:TextAutoFitToSize");
    else if (command.op === "rotate") {
      const current = Number(element.rotation ?? 0);
      dispatch(".uno:TransformDialog", [
        prop(
          "TransformRotationDeltaAngle",
          uno.type.long,
          Math.round(command.degrees * 100) - current,
        ),
        prop(
          "TransformRotationX",
          uno.type.long,
          Math.round(element.x + element.width / 2),
        ),
        prop(
          "TransformRotationY",
          uno.type.long,
          Math.round(element.y + element.height / 2),
        ),
      ]);
    } else if (command.op === "z_order")
      dispatch(
        {
          front: ".uno:BringToFront",
          forward: ".uno:ObjectForwardOne",
          backward: ".uno:ObjectBackOne",
          back: ".uno:SendToBack",
        }[command.position],
      );
    else if (command.op === "paragraph_alignment")
      dispatch(
        {
          left: ".uno:LeftPara",
          center: ".uno:CenterPara",
          right: ".uno:RightPara",
          justify: ".uno:JustifyPara",
        }[command.alignment],
      );
    else if (command.op === "flip")
      dispatch(
        command.axis === "horizontal"
          ? ".uno:FlipHorizontal"
          : ".uno:FlipVertical",
      );
    else if (command.op === "ungroup") dispatch(".uno:FormatUngroup");
    else if (command.op === "duplicate_element") {
      if (patchedObjectLifecycleEngine || runtimeSupports(command.op)) {
        const objectPath = command.elementId.split("/").slice(1).join("/");
        transformSlides([
          { JumpToSlide: slideIndex },
          { [`DuplicateObject.${objectPath}`]: {} },
        ]);
      } else {
        dispatch(".uno:Copy");
        dispatch(".uno:Paste");
      }
    } else if (command.op === "delete_element") dispatch(".uno:Delete");

    const after = usesTypedTextFormatting ? read(slideIndex) : read();
    const target = after.slides[slideIndex].elements.find(
      (candidate) => candidate.elementId === command.elementId,
    );
    const beforeElementIds = new Set(
      before.slides[slideIndex].elements.map((candidate) => candidate.stableId),
    );
    const duplicate =
      command.op === "duplicate_element"
        ? after.slides[slideIndex].elements.find(
            (candidate) =>
              !beforeElementIds.has(candidate.stableId) &&
              candidate.parentElementId === element.parentElementId,
          )
        : null;
    const duplicateComparable = (value) => {
      if (!value) return null;
      const copy = { ...value };
      for (const key of [
        "elementId",
        "stableId",
        "parentElementId",
        "childElementIds",
        "zIndex",
        "name",
        "objectName",
        "selected",
        "alignedWith",
        "overlapsWith",
      ])
        delete copy[key];
      return stableJson(copy);
    };
    const structuralOrDispatch = [
      "z_order",
      "paragraph_alignment",
      "flip",
      "ungroup",
    ].includes(command.op);
    const applied =
      command.op === "replace_text"
        ? target?.text === command.text
        : command.op === "move"
          ? target?.x === Math.round(command.x) &&
            target?.y === Math.round(command.y)
          : command.op === "resize"
            ? target?.width === Math.round(command.width) &&
              target?.height === Math.round(command.height)
            : command.op === "font_size"
              ? typedTextFormattingMatches(after)
              : command.op === "bold"
                ? typedTextFormattingMatches(after)
                : command.op === "italic"
                  ? typedTextFormattingMatches(after)
                  : command.op === "underline"
                    ? underlined(target?.underline) === command.underline
                    : command.op === "strikethrough"
                      ? struck(target?.strikethrough) === command.strikethrough
                      : command.op === "text_shadow"
                        ? target?.textShadow === command.shadow
                        : command.op === "font_family"
                          ? typedTextFormattingMatches(after)
                          : command.op === "font_color"
                            ? target?.color === Math.round(command.color)
                            : command.op === "fill_color"
                              ? target?.fill === Math.round(command.color)
                              : command.op === "line_color"
                                ? target?.lineColor ===
                                  Math.round(command.color)
                                : command.op === "line_width"
                                  ? target?.lineWidth ===
                                    Math.round(command.size * 100)
                                  : command.op === "fill_opacity"
                                    ? target?.fillOpacity ===
                                      Math.round(command.opacity)
                                    : command.op === "line_opacity"
                                      ? target?.lineOpacity ===
                                        Math.round(command.opacity)
                                      : command.op === "text_autofit"
                                        ? autofit(target?.textFitToSize) ===
                                          command.autofit
                                        : command.op === "rotate"
                                          ? target?.rotation ===
                                            Math.round(command.degrees * 100)
                                          : structuralOrDispatch
                                            ? documentStateJson(
                                                before.slides,
                                              ) !==
                                              documentStateJson(after.slides)
                                            : command.op === "duplicate_element"
                                              ? duplicate !== null &&
                                                duplicateComparable(
                                                  duplicate,
                                                ) ===
                                                  duplicateComparable(element)
                                              : !target &&
                                                after.slides[slideIndex]
                                                  .topLevelElementCount ===
                                                  before.slides[slideIndex]
                                                    .topLevelElementCount -
                                                    1;
    const intrinsic = (value) => {
      const copy = { ...value };
      delete copy.alignedWith;
      delete copy.overlapsWith;
      return JSON.stringify(copy);
    };
    const structural = [
      "duplicate_element",
      "delete_element",
      "z_order",
      "ungroup",
    ].includes(command.op);
    const unrelatedChanged = structural
      ? false
      : before.slides.some((slide, index) =>
          slide.elements.some((candidate) => {
            if (
              index === slideIndex &&
              candidate.elementId === command.elementId
            )
              return false;
            const next = after.slides[index]?.elements.find(
              (value) => value.elementId === candidate.elementId,
            );
            return !next || intrinsic(candidate) !== intrinsic(next);
          }),
        );
    if (
      !applied ||
      unrelatedChanged ||
      (!request.transactionActive &&
        undo.getAllUndoActionTitles().length <= undoCount)
    ) {
      if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
      throw new Error(
        unrelatedChanged
          ? "unexpected_edit_scope"
          : !applied
            ? "native_command_not_applied"
            : "native_undo_not_recorded",
      );
    }
    return result(after, slideIndex);
  };

  if (request.operation !== "edit_batch") return executeSingle(request);

  const before = read();
  let expectedSlides;
  try {
    expectedSlides = JSON.parse(request.expectedSlides);
  } catch (_) {
    throw new Error("invalid_expected_document");
  }
  if (
    typeof request.expectedRevision === "string"
      ? before.revision !== request.expectedRevision
      : documentStateJson(before.slides) !== documentStateJson(expectedSlides)
  )
    throw new Error("document_changed_observe_again");
  if (
    !Array.isArray(request.commands) ||
    request.commands.length < 1 ||
    request.commands.length > 50
  )
    throw new Error("invalid_transaction");
  if (
    request.commands.length > 1 &&
    request.commands.some(
      (command) => mutationContractFor(command.op).identityEffect === "replace",
    )
  )
    throw new Error("identity_replacing_operation_must_be_isolated");

  const shapeReferences = {};
  const pageReferences = {};
  const permissionShapeReferences = (request.permission?.elementIds ?? []).map(
    (elementId) => ({ elementId, reference: resolveShape(elementId) }),
  );
  const permissionPageReferences = (request.permission?.slideIndexes ?? []).map(
    (slideIndex) => ({
      slideIndex,
      reference: pages.getByIndex(slideIndex),
    }),
  );
  const isStructureChangingSlideOperation = (operation) =>
    mutationContractFor(operation).family === "slide_structure";
  const isTransactionalSlideOperation = (operation) => {
    const contract = mutationContractFor(operation);
    return contract.domain === "slide_transform" && contract.target === "slide";
  };
  const hasStructureChangingSlideCommand = request.commands.some((command) =>
    isStructureChangingSlideOperation(command.op),
  );
  const hasNonSlideCommand = request.commands.some(
    (command) => !isTransactionalSlideOperation(command.op),
  );
  if (hasStructureChangingSlideCommand && hasNonSlideCommand)
    throw new Error("mixed_slide_structure_and_content_transaction");
  if (
    hasStructureChangingSlideCommand &&
    request.commands.length > 1 &&
    !patchedUndoEngine &&
    !request.commands.every((command) => runtimeSupports(command.op))
  )
    throw new Error(
      "multi_slide_structure_transaction_requires_patched_engine",
    );
  for (const command of request.commands) {
    if (
      typeof command.elementId === "string" &&
      !shapeReferences[command.elementId]
    )
      shapeReferences[command.elementId] = resolveShape(command.elementId);
    if (Array.isArray(command.elementIds))
      for (const elementId of command.elementIds)
        if (!shapeReferences[elementId])
          shapeReferences[elementId] = resolveShape(elementId);
    if (
      Number.isInteger(command.slideIndex) &&
      !pageReferences[command.slideIndex]
    )
      pageReferences[command.slideIndex] = pages.getByIndex(command.slideIndex);
    const commandBefore =
      detailSlideForCommand(command) === null
        ? before
        : read(detailSlideForCommand(command));
    executeSingle({
      operation: "edit",
      expectedRevision: commandBefore.revision,
      expectedSlides: stableJson(commandBefore.slides),
      command,
      permission: request.permission,
      dryRun: true,
      suppressCapture: true,
      observedBefore: commandBefore,
    });
  }

  if (request.dryRun)
    return {
      ...before,
      layoutAudit: withAuditDelta(before, before),
      images: [capture(before.activeSlide)],
      changedSlideIndexes: [],
      visualEvidenceComplete: true,
      transaction: {
        status: "validated",
        commandCount: request.commands.length,
        atomic: true,
      },
    };

  const currentPageIndex = (reference) => {
    for (let index = 0; index < pages.getCount(); index++)
      if (uno.sameUnoObject(reference, pages.getByIndex(index))) return index;
    throw new Error("transaction_slide_no_longer_exists");
  };
  const currentElementId = (reference) => {
    const visit = (container, prefix) => {
      for (let index = 0; index < container.getCount(); index++) {
        const shape = container.getByIndex(index);
        const elementId = `${prefix}/${index}`;
        if (uno.sameUnoObject(reference, shape)) return elementId;
        if (childCount(shape)) {
          const nested = visit(shape, elementId);
          if (nested) return nested;
        }
      }
      return null;
    };
    for (let slideIndex = 0; slideIndex < pages.getCount(); slideIndex++) {
      const found = visit(pages.getByIndex(slideIndex), String(slideIndex));
      if (found) return found;
    }
    throw new Error("transaction_element_no_longer_exists");
  };
  const rebind = (command) => {
    const rebound = { ...command };
    if (typeof command.elementId === "string")
      rebound.elementId = currentElementId(shapeReferences[command.elementId]);
    if (Array.isArray(command.elementIds))
      rebound.elementIds = command.elementIds.map((elementId) =>
        currentElementId(shapeReferences[elementId]),
      );
    if (Number.isInteger(command.slideIndex))
      rebound.slideIndex = currentPageIndex(pageReferences[command.slideIndex]);
    return rebound;
  };
  const rebindPermission = () => ({
    ...request.permission,
    elementIds: permissionShapeReferences.map(({ reference }) =>
      currentElementId(reference),
    ),
    slideIndexes: permissionPageReferences.map(({ reference }) =>
      currentPageIndex(reference),
    ),
  });

  const undo = model.getUndoManager();
  const undoCount = undo.getAllUndoActionTitles().length;
  if (
    request.commands.every((command) =>
      isTransactionalSlideOperation(command.op),
    )
  ) {
    const initialPageReferences = Array.from(
      { length: pages.getCount() },
      (_, slideIndex) => pages.getByIndex(slideIndex),
    );
    const virtualPages = initialPageReferences.map((reference) => ({
      reference,
    }));
    const transforms = [];
    const expectedLayouts = [];
    const expectedNotes = [];
    const expectedTransitions = [];
    const expectedNames = [];
    const expectedVisibility = [];
    const setFinalExpectedState = (states, next) => {
      const existingIndex = states.findIndex(({ reference }) =>
        uno.sameUnoObject(reference, next.reference),
      );
      if (existingIndex >= 0) states[existingIndex] = next;
      else states.push(next);
    };
    const findVirtualPage = (reference) =>
      virtualPages.findIndex(
        (entry) =>
          entry.reference && uno.sameUnoObject(entry.reference, reference),
      );
    for (const command of request.commands) {
      const reference = pageReferences[command.slideIndex];
      const slideIndex = findVirtualPage(reference);
      if (slideIndex < 0) throw new Error("transaction_slide_no_longer_exists");
      if (command.op === "insert_slide") {
        if (!patchedSlideInsertionEngine && !runtimeSupports(command.op))
          throw new Error("native_engine_slide_insertion_patch_required");
        transforms.push(
          { JumpToSlide: slideIndex },
          {
            InsertMasterSlide: before.slides[command.slideIndex].masterIndex,
          },
        );
        virtualPages.splice(slideIndex + 1, 0, { created: true });
      } else if (command.op === "duplicate_slide") {
        transforms.push({ DuplicateSlide: slideIndex });
        virtualPages.splice(slideIndex + 1, 0, { created: true });
      } else if (command.op === "delete_slide") {
        if (virtualPages.length <= 1)
          throw new Error("cannot_delete_only_slide");
        transforms.push({ DeleteSlide: slideIndex });
        virtualPages.splice(slideIndex, 1);
      } else if (command.op === "move_slide") {
        if (
          command.targetSlideIndex < 0 ||
          command.targetSlideIndex >= virtualPages.length
        )
          throw new Error("invalid_slide_destination");
        transforms.push({
          [`MoveSlide.${slideIndex}`]: command.targetSlideIndex,
        });
        const [entry] = virtualPages.splice(slideIndex, 1);
        virtualPages.splice(command.targetSlideIndex, 0, entry);
      } else if (command.op === "set_slide_layout") {
        const selectedMaster = before.masters[command.masterIndex];
        transforms.push(
          { JumpToSlide: slideIndex },
          {
            ChangeLayout: {
              MasterIndex: command.masterIndex,
              Layout: selectedMaster.layout,
            },
          },
        );
        setFinalExpectedState(expectedLayouts, {
          reference,
          layout: selectedMaster.layout,
          masterIndex: command.masterIndex,
          masterName: selectedMaster.name,
        });
      } else if (command.op === "set_speaker_notes") {
        transforms.push(
          { JumpToSlide: slideIndex },
          { SetNotes: command.text },
        );
        setFinalExpectedState(expectedNotes, {
          reference,
          text: command.text,
        });
      } else if (command.op === "rename_slide") {
        transforms.push(
          { JumpToSlide: slideIndex },
          { RenameSlide: command.name.trim() },
        );
        setFinalExpectedState(expectedNames, {
          reference,
          name: command.name.trim(),
        });
      } else if (command.op === "set_slide_hidden") {
        transforms.push(
          { JumpToSlide: slideIndex },
          { SetSlideVisible: !command.hidden },
        );
        setFinalExpectedState(expectedVisibility, {
          reference,
          visible: !command.hidden,
        });
      } else if (command.op === "set_slide_transition") {
        const preset = slideTransitionPresets[command.transitionEffect];
        const transition = {
          type: preset.Type,
          subtype: preset.Subtype,
          direction: preset.Direction,
          duration: command.transitionDuration,
          fadeColor: preset.FadeColor,
        };
        transforms.push(
          { JumpToSlide: slideIndex },
          {
            SetSlideTransition: {
              ...preset,
              Duration: command.transitionDuration,
            },
          },
        );
        setFinalExpectedState(expectedTransitions, { reference, transition });
      }
    }
    try {
      transformSlides(transforms);
      const after = read();
      const orderApplied =
        pages.getCount() === virtualPages.length &&
        virtualPages.every((entry, slideIndex) => {
          const actual = pages.getByIndex(slideIndex);
          if (entry.reference)
            return uno.sameUnoObject(entry.reference, actual);
          return !initialPageReferences.some((reference) =>
            uno.sameUnoObject(reference, actual),
          );
        });
      const layoutsApplied = expectedLayouts.every(
        ({ reference, layout, masterIndex, masterName }) => {
          const slide = after.slides[currentPageIndex(reference)];
          return (
            slide?.layout === layout &&
            slide.masterIndex === masterIndex &&
            slide.masterName === masterName
          );
        },
      );
      const notesApplied = expectedNotes.every(({ reference, text }) => {
        const index = currentPageIndex(reference);
        return after.slides[index]?.speakerNotes?.text === text;
      });
      const transitionsApplied = expectedTransitions.every(
        ({ reference, transition }) => {
          const index = currentPageIndex(reference);
          return (
            stableJson(
              persistedSlideTransition(after.slides[index]?.transition),
            ) === stableJson(transition)
          );
        },
      );
      const namesApplied = expectedNames.every(({ reference, name }) => {
        const index = currentPageIndex(reference);
        return after.slides[index]?.name === name;
      });
      const visibilityApplied = expectedVisibility.every(
        ({ reference, visible }) =>
          safeProperty(reference, "Visible") === visible,
      );
      const changed =
        documentStateJson(before.slides) !== documentStateJson(after.slides);
      const undoActionsAdded = undo.getAllUndoActionTitles().length - undoCount;
      if (
        !orderApplied ||
        !layoutsApplied ||
        !notesApplied ||
        !transitionsApplied ||
        !namesApplied ||
        !visibilityApplied ||
        (changed && undoActionsAdded !== 1)
      )
        throw new Error(
          !orderApplied ||
          !layoutsApplied ||
          !notesApplied ||
          !transitionsApplied ||
          !namesApplied ||
          !visibilityApplied
            ? `native_command_not_applied:${stableJson({
                orderApplied,
                layoutsApplied,
                notesApplied,
                transitionsApplied,
                namesApplied,
                visibilityApplied,
                expectedTransitions: expectedTransitions.map(
                  ({ reference, transition }) => ({
                    slideIndex: currentPageIndex(reference),
                    transition,
                  }),
                ),
                observedTransitions: expectedTransitions.map(
                  ({ reference }) => {
                    const index = currentPageIndex(reference);
                    return {
                      slideIndex: index,
                      transition: after.slides[index]?.transition,
                    };
                  },
                ),
              })}`
            : "transaction_undo_not_recorded",
        );
      const affectedSlideIndexes = [];
      for (const entry of virtualPages) {
        if (entry.created)
          affectedSlideIndexes.push(virtualPages.indexOf(entry));
      }
      for (const command of request.commands) {
        const reference = pageReferences[command.slideIndex];
        if (!reference || command.op === "delete_slide") continue;
        try {
          affectedSlideIndexes.push(currentPageIndex(reference));
        } catch (_) {}
      }
      const evidence = visualEvidence(
        before,
        after,
        affectedSlideIndexes,
        Math.min(after.activeSlide, after.slides.length - 1),
      );
      return {
        ...after,
        layoutAudit: withAuditDelta(before, after),
        ...evidence,
        transaction: {
          status: changed ? "applied" : "unchanged",
          commandCount: request.commands.length,
          atomic: true,
          undoActionsAdded,
        },
      };
    } catch (error) {
      while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
      const rolledBack = read();
      if (
        documentStateJson(rolledBack.slides) !==
        documentStateJson(before.slides)
      )
        throw new Error(
          `transaction_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}:expected_${before.revision}:actual_${rolledBack.revision}`,
        );
      throw error;
    }
  }
  let contextOpen = false;
  try {
    undo.enterUndoContext("AI presentation edit");
    contextOpen = true;
    let current = before;
    for (let index = 0; index < request.commands.length; index++) {
      const command = request.commands[index];
      const rebound = rebind(command);
      const detailSlideIndex = detailSlideForCommand(rebound);
      if (
        detailSlideIndex !== null &&
        current.textDetails?.slideIndex !== detailSlideIndex
      )
        current = read(detailSlideIndex);
      try {
        current = executeSingle({
          operation: "edit",
          expectedRevision: current.revision,
          expectedSlides: stableJson(current.slides),
          command: rebound,
          permission: rebindPermission(),
          transactionActive: true,
          suppressCapture: true,
          observedBefore: current,
        });
      } catch (error) {
        throw new Error(
          `transaction_command_${index}_${command.op}:${error.message}`,
        );
      }
    }
    undo.leaveUndoContext();
    contextOpen = false;
    const after = read();
    const changed =
      documentStateJson(before.slides) !== documentStateJson(after.slides);
    if (changed && undo.getAllUndoActionTitles().length <= undoCount)
      throw new Error("transaction_undo_not_recorded");
    const affectedSlideIndexes = request.commands.flatMap((command) => {
      if (Number.isInteger(command.slideIndex)) return [command.slideIndex];
      if (typeof command.elementId === "string")
        return [Number(command.elementId.split("/")[0])];
      if (Array.isArray(command.elementIds))
        return command.elementIds.map((elementId) =>
          Number(elementId.split("/")[0]),
        );
      return [];
    });
    const evidence = visualEvidence(
      before,
      after,
      affectedSlideIndexes,
      after.activeSlide,
    );
    return {
      ...after,
      layoutAudit: withAuditDelta(before, after),
      ...evidence,
      transaction: {
        status: changed ? "applied" : "unchanged",
        commandCount: request.commands.length,
        atomic: true,
        undoActionsAdded: undo.getAllUndoActionTitles().length - undoCount,
      },
    };
  } catch (error) {
    if (contextOpen) {
      try {
        undo.leaveUndoContext();
      } catch (_) {}
    }
    while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
    const rolledBack = read();
    if (
      documentStateJson(rolledBack.slides) !== documentStateJson(before.slides)
    )
      throw new Error(
        `transaction_rollback_failed:${error.message}:${firstDifferencePath(before.slides, rolledBack.slides) ?? "unknown"}:expected_${before.revision}:actual_${rolledBack.revision}`,
      );
    throw error;
  }
}
