/* SPDX-License-Identifier: MPL-2.0 */

"use strict";

(function installBrowserNativeTransformAdapter(global) {
  const candidateOperations = Object.freeze([
    "crop_image",
    "rename_slide",
    "set_alt_text",
    "set_object_interaction",
    "set_object_lock",
    "set_shape_name",
    "set_shape_shadow",
    "set_slide_hidden",
    "set_slide_transition",
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
      runtimeIdentity.patchLevel === "browser-undo-v4";
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

    function transformSlides({ commands, controller, model, pages }) {
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
          state,
        });
      });
      if (!prepared.some(({ mutates }) => mutates)) {
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

    return Object.freeze({ supportedOperations, transformSlides });
  }

  global.createSpellbookBrowserNativeAdapter =
    createSpellbookBrowserNativeAdapter;
})(globalThis);
