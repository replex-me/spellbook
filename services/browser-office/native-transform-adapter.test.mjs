import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("./harness/native-transform-adapter.js", import.meta.url),
  "utf8",
);

function loadFactory() {
  const context = {};
  vm.runInNewContext(source, context, {
    filename: "native-transform-adapter.js",
  });
  return context.createSpellbookBrowserNativeAdapter;
}

function fixture() {
  let activePage;
  let contextOpen = false;
  const undoTitles = [];
  const writes = [];
  const mutations = [];
  const undo = {
    enterUndoContext(title) {
      assert.equal(contextOpen, false);
      contextOpen = true;
      writes.push(["enter", title]);
    },
    leaveUndoContext() {
      assert.equal(contextOpen, true);
      contextOpen = false;
      undoTitles.push("AI presentation edit");
      writes.push(["leave"]);
    },
    getAllUndoActionTitles() {
      return [...undoTitles];
    },
    undo() {
      undoTitles.pop();
      writes.push(["undo"]);
    },
  };
  const shape = (name, initialText = "Alpha Beta\nSecond paragraph") => ({
    name,
    text: initialText,
    properties: {},
    textProperties: {},
    getString() {
      return this.text;
    },
    setString(value) {
      this.text = value;
      mutations.push([name, "Text", "string", value]);
    },
    createTextCursor() {
      const target = this;
      let start = 0;
      let end = 0;
      return {
        gotoStart(expand) {
          if (expand) start = 0;
          else start = end = 0;
        },
        gotoEnd(expand) {
          if (expand) end = target.text.length;
          else start = end = target.text.length;
        },
        goRight(count, expand) {
          if (end + count > target.text.length) return false;
          if (expand) end += count;
          else start = end += count;
          return true;
        },
        getString() {
          return target.text.slice(start, end);
        },
        setString(value) {
          target.text =
            target.text.slice(0, start) + value + target.text.slice(end);
          end = start + value.length;
          mutations.push([name, "TextRange", "string", value]);
        },
        setPropertyValue(property, value) {
          target.textProperties[property] = value.val;
          mutations.push([name, property, value.type, value.val]);
        },
      };
    },
    setPropertyValue(property, value) {
      this.properties[property] = value.val;
      mutations.push([name, property, value.type, value.val]);
    },
  });
  const page = (name, children) => {
    const notesShape = shape(`${name}-notes`, "Existing notes");
    notesShape.getShapeType = () => "com.sun.star.presentation.NotesShape";
    const notesPage = {
      getCount: () => 1,
      getByIndex: (index) => {
        assert.equal(index, 0);
        return notesShape;
      },
    };
    return {
      name,
      notesShape,
      properties: {},
      getName() {
        return this.name;
      },
      setName(value) {
        this.name = value;
        mutations.push([name, "Name", "string", value]);
      },
      setPropertyValue(property, value) {
        this.properties[property] = value.val;
        mutations.push([name, property, value.type, value.val]);
      },
      getCount() {
        return children.length;
      },
      getByIndex(index) {
        return children[index];
      },
      getNotesPage() {
        return notesPage;
      },
    };
  };
  const firstShape = shape("first-shape");
  const secondShape = shape("second-shape");
  const firstPage = page("Slide 1", [firstShape]);
  const secondPage = page("Slide 2", [secondShape]);
  const pageList = [firstPage, secondPage];
  activePage = firstPage;
  const pages = {
    getCount: () => pageList.length,
    getByIndex: (index) => pageList[index],
  };
  const controller = {
    getCurrentPage: () => activePage,
    setCurrentPage: (next) => {
      activePage = next;
      writes.push(["page", next.name]);
    },
  };
  class Any {
    constructor(type, val) {
      this.type = type;
      this.val = val;
    }
  }
  class GraphicCrop {
    constructor(value) {
      Object.assign(this, value);
    }
  }
  const ClickAction = function ClickAction() {};
  const presentation = {
    ClickAction,
    ClickAction_NONE: "none",
    ClickAction_DOCUMENT: "document",
    ClickAction_BOOKMARK: "bookmark",
    ClickAction_NEXTPAGE: "next",
    ClickAction_PREVPAGE: "previous",
    ClickAction_FIRSTPAGE: "first",
    ClickAction_LASTPAGE: "last",
    ClickAction_STOPPRESENTATION: "stop",
  };
  const FontSlant = function FontSlant() {};
  const awt = {
    FontSlant,
    FontSlant_NONE: "none",
    FontSlant_ITALIC: "italic",
  };
  const uno = {
    Any,
    type: {
      string: "string",
      boolean: "boolean",
      byte: "byte",
      short: "short",
      long: "long",
      float: "float",
      double: "double",
      enum: (value) =>
        value === FontSlant ? "enum:FontSlant" : "enum:ClickAction",
      struct: () => "struct:GraphicCrop",
    },
    idl: {
      com: { sun: { star: { awt, presentation, text: { GraphicCrop } } } },
    },
  };
  const factory = loadFactory();
  const runtimeIdentity = {
    buildReady: true,
    buildCommit: "candidate",
    candidateCommit: "candidate",
    patchLevel: "browser-undo-v5",
  };
  return {
    adapter: factory({ uno, runtimeIdentity }),
    factory,
    uno,
    controller,
    model: { getUndoManager: () => undo },
    pages,
    firstPage,
    secondPage,
    firstShape,
    secondShape,
    writes,
    mutations,
  };
}

