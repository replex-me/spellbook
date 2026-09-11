import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  authenticateLocal,
  createSessionToken,
  publicBaseUrl,
  safeRedirect,
  secureRequest,
} from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL("/login", await publicBaseUrl(request));
  url.searchParams.set(
    "redirect",
    safeRedirect(new URL(request.url).searchParams.get("redirect")),
  );
  return NextResponse.redirect(url);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const redirect = safeRedirect(String(form.get("redirect") ?? "/"));
  const base = await publicBaseUrl(request);
  try {
    const session = authenticateLocal(
      String(form.get("email") ?? ""),
      String(form.get("password") ?? ""),
    );
    const response = NextResponse.redirect(new URL(redirect, base), 303);
    response.cookies.set(SESSION_COOKIE, createSessionToken(session), {
      httpOnly: true,
      secure: secureRequest(request),
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    return response;
  } catch {
    const url = new URL("/login", base);
    url.searchParams.set("error", "invalid_credentials");
    url.searchParams.set("redirect", redirect);
    return NextResponse.redirect(url, 303);
  }
}
