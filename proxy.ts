import type { NextRequest } from "next/server";
import { guardStaffRoutes, staffRouteGuardConfig } from "@/lib/staff-route-guard";

export async function proxy(request: NextRequest) {
  return guardStaffRoutes(request);
}

export const config = staffRouteGuardConfig;
