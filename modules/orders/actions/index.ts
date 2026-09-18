"use server";

import * as exchanges from "./exchange-actions";
import { ZodError } from "zod";
import { exchangeValidationMessage, type ExchangeCorrection } from "../types/exchange";
import { logExchangeFailure } from "../helpers/exchange-diagnostics";

export async function getExchangeRequests() { return exchanges.getExchangeRequests(); }
export async function getExchangeRequestsForUi() {
  try { return { success: true as const, ...await exchanges.getExchangeRequests() }; }
  catch (error) {
    const reference = logExchangeFailure("load", error);
    return { success: false as const, error: `Impossible de charger les demandes. Actualisez la page. Référence : ${reference}` };
  }
}
export async function reviewOrderExchange(requestId: string, decision: "APPROVED" | "REJECTED", note?: string) { return exchanges.reviewOrderExchange(requestId, decision, note); }

export async function reviewOrderExchangeForUi(requestId: string, decision: "APPROVED" | "REJECTED", note?: string, correction?: ExchangeCorrection) {
  try {
    return { success: true as const, request: await exchanges.reviewOrderExchange(requestId, decision, note, correction) };
  } catch (error) {
    if (error instanceof ZodError) {
      const dateInvalid = error.issues.some(issue => issue.path[0] === "deliveryDate");
      return { success: false as const, error: dateInvalid
        ? "La date de livraison demandée est passée ou invalide. Corrigez la date dans la demande avant de l’approuver."
        : exchangeValidationMessage(error) };
    }
    const message = error instanceof Error ? error.message : "";
    const expected = /^(Non authentifié|Action non autorisée|Accès refusé|Indiquez le motif du refus|Demande introuvable|Cette demande a déjà été traitée|La commande originale n'est plus disponible|La commande a changé depuis la demande|Le compte commercial n'est plus disponible|Type de demande invalide|Les données enregistrées|Le moyen de paiement|Le numéro ayant effectué|GIFT_APPROVAL_REQUIRED)/.test(message);
    const reference = expected ? undefined : logExchangeFailure("review", error);
    return { success: false as const, error: expected ? message : `Impossible de traiter la demande d’échange. Actualisez puis réessayez. Référence : ${reference}` };
  }
}

import * as reprogramming from "./reprogramming-actions";

export async function getReprogrammingRequests() {
  return reprogramming.getReprogrammingRequests();
}

export async function reviewOrderReprogramming(requestId: string, decision: "APPROVED" | "REJECTED", note?: string) {
  return reprogramming.reviewOrderReprogramming(requestId, decision, note);
}

import * as actions from "./actions";

export async function generateUniqueRef(commune?: string, typePrefix?: string) {
  return actions.generateUniqueRef(commune, typePrefix);
}

export async function getOrCreateDefaultWarehouse() {
  return actions.getOrCreateDefaultWarehouse();
}

export async function getOrder(id: string) {
  return actions.getOrder(id);
}

export async function createOrder(data: Parameters<typeof actions.createOrder>[0]) {
  return actions.createOrder(data);
}

export async function createPublicOrder(data: Parameters<typeof actions.createPublicOrder>[0]) {
  return actions.createPublicOrder(data);
}

export async function deleteOrder(orderId: string) {
  return actions.deleteOrder(orderId);
}

export async function updateOrderDetails(orderId: string, data: Parameters<typeof actions.updateOrderDetails>[1]) {
  return actions.updateOrderDetails(orderId, data);
}

export async function addOrderHistoryEntry(orderId: string, action: string) {
  return actions.addOrderHistoryEntry(orderId, action);
}

export async function duplicateOrder(orderId: string, data: Parameters<typeof actions.duplicateOrder>[1]) {
  return actions.duplicateOrder(orderId, data);
}

