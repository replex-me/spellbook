/* SPDX-License-Identifier: MPL-2.0 */

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const presentationNamespace =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
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

export function applyOoxmlCommand(input, command) {
  if (!(input instanceof Uint8Array))
    throw new TypeError("PPTX input must be a Uint8Array.");
  if (input.byteLength > maximumInputBytes)
    throw new Error("PPTX exceeds the browser mutation limit.");
  if (command?.op !== "add_slide")
    throw new Error(`Unsupported browser OOXML operation: ${command?.op}`);
  return addSlide(input, command);
}

function addSlide(input, command) {
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

  const presentationPath = "ppt/presentation.xml";
  const presentationRelationshipsPath = "ppt/_rels/presentation.xml.rels";
  const contentTypesPath = "[Content_Types].xml";
  const presentation = parseXml(entries, presentationPath);
  const relationships = parseXml(entries, presentationRelationshipsPath);
  const contentTypes = parseXml(entries, contentTypesPath);
  if (presentation.documentElement.namespaceURI !== presentationNamespace)
    throw new Error(
      "Browser structural editing currently requires transitional PresentationML.",
    );
  if (
    presentation.getElementsByTagNameNS(presentationNamespace, "sectionLst")
      .length > 0 ||
    presentation.getElementsByTagNameNS(presentationNamespace, "custShowLst")
      .length > 0
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
  if (slideIds.length >= 200)
    throw new Error("The browser document slide limit is 200.");
  const templateSlideIndex = integerInRange(
    command.templateSlideIndex,
    0,
    slideIds.length - 1,
    "templateSlideIndex",
  );
  const insertIndex = integerInRange(
    command.insertIndex,
    0,
    slideIds.length,
    "insertIndex",
  );

  const templateRelationshipId = slideIds[templateSlideIndex].getAttributeNS(
    relationshipAttributeNamespace,
    "id",
  );
  const templateRelationship = [
    ...relationships.getElementsByTagNameNS(
      packageRelationshipNamespace,
      "Relationship",
    ),
  ].find((element) => element.getAttribute("Id") === templateRelationshipId);
  if (!templateRelationship)
    throw new Error("Template slide relationship is missing.");
  const templateSlidePath = resolvePart(
    presentationPath,
    templateRelationship.getAttribute("Target"),
  );
  if (!templateSlidePath.startsWith("ppt/slides/"))
    throw new Error("Template relationship does not target a slide part.");
  const newSlidePath = nextSlidePath(entryNames);
  const newSlideRelationshipsPath = relationshipsPath(newSlidePath);
  const templateSlideRelationshipsPath = relationshipsPath(templateSlidePath);

  const slide = parseXml(entries, templateSlidePath);
  const commonSlideData = requiredElement(slide, presentationNamespace, "cSld");
  const shapeTree = requiredElement(
    commonSlideData,
    presentationNamespace,
    "spTree",
  );
  removeDirectChildrenExcept(shapeTree, ["nvGrpSpPr", "grpSpPr"]);
  removeDirectChildrenExcept(commonSlideData, ["bg", "spTree"]);
  removeDirectChildrenExcept(slide.documentElement, ["cSld", "clrMapOvr"]);
  entries[newSlidePath] = serializeXml(slide);

  if (entries[templateSlideRelationshipsPath]) {
    const slideRelationships = parseXml(
      entries,
      templateSlideRelationshipsPath,
    );
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
    entries[newSlideRelationshipsPath] = serializeXml(slideRelationships);
  }

  const existingRelationshipIds = new Set(
    [
      ...relationships.getElementsByTagNameNS(
        packageRelationshipNamespace,
        "Relationship",
      ),
    ].map((element) => element.getAttribute("Id")),
  );
  let relationshipOrdinal = 1;
  while (existingRelationshipIds.has(`rIdSpellbook${relationshipOrdinal}`))
    relationshipOrdinal += 1;
  const newRelationshipId = `rIdSpellbook${relationshipOrdinal}`;
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
  if (!Number.isSafeInteger(maximumSlideId) || maximumSlideId < 1)
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

  const sourceOverride = [
    ...contentTypes.getElementsByTagNameNS(contentTypeNamespace, "Override"),
  ].find(
    (element) => element.getAttribute("PartName") === `/${templateSlidePath}`,
  );
  const override = contentTypes.createElementNS(
    contentTypeNamespace,
    "Override",
  );
  override.setAttribute("PartName", `/${newSlidePath}`);
  override.setAttribute(
    "ContentType",
    sourceOverride?.getAttribute("ContentType") || slideContentType,
  );
  contentTypes.documentElement.appendChild(override);

  entries[presentationPath] = serializeXml(presentation);
  entries[presentationRelationshipsPath] = serializeXml(relationships);
  entries[contentTypesPath] = serializeXml(contentTypes);
  const output = zipSync(entries, { level: 6 });
  return {
    bytes: output,
    report: {
      operation: "add_slide",
      templateSlideIndex,
      insertIndex,
      slideCount: slideIds.length + 1,
      changedParts: [
        contentTypesPath,
        presentationRelationshipsPath,
        presentationPath,
        newSlideRelationshipsPath,
        newSlidePath,
      ].filter((path) => entries[path]),
    },
  };
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
