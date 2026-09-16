/* SPDX-License-Identifier: MPL-2.0 */

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
}

export function createSaveSnapshot(
  bytes,
  modelRevision,
  commandCount = 0,
  undoCount = 0,
) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength)
    throw new TypeError("A save requires PPTX bytes.");
  if (typeof modelRevision !== "string" || !modelRevision)
    throw new TypeError("A save requires the observed model revision.");
  if (
    !Number.isSafeInteger(commandCount) ||
    commandCount < 0 ||
    !Number.isSafeInteger(undoCount) ||
    undoCount < 0
  )
    throw new TypeError("A save requires valid history positions.");
  return { bytes: bytes.slice(), modelRevision, commandCount, undoCount };
}

export function acknowledgedSaveHasLaterChanges(
  snapshot,
  currentBytes,
  currentModelRevision,
) {
  if (!(snapshot?.bytes instanceof Uint8Array))
    throw new TypeError("The acknowledged save has no byte snapshot.");
  if (!(currentBytes instanceof Uint8Array) || !currentBytes.byteLength)
    throw new TypeError("The current PPTX bytes are missing.");
  if (typeof currentModelRevision !== "string" || !currentModelRevision)
    throw new TypeError("The current model revision is missing.");
  return (
    currentModelRevision !== snapshot.modelRevision ||
    !sameBytes(snapshot.bytes, currentBytes)
  );
}

export function laterHistoryFromSaveSnapshot(
  snapshot,
  currentBytes,
  currentModelRevision,
  commands,
  undoHistory,
) {
  if (!Array.isArray(commands) || !Array.isArray(undoHistory)) return null;
  if (
    commands.length < snapshot.commandCount ||
    undoHistory.length < snapshot.undoCount
  )
    return null;
  const laterCommands = commands.slice(snapshot.commandCount);
  const laterUndo = undoHistory.slice(snapshot.undoCount);
  if (!laterCommands.length || laterCommands.length !== laterUndo.length)
    return null;
  let beforeBytes = snapshot.bytes;
  let beforeRevision = snapshot.modelRevision;
  for (let index = 0; index < laterUndo.length; index += 1) {
    const entry = laterUndo[index];
    if (
      entry?.command !== laterCommands[index] ||
      !(entry.beforeBytes instanceof Uint8Array) ||
      !(entry.afterBytes instanceof Uint8Array) ||
      entry.beforeRevision !== beforeRevision ||
      !sameBytes(entry.beforeBytes, beforeBytes)
    )
      return null;
    beforeBytes = entry.afterBytes;
    beforeRevision = entry.afterRevision;
  }
  if (
    beforeRevision !== currentModelRevision ||
    !sameBytes(beforeBytes, currentBytes)
  )
    return null;
  return { commands: laterCommands, undoHistory: laterUndo };
}
