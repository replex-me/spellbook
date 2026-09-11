import { describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: vi.fn(), ensureSchema: vi.fn() }));
vi.mock("./storage", () => ({ putObject: vi.fn() }));
import { imageInfo } from "./image-assets";

describe("image asset admission", () => {
  const png = () =>
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=",
      "base64",
    );
  it("reads dimensions and MIME from PNG bytes rather than the file name", () => {
    expect(imageInfo(png())).toEqual({
      width: 1,
      height: 1,
      contentType: "image/png",
    });
  });
  it("rejects non-images, oversized pixels and oversized files", () => {
    expect(() => imageInfo(Buffer.from("<svg></svg>"))).toThrow();
    const huge = png();
    huge.writeUInt32BE(20000, 16);
    huge.writeUInt32BE(20000, 20);
    expect(() => imageInfo(huge)).toThrow();
    expect(() =>
      imageInfo(Buffer.concat([png(), Buffer.alloc(5_000_000)])),
    ).toThrow();
  });
});
