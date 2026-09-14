import test from "node:test";
import assert from "node:assert/strict";

import { validatePlaybackEvidence } from "./slideshow-playback.mjs";

const base = {
  slideIndex: 0,
  canvas: { width: 1280, height: 720 },
  presentationInfo: {
    transition: {
      type: "Fade",
      subtype: "CrossFade",
      direction: true,
      durationMilliseconds: 750,
    },
    animation: {
      present: true,
      presets: ["ooo-entrance-wipe"],
      durations: ["1.5s"],
    },
  },
  transition: {
    activityCreated: true,
    performCalls: 8,
    renderCalls: 7,
    ended: true,
  },
  animation: {
    started: true,
    ended: true,
    frameSamples: 12,
    frameFingerprints: 5,
    frameHashes: ["a", "b", "c", "d", "e"],
  },
  interaction: {
    executed: true,
    targetSlideIndex: 1,
    targetRendered: true,
  },
};

test("transition playback requires metadata, activity frames and completion", () => {
  assert.equal(
    validatePlaybackEvidence(base, {
      kind: "transition",
      slideIndex: 0,
      durationSeconds: 0.75,
    }).actualWebPlayback,
    true,
  );
  assert.throws(
    () =>
      validatePlaybackEvidence(
        { ...base, transition: { ...base.transition, renderCalls: 1 } },
        { kind: "transition", slideIndex: 0, durationSeconds: 0.75 },
      ),
    /multiple canvas frames/,
  );
});

test("animation playback requires exported timing and changed canvas frames", () => {
  assert.equal(
    validatePlaybackEvidence(base, {
      kind: "animation",
      slideIndex: 0,
      presetId: "ooo-entrance-wipe",
      durationSeconds: 1.5,
    }).actualWebPlayback,
    true,
  );
  assert.throws(
    () =>
      validatePlaybackEvidence(
        {
          ...base,
          animation: { ...base.animation, frameFingerprints: 1 },
        },
        {
          kind: "animation",
          slideIndex: 0,
          presetId: "ooo-entrance-wipe",
          durationSeconds: 1.5,
        },
      ),
    /distinct composited frames/,
  );
  assert.throws(
    () =>
      validatePlaybackEvidence(
        {
          ...base,
          animation: { ...base.animation, frameSamples: 1 },
        },
        {
          kind: "animation",
          slideIndex: 0,
          presetId: "ooo-entrance-wipe",
          durationSeconds: 1.5,
        },
      ),
    /not sampled completely/,
  );
});

test("interaction playback requires exported action and actual navigation", () => {
  const interactionEvidence = {
    ...base,
    presentationInfo: {
      ...base.presentationInfo,
      interactions: [
        {
          bounds: { x: 10, y: 20, width: 100, height: 40 },
          clickAction: { action: "bookmark", bookmark: "Slide 2" },
        },
      ],
    },
  };
  assert.equal(
    validatePlaybackEvidence(interactionEvidence, {
      kind: "interaction",
      slideIndex: 0,
      action: "bookmark",
      targetSlideIndex: 1,
    }).actualWebPlayback,
    true,
  );
  assert.throws(
    () =>
      validatePlaybackEvidence(
        {
          ...interactionEvidence,
          interaction: { executed: true, targetSlideIndex: 0 },
        },
        {
          kind: "interaction",
          slideIndex: 0,
          action: "bookmark",
          targetSlideIndex: 1,
        },
      ),
    /different slide/,
  );
});