test("browser adapter advertises only its exact operation families", () => {
  const { adapter } = fixture();
  assert.deepEqual(Array.from(adapter.supportedOperations), [
    "crop_image",
    "bold",
    "font_family",
    "font_size",
    "italic",
    "rename_slide",
    "replace_text_range",
    "set_alt_text",
    "set_object_interaction",
    "set_object_lock",
    "set_character_spacing",
    "set_shape_name",
    "set_shape_shadow",
    "set_slide_hidden",
    "set_slide_transition",
    "set_speaker_notes",
    "set_script_position",
    "set_text_box",
  ]);
});

test("browser adapter advertises no patched operation on an unbuilt runtime", () => {
  const runtime = fixture();
  const adapter = runtime.factory({
    uno: runtime.uno,
    runtimeIdentity: {
      buildReady: false,
      buildCommit: "stock",
      candidateCommit: "candidate",
      patchLevel: "browser-undo-v5",
    },
  });
  assert.deepEqual(Array.from(adapter.supportedOperations), []);
});

test("browser adapter preflights a complete list before mutating", () => {
  const runtime = fixture();
  assert.throws(
    () =>
      runtime.adapter.transformSlides({
        commands: [
          { RenameSlide: "Must not apply" },
          { UnsupportedMutation: true },
        ],
        ...runtime,
      }),
    /Unsupported browser native transform/u,
  );
  assert.equal(runtime.firstPage.name, "Slide 1");
  assert.deepEqual(runtime.writes, []);
  assert.deepEqual(runtime.mutations, []);
});

test("browser adapter follows virtual navigation and groups page changes", () => {
  const runtime = fixture();
  runtime.adapter.transformSlides({
    commands: [
      { JumpToSlide: 1 },
      { RenameSlide: "Target slide" },
      { SetSlideVisible: false },
      {
        SetSlideTransition: {
          Type: 37,
          Subtype: 101,
          Direction: true,
          FadeColor: 0,
          Duration: 1.5,
        },
      },
    ],
    ...runtime,
  });
  assert.equal(runtime.firstPage.name, "Slide 1");
  assert.equal(runtime.secondPage.name, "Target slide");
  assert.equal(runtime.secondPage.properties.Visible, false);
  assert.equal(runtime.secondPage.properties.TransitionType, 37);
  assert.equal(runtime.secondPage.properties.TransitionDuration, 1.5);
  assert.deepEqual(runtime.writes, [
    ["enter", "AI presentation edit"],
    ["page", "Slide 2"],
    ["leave"],
  ]);
});

