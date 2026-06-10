import React from "react";
import prisma from "@/lib/prisma";
import Topbar from "@/components/Topbar";
import DirectoryClient from "./DirectoryClient";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DirectoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Fetch all staff members (not CUSTOMER, and hide DEVELOPER unless user is developer)
  const where: any = {
    role: { not: "CUSTOMER" }
  };
  if (session.role !== "developer") {
    where.AND = [
      { role: { not: "CUSTOMER" } },
      { role: { not: "DEVELOPER" } }
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      phone2: true,
      serviceLabel: true,
      role: true,
      email: true,
      isPaused: true,
      pausedAt: true,
      pauseReason: true
    },
    orderBy: {
      name: 'asc'
    }
  });

  return (
    <>
      <Topbar title="Répertoire" subtitle="Équipe Zangochap" />
      <DirectoryClient users={JSON.parse(JSON.stringify(users))} canViewPauses={["admin", "developer"].includes(session.role)} />
    </>
  );
}
