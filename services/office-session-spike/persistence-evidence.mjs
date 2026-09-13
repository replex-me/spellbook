import { quantizedGeometryEquivalent } from "./document-state-evidence.mjs";

function valueSummary(value) {
  if (value === undefined) return "undefined";
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return String(value);
  return encoded.length > 240 ? `${encoded.slice(0, 237)}...` : encoded;
}

function stableJson(value) {
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate !== null && typeof candidate === "object")
      return Object.fromEntries(
        Object.keys(candidate)
          .sort()
          .map((key) => [key, normalize(candidate[key])]),
      );
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

const OBSERVATION_ONLY_FIELDS = new Set([
  "alignedWith",
  "layoutIssues",
  "overlapsWith",
  "stableId",
]);

function withoutObservationOnlyFields(value) {
  if (Array.isArray(value)) return value.map(withoutObservationOnlyFields);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !OBSERVATION_ONLY_FIELDS.has(key))
        .map(([key, candidate]) => [
          key,
          withoutObservationOnlyFields(candidate),
        ]),
    );
  return value;
}

function withoutMergedContinuationFormatting(slides) {
  for (const slide of slides) {
    for (const element of slide.elements ?? []) {
      const rows = element.table?.cellDetails;
      if (!Array.isArray(rows)) continue;
      element.table.cellDetails = rows.map((row) =>
        row.map((cell) => {
          if (cell?.merged !== true) return cell;
          // A merged continuation cell has no independently rendered surface.
          // LibreOffice reconstructs its dormant formatting from the merge
          // anchor when PPTX is reopened, so only its structural marker and
          // non-rendered text identity are stable persisted semantics.
          return {
            row: cell.row,
            column: cell.column,
            text: cell.text,
            merged: true,
            rowSpan: cell.rowSpan,
            columnSpan: cell.columnSpan,
          };
        }),
      );
    }
  }
  return slides;
}

/**
 * Captures the persisted slide/master model while using the detailed UNO text
 * enumeration as the source of truth for the requested slide. The compact
 * element text is useful for prompts but can lag a range edit in the same
 * remote transaction; paragraph portions are read directly from the model.
 */
export function persistenceStateFromObservation(observation) {
  const state = {
    slides: structuredClone(observation?.slides ?? []),
    masters: structuredClone(observation?.masters ?? []),
  };
  const detailSlideIndex = observation?.textDetails?.slideIndex;
  if (!Number.isInteger(detailSlideIndex) || !state.slides[detailSlideIndex])
    return state;
  for (const detail of observation.textDetails?.elements ?? []) {
    const element = state.slides[detailSlideIndex].elements?.find(
      (candidate) => candidate.elementId === detail.elementId,
    );
    if (!element || !Array.isArray(detail.paragraphs)) continue;
    element.text = detail.paragraphs
      .map((paragraph) =>
        Array.isArray(paragraph.portions)
          ? paragraph.portions.map((portion) => portion.text ?? "").join("")
          : (paragraph.text ?? ""),
      )
      .join("\n");
  }
  return state;
}

/**
 * Removes serialization order from the document state without removing any
 * user-visible master or theme data. PPTX import/export may reorder master
 * relationships and consequently renumber the UNO masterIndex. Slides retain
 * masterName, while every semantic master field is compared as a sorted
 * multiset so extra, missing or modified masters still fail the gate.
 */
export function normalizeDocumentPersistenceState(state) {
  const masters = (state?.masters ?? [])
    .map(({ masterIndex: _masterIndex, ...master }) =>
      withoutObservationOnlyFields(structuredClone(master)),
    )
    .sort((left, right) => {
      const leftIdentity = `${left.name ?? ""}\u0000${left.layout ?? ""}\u0000${stableJson(left)}`;
      const rightIdentity = `${right.name ?? ""}\u0000${right.layout ?? ""}\u0000${stableJson(right)}`;
      return leftIdentity.localeCompare(rightIdentity, "en");
    });
  const slides = withoutMergedContinuationFormatting(
    (state?.slides ?? []).map(({ masterIndex: _masterIndex, ...slide }) => {
      const normalized = withoutObservationOnlyFields(structuredClone(slide));
      if (normalized.transition) {
        const {
          effect: _effect,
          speed: _speed,
          ...persistedTransition
        } = normalized.transition;
        normalized.transition = persistedTransition;
      }
      return normalized;
    }),
  );
  return { slides, masters };
}

