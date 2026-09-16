/* SPDX-License-Identifier: MPL-2.0 */

// A package-only edit must survive an Office reload before it enters the
// browser journal. Compare authored identity and order, then verify the
// inspector's derived slideCount against the complete saved slide order.
export function persistedSectionsMatch(expected, observed, slideCount) {
  if (!Array.isArray(expected) || !Array.isArray(observed)) return false;
  if (!Number.isSafeInteger(slideCount) || slideCount < 0) return false;
  if (expected.length !== observed.length) return false;
  return expected.every((section, index) => {
    const saved = observed[index];
    return (
      saved &&
      typeof section?.id === "string" &&
      typeof saved.id === "string" &&
      section.id.toUpperCase() === saved.id.toUpperCase() &&
      section.name === saved.name &&
      section.startSlideIndex === saved.startSlideIndex &&
      saved.slideCount ===
        (expected[index + 1]?.startSlideIndex ?? slideCount) -
          section.startSlideIndex
    );
  });
}
