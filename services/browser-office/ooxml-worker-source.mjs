/* SPDX-License-Identifier: MPL-2.0 */

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const presentationNamespace =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
const drawingNamespace =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
const relationshipAttributeNamespace =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationshipNamespace =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const contentTypeNamespace =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const slideContentType =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const maximumInputBytes = 64 * 1024 * 1024;
const maximumExpandedBytes = 512 * 1024 * 1024;
const maximumEntries = 10_000;
const deterministicZipModifiedAt = new Date("2000-01-01T00:00:00.000Z");
const presentationPath = "ppt/presentation.xml";
const presentationRelationshipsPath = "ppt/_rels/presentation.xml.rels";
const contentTypesPath = "[Content_Types].xml";
const topologyOperations = new Set([
  "add_slide",
  "duplicate_slide",
  "delete_slide",
  "move_slide",
]);
const slideMetadataOperations = new Set(["rename_slide", "set_slide_hidden"]);
const elementOperations = new Set(["replace_text"]);
const browserOperations = new Set([
  ...topologyOperations,
  ...slideMetadataOperations,
  ...elementOperations,
]);
const sharedDependencyKinds = new Set([
  "slideLayout",
  "slideMaster",
  "notesMaster",
  "theme",
  "image",
  "audio",
  "video",
  "slide",
]);

export function applyOoxmlCommand(input, command) {
  if (!(input instanceof Uint8Array))
    throw new TypeError("PPTX input must be a Uint8Array.");
  if (input.byteLength > maximumInputBytes)
    throw new Error("PPTX exceeds the browser mutation limit.");
  if (!browserOperations.has(command?.op))
    throw new Error(`Unsupported browser OOXML operation: ${command?.op}`);
  const context = openPackage(input, {
    requireSimpleTopology: topologyOperations.has(command.op),
  });
  const report =
    command.op === "add_slide" || command.op === "duplicate_slide"
      ? createSlide(context, command)
      : command.op === "delete_slide"
        ? deleteSlide(context, command)
        : command.op === "move_slide"
          ? moveSlide(context, command)
          : slideMetadataOperations.has(command.op)
            ? updateSlideMetadata(context, command)
            : updateElement(context, command);
  return {
    bytes: zipSync(context.entries, {
      level: 6,
      mtime: deterministicZipModifiedAt,
    }),
    report,
  };
}

function openPackage(input, { requireSimpleTopology }) {
  inspectZipPackage(input);
  const entries = unzipSync(input);
  const entryNames = Object.keys(entries);
  if (entryNames.length > maximumEntries)
    throw new Error("PPTX contains too many package entries.");
  const expandedBytes = Object.values(entries).reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  if (expandedBytes > maximumExpandedBytes)
    throw new Error("Expanded PPTX exceeds the browser mutation limit.");
  const presentation = parseXml(entries, presentationPath);
  const relationships = parseXml(entries, presentationRelationshipsPath);
  const contentTypes = parseXml(entries, contentTypesPath);
  if (presentation.documentElement.namespaceURI !== presentationNamespace)
    throw new Error(
      "Browser structural editing currently requires transitional PresentationML.",
    );
  if (
    requireSimpleTopology &&
    (presentation.getElementsByTagNameNS(presentationNamespace, "sectionLst")
      .length > 0 ||
      presentation.getElementsByTagNameNS(presentationNamespace, "custShowLst")
        .length > 0)
  )
    throw new Error(
      "Slides in sections or custom shows require an explicit structure migration.",
    );

  const slideIdList = requiredElement(
    presentation,
    presentationNamespace,
    "sldIdLst",
  );
  const slideIds = [...slideIdList.childNodes].filter(
    (node) =>
      node.nodeType === 1 &&
      node.namespaceURI === presentationNamespace &&
      node.localName === "sldId",
  );
  if (slideIds.length === 0) throw new Error("The PPTX has no template slide.");
  return {
    entries,
    presentation,
    relationships,
    contentTypes,
    slideIdList,
    slideIds,
  };
}