export function firstPersistenceDifference(expected, observed, path = "$") {
  if (Object.is(expected, observed)) return null;
  if (Array.isArray(expected) || Array.isArray(observed)) {
    if (!Array.isArray(expected) || !Array.isArray(observed))
      return { path, expected, observed };
    if (expected.length !== observed.length)
      return {
        path: `${path}.length`,
        expected: expected.length,
        observed: observed.length,
      };
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstPersistenceDifference(
        expected[index],
        observed[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }
  const expectedObject = expected !== null && typeof expected === "object";
  const observedObject = observed !== null && typeof observed === "object";
  if (expectedObject || observedObject) {
    if (!expectedObject || !observedObject) return { path, expected, observed };
    const keys = [
      ...new Set([...Object.keys(expected), ...Object.keys(observed)]),
    ].sort();
    for (const key of keys) {
      const difference = firstPersistenceDifference(
        expected[key],
        observed[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return null;
  }
  return { path, expected, observed };
}

export function assertExactPersistence(observed, expected, message) {
  const difference = firstPersistenceDifference(expected, observed);
  if (!difference) return;
  throw new Error(
    `${message} First difference at ${difference.path}: expected ${valueSummary(difference.expected)}, observed ${valueSummary(difference.observed)}.`,
  );
}

function persistenceKind(value) {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "value";
}

function isAnimationTreeTime(path) {
  return (
    path.includes(".animations.roots[") &&
    /\.(?:begin|duration|end|offset)$/.test(path)
  );
}

function ooxmlAnimationTime(seconds) {
  // ECMA-376 serializes these timing attributes as integer milliseconds.
  // LibreOffice's exporter truncates the double when it writes that integer.
  return Math.trunc(seconds * 1_000 + Number.EPSILON) / 1_000;
}

function isFormatCanonicalEquivalent(expected, observed, path) {
  const numeric =
    typeof expected === "number" &&
    typeof observed === "number" &&
    Number.isFinite(expected) &&
    Number.isFinite(observed);
  if (!numeric) return false;
  if (
    /\.elements\[\d+\]\.(?:x|y|width|height)$/.test(path) ||
    /\.table\.(?:rowHeights|columnWidths)\[\d+\]$/.test(path)
  )
    return quantizedGeometryEquivalent(expected, observed);
  return (
    isAnimationTreeTime(path) &&
    Object.is(ooxmlAnimationTime(expected), observed)
  );
}

function intendedDifference(expected, observed, path) {
  if (isFormatCanonicalEquivalent(expected, observed, path)) return null;
  const difference = firstPersistenceDifference(expected, observed, path);
  return difference ? { ...difference, invariant: "intended-change" } : null;
}

function collectExactDifferences(
  expected,
  observed,
  path,
  invariant,
  differences,
  limit,
  allowFormatCanonicalization,
) {
  if (differences.length >= limit || Object.is(expected, observed)) return;
  if (
    allowFormatCanonicalization &&
    isFormatCanonicalEquivalent(expected, observed, path)
  )
    return;
  if (Array.isArray(expected) || Array.isArray(observed)) {
    if (!Array.isArray(expected) || !Array.isArray(observed)) {
      differences.push({ path, expected, observed, invariant });
      return;
    }
    if (expected.length !== observed.length)
      differences.push({
        path: `${path}.length`,
        expected: expected.length,
        observed: observed.length,
        invariant,
      });
    const length = Math.min(expected.length, observed.length);
    for (
      let index = 0;
      index < length && differences.length < limit;
      index += 1
    )
      collectExactDifferences(
        expected[index],
        observed[index],
        `${path}[${index}]`,
        invariant,
        differences,
        limit,
        allowFormatCanonicalization,
      );
    return;
  }
  const expectedObject = expected !== null && typeof expected === "object";
  const observedObject = observed !== null && typeof observed === "object";
  if (expectedObject || observedObject) {
    if (!expectedObject || !observedObject) {
      differences.push({ path, expected, observed, invariant });
      return;
    }
    const keys = [
      ...new Set([...Object.keys(expected), ...Object.keys(observed)]),
    ].sort();
    for (const key of keys) {
      if (differences.length >= limit) break;
      collectExactDifferences(
        expected[key],
        observed[key],
        `${path}.${key}`,
        invariant,
        differences,
        limit,
        allowFormatCanonicalization,
      );
    }
    return;
  }
  differences.push({ path, expected, observed, invariant });
}

function collectPersistenceDeltaDifferences(
  before,
  expected,
  baseline,
  observed,
  path,
  differences,
  limit,
) {
  if (differences.length >= limit) return;
  if (!firstPersistenceDifference(before, expected)) {
    collectExactDifferences(
      baseline,
      observed,
      path,
      "unchanged-after-normalization",
      differences,
      limit,
      false,
    );
    return;
  }
  if (!firstPersistenceDifference(expected, observed)) return;

  const beforeKind = persistenceKind(before);
  const expectedKind = persistenceKind(expected);
  const baselineKind = persistenceKind(baseline);
  const observedKind = persistenceKind(observed);
  if (
    beforeKind !== expectedKind ||
    baselineKind !== observedKind ||
    expectedKind !== observedKind
  ) {
    collectExactDifferences(
      expected,
      observed,
      path,
      "intended-change",
      differences,
      limit,
      true,
    );
    return;
  }

  if (expectedKind === "array") {
    if (
      before.length !== expected.length ||
      baseline.length !== observed.length ||
      expected.length !== observed.length
    ) {
      collectExactDifferences(
        expected,
        observed,
        path,
        "intended-change",
        differences,
        limit,
        true,
      );
      return;
    }
    for (let index = 0; index < expected.length; index += 1)
      collectPersistenceDeltaDifferences(
        before[index],
        expected[index],
        baseline[index],
        observed[index],
        `${path}[${index}]`,
        differences,
        limit,
      );
    return;
  }

  if (expectedKind === "object") {
    const keys = [
      ...new Set([
        ...Object.keys(before),
        ...Object.keys(expected),
        ...Object.keys(baseline),
        ...Object.keys(observed),
      ]),
    ].sort();
    for (const key of keys)
      collectPersistenceDeltaDifferences(
        before[key],
        expected[key],
        baseline[key],
        observed[key],
        `${path}.${key}`,
        differences,
        limit,
      );
    return;
  }

  collectExactDifferences(
    expected,
    observed,
    path,
    "intended-change",
    differences,
    limit,
    true,
  );
}

export function persistenceDeltaDifferences(
  { before, expected, baseline, observed },
  { limit = 200 } = {},
) {
  const differences = [];
  collectPersistenceDeltaDifferences(
    before,
    expected,
    baseline,
    observed,
    "$",
    differences,
    limit,
  );
  return differences;
}

/**
 * Compares a mutated save against a no-op save of the same source document.
 *
 * LibreOffice may canonicalize imported OOXML even when the user makes no
 * change. For every subtree that the mutation left alone, the no-op save is
 * therefore the correct expected value. Only subtrees changed in memory must
 * match the post-mutation state directly.
 */
export function firstPersistenceDeltaDifference(
  before,
  expected,
  baseline,
  observed,
  path = "$",
) {
  if (!firstPersistenceDifference(before, expected)) {
    const difference = firstPersistenceDifference(baseline, observed, path);
    return difference
      ? { ...difference, invariant: "unchanged-after-normalization" }
      : null;
  }

  if (!firstPersistenceDifference(expected, observed)) return null;

  const beforeKind = persistenceKind(before);
  const expectedKind = persistenceKind(expected);
  const baselineKind = persistenceKind(baseline);
  const observedKind = persistenceKind(observed);
  if (
    beforeKind !== expectedKind ||
    baselineKind !== observedKind ||
    expectedKind !== observedKind
  )
    return intendedDifference(expected, observed, path);

  if (expectedKind === "array") {
    if (
      before.length !== expected.length ||
      baseline.length !== observed.length ||
      expected.length !== observed.length
    )
      return intendedDifference(expected, observed, path);
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstPersistenceDeltaDifference(
        before[index],
        expected[index],
        baseline[index],
        observed[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }

  if (expectedKind === "object") {
    const keys = [
      ...new Set([
        ...Object.keys(before),
        ...Object.keys(expected),
        ...Object.keys(baseline),
        ...Object.keys(observed),
      ]),
    ].sort();
    for (const key of keys) {
      const difference = firstPersistenceDeltaDifference(
        before[key],
        expected[key],
        baseline[key],
        observed[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return null;
  }

  return intendedDifference(expected, observed, path);
}

export function assertPersistenceDelta(
  { before, expected, baseline, observed },
  message,
) {
  const differences = persistenceDeltaDifferences({
    before,
    expected,
    baseline,
    observed,
  });
  const difference = differences[0];
  if (!difference) return;
  const expectation =
    difference.invariant === "unchanged-after-normalization"
      ? "the no-op saved baseline"
      : "the intended edited state";
  throw new Error(
    `${message} ${differences.length} difference(s); ${difference.invariant} failed at ${difference.path}: expected ${expectation} ${valueSummary(difference.expected)}, observed ${valueSummary(difference.observed)}.`,
  );
}

export function documentPersistenceDeltaDifferences(report, observed, options) {
  const before = report?.persistenceBefore;
  const expected = report?.persistenceExpected;
  const baseline = report?.persistenceBaseline;
  if (
    !before?.slides ||
    !before?.masters ||
    !expected?.slides ||
    !expected?.masters ||
    !baseline?.slides ||
    !baseline?.masters ||
    !observed?.slides ||
    !observed?.masters
  )
    throw new Error(
      "Persistence evidence requires before, expected, no-op baseline and reopened slide/master states.",
    );
  return persistenceDeltaDifferences(
    {
      before: normalizeDocumentPersistenceState(before),
      expected: normalizeDocumentPersistenceState(expected),
      baseline: normalizeDocumentPersistenceState(baseline),
      observed: normalizeDocumentPersistenceState(observed),
    },
    options,
  );
}

export function assertDocumentPersistenceDelta(report, observed, message) {
  const before = report?.persistenceBefore;
  const expected = report?.persistenceExpected;
  const baseline = report?.persistenceBaseline;
  if (
    !before?.slides ||
    !before?.masters ||
    !expected?.slides ||
    !expected?.masters ||
    !baseline?.slides ||
    !baseline?.masters ||
    !observed?.slides ||
    !observed?.masters
  )
    throw new Error(
      "Persistence evidence requires before, expected, no-op baseline and reopened slide/master states.",
    );
  const differences = documentPersistenceDeltaDifferences(report, observed);
  if (!differences.length) return;
  const difference = differences[0];
  const expectation =
    difference.invariant === "unchanged-after-normalization"
      ? "the no-op saved baseline"
      : "the intended edited state";
  throw new Error(
    `${message} ${differences.length} difference(s); ${difference.invariant} failed at ${difference.path}: expected ${expectation} ${valueSummary(difference.expected)}, observed ${valueSummary(difference.observed)}.`,
  );
}
