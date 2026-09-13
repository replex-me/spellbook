const GEOMETRY_QUANTIZATION = 1;

export function quantizedGeometryEquivalent(expected, actual) {
  return (
    typeof expected === "number" &&
    typeof actual === "number" &&
    Number.isFinite(expected) &&
    Number.isFinite(actual) &&
    Math.abs(expected - actual) <= GEOMETRY_QUANTIZATION
  );
}

function isQuantizedGeometryPath(path) {
  return (
    /\.elements\[\d+\]\.(?:x|y|width|height)$/.test(path) ||
    /\.table\.(?:rowHeights|columnWidths)\[\d+\]$/.test(path)
  );
}

/**
 * Finds the first user-visible document-state difference. LibreOffice stores
 * shape and table geometry in hundredths of a millimetre, and some native
 * model round trips quantize a calculated value by one unit. That 0.01 mm is
 * below a screen pixel and is treated as the same outline; every structural,
 * textual and formatting value remains exact.
 */
export function firstDocumentStateDifference(
  expected,
  actual,
  path = "slides",
) {
  if (Object.is(expected, actual)) return null;
  if (
    isQuantizedGeometryPath(path) &&
    quantizedGeometryEquivalent(expected, actual)
  )
    return null;
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  )
    return { path, expected, actual };
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  for (const key of keys) {
    const childPath = Array.isArray(expected)
      ? `${path}[${key}]`
      : `${path}.${key}`;
    const difference = firstDocumentStateDifference(
      expected[key],
      actual[key],
      childPath,
    );
    if (difference) return difference;
  }
  return null;
}

export function documentStatesEquivalent(expected, actual) {
  return firstDocumentStateDifference(expected, actual) === null;
}
