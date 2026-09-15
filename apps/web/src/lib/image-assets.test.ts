import { describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: vi.fn(), ensureSchema: vi.fn() }));
vi.mock("./storage", () => ({ getObject: vi.fn(), putObject: vi.fn() }));
import { assetInfo, imageInfo } from "./image-assets";

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

describe("presentation media asset admission", () => {
  const bytes = (prefix: number[] | string, length = 16) => {
    const data = Buffer.alloc(length);
    if (typeof prefix === "string") data.write(prefix, 0, "ascii");
    else Buffer.from(prefix).copy(data);
    return data;
  };

  it.each([
    [
      "audio/wav",
      (() => {
        const data = bytes("RIFF");
        data.write("WAVE", 8, "ascii");
        return data;
      })(),
    ],
    ["audio/ogg", bytes("OggS")],
    ["audio/mpeg", bytes("ID3")],
    ["audio/mpeg", bytes([0xff, 0xfb])],
    ["video/webm", bytes([0x1a, 0x45, 0xdf, 0xa3])],
  ] as const)(
    "accepts %s only from its binary signature",
    (contentType, data) => {
      expect(assetInfo(data, contentType)).toEqual({
        width: 0,
        height: 0,
        contentType,
        kind: "media",
      });
    },
  );

  it.each(["audio/mp4", "video/mp4"] as const)(
    "accepts declared %s after an ISO media signature",
    (contentType) => {
      const data = bytes("");
      data.write("ftyp", 4, "ascii");
      expect(assetInfo(data, contentType).contentType).toBe(contentType);
    },
  );

  it("normalizes WAV aliases and rejects mismatches, unknown bytes, and oversized media", () => {
    const wav = bytes("RIFF");
    wav.write("WAVE", 8, "ascii");
    expect(assetInfo(wav, "audio/x-wav").contentType).toBe("audio/wav");
    expect(() => assetInfo(bytes("OggS"), "audio/mpeg")).toThrow(
      "unsupported_or_invalid_media",
    );
    expect(() => assetInfo(bytes("unknown"), "video/mp4")).toThrow(
      "unsupported_or_invalid_media",
    );
    expect(() => assetInfo(Buffer.alloc(25_000_001), "video/webm")).toThrow(
      "media_too_large",
    );
  });
});
