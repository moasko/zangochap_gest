// Attribution d'un livreur des que le call center valide une commande (CONFIRMED).
// Module interne, PAS une Server Action : appele apres l'enregistrement de la
// confirmation, il ne doit jamais faire echouer la vente (best effort, journalise).
// Active uniquement si l'interrupteur du planning est allume.
import prisma from "@/lib/prisma";
import { loadDeliveryPlanning } from "@/modules/delivery-planning/helpers/load";
import { DISPATCH_DEFAULT_CAPACITY, planDeliveryDispatch } from "../helpers/delivery-dispatch";
import { loadDispatchContext } from "./dispatch-context";

type Actor = { email?: string | null; name?: string | null } | null | undefined;

export type AutoAssignResult =
  | { assigned: true; riderId: string; riderName: string }
  | { assigned: false; reason: string };

export async function autoAssignAtConfirmation(orderId: string, actor?: Actor): Promise<AutoAssignResult> {
  try {
    const planning = await loadDeliveryPlanning(prisma);
    if (!planning.settings.autoAssignOnConfirm) return { assigned: false, reason: "Desactivee" };

    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true, ref: true, status: true, commune: true, customerPhone: true, customerLocation: true,
          deliverymanId: true, settlementId: true, depositVerificationStatus: true, deliveryDate: true,
          deletedAt: true, updatedAt: true, history: true,
        },
      });
      if (!order || order.deletedAt) return { assigned: false as const, reason: "Commande introuvable" };
      if (order.deliverymanId) return { assigned: false as const, reason: "Deja attribuee" };
      if (order.status !== "CONFIRMED") return { assigned: false as const, reason: `Statut ${order.status}` };
      if (!order.deliveryDate) return { assigned: false as const, reason: "Sans date de livraison" };

      const day = order.deliveryDate.toISOString().slice(0, 10);
      // Une attribution a la fois par date : deux validations simultanees ne
      // depassent pas un plafond et respectent le partage egal.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`delivery-dispatch:${day}`}))) AS l`;

      const context = await loadDispatchContext(tx, day);
      const plan = planDeliveryDispatch({
        orders: [order],
        riders: context.riders,
        presentRiderIds: context.defaultPresent,
        capacity: DISPATCH_DEFAULT_CAPACITY,
        currentLoads: context.currentLoads,
        currentCommunes: context.currentCommunes,
        history: context.historyByRider,
        capacities: context.capacities,
        fixedCommunes: context.fixedCommunes,
        atConfirmation: true,
      });
      const choice = plan.assignments[0];
      if (!choice) return { assigned: false as const, reason: plan.skipped[0]?.reason || "Aucun livreur disponible" };
      const rider = context.riders.find((item) => item.id === choice.riderId)!;

      const history = Array.isArray(order.history) ? [...order.history] : [];
      history.push({
        at: new Date().toISOString(),
        action: `Attribution automatique a la validation : ${rider.name}`,
        by: actor?.email || "system",
        byName: actor?.name || "Systeme",
      });
      // Verrou optimiste : rien n'est ecrit si la commande a change entre-temps.
      const updated = await tx.order.updateMany({
        where: { id: order.id, deliverymanId: null, status: "CONFIRMED", updatedAt: order.updatedAt, settlementId: null },
        data: { deliverymanId: rider.id, deliverymanName: rider.name, history },
      });
      if (updated.count !== 1) return { assigned: false as const, reason: "Modifiee pendant l'attribution" };
      return { assigned: true as const, riderId: rider.id, riderName: rider.name };
    }, { timeout: 15_000 });
  } catch (error) {
    console.error("[auto-assign-on-confirm]", orderId, error instanceof Error ? error.message : error);
    return { assigned: false, reason: "Erreur" };
  }
}