function updateSlideMetadata(context, command) {
  const slideIndex = integerInRange(
    command.slideIndex,
    0,
    context.slideIds.length - 1,
    "slideIndex",
  );
  const target = slideInfo(context, slideIndex);
  const slide = parseXml(context.entries, target.path);
  const changedParts = [];
  let previous;
  let value;

  if (command.op === "rename_slide") {
    value = validSlideName(command.name);
    const commonSlideData = requiredElement(
      slide,
      presentationNamespace,
      "cSld",
    );
    previous = commonSlideData.getAttribute("name") || "";
    if (previous !== value) {
      commonSlideData.setAttribute("name", value);
      context.entries[target.path] = serializeXml(slide);
      changedParts.push(target.path);
    }
  } else {
    if (typeof command.hidden !== "boolean")
      throw new TypeError("hidden must be a boolean.");
    previous = slideHidden(slide.documentElement);
    value = command.hidden;
    if (previous !== value) {
      if (value) slide.documentElement.setAttribute("show", "0");
      else slide.documentElement.removeAttribute("show");
      context.entries[target.path] = serializeXml(slide);
      changedParts.push(target.path);
    }
  }

  return {
    operation: command.op,
    slideIndex,
    slideCount: context.slideIds.length,
    previous,
    value,
    changedParts,
  };
}

function updateElement(context, command) {
  if (command.op !== "replace_text")
    throw new Error(`Unsupported browser element operation: ${command.op}`);
  if (
    typeof command.elementId !== "string" ||
    !/^\d+(?:\/\d+)+$/u.test(command.elementId)
  )
    throw new Error("elementId must be a browser Office object path.");
  if (
    typeof command.expectedText !== "string" ||
    typeof command.text !== "string"
  )
    throw new TypeError("replace_text requires expectedText and text strings.");
  const path = command.elementId.split("/").map(Number);
  const slideIndex = integerInRange(
    path.shift(),
    0,
    context.slideIds.length - 1,
    "element slide index",
  );
  const target = slideInfo(context, slideIndex);
  const slide = parseXml(context.entries, target.path);
  const shapeTree = requiredElement(slide, presentationNamespace, "spTree");
  let container = shapeTree;
  let shape;
  for (const [depth, index] of path.entries()) {
    const shapes = directShapes(container);
    shape =
      shapes[
        integerInRange(index, 0, shapes.length - 1, `element path ${depth}`)
      ];
    container = shape;
  }
  const previous = readShapeText(shape);
  if (previous !== command.expectedText)
    throw new Error("The browser package text changed after observation.");
  if (previous === command.text)
    return {
      operation: command.op,
      elementId: command.elementId,
      slideIndex,
      slideCount: context.slideIds.length,
      previous,
      value: command.text,
      changedParts: [],
    };
  replaceShapeText(shape, command.text);
  context.entries[target.path] = serializeXml(slide);
  return {
    operation: command.op,
    elementId: command.elementId,
    slideIndex,
    slideCount: context.slideIds.length,
    previous,
    value: command.text,
    changedParts: [target.path],
  };
}

function directShapes(container) {
  const names = new Set(["sp", "pic", "graphicFrame", "grpSp", "cxnSp"]);
  return [...container.childNodes].filter(
    (node) =>
      node.nodeType === 1 &&
      node.namespaceURI === presentationNamespace &&
      names.has(node.localName),
  );
}

function readShapeText(shape) {
  const paragraphs = [...shape.getElementsByTagNameNS(drawingNamespace, "p")];
  if (!paragraphs.length)
    throw new Error("The browser package target has no editable text.");
  return paragraphs.map(readParagraphText).join("\n");
}

function readParagraphText(paragraph) {
  let value = "";
  for (const child of [...paragraph.childNodes]) {
    if (child.nodeType !== 1 || child.namespaceURI !== drawingNamespace)
      continue;
    if (child.localName === "br") value += "\v";
    else if (child.localName === "r" || child.localName === "fld") {
      const text = child.getElementsByTagNameNS(drawingNamespace, "t")[0];
      if (text) value += text.textContent ?? "";
    }
  }
  return value;
}

