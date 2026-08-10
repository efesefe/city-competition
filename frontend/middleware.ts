import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, localeCookieName } from "./i18n/config";

/** Ensures a locale cookie exists; does not rewrite paths. */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.get(localeCookieName)) {
    response.cookies.set(localeCookieName, defaultLocale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
