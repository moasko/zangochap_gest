"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { ensureAuth } from "@/lib/auth";

export async function deleteCustomer(id: string) {
  // Suppression definitive d'un client : admins uniquement.
  await ensureAuth(["admin", "developer"]);
  await prisma.customer.delete({ where: { id } });
  revalidatePath("/zangochap-manager/admin/crm");
}
