import { timingSafeEqual } from "node:crypto";
import { HttpError } from "./http";

export function authorizeInternal(request: Request): void {
  const expected = process.env.SPELLBOOK_INTERNAL_TOKEN;
  if (!expected) throw new Error("SPELLBOOK_INTERNAL_TOKEN is required.");
  const left = Buffer.from(
    request.headers.get("x-spellbook-internal-token") ?? "",
  );
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new HttpError(401, "invalid_internal_token");
}
