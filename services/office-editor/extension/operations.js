/* Fixed engine-side program. Models supply validated data, never executable
 * JavaScript. This function is serialized by cool.callRemote and runs against
 * the same open Collabora document the user is editing.
 */
function presentDocumentOperation(request) {
  if (request.expiresAt && Date.now() > request.expiresAt)
    throw new Error("expired_operation");

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
  const dispatch = (command, args = []) =>
    uno.idl.com.sun.star.frame.DispatchHelper.create(
      uno.componentContext,
    ).executeDispatch(frame, command, "", 0, args);
  const safeProperty = (shape, name) => {
    try {
      return shape.getPropertyValue(name);
    } catch (_) {
      return null;
    }
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
      const rows = table.getRows().getCount();
      const columns = table.getColumns().getCount();
      return {
        rows,
        columns,
        cells: Array.from({ length: rows }, (_, row) =>
          Array.from({ length: columns }, (_, column) => {
            const cell = table.getCellByPosition(column, row);
            try {
              return cell.getString();
            } catch (_) {
              return cell.getFormula();
            }
          }),
        ),
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

  function read() {
    const slides = [];
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
      const visit = (container, prefix, parentElementId) => {
        for (let index = 0; index < container.getCount(); index++) {
          const shape = container.getByIndex(index);
          const elementId = `${prefix}/${index}`;
          const children = childCount(shape);
          const position = shape.getPosition();
          const size = shape.getSize();
          let text = null;
          try {
            text = shape.getString();
          } catch (_) {}
          if (selected(shape)) selectedElementIds.push(elementId);
          elements.push({
            elementId,
            parentElementId,
            childElementIds: Array.from(
              { length: children },
              (_, child) => `${elementId}/${child}`,
            ),
            zIndex: index,
            name: shape.getName(),
            kind: shape.getShapeType(),
            text,
            x: position.X,
            y: position.Y,
            width: size.Width,
            height: size.Height,
            rotation: safeProperty(shape, "RotateAngle"),
            fill: safeProperty(shape, "FillColor"),
            lineColor: safeProperty(shape, "LineColor"),
            lineWidth: safeProperty(shape, "LineWidth"),
            fontFamily: safeProperty(shape, "CharFontName"),
            fontSize: safeProperty(shape, "CharHeight"),
            fontWeight: safeProperty(shape, "CharWeight"),
            fontStyle: enumName(safeProperty(shape, "CharPosture")),
            underline: safeProperty(shape, "CharUnderline"),
            color: safeProperty(shape, "CharColor"),
            paragraphAlignment: safeProperty(shape, "ParaAdjust"),
            mirroredX: safeProperty(shape, "MirroredX"),
            mirroredY: safeProperty(shape, "MirroredY"),
            table: tableDetails(shape),
          });
          if (children) visit(shape, elementId, elementId);
        }
      };
      visit(page, String(slideIndex), null);
      const background = safeProperty(page, "Background");

      for (const element of elements) {
        const alignedWith = [];
        const overlapsWith = [];
        for (const other of elements) {
          if (other.elementId === element.elementId) continue;
          const edges = [];
          if (Math.abs(element.x - other.x) <= 10) edges.push("left");
          if (
            Math.abs(
              element.x + element.width / 2 - (other.x + other.width / 2),
            ) <= 10
          )
            edges.push("center_x");
          if (
            Math.abs(element.x + element.width - (other.x + other.width)) <= 10
          )
            edges.push("right");
          if (Math.abs(element.y - other.y) <= 10) edges.push("top");
          if (
            Math.abs(
              element.y + element.height / 2 - (other.y + other.height / 2),
            ) <= 10
          )
            edges.push("center_y");
          if (
            Math.abs(element.y + element.height - (other.y + other.height)) <=
            10
          )
            edges.push("bottom");
          if (edges.length)
            alignedWith.push({ elementId: other.elementId, edges });
          if (
            element.x < other.x + other.width &&
            element.x + element.width > other.x &&
            element.y < other.y + other.height &&
            element.y + element.height > other.y
          )
            overlapsWith.push(other.elementId);
        }
        element.alignedWith = alignedWith;
        element.overlapsWith = overlapsWith;
      }
      slides.push({
        slideIndex,
        name: page.getName(),
        width: page.getPropertyValue("Width"),
        height: page.getPropertyValue("Height"),
        backgroundColor: background
          ? safeProperty(background, "FillColor")
          : null,
        topLevelElementCount: page.getCount(),
        elements,
      });
    }
    return { unit: "1/100mm", slides, activeSlide, selectedElementIds };
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

  const before = read();
  if (request.operation === "observe")
    return { ...before, images: [capture(before.activeSlide)] };
  if (request.operation !== "edit")
    throw new Error("unsupported_native_operation");
  let expectedSlides;
  try {
    expectedSlides = JSON.parse(request.expectedSlides);
  } catch (_) {
    throw new Error("invalid_expected_document");
  }
  if (stableJson(before.slides) !== stableJson(expectedSlides))
    throw new Error("document_changed_observe_again");

  const command = request.command;
  if (!command || typeof command.op !== "string")
    throw new Error("invalid_command");
  if (command.op === "set_background")
    throw new Error("native_undo_unavailable");
  const permission = request.permission;
  if (!permission || permission.mode === "read_only")
    throw new Error("read_only");
  const slideOperation = [
    "insert_slide",
    "duplicate_slide",
    "delete_slide",
  ].includes(command.op);
  if (slideOperation) {
    const slideIndex = command.slideIndex;
    if (
      !Number.isInteger(slideIndex) ||
      slideIndex < 0 ||
      slideIndex >= before.slides.length
    )
      throw new Error("invalid_slide_target");
    const allowed =
      permission.mode === "document" ||
      (command.op !== "insert_slide" &&
        permission.mode === "slides" &&
        permission.slideIndexes.includes(slideIndex));
    if (!allowed) throw new Error("outside_edit_permission");
    if (command.op === "delete_slide" && before.slides.length === 1)
      throw new Error("cannot_delete_only_slide");
    const undo = model.getUndoManager();
    const undoCount = undo.getAllUndoActionTitles().length;
    controller.setCurrentPage(pages.getByIndex(slideIndex));
    if (command.op === "insert_slide") dispatch(".uno:InsertPage");
    else if (command.op === "duplicate_slide") dispatch(".uno:DuplicatePage");
    else if (command.op === "delete_slide") dispatch(".uno:DeletePage");
    else throw new Error("unsupported_slide_command");
    const after = read();
    const applied =
      command.op === "delete_slide"
        ? after.slides.length === before.slides.length - 1
        : after.slides.length === before.slides.length + 1;
    if (!applied || undo.getAllUndoActionTitles().length <= undoCount) {
      if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
      throw new Error(
        !applied ? "native_command_not_applied" : "native_undo_not_recorded",
      );
    }
    return {
      ...after,
      images: [capture(Math.min(after.activeSlide, after.slides.length - 1))],
    };
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
            row.some((cell) => typeof cell !== "string" || cell.length > 2000),
        ) ||
        command.cells.flat().join("").length > 20000)
    )
      throw new Error("invalid_table");
    const page = pages.getByIndex(slideIndex);
    if (command.op === "add_table") {
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const beforeIds = new Set(
        before.slides[slideIndex].elements
          .filter((element) => element.parentElementId === null)
          .map((element) => element.elementId),
      );
      controller.setCurrentPage(page);
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
      if (tableElement) {
        const tableShape = resolveShape(tableElement.elementId);
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
        for (let row = 0; row < command.cells.length; row++)
          for (let column = 0; column < command.cells[row].length; column++)
            table
              .getCellByPosition(column, row)
              .setString(command.cells[row][column]);
      }
      const after = read();
      const target = tableElement
        ? after.slides[slideIndex].elements.find(
            (element) => element.elementId === tableElement.elementId,
          )
        : null;
      const applied =
        target?.x === Math.round(command.x) &&
        target?.y === Math.round(command.y) &&
        target?.width === Math.round(command.width) &&
        target?.height === Math.round(command.height) &&
        stableJson(target?.table?.cells) === stableJson(command.cells);
      if (!applied || undo.getAllUndoActionTitles().length <= undoCount) {
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        else if (tableElement)
          page.remove(resolveShape(tableElement.elementId));
        throw new Error(
          !applied ? "native_command_not_applied" : "native_undo_not_recorded",
        );
      }
      return { ...after, images: [capture(slideIndex)] };
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
    if (command.op === "add_text_box") shape.setString(command.text);
    else if (command.geometry === "line")
      shape.setPropertyValue(
        "LineColor",
        new uno.Any(uno.type.long, command.color),
      );
    else
      shape.setPropertyValue(
        "FillColor",
        new uno.Any(uno.type.long, command.color),
      );
    const undo = model.getUndoManager();
    const undoCount = undo.getAllUndoActionTitles().length;
    controller.setCurrentPage(page);
    page.add(shape);
    controller.select(shape);
    // Direct XShapes.add is not represented in Impress' native undo stack.
    // Use it only to build an in-memory clipboard template, remove it again,
    // then let the editor's Paste command create the user-visible object.
    dispatch(".uno:Copy");
    page.remove(shape);
    dispatch(".uno:Paste");
    const after = read();
    const applied =
      after.slides[slideIndex].topLevelElementCount ===
      before.slides[slideIndex].topLevelElementCount + 1;
    if (!applied || undo.getAllUndoActionTitles().length <= undoCount) {
      if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
      throw new Error(
        !applied ? "native_command_not_applied" : "native_undo_not_recorded",
      );
    }
    return { ...after, images: [capture(slideIndex)] };
  }
  const multiOperation = ["align", "distribute", "group"].includes(command.op);
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
    const collection = uno.idl.com.sun.star.drawing.ShapeCollection.create(
      uno.componentContext,
    );
    for (const elementId of elementIds) collection.add(resolveShape(elementId));
    const undo = model.getUndoManager();
    const undoCount = undo.getAllUndoActionTitles().length;
    controller.setCurrentPage(pages.getByIndex(slideIndex));
    controller.select(collection);
    dispatch(unoCommand);
    const after = read();
    const changed = stableJson(before.slides) !== stableJson(after.slides);
    const grouped =
      command.op !== "group" ||
      after.slides[slideIndex].topLevelElementCount ===
        before.slides[slideIndex].topLevelElementCount - elementIds.length + 1;
    if (
      (changed && undo.getAllUndoActionTitles().length <= undoCount) ||
      !grouped
    ) {
      if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
      throw new Error(
        !grouped ? "native_command_not_applied" : "native_undo_not_recorded",
      );
    }
    return { ...(changed ? after : before), images: [capture(slideIndex)] };
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
    (!finite(command.x, -100000, 100000) || !finite(command.y, -100000, 100000))
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
    ["duplicate_element", "delete_element"].includes(command.op) &&
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
    "font_family",
    "font_color",
    "fill_color",
    "line_color",
    "line_width",
    "rotate",
    "z_order",
    "paragraph_alignment",
    "flip",
    "ungroup",
    "duplicate_element",
    "delete_element",
  ];
  if (!supported.includes(command.op)) throw new Error("unsupported_command");

  const italic = (value) =>
    value !== null && !String(value).toUpperCase().includes("NONE");
  const underlined = (value) => Number(value ?? 0) !== 0;
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
            ? command.size === element.fontSize
            : command.op === "bold"
              ? element.fontWeight === (command.bold ? 150 : 100)
              : command.op === "italic"
                ? italic(element.fontStyle) === command.italic
                : command.op === "underline"
                  ? underlined(element.underline) === command.underline
                  : command.op === "font_family"
                    ? element.fontFamily === command.family.trim()
                    : command.op === "font_color"
                      ? element.color === Math.round(command.color)
                      : command.op === "fill_color"
                        ? element.fill === Math.round(command.color)
                        : command.op === "line_color"
                          ? element.lineColor === Math.round(command.color)
                          : command.op === "line_width"
                            ? element.lineWidth ===
                              Math.round(command.size * 100)
                            : command.op === "rotate"
                              ? element.rotation ===
                                Math.round(command.degrees * 100)
                              : false;
  if (unchanged) return { ...before, images: [capture(slideIndex)] };

  const shape = resolveShape(command.elementId);
  const undo = model.getUndoManager();
  const undoCount = undo.getAllUndoActionTitles().length;
  controller.setCurrentPage(pages.getByIndex(slideIndex));
  controller.select(shape);
  if (command.op === "replace_text")
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
  else if (command.op === "font_size")
    dispatch(".uno:FontHeight", [
      prop("FontHeight.Height", uno.type.float, command.size),
    ]);
  else if (command.op === "bold")
    dispatch(".uno:Bold", [prop("Bold", uno.type.boolean, command.bold)]);
  else if (command.op === "italic")
    dispatch(".uno:Italic", [prop("Italic", uno.type.boolean, command.italic)]);
  else if (command.op === "underline")
    dispatch(".uno:Underline", [
      prop("Underline", uno.type.boolean, command.underline),
    ]);
  else if (command.op === "font_family")
    dispatch(".uno:CharFontName", [
      prop("CharFontName.FamilyName", uno.type.string, command.family.trim()),
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
    dispatch(".uno:Copy");
    dispatch(".uno:Paste");
  } else if (command.op === "delete_element") dispatch(".uno:Delete");

  const after = read();
  const target = after.slides[slideIndex].elements.find(
    (candidate) => candidate.elementId === command.elementId,
  );
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
            ? target?.fontSize === command.size
            : command.op === "bold"
              ? target?.fontWeight === (command.bold ? 150 : 100)
              : command.op === "italic"
                ? italic(target?.fontStyle) === command.italic
                : command.op === "underline"
                  ? underlined(target?.underline) === command.underline
                  : command.op === "font_family"
                    ? target?.fontFamily === command.family.trim()
                    : command.op === "font_color"
                      ? target?.color === Math.round(command.color)
                      : command.op === "fill_color"
                        ? target?.fill === Math.round(command.color)
                        : command.op === "line_color"
                          ? target?.lineColor === Math.round(command.color)
                          : command.op === "line_width"
                            ? target?.lineWidth ===
                              Math.round(command.size * 100)
                            : command.op === "rotate"
                              ? target?.rotation ===
                                Math.round(command.degrees * 100)
                              : structuralOrDispatch
                                ? stableJson(before.slides) !==
                                  stableJson(after.slides)
                                : command.op === "duplicate_element"
                                  ? after.slides[slideIndex]
                                      .topLevelElementCount ===
                                    before.slides[slideIndex]
                                      .topLevelElementCount +
                                      1
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
          if (index === slideIndex && candidate.elementId === command.elementId)
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
    undo.getAllUndoActionTitles().length <= undoCount
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
  return { ...after, images: [capture(slideIndex)] };
}