// Expected errors are data so Next.js does not redact their explanation in production.
export async function duplicateOrderForUi(orderId: string, data: Parameters<typeof actions.duplicateOrder>[1]) {
  try {
    return { success: true as const, result: await actions.duplicateOrder(orderId, data) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const expected = error instanceof Error && (error.name === "ExchangeValidationError"
      || /^(Accès refusé|Non authentifié|Une demande pour cette commande|Votre session|Date de livraison|La date de livraison|Veuillez sélectionner|Ce point relais|Une image est obligatoire|Le moyen de paiement|Le numéro ayant effectué|GIFT_APPROVAL_REQUIRED|Le compte commercial)/.test(message));
    return { success: false as const, error: expected ? message : "Impossible de créer l’échange ou la duplication. Réessayez après actualisation ; si le problème persiste, contactez l’administrateur." };
  }
}

export async function reprogramOrder(orderId: string, data: Parameters<typeof actions.reprogramOrder>[1]) {
  return actions.reprogramOrder(orderId, data);
}

export async function takeToProcessOrder(orderId: string, commercialId?: string) {
  return actions.takeToProcessOrder(orderId, commercialId);
}

export async function reassignOrderLead(orderId: string, newCommercialId: string) {
  return actions.reassignOrderLead(orderId, newCommercialId);
}

export async function updateRoundRobinActiveCommercials(activeCommercialIds: string[]) {
  return actions.updateRoundRobinActiveCommercials(activeCommercialIds);
}

export async function updateOrderStatus(orderId: string, newStatus: string, note?: string, amountReceived?: number | null, reproDeliveryDate?: string) {
  return actions.updateOrderStatus(orderId, newStatus, note, amountReceived, reproDeliveryDate);
}

export async function reopenDeliveryOrder(orderId: string, note?: string) {
  return actions.reopenDeliveryOrder(orderId, note);
}

export async function markPartialDelivery(
  orderId: string,
  deliveredQuantities: Record<string, number>,
  note?: string,
  includeDeliveryFee?: boolean,
  amountReceived?: number | null,
) {
  return actions.markPartialDelivery(orderId, deliveredQuantities, note, includeDeliveryFee, amountReceived);
}

export async function assignOrderToDeliveryman(orderId: string, deliverymanId: string) {
  return actions.assignOrderToDeliveryman(orderId, deliverymanId);
}

export async function bulkAssignOrders(orderIds: string[], deliverymanId: string) {
  return actions.bulkAssignOrders(orderIds, deliverymanId);
}

export async function autoAssignDeliveryOrders(orderIds: string[]) {
  return actions.autoAssignDeliveryOrders(orderIds);
}

export async function getPendingSettlements() {
  return actions.getPendingSettlements();
}

export async function getSettlementHistory() {
  return actions.getSettlementHistory();
}

export async function createSettlement(
  deliverymanId: string,
  orderIds: string[],
  amount: number,
  notes?: string,
) {
  return actions.createSettlement(deliverymanId, orderIds, amount, notes);
}

export async function getSettlementStats(from?: string, to?: string, commercialId?: string, method?: string) {
  return actions.getSettlementStats(from, to, commercialId, method);
}

export async function getRiderSettlementStats(from?: string, to?: string, riderId?: string) {
  return actions.getRiderSettlementStats(from, to, riderId);
}

export async function getDeliverySettlementDashboard(from?: string, to?: string, riderId?: string) {
  return actions.getDeliverySettlementDashboard(from, to, riderId);
}

export async function toggleCommercialContacted(orderId: string, value: boolean) {
  return actions.toggleCommercialContacted(orderId, value);
}

export async function getSidebarCounts(userId?: string) {
  return actions.getSidebarCounts(userId);
}

export async function getDashboardStats() {
  return actions.getDashboardStats();
}

export async function getPerformanceStats(dateFrom?: string, dateTo?: string) {
  return actions.getPerformanceStats(dateFrom, dateTo);
}

export async function getUserPerformanceDetails(userId: string, role: string, dateFrom?: string, dateTo?: string) {
  return actions.getUserPerformanceDetails(userId, role, dateFrom, dateTo);
}

export async function getStockHistory() {
  return actions.getStockHistory();
}
