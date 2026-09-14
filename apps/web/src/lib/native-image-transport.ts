const PNG_BYTE_LIMIT = 12_000_000;

function bytesToBase64(bytes: number[]): string | null {
  if (
    bytes.length > PNG_BYTE_LIMIT ||
    bytes.some(
      (value) => !Number.isInteger(value) || value < -128 || value > 255,
    )
  )
    return null;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    const view = Uint8Array.from(
      bytes.slice(offset, offset + 8_192),
      (value) => value & 255,
    );
    chunks.push(String.fromCharCode(...view));
  }
  return btoa(chunks.join(""));
}

/**
 * Collabora exposes byte sequences as JSON number arrays. Compact only the PNG
 * payload at the browser boundary so HTTP and JSONB do not expand every byte
 * into several decimal characters. Invalid payloads remain unchanged and are
 * rejected by the server-side contract.
 */
export function compactNativeTaskResultForTransport(value: unknown): unknown {
  const result = value as Record<string, unknown> | null;
  const observation = result?.value as Record<string, unknown> | null;
  if (!observation || !Array.isArray(observation.images)) return value;
  return {
    ...result,
    value: {
      ...observation,
      images: observation.images.map((rawImage) => {
        const image = rawImage as Record<string, unknown> | null;
        if (!image || !Array.isArray(image.pngBytes)) return rawImage;
        const pngBase64 = bytesToBase64(image.pngBytes);
        if (pngBase64 === null) return rawImage;
        const { pngBytes: _pngBytes, ...metadata } = image;
        return { ...metadata, pngBase64 };
      }),
    },
  };
}
