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