test("browser adapter writes only bounded object, crop and interaction fields", () => {
  const runtime = fixture();
  runtime.adapter.transformSlides({
    commands: [
      { JumpToSlide: 1 },
      {
        "SetObjectProperties.0": {
          TextLeftDistance: 420,
          Shadow: true,
          MoveProtect: true,
        },
      },
      {
        "SetGraphicCrop.0": { Left: 1, Top: 2, Right: 3, Bottom: 4 },
      },
      {
        "SetObjectInteraction.0": {
          Action: "internal_slide",
          TargetSlideIndex: 0,
        },
      },
    ],
    ...runtime,
  });
  assert.equal(runtime.secondShape.properties.TextLeftDistance, 420);
  assert.equal(runtime.secondShape.properties.Shadow, true);
  assert.equal(runtime.secondShape.properties.MoveProtect, true);
  assert.deepEqual(
    { ...runtime.secondShape.properties.GraphicCrop },
    { Left: 1, Top: 2, Right: 3, Bottom: 4 },
  );
  assert.equal(runtime.secondShape.properties.OnClick, "bookmark");
  assert.equal(runtime.secondShape.properties.Bookmark, "Slide 1");
});

test("browser adapter writes text, formatting and notes in one native Undo group", () => {
  const runtime = fixture();
  runtime.adapter.transformSlides({
    commands: [
      { JumpToSlide: 1 },
      {
        "SetTextRange.0": {
          Paragraph: 0,
          Start: 0,
          End: 5,
          ExpectedText: "Alpha",
          Text: "Gamma",
        },
      },
      {
        "SetTextProperties.0": {
          Bold: true,
          Italic: true,
          FontFamily: "Aptos",
          FontHeightPoints: 20,
          Kerning: 35,
          Escapement: 33,
          EscapementHeight: 58,
        },
      },
      { SetNotes: "Updated speaker notes" },
    ],
    ...runtime,
  });

  assert.equal(runtime.secondShape.text, "Gamma Beta\nSecond paragraph");
  assert.equal(runtime.secondPage.notesShape.text, "Updated speaker notes");
  assert.equal(runtime.secondShape.textProperties.CharWeight, 150);
  assert.equal(runtime.secondShape.textProperties.CharWeightAsian, 150);
  assert.equal(runtime.secondShape.textProperties.CharPosture, "italic");
  assert.equal(runtime.secondShape.textProperties.CharFontName, "Aptos");
  assert.equal(runtime.secondShape.textProperties.CharHeight, 20);
  assert.equal(runtime.secondShape.textProperties.CharKerning, 20);
  assert.equal(runtime.secondShape.textProperties.CharEscapement, 33);
  assert.equal(runtime.secondShape.textProperties.CharEscapementHeight, 58);
  assert.deepEqual(runtime.writes, [
    ["enter", "AI presentation edit"],
    ["page", "Slide 2"],
    ["leave"],
  ]);
});

test("browser adapter closes and rolls back a failed native Undo group", () => {
  const runtime = fixture();
  const original = runtime.secondShape.setPropertyValue;
  runtime.secondShape.setPropertyValue = function setPropertyValue(
    name,
    value,
  ) {
    original.call(this, name, value);
    if (name === "Shadow") throw new Error("synthetic native failure");
  };
  assert.throws(
    () =>
      runtime.adapter.transformSlides({
        commands: [
          { JumpToSlide: 1 },
          { "SetObjectProperties.0": { Shadow: true } },
        ],
        ...runtime,
      }),
    /synthetic native failure/u,
  );
  assert.deepEqual(runtime.writes, [
    ["enter", "AI presentation edit"],
    ["page", "Slide 2"],
    ["leave"],
    ["undo"],
  ]);
});
