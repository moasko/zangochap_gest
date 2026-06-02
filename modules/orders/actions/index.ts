"use server";

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
