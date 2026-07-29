import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getSession } from "@/modules/auth/actions";

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
    // Client Prisma (et non $executeRaw) : la sérialisation JSON de "details"
    // est gérée nativement — un objet brut passé en paramètre raw échoue sous Postgres.
    await prisma.developerAuditLog.create({
      data: {
        action,
        status,
        actorId: session?.id || null,
        actorName: session?.name || null,
        actorEmail: session?.email || null,
        details: (shrinkDetails(details) as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      },
    });
  } catch {
    // The audit table is optional until its manual migration is applied.
  }
}
