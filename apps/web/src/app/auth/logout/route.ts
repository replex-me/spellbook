import { NextResponse } from "next/server";

import { SESSION_COOKIE, publicBaseUrl } from "@/lib/auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(
    new URL("/", await publicBaseUrl(request)),
  );
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
