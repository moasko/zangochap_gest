"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { appendOrderHistory, getWhatsAppSettings, sendWhatsAppContent } from "./send";
import { buildOrderWhatsAppMessage } from "./message-builder";

// Rend le message de confirmation d'une commande avec le modele configure
// (onglet Marketing de la console) : utilise pour previsualiser avant envoi.
export async function getOrderMessagePreview(orderId: string) {
  await ensureAuth(["admin", "commercial"]);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return { success: false as const, error: "Commande introuvable." };
  const settings = await getWhatsAppSettings();
  return {
    success: true as const,
    message: buildOrderWhatsAppMessage(order, settings.orderTemplate),
    imageUrl: settings.orderImageUrl,
  };
}

// Envoi manuel depuis la liste des commandes : le staff previsualise (et peut
// editer) le recapitulatif avant l'envoi direct via l'API Cloud.
export async function sendOrderWhatsAppMessage(input: { orderId: string; message?: string }) {
  const session = await ensureAuth(["admin", "commercial"]);

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { items: true },
  });
  if (!order) return { success: false as const, error: "Commande introuvable." };
  if (!order.customerPhone) return { success: false as const, error: "Numéro de téléphone du client manquant." };

  const settings = await getWhatsAppSettings();
  const body = input.message?.trim() || buildOrderWhatsAppMessage(order, settings.orderTemplate);
  const result = await sendWhatsAppContent({
    recipient: order.customerPhone,
    body,
    imageUrl: settings.orderImageUrl,
    byName: session.name,
  });

  await appendOrderHistory(
    order.id,
    result.success
      ? `Message WhatsApp envoyé au client par ${session.name}`
      : `Échec d'envoi WhatsApp par ${session.name} : ${result.error}`,
    session.email,
    session.name,
  );

  revalidatePath("/zangochap-manager/orders");
  return result;
}
