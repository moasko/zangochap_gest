import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "zangochap-super-secret-key-change-me-in-prod"
);

const LOGIN_PATH = "/zangochap-manager";
const STAFF_PRIVATE_PREFIX = "/zangochap-manager/";
const RIDER_PREFIX = "/zangochap-rider";

async function hasValidStaffSession(request: NextRequest) {
  const sessionToken = request.cookies.get("zc_session")?.value;
  if (!sessionToken) return false;

  try {
    await jwtVerify(sessionToken, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin(request: NextRequest) {
  const response = NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  response.cookies.delete("zc_session");
  return response;
}

export async function guardStaffRoutes(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === LOGIN_PATH;
  const isPrivateStaffPath =
    pathname.startsWith(STAFF_PRIVATE_PREFIX) || pathname.startsWith(RIDER_PREFIX);

  if (!isLoginPage && !isPrivateStaffPath) {
    return NextResponse.next();
  }

  const hasSession = await hasValidStaffSession(request);

  if (!hasSession) {
    return isLoginPage ? NextResponse.next() : redirectToLogin(request);
  }

  if (isLoginPage) {
    return NextResponse.redirect(new URL("/zangochap-manager/dashboard", request.url));
  }

  return NextResponse.next();
}

export const staffRouteGuardConfig = {
  matcher: ["/((?!api|_next/static|_next/image|uploads|favicon.ico|sitemap.xml|robots.txt).*)"],
};