function replaceShapeText(shape, value) {
  const paragraphs = [...shape.getElementsByTagNameNS(drawingNamespace, "p")];
  const replacements = value.replace(/\r\n/gu, "\n").split("\n");
  if (replacements.length !== paragraphs.length)
    throw new Error(
      "Browser package reconciliation cannot change paragraph count yet.",
    );
  for (let index = 0; index < paragraphs.length; index += 1)
    replaceParagraphText(paragraphs[index], replacements[index]);
}

function replaceParagraphText(paragraph, value) {
  if (value.includes("\v"))
    throw new Error(
      "Browser package reconciliation cannot change line-break structure yet.",
    );
  const fields = [...paragraph.getElementsByTagNameNS(drawingNamespace, "fld")];
  if (fields.length)
    throw new Error("Replacing dynamic fields as plain text is not supported.");
  const textNodes = [
    ...paragraph.getElementsByTagNameNS(drawingNamespace, "t"),
  ];
  if (!textNodes.length)
    throw new Error("The browser package paragraph has no editable text run.");
  const original = textNodes.map((node) => node.textContent ?? "").join("");
  if (original === value) return;
  let prefix = 0;
  while (
    prefix < original.length &&
    prefix < value.length &&
    original[prefix] === value[prefix]
  )
    prefix += 1;
  if (
    prefix > 0 &&
    prefix < original.length &&
    isLowSurrogate(original, prefix)
  )
    prefix -= 1;
  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < value.length - prefix &&
    original[original.length - suffix - 1] === value[value.length - suffix - 1]
  )
    suffix += 1;
  if (suffix > 0 && isLowSurrogate(original, original.length - suffix))
    suffix -= 1;
  const end = original.length - suffix;
  const inserted = value.slice(prefix, value.length - suffix);
  let offset = 0;
  let insertedOnce = false;
  for (const [index, node] of textNodes.entries()) {
    const text = node.textContent ?? "";
    const runEnd = offset + text.length;
    const before = text.slice(
      0,
      Math.max(0, Math.min(text.length, prefix - offset)),
    );
    const after = text.slice(Math.max(0, Math.min(text.length, end - offset)));
    const anchor =
      !insertedOnce && (prefix < runEnd || index === textNodes.length - 1);
    const replacement = before + (anchor ? inserted : "") + after;
    if (anchor) insertedOnce = true;
    node.textContent = replacement;
    if (/^\s|\s$/u.test(replacement))
      node.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace",
        "xml:space",
        "preserve",
      );
    else
      node.removeAttributeNS("http://www.w3.org/XML/1998/namespace", "space");
    offset = runEnd;
  }
}

