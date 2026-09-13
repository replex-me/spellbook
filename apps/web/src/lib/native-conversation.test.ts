import { describe, expect, it } from "vitest";
import {
  boundedNativeConversationHistory,
  NATIVE_HISTORY_CHARACTER_LIMIT,
  NATIVE_HISTORY_TURN_LIMIT,
} from "./native-conversation";

describe("bounded native conversation history", () => {
  it("keeps admitted turns in chronological order", () => {
    expect(
      boundedNativeConversationHistory([
        {
          request_text: "세 번째 요청",
          assistant_text: null,
          status: "failed",
        },
        {
          request_text: "실행 중 요청",
          assistant_text: null,
          status: "running",
        },
        {
          request_text: "첫 요청",
          assistant_text: "첫 응답",
          status: "completed",
        },
      ]),
    ).toEqual([
      { request: "첫 요청", response: "첫 응답", status: "completed" },
      { request: "세 번째 요청", response: null, status: "failed" },
    ]);
  });

  it("bounds both turn count and total user-visible text", () => {
    const history = boundedNativeConversationHistory(
      Array.from({ length: 20 }, (_, index) => ({
        request_text: `${index}`.repeat(3_000),
        assistant_text: `${index}`.repeat(10_000),
        status: "completed",
      })),
    );
    expect(history.length).toBeLessThanOrEqual(NATIVE_HISTORY_TURN_LIMIT);
    expect(
      history.reduce(
        (total, turn) =>
          total + turn.request.length + (turn.response?.length ?? 0),
        0,
      ),
    ).toBeLessThanOrEqual(NATIVE_HISTORY_CHARACTER_LIMIT);
  });
});
