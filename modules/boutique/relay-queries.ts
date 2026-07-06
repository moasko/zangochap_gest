import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";

export async function getActiveRelayPoints() {
  const accounts = await prisma.user.findMany({
    where: {
      role: Role.POINT_RELAIS,
      serviceLabel: { not: null },
      isPaused: false,
    },
    select: { serviceLabel: true },
    orderBy: { serviceLabel: "asc" },
  });

  return [...new Set(
    accounts
      .map((account) => account.serviceLabel?.trim())
      .filter((label): label is string => Boolean(label)),
  )];
}