function isLowSurrogate(value, index) {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

function validSlideName(value) {
  if (typeof value !== "string") throw new TypeError("name must be a string.");
  const codePoints = [...value];
  if (codePoints.length === 0 || codePoints.length > 255)
    throw new Error("name must contain from 1 to 255 characters.");
  if (/[\u0000-\u001f\u007f]/u.test(value))
    throw new Error("name contains an unsupported control character.");
  return value;
}

function slideHidden(slideRoot) {
  if (!slideRoot.hasAttribute("show")) return false;
  return ["0", "false", "off", "no"].includes(
    slideRoot.getAttribute("show").trim().toLowerCase(),
  );
}

function createSlide(context, command) {
  const {
    entries,
    presentation,
    relationships,
    contentTypes,
    slideIdList,
    slideIds,
  } = context;
  if (slideIds.length >= 200)
    throw new Error("The browser document slide limit is 200.");
  const sourceProperty =
    command.op === "add_slide" ? "templateSlideIndex" : "slideIndex";
  const sourceIndex = integerInRange(
    command[sourceProperty],
    0,
    slideIds.length - 1,
    sourceProperty,
  );
  const insertIndex = integerInRange(
    command.insertIndex,
    0,
    slideIds.length,
    "insertIndex",
  );
  const source = slideInfo(context, sourceIndex);
  const newSlidePath = nextSlidePath(Object.keys(entries));
  const newSlideRelationshipsPath = relationshipsPath(newSlidePath);
  const sourceSlideRelationshipsPath = relationshipsPath(source.path);
  const changedParts = new Set();

  if (command.op === "duplicate_slide") {
    const copied = new Map([[source.path, newSlidePath]]);
    clonePart(context, source.path, newSlidePath, copied, changedParts);
  } else {
    const slide = parseXml(entries, source.path);
    const commonSlideData = requiredElement(
      slide,
      presentationNamespace,
      "cSld",
    );
    const shapeTree = requiredElement(
      commonSlideData,
      presentationNamespace,
      "spTree",
    );
    removeDirectChildrenExcept(shapeTree, ["nvGrpSpPr", "grpSpPr"]);
    removeDirectChildrenExcept(commonSlideData, ["bg", "spTree"]);
    removeDirectChildrenExcept(slide.documentElement, ["cSld", "clrMapOvr"]);
    entries[newSlidePath] = serializeXml(slide);
    changedParts.add(newSlidePath);
    copyContentType(context, source.path, newSlidePath, slideContentType);
    if (!entries[sourceSlideRelationshipsPath])
      throw new Error("Template slide has no layout relationship.");
    const slideRelationships = parseXml(entries, sourceSlideRelationshipsPath);
    for (const element of [
      ...slideRelationships.getElementsByTagNameNS(
        packageRelationshipNamespace,
        "Relationship",
      ),
    ]) {
      const kind = element.getAttribute("Type").split("/").at(-1);
      if (kind !== "slideLayout" && kind !== "image")
        element.parentNode.removeChild(element);
    }
    const layoutRelationships = relationshipElements(slideRelationships).filter(
      (element) => element.getAttribute("Type").endsWith("/slideLayout"),
    );
    if (layoutRelationships.length !== 1)
      throw new Error(
        "Template slide must have exactly one layout relationship.",
      );
    entries[newSlideRelationshipsPath] = serializeXml(slideRelationships);
    changedParts.add(newSlideRelationshipsPath);
  }
  const newRelationshipId = nextRelationshipId(relationships);
  const newRelationship = relationships.createElementNS(
    packageRelationshipNamespace,
    "Relationship",
  );
  newRelationship.setAttribute("Id", newRelationshipId);
  newRelationship.setAttribute(
    "Type",
    `${relationshipAttributeNamespace}/slide`,
  );
  newRelationship.setAttribute(
    "Target",
    relativePart(presentationPath, newSlidePath),
  );
  relationships.documentElement.appendChild(newRelationship);

  const maximumSlideId = Math.max(
    ...slideIds.map((element) => Number(element.getAttribute("id"))),
  );
  if (
    !Number.isSafeInteger(maximumSlideId) ||
    maximumSlideId < 1 ||
    maximumSlideId >= 0xffffffff
  )
    throw new Error("PPTX slide identifiers are invalid.");
  const newSlideId = presentation.createElementNS(
    presentationNamespace,
    "p:sldId",
  );
  newSlideId.setAttribute("id", String(maximumSlideId + 1));
  newSlideId.setAttributeNS(
    relationshipAttributeNamespace,
    "r:id",
    newRelationshipId,
  );
  if (insertIndex === slideIds.length) slideIdList.appendChild(newSlideId);
  else slideIdList.insertBefore(newSlideId, slideIds[insertIndex]);
  entries[presentationPath] = serializeXml(presentation);
  entries[presentationRelationshipsPath] = serializeXml(relationships);
  entries[contentTypesPath] = serializeXml(contentTypes);
  changedParts.add(contentTypesPath);
  changedParts.add(presentationRelationshipsPath);
  changedParts.add(presentationPath);
  return {
    operation: command.op,
    sourceIndex,
    insertIndex,
    slideCount: slideIds.length + 1,
    changedParts: [...changedParts].sort(),
  };
}

function moveSlide(context, command) {
  const sourceIndex = integerInRange(
    command.slideIndex,
    0,
    context.slideIds.length - 1,
    "slideIndex",
  );
  const insertIndex = integerInRange(
    command.insertIndex,
    0,
    context.slideIds.length - 1,
    "insertIndex",
  );
  const reordered = [...context.slideIds];
  const [slideId] = reordered.splice(sourceIndex, 1);
  reordered.splice(insertIndex, 0, slideId);
  for (const element of context.slideIds)
    context.slideIdList.removeChild(element);
  for (const element of reordered) context.slideIdList.appendChild(element);
  context.entries[presentationPath] = serializeXml(context.presentation);
  return {
    operation: command.op,
    sourceIndex,
    insertIndex,
    slideCount: context.slideIds.length,
    changedParts: [presentationPath],
  };
}

function deleteSlide(context, command) {
  if (context.slideIds.length === 1)
    throw new Error("The last slide cannot be deleted.");
  const sourceIndex = integerInRange(
    command.slideIndex,
    0,
    context.slideIds.length - 1,
    "slideIndex",
  );
  const source = slideInfo(context, sourceIndex);
  for (let index = 0; index < context.slideIds.length; index += 1) {
    if (index === sourceIndex) continue;
    const other = slideInfo(context, index);
    const relPath = relationshipsPath(other.path);
    if (!context.entries[relPath]) continue;
    const linked = relationshipElements(
      parseXml(context.entries, relPath),
    ).some(
      (relationship) =>
        relationship.getAttribute("TargetMode") !== "External" &&
        resolvePart(other.path, relationship.getAttribute("Target")) ===
          source.path,
    );
    if (linked)
      throw new Error(
        "Another slide links to this slide. Remove that link before deleting it.",
      );
  }

  const before = reachableParts(context.entries);
  source.slideId.parentNode.removeChild(source.slideId);
  source.relationship.parentNode.removeChild(source.relationship);
  const after = reachableParts(context.entries, context.relationships);
  const removedParts = [...before].filter((part) => !after.has(part));
  const changedParts = new Set([
    contentTypesPath,
    presentationRelationshipsPath,
    presentationPath,
  ]);
  for (const part of removedParts) {
    delete context.entries[part];
    changedParts.add(part);
    const relPath = relationshipsPath(part);
    if (context.entries[relPath]) {
      delete context.entries[relPath];
      changedParts.add(relPath);
    }
  }
  for (const override of [
    ...context.contentTypes.getElementsByTagNameNS(
      contentTypeNamespace,
      "Override",
    ),
  ])
    if (
      removedParts.includes(
        override.getAttribute("PartName").replace(/^\//u, ""),
      )
    )
      override.parentNode.removeChild(override);
  context.entries[presentationPath] = serializeXml(context.presentation);
  context.entries[presentationRelationshipsPath] = serializeXml(
    context.relationships,
  );
  context.entries[contentTypesPath] = serializeXml(context.contentTypes);
  return {
    operation: command.op,
    sourceIndex,
    slideCount: context.slideIds.length - 1,
    changedParts: [...changedParts].sort(),
    removedParts: removedParts.sort(),
  };
}

function slideInfo(context, index) {
  const slideId = context.slideIds[index];
  const relationshipId = slideId.getAttributeNS(
    relationshipAttributeNamespace,
    "id",
  );
  const relationship = relationshipElements(context.relationships).find(
    (element) => element.getAttribute("Id") === relationshipId,
  );
  if (!relationship || relationship.getAttribute("TargetMode") === "External")
    throw new Error("Slide relationship is missing or external.");
  const path = resolvePart(
    presentationPath,
    relationship.getAttribute("Target"),
  );
  if (!path.startsWith("ppt/slides/") || !context.entries[path])
    throw new Error("Slide relationship does not target a package slide.");
  return { slideId, relationship, path };
}

function relationshipElements(document) {
  return [
    ...document.getElementsByTagNameNS(
      packageRelationshipNamespace,
      "Relationship",
    ),
  ];
}

function nextRelationshipId(document) {
  const existing = new Set(
    relationshipElements(document).map((element) => element.getAttribute("Id")),
  );
  let ordinal = 1;
  while (existing.has(`rIdSpellbook${ordinal}`)) ordinal += 1;
  return `rIdSpellbook${ordinal}`;
}

function copyContentType(context, source, destination, fallback = null) {
  const overrides = [
    ...context.contentTypes.getElementsByTagNameNS(
      contentTypeNamespace,
      "Override",
    ),
  ];
  if (
    overrides.some(
      (element) => element.getAttribute("PartName") === `/${destination}`,
    )
  )
    throw new Error(`PPTX content type already exists for ${destination}.`);
  const sourceOverride = overrides.find(
    (element) => element.getAttribute("PartName") === `/${source}`,
  );
  if (!sourceOverride && !fallback) return;
  const override = context.contentTypes.createElementNS(
    contentTypeNamespace,
    "Override",
  );
  override.setAttribute("PartName", `/${destination}`);
  override.setAttribute(
    "ContentType",
    sourceOverride?.getAttribute("ContentType") || fallback,
  );
  context.contentTypes.documentElement.appendChild(override);
}

function clonePart(context, source, destination, copied, changedParts) {
  if (copied.size > 500)
    throw new Error("Slide dependency graph exceeds the safe copy limit.");
  const bytes = context.entries[source];
  if (!bytes) throw new Error(`Missing slide dependency: ${source}`);
  context.entries[destination] = bytes.slice();
  changedParts.add(destination);
  copyContentType(context, source, destination);
  const sourceRelationshipsPath = relationshipsPath(source);
  if (!context.entries[sourceRelationshipsPath]) return;
  const relationships = parseXml(context.entries, sourceRelationshipsPath);
  for (const relationship of relationshipElements(relationships)) {
    if (relationship.getAttribute("TargetMode") === "External") continue;
    const target = resolvePart(source, relationship.getAttribute("Target"));
    const kind = relationship.getAttribute("Type").split("/").at(-1);
    let mapped = copied.get(target);
    if (!mapped) {
      if (sharedDependencyKinds.has(kind)) mapped = target;
      else {
        mapped = nextPartPath(context.entries, target);
        copied.set(target, mapped);
        clonePart(context, target, mapped, copied, changedParts);
      }
    }
    relationship.setAttribute("Target", relativePart(destination, mapped));
  }
  const destinationRelationshipsPath = relationshipsPath(destination);
  context.entries[destinationRelationshipsPath] = serializeXml(relationships);
  changedParts.add(destinationRelationshipsPath);
}

function nextPartPath(entries, source) {
  if (source.startsWith("ppt/slides/"))
    return nextSlidePath(Object.keys(entries));
  const slash = source.lastIndexOf("/");
  const dot = source.lastIndexOf(".");
  const directory = source.slice(0, slash + 1);
  const stem = source.slice(slash + 1, dot > slash ? dot : undefined);
  const extension = dot > slash ? source.slice(dot) : "";
  let ordinal = 1;
  let candidate;
  do {
    candidate = `${directory}${stem}-spellbook-${ordinal}${extension}`;
    ordinal += 1;
  } while (entries[candidate]);
  return candidate;
}

function reachableParts(entries, presentationRelationshipsOverride = null) {
  const reachable = new Set();
  const visit = (source, relationshipPath) => {
    if (
      !entries[relationshipPath] &&
      relationshipPath !== presentationRelationshipsPath
    )
      return;
    const relationships =
      relationshipPath === presentationRelationshipsPath &&
      presentationRelationshipsOverride
        ? presentationRelationshipsOverride
        : parseXml(entries, relationshipPath);
    for (const relationship of relationshipElements(relationships)) {
      if (relationship.getAttribute("TargetMode") === "External") continue;
      const target = resolvePart(source, relationship.getAttribute("Target"));
      if (reachable.has(target)) continue;
      reachable.add(target);
      visit(target, relationshipsPath(target));
    }
  };
  visit("", "_rels/.rels");
  return reachable;
}

function inspectZipPackage(input) {
  if (input.byteLength < 22) throw new Error("PPTX ZIP end record is missing.");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const minimumOffset = Math.max(0, input.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = input.byteLength - 22; offset >= minimumOffset; offset -= 1)
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  if (endOffset < 0) throw new Error("PPTX ZIP end record is missing.");
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  )
    throw new Error(
      "ZIP64 PPTX packages are not supported in the browser worker.",
    );
  if (entryCount > maximumEntries)
    throw new Error("PPTX contains too many package entries.");
  if (directoryOffset + directorySize > endOffset)
    throw new Error("PPTX ZIP central directory is invalid.");

  const decoder = new TextDecoder();
  const names = new Set();
  let expandedBytes = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > input.byteLength ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error("PPTX ZIP central directory entry is invalid.");
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (flags & 1) throw new Error("Encrypted PPTX entries are not supported.");
    if (compression !== 0 && compression !== 8)
      throw new Error(
        `Unsupported PPTX ZIP compression method: ${compression}.`,
      );
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > input.byteLength)
      throw new Error("PPTX ZIP entry name exceeds the package boundary.");
    const name = decoder.decode(input.subarray(nameStart, nameEnd));
    const segments = name.split("/");
    if (
      !name ||
      name.includes("\\") ||
      name.includes("\0") ||
      name.startsWith("/") ||
      segments.includes("..") ||
      names.has(name)
    )
      throw new Error(
        `Unsafe or duplicate PPTX ZIP entry: ${name || "<empty>"}.`,
      );
    names.add(name);
    expandedBytes += uncompressedBytes;
    if (expandedBytes > maximumExpandedBytes)
      throw new Error("Expanded PPTX exceeds the browser mutation limit.");
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== directoryOffset + directorySize)
    throw new Error("PPTX ZIP central directory size is inconsistent.");
}

