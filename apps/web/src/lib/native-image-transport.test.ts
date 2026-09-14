import { describe, expect, it } from "vitest";
import { compactNativeTaskResultForTransport } from "./native-image-transport";

describe("native image transport", () => {
  it("compacts signed PNG byte arrays without changing metadata", () => {
    const result = compactNativeTaskResultForTransport({
      id: "task",
      value: {
        revision: "r1",
        images: [
          {
            slideIndex: 2,
            pngBytes: [-119, 80, 78, 71, 13, 10, 26, 10],
          },
        ],
      },
    }) as any;

    expect(result.id).toBe("task");
    expect(result.value.revision).toBe("r1");
    expect(result.value.images).toEqual([
      { slideIndex: 2, pngBase64: "iVBORw0KGgo=" },
    ]);
  });

  it("leaves invalid payloads for fail-closed server validation", () => {
    const invalid = { value: { images: [{ pngBytes: [999] }] } };
    expect(compactNativeTaskResultForTransport(invalid)).toEqual(invalid);
  });
});
