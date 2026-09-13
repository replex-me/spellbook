export function internalAppBaseUrl(): string {
  const value = (
    process.env.SPELLBOOK_INTERNAL_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  )?.replace(/\/+$/, "");
  if (!value)
    throw new Error(
      "SPELLBOOK_INTERNAL_APP_URL or NEXT_PUBLIC_APP_URL is required.",
    );
  return value;
}

export function publicAppBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (!value) throw new Error("NEXT_PUBLIC_APP_URL is required.");
  const url = new URL(value);
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.origin !== value || (url.protocol !== "https:" && !loopback))
    throw new Error("NEXT_PUBLIC_APP_URL must be an exact secure origin.");
  return url.origin;
}