function parseXml(entries, path) {
  const bytes = entries[path];
  if (!bytes) throw new Error(`PPTX package part is missing: ${path}`);
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/iu.test(source))
    throw new Error(`Unsafe XML declaration in ${path}.`);
  const issues = [];
  const document = new DOMParser({
    onError: (level, message) => issues.push(`${level}: ${message}`),
  }).parseFromString(source, "application/xml");
  if (issues.length || document.getElementsByTagName("parsererror").length)
    throw new Error(`Invalid XML in ${path}: ${issues.join("; ")}`);
  return document;
}

function serializeXml(document) {
  return strToU8(new XMLSerializer().serializeToString(document));
}

function requiredElement(document, namespace, localName) {
  const element = document.getElementsByTagNameNS(namespace, localName)[0];
  if (!element)
    throw new Error(`Required PresentationML element is missing: ${localName}`);
  return element;
}

function removeDirectChildrenExcept(parent, allowed) {
  for (const child of [...parent.childNodes])
    if (
      child.nodeType === 1 &&
      child.namespaceURI === presentationNamespace &&
      !allowed.includes(child.localName)
    )
      parent.removeChild(child);
}

function integerInRange(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  return value;
}

function nextSlidePath(entryNames) {
  const used = new Set(entryNames);
  let ordinal = 1;
  while (used.has(`ppt/slides/slide${ordinal}.xml`)) ordinal += 1;
  return `ppt/slides/slide${ordinal}.xml`;
}

