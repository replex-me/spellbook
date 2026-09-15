/* SPDX-License-Identifier: MPL-2.0 */

"use strict";

(function installBrowserNativeTransformAdapter(global) {
  const candidateOperations = Object.freeze([
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

  const objectPropertyTypes = Object.freeze({
    Name: "string",
    Title: "string",
    Description: "string",
    Decorative: "boolean",
    TextLeftDistance: "long",
    TextRightDistance: "long",
    TextUpperDistance: "long",
    TextLowerDistance: "long",
    TextAutoGrowHeight: "boolean",
    TextAutoGrowWidth: "boolean",
    TextWordWrap: "boolean",
    Shadow: "boolean",
    ShadowColor: "long",
    ShadowTransparence: "short",
    ShadowXDistance: "long",
    ShadowYDistance: "long",
    ShadowBlur: "long",
    MoveProtect: "boolean",
    SizeProtect: "boolean",
  });

  function createSpellbookBrowserNativeAdapter({ uno, runtimeIdentity }) {
    if (!uno?.Any || !uno?.type || !uno?.idl)
      throw new Error("Browser UNO bridge is unavailable.");
    const admitted =
      runtimeIdentity?.buildReady === true &&
      runtimeIdentity.buildCommit === runtimeIdentity.candidateCommit &&
      runtimeIdentity.patchLevel === "browser-undo-v5";
    const nativeSlideStructureReady =
      admitted && runtimeIdentity.nativeSlideStructureReady === true;
    const supportedOperations = Object.freeze(
      admitted ? [...candidateOperations] : [],
    );

    const any = (typeName, value) => new uno.Any(uno.type[typeName], value);
    const assertSingleEntry = (command) => {
      const entries = Object.entries(command ?? {});
      if (entries.length !== 1)
        throw new Error("Browser native transform must contain one command.");
      return entries[0];
    };
    const assertIndex = (value, maximum, label) => {
      if (!Number.isSafeInteger(value) || value < 0 || value >= maximum)
        throw new Error(`${label} is out of range.`);
      return value;
    };
    const assertRecord = (value, label) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object.`);
      return value;
    };
    const assertExactKeys = (value, allowed, label) => {
      const keys = Object.keys(value);
      if (keys.some((key) => !allowed.includes(key)))
        throw new Error(`${label} contains an unsupported field.`);
      return keys;
    };
    const parsePath = (suffix, label) => {
      if (!/^\d+(?:\/\d+)*$/u.test(suffix))
        throw new Error(`${label} has an invalid object path.`);
      return suffix.split("/").map(Number);
    };
    const resolveShape = (page, path, label) => {
      let shape = page;
      for (const index of path) {
        if (typeof shape.getCount !== "function")
          throw new Error(`${label} does not resolve to a shape collection.`);
        assertIndex(index, shape.getCount(), label);
        shape = shape.getByIndex(index);
      }
      return shape;
    };
    const propertyWrite = (target, name, typeName, value) => () =>
      target.setPropertyValue(name, any(typeName, value));
    const selectAllText = (shape, label) => {
      if (
        typeof shape.createTextCursor !== "function" ||
        typeof shape.getString !== "function"
      )
        throw new Error(`${label} has no editable text.`);
      const cursor = shape.createTextCursor();
      cursor.gotoStart(false);
      cursor.gotoEnd(true);
      return cursor;
    };
    const moveCursorRight = (cursor, count, expand, label) => {
      let remaining = count;
      while (remaining > 0) {
        const step = Math.min(remaining, 32767);
        if (!cursor.goRight(step, expand))
          throw new Error(`${label} is unavailable.`);
        remaining -= step;
      }
    };

    const registry = [
      {
        match: (key) => key === "JumpToSlide",
        prepare: ({ value, controller, pages, state }) => {
          const slideIndex = assertIndex(
            value,
            pages.getCount(),
            "Browser native slide target",
          );
          const page = pages.getByIndex(slideIndex);
          state.currentPage = page;
          return {
            mutates: false,
            apply: () => controller.setCurrentPage(page),
          };
        },
      },
      {
        match: (key) => key === "DuplicateSlide",
        prepare: ({ value, controller, pages, dispatch }) => {
          const slideIndex = assertIndex(
            value,
            pages.getCount(),
            "Browser duplicate slide target",
          );
          return {
            mutates: true,
            apply: () => {
              controller.setCurrentPage(pages.getByIndex(slideIndex));
              dispatch(".uno:DuplicatePage");
            },
          };
        },
      },
      {
        match: (key) => key === "DeleteSlide",
        prepare: ({ value, controller, pages }) => {
          const slideIndex = assertIndex(
            value,
            pages.getCount(),
            "Browser delete slide target",
          );
          if (pages.getCount() === 1)
            throw new Error("The final browser slide cannot be deleted.");
          const targetPage = pages.getByIndex(slideIndex);
          const survivingPage = pages.getByIndex(
            slideIndex + 1 < pages.getCount() ? slideIndex + 1 : slideIndex - 1,
          );
          return {
            mutates: true,
            nativeUndoManaged: true,
            apply: () => {
              controller.setCurrentPage(survivingPage);
              pages.remove(targetPage);
            },
          };
        },
      },
      {
        match: (key) => key.startsWith("MoveSlide."),
        prepare: ({ key, value, controller, pages, dispatch }) => {
          const sourceIndex = assertIndex(
            Number(key.slice("MoveSlide.".length)),
            pages.getCount(),
            "Browser move slide source",
          );
          const targetIndex = assertIndex(
            value,
            pages.getCount(),
            "Browser move slide destination",
          );
          return {
            mutates: sourceIndex !== targetIndex,
            apply: () => {
              controller.setCurrentPage(pages.getByIndex(sourceIndex));
              const command =
                targetIndex < sourceIndex
                  ? ".uno:MovePageUp"
                  : ".uno:MovePageDown";
              for (
                let step = 0;
                step < Math.abs(targetIndex - sourceIndex);
                step += 1
              )
                dispatch(command);
            },
          };
        },
      },
      {
        match: (key) => key === "RenameSlide",
        prepare: ({ value, state }) => {
          if (typeof value !== "string" || !value.trim())
            throw new Error("Browser slide name is invalid.");
          const page = state.currentPage;
          return { mutates: true, apply: () => page.setName(value) };
        },
      },
      {
        match: (key) => key === "SetSlideVisible",
        prepare: ({ value, state }) => {
          if (typeof value !== "boolean")
            throw new Error("Browser slide visibility is invalid.");
          const page = state.currentPage;
          return {
            mutates: true,
            apply: propertyWrite(page, "Visible", "boolean", value),
          };
        },
      },
      {
        match: (key) => key === "SetSlideTransition",
        prepare: ({ value, state }) => {
          const transition = assertRecord(value, "Browser slide transition");
          assertExactKeys(
            transition,
            ["Type", "Subtype", "Direction", "FadeColor", "Duration"],
            "Browser slide transition",
          );
          if (
            !Number.isSafeInteger(transition.Type) ||
            !Number.isSafeInteger(transition.Subtype) ||
            typeof transition.Direction !== "boolean" ||
            !Number.isSafeInteger(transition.FadeColor) ||
            typeof transition.Duration !== "number" ||
            !Number.isFinite(transition.Duration)
          )
            throw new Error("Browser slide transition is invalid.");
          const page = state.currentPage;
          const writes = [
            propertyWrite(page, "TransitionType", "short", transition.Type),
            propertyWrite(
              page,
              "TransitionSubtype",
              "short",
              transition.Subtype,
            ),
            propertyWrite(
              page,
              "TransitionDirection",
              "boolean",
              transition.Direction,
            ),
            propertyWrite(
              page,
              "TransitionFadeColor",
              "long",
              transition.FadeColor,
            ),
            propertyWrite(
              page,
              "TransitionDuration",
              "double",
              transition.Duration,
            ),
          ];
          return {
            mutates: true,
            apply: () => writes.forEach((write) => write()),
          };
        },
      },
      {
        match: (key) => key === "SetNotes",
        prepare: ({ value, state }) => {
          if (typeof value !== "string")
            throw new Error("Browser speaker notes are invalid.");
          const notesPage = state.currentPage.getNotesPage();
          let notesShape = null;
          for (let index = 0; index < notesPage.getCount(); index += 1) {
            const candidate = notesPage.getByIndex(index);
            if (String(candidate.getShapeType()).endsWith("NotesShape")) {
              notesShape = candidate;
              break;
            }
          }
          if (!notesShape || typeof notesShape.setString !== "function")
            throw new Error(
              "Browser speaker notes placeholder is unavailable.",
            );
          return {
            mutates: true,
            apply: () => notesShape.setString(value),
          };
        },
      },
      {
        match: (key) => key.startsWith("SetTextRange."),
        prepare: ({ key, value, state }) => {
          const replacement = assertRecord(value, "Browser text range");
          assertExactKeys(
            replacement,
            ["Paragraph", "Start", "End", "ExpectedText", "Text"],
            "Browser text range",
          );
          if (
            !Number.isSafeInteger(replacement.Paragraph) ||
            replacement.Paragraph < 0 ||
            !Number.isSafeInteger(replacement.Start) ||
            replacement.Start < 0 ||
            !Number.isSafeInteger(replacement.End) ||
            replacement.End < replacement.Start ||
            typeof replacement.ExpectedText !== "string" ||
            typeof replacement.Text !== "string"
          )
            throw new Error("Browser text range is invalid.");
          const path = parsePath(
            key.slice("SetTextRange.".length),
            "Browser text range target",
          );
          const shape = resolveShape(
            state.currentPage,
            path,
            "Browser text range target",
          );
          if (
            typeof shape.getString !== "function" ||
            typeof shape.createTextCursor !== "function"
          )
            throw new Error("Browser text range target has no editable text.");
          const paragraphs = shape.getString().split("\n");
          assertIndex(
            replacement.Paragraph,
            paragraphs.length,
            "Browser text paragraph",
          );
          const paragraph = paragraphs[replacement.Paragraph];
          if (
            replacement.End > paragraph.length ||
            paragraph.slice(replacement.Start, replacement.End) !==
              replacement.ExpectedText
          )
            throw new Error("Browser text range changed after observation.");
          const absoluteStart =
            paragraphs
              .slice(0, replacement.Paragraph)
              .reduce((length, text) => length + text.length + 1, 0) +
            replacement.Start;
          const cursor = shape.createTextCursor();
          cursor.gotoStart(false);
          moveCursorRight(
            cursor,
            absoluteStart,
            false,
            "Browser text range start",
          );
          const rangeLength = replacement.End - replacement.Start;
          moveCursorRight(cursor, rangeLength, true, "Browser text range end");
          if (cursor.getString() !== replacement.ExpectedText)
            throw new Error("Browser text range selection changed.");
          return {
            mutates: true,
            apply: () => cursor.setString(replacement.Text),
          };
        },
      },
      {
        match: (key) => key.startsWith("SetTextProperties."),
        prepare: ({ key, value, state }) => {
          const properties = assertRecord(value, "Browser text properties");
          const names = assertExactKeys(
            properties,
            [
              "Bold",
              "Kerning",
              "Escapement",
              "EscapementHeight",
              "FontFamily",
              "FontHeightPoints",
              "Italic",
            ],
            "Browser text properties",
          );
          if (!names.length)
            throw new Error("Browser text properties are empty.");
          const path = parsePath(
            key.slice("SetTextProperties.".length),
            "Browser text property target",
          );
          const shape = resolveShape(
            state.currentPage,
            path,
            "Browser text property target",
          );
          const cursor = selectAllText(shape, "Browser text property target");
          const css = uno.idl.com.sun.star;
          const writes = [];
          const addWrite = (name, typeName, propertyValue) =>
            writes.push(propertyWrite(cursor, name, typeName, propertyValue));
          if (Object.hasOwn(properties, "FontHeightPoints")) {
            if (
              typeof properties.FontHeightPoints !== "number" ||
              !Number.isFinite(properties.FontHeightPoints) ||
              properties.FontHeightPoints <= 0 ||
              properties.FontHeightPoints > 400
            )
              throw new Error("Browser font height is invalid.");
            for (const name of [
              "CharHeight",
              "CharHeightAsian",
              "CharHeightComplex",
            ])
              addWrite(name, "float", properties.FontHeightPoints);
          }
          if (Object.hasOwn(properties, "FontFamily")) {
            if (
              typeof properties.FontFamily !== "string" ||
              !properties.FontFamily.trim() ||
              properties.FontFamily.length > 255 ||
              /[\u0000-\u001f]/u.test(properties.FontFamily)
            )
              throw new Error("Browser font family is invalid.");
            for (const name of [
              "CharFontName",
              "CharFontNameAsian",
              "CharFontNameComplex",
            ])
              addWrite(name, "string", properties.FontFamily);
          }
          if (Object.hasOwn(properties, "Bold")) {
            if (typeof properties.Bold !== "boolean")
              throw new Error("Browser font weight is invalid.");
            for (const name of [
              "CharWeight",
              "CharWeightAsian",
              "CharWeightComplex",
            ])
              addWrite(name, "float", properties.Bold ? 150 : 100);
          }
          if (Object.hasOwn(properties, "Italic")) {
            if (typeof properties.Italic !== "boolean")
              throw new Error("Browser font posture is invalid.");
            const posture = properties.Italic
              ? css.awt.FontSlant_ITALIC
              : css.awt.FontSlant_NONE;
            const postureType = uno.type.enum(css.awt.FontSlant);
            for (const name of [
              "CharPosture",
              "CharPostureAsian",
              "CharPostureComplex",
            ])
              writes.push(() =>
                cursor.setPropertyValue(
                  name,
                  new uno.Any(postureType, posture),
                ),
              );
          }
          if (Object.hasOwn(properties, "Kerning")) {
            if (
              !Number.isSafeInteger(properties.Kerning) ||
              properties.Kerning < -32768 ||
              properties.Kerning > 32767
            )
              throw new Error("Browser text kerning is invalid.");
            addWrite(
              "CharKerning",
              "short",
              Math.round((properties.Kerning * 72 * 20) / 2540),
            );
          }
          const hasEscapement = Object.hasOwn(properties, "Escapement");
          const hasEscapementHeight = Object.hasOwn(
            properties,
            "EscapementHeight",
          );
          if (hasEscapement !== hasEscapementHeight)
            throw new Error("Browser text escapement is incomplete.");
          if (hasEscapement) {
            if (
              !Number.isSafeInteger(properties.Escapement) ||
              properties.Escapement < -100 ||
              properties.Escapement > 100 ||
              !Number.isSafeInteger(properties.EscapementHeight) ||
              properties.EscapementHeight < 1 ||
              properties.EscapementHeight > 100
            )
              throw new Error("Browser text escapement is invalid.");
            addWrite("CharEscapement", "short", properties.Escapement);
            addWrite(
              "CharEscapementHeight",
              "byte",
              properties.EscapementHeight,
            );
          }
          return {
            mutates: true,
            apply: () => writes.forEach((write) => write()),
          };
        },
      },
      {
        match: (key) => key.startsWith("SetObjectProperties."),
        prepare: ({ key, value, state }) => {
          const properties = assertRecord(value, "Browser object properties");
          const names = assertExactKeys(
            properties,
            Object.keys(objectPropertyTypes),
            "Browser object properties",
          );
          if (!names.length)
            throw new Error("Browser object properties are empty.");
          const path = parsePath(
            key.slice("SetObjectProperties.".length),
            "Browser object target",
          );
          const shape = resolveShape(
            state.currentPage,
            path,
            "Browser object target",
          );
          const writes = names.map((name) => {
            const typeName = objectPropertyTypes[name];
            const propertyValue = properties[name];
            if (
              (typeName === "string" && typeof propertyValue !== "string") ||
              (typeName === "boolean" && typeof propertyValue !== "boolean") ||
              (["short", "long"].includes(typeName) &&
                !Number.isSafeInteger(propertyValue))
            )
              throw new Error(
                `Browser object property ${name} has the wrong type.`,
              );
            return propertyWrite(shape, name, typeName, propertyValue);
          });
          return {
            mutates: true,
            apply: () => writes.forEach((write) => write()),
          };
        },
      },
      {
        match: (key) => key.startsWith("SetGraphicCrop."),
        prepare: ({ key, value, state }) => {
          const crop = assertRecord(value, "Browser graphic crop");
          assertExactKeys(
            crop,
            ["Left", "Top", "Right", "Bottom"],
            "Browser graphic crop",
          );
          if (
            [crop.Left, crop.Top, crop.Right, crop.Bottom].some(
              (candidate) => !Number.isSafeInteger(candidate) || candidate < 0,
            )
          )
            throw new Error("Browser graphic crop is invalid.");
          const path = parsePath(
            key.slice("SetGraphicCrop.".length),
            "Browser graphic target",
          );
          const shape = resolveShape(
            state.currentPage,
            path,
            "Browser graphic target",
          );
          const graphicCrop = new uno.idl.com.sun.star.text.GraphicCrop(crop);
          return {
            mutates: true,
            apply: () =>
              shape.setPropertyValue(
                "GraphicCrop",
                new uno.Any(
                  uno.type.struct(uno.idl.com.sun.star.text.GraphicCrop),
                  graphicCrop,
                ),
              ),
          };
        },
      },
      {
        match: (key) => key.startsWith("SetObjectInteraction."),
        prepare: ({ key, value, pages, state }) => {
          const interaction = assertRecord(value, "Browser object interaction");
          assertExactKeys(
            interaction,
            ["Action", "Target", "TargetSlideIndex"],
            "Browser object interaction",
          );
          const path = parsePath(
            key.slice("SetObjectInteraction.".length),
            "Browser interaction target",
          );
          const shape = resolveShape(
            state.currentPage,
            path,
            "Browser interaction target",
          );
          const css = uno.idl.com.sun.star;
          const clickActions = {
            none: css.presentation.ClickAction_NONE,
            external_url: css.presentation.ClickAction_DOCUMENT,
            internal_slide: css.presentation.ClickAction_BOOKMARK,
            next_slide: css.presentation.ClickAction_NEXTPAGE,
            previous_slide: css.presentation.ClickAction_PREVPAGE,
            first_slide: css.presentation.ClickAction_FIRSTPAGE,
            last_slide: css.presentation.ClickAction_LASTPAGE,
            end_show: css.presentation.ClickAction_STOPPRESENTATION,
          };
          if (!Object.hasOwn(clickActions, interaction.Action))
            throw new Error("Browser object interaction action is invalid.");
          let bookmark = "";
          if (interaction.Action === "external_url") {
            if (typeof interaction.Target !== "string" || !interaction.Target)
              throw new Error(
                "Browser external interaction target is invalid.",
              );
            bookmark = interaction.Target;
          } else if (interaction.Action === "internal_slide") {
            const targetIndex = assertIndex(
              interaction.TargetSlideIndex,
              pages.getCount(),
              "Browser interaction slide target",
            );
            bookmark = pages.getByIndex(targetIndex).getName();
          } else if (
            interaction.Target !== undefined ||
            interaction.TargetSlideIndex !== undefined
          ) {
            throw new Error(
              "Browser navigation interaction has an unexpected target.",
            );
          }
          return {
            mutates: true,
            apply: () => {
              shape.setPropertyValue(
                "OnClick",
                new uno.Any(
                  uno.type.enum(css.presentation.ClickAction),
                  clickActions[interaction.Action],
                ),
              );
              shape.setPropertyValue("Bookmark", any("string", bookmark));
            },
          };
        },
      },
    ];

    function transformSlides({ commands, controller, dispatch, model, pages }) {
      if (!Array.isArray(commands) || !commands.length)
        throw new Error("Browser native transform list is empty.");
      const state = { currentPage: controller.getCurrentPage() };
      const prepared = commands.map((command) => {
        const [key, value] = assertSingleEntry(command);
        const handler = registry.find((candidate) => candidate.match(key));
        if (!handler)
          throw new Error(`Unsupported browser native transform: ${key}`);
        return handler.prepare({
          key,
          value,
          controller,
          model,
          pages,
          dispatch,
          state,
        });
      });
      if (!prepared.some(({ mutates }) => mutates)) {
        for (const { apply } of prepared) apply();
        return;
      }
      const mutations = prepared.filter(({ mutates }) => mutates);
      if (mutations.every(({ nativeUndoManaged }) => nativeUndoManaged)) {
        for (const { apply } of prepared) apply();
        return;
      }

      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      let contextOpen = false;
      try {
        undo.enterUndoContext("AI presentation edit");
        contextOpen = true;
        for (const { apply } of prepared) apply();
        undo.leaveUndoContext();
        contextOpen = false;
      } catch (error) {
        if (contextOpen) undo.leaveUndoContext();
        if (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
        throw error;
      }
    }

    const stockStructuralKey = (key) =>
      key === "JumpToSlide" ||
      key === "DuplicateSlide" ||
      key.startsWith("MoveSlide.");
    const supportsTransform = (commands) => {
      if (!Array.isArray(commands) || commands.length === 0) return false;
      const keys = commands.map((command) => {
        const entries = Object.entries(command ?? {});
        return entries.length === 1 ? entries[0][0] : null;
      });
      if (keys.some((key) => key === null)) return false;
      if (keys.includes("DeleteSlide") && !nativeSlideStructureReady)
        return false;
      if (!admitted && !keys.every(stockStructuralKey)) return false;
      return keys.every((key) =>
        registry.some((candidate) => candidate.match(key)),
      );
    };

    return Object.freeze({
      supportedOperations,
      supportsTransform,
      transformSlides,
    });
  }

  global.createSpellbookBrowserNativeAdapter =
    createSpellbookBrowserNativeAdapter;
})(globalThis);
