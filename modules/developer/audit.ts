import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import { randomUUID } from "crypto";

type AuditStatus = "success" | "failure" | "blocked" | "info";

function shrinkDetails(details?: Record<string, unknown>) {
  if (!details) return undefined;
  const json = JSON.stringify(details);
  if (json.length <= 4000) return details;
  return {
    truncated: true,
    preview: json.slice(0, 3900),
  };
}

export async function recordDeveloperAudit(
  action: string,
  status: AuditStatus,
  details?: Record<string, unknown>,
) {
  try {
    const session = await getSession();
    await prisma.$executeRaw`
      INSERT INTO "DeveloperAuditLog"
        ("id", "action", "status", "actorId", "actorName", "actorEmail", "details", "createdAt")
      VALUES
        (${randomUUID()}, ${action}, ${status}, ${session?.id || null}, ${session?.name || null}, ${session?.email || null}, ${shrinkDetails(details) || null}, NOW())
    `;
  } catch {
    // The audit table is optional until its manual migration is applied.
  }
}
