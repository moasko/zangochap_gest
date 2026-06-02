import type { NextRequest } from "next/server";
import { guardStaffRoutes } from "@/lib/staff-route-guard";

export async function middleware(request: NextRequest) {
  return guardStaffRoutes(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|uploads|favicon.ico|sitemap.xml|robots.txt).*)"],
};