function relationshipsPath(part) {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

function resolvePart(source, target) {
  if (!target || target.includes("\\"))
    throw new Error("Unsafe internal relationship target.");
  const resolved = new URL(target, `https://package.invalid/${source}`);
  if (resolved.origin !== "https://package.invalid")
    throw new Error("External slide relationship is not supported.");
  const decoded = decodeURIComponent(resolved.pathname).replace(/^\//u, "");
  if (decoded.includes("\\"))
    throw new Error("Unsafe internal relationship target.");
  return decoded;
}

function relativePart(source, target) {
  const sourceSegments = source.split("/");
  sourceSegments.pop();
  const targetSegments = target.split("/");
  while (
    sourceSegments.length &&
    targetSegments.length &&
    sourceSegments[0] === targetSegments[0]
  ) {
    sourceSegments.shift();
    targetSegments.shift();
  }
  return `${"../".repeat(sourceSegments.length)}${targetSegments.join("/")}`;
}

if (typeof self !== "undefined")
  self.onmessage = (event) => {
    const { requestId, bytes, command } = event.data;
    try {
      const result = applyOoxmlCommand(new Uint8Array(bytes), command);
      self.postMessage(
        { requestId, bytes: result.bytes.buffer, report: result.report },
        [result.bytes.buffer],
      );
    } catch (error) {
      self.postMessage({
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
