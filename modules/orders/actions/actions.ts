"use server";

/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  ORDERS MODULE — Re-export Hub                          ║
 * ║                                                         ║
 * ║  Backward-compatible re-exports. Each function wraps    ║
 * ║  the actual implementation from its sub-module.         ║
 * ║                                                         ║
 * ║  For helpers (non-async), import directly:              ║
 * ║  import { generateUniqueRef } from "@/modules/orders/   ║
 * ║  helpers";                                              ║
 * ║                                                         ║
 * ║  Module Structure:                                      ║
 * ║  ├── helpers.ts           → Internal utilities          ║
 * ║  ├── stock.ts             → Stock operations            ║
 * ║  ├── order-actions.ts     → CRUD operations             ║
 * ║  ├── status-actions.ts    → Status changes              ║
 * ║  ├── delivery-actions.ts  → Delivery assignments        ║
 * ║  ├── settlement-actions.ts→ Financial settlements       ║
 * ║  ├── analytics-actions.ts → Dashboard & performance     ║
 * ║  └── schema.ts            → Validation schemas          ║
 * ╚══════════════════════════════════════════════════════════╝
 */

import * as orderActions from "./order-actions";
import * as statusActions from "./status-actions";
import * as deliveryActions from "./delivery-actions";
import * as settlementActions from "./settlement-actions";
import * as analyticsActions from "./analytics-actions";
import * as stockModule from "./stock";
import * as helpers from "../helpers";

// ── Helpers (async wrappers for server-action compat) ──
export async function generateUniqueRef(commune?: string, typePrefix?: string) {
  return helpers.generateUniqueRef(commune, typePrefix);
}
export async function getOrCreateDefaultWarehouse() {
  return helpers.getOrCreateDefaultWarehouse();
}

// ── Order CRUD ──
export async function getOrder(id: string) { return orderActions.getOrder(id); }
export async function createOrder(data: Parameters<typeof orderActions.createOrder>[0]) { return orderActions.createOrder(data); }
export async function deleteOrder(orderId: string) { return orderActions.deleteOrder(orderId); }
export async function updateOrderDetails(orderId: string, data: Parameters<typeof orderActions.updateOrderDetails>[1]) { return orderActions.updateOrderDetails(orderId, data); }
export async function addOrderHistoryEntry(orderId: string, action: string) { return orderActions.addOrderHistoryEntry(orderId, action); }
export async function duplicateOrder(orderId: string, data: Parameters<typeof orderActions.duplicateOrder>[1]) { return orderActions.duplicateOrder(orderId, data); }
export async function reprogramOrder(orderId: string, data: Parameters<typeof orderActions.reprogramOrder>[1]) { return orderActions.reprogramOrder(orderId, data); }
export async function takeToProcessOrder(orderId: string, commercialId?: string) { return orderActions.takeToProcessOrder(orderId, commercialId); }
export async function reassignOrderLead(orderId: string, newCommercialId: string) { return orderActions.reassignOrderLead(orderId, newCommercialId); }
export async function updateRoundRobinActiveCommercials(activeCommercialIds: string[]) { return orderActions.updateRoundRobinActiveCommercials(activeCommercialIds); }

// ── Status Changes ──
export async function updateOrderStatus(orderId: string, newStatus: string, note?: string, amountReceived?: number | null, reproDeliveryDate?: string) { return statusActions.updateOrderStatus(orderId, newStatus, note, amountReceived, reproDeliveryDate); }
export async function reopenDeliveryOrder(orderId: string, note?: string) { return statusActions.reopenDeliveryOrder(orderId, note); }
export async function markPartialDelivery(orderId: string, deliveredQuantities: Record<string, number>, note?: string, includeDeliveryFee?: boolean, amountReceived?: number | null) { return statusActions.markPartialDelivery(orderId, deliveredQuantities, note, includeDeliveryFee, amountReceived); }

// ── Delivery Assignments ──
export async function assignOrderToDeliveryman(orderId: string, deliverymanId: string) { return deliveryActions.assignOrderToDeliveryman(orderId, deliverymanId); }
export async function bulkAssignOrders(orderIds: string[], deliverymanId: string) { return deliveryActions.bulkAssignOrders(orderIds, deliverymanId); }
export async function autoAssignDeliveryOrders(orderIds: string[]) { return deliveryActions.autoAssignDeliveryOrders(orderIds); }

// ── Settlements ──
export async function getPendingSettlements() { return settlementActions.getPendingSettlements(); }
export async function getSettlementHistory() { return settlementActions.getSettlementHistory(); }
export async function createSettlement(deliverymanId: string, orderIds: string[], amount: number, notes?: string) { return settlementActions.createSettlement(deliverymanId, orderIds, amount, notes); }
export async function getSettlementStats(from?: string, to?: string, commercialId?: string, method?: string) { return settlementActions.getSettlementStats(from, to, commercialId, method); }
export async function getRiderSettlementStats(from?: string, to?: string, riderId?: string) { return settlementActions.getRiderSettlementStats(from, to, riderId); }
export async function getDeliverySettlementDashboard(from?: string, to?: string, riderId?: string) { return settlementActions.getDeliverySettlementDashboard(from, to, riderId); }
export async function toggleCommercialContacted(orderId: string, value: boolean) { return settlementActions.toggleCommercialContacted(orderId, value); }

// ── Analytics & Dashboard ──
export async function getSidebarCounts(userId?: string) { return analyticsActions.getSidebarCounts(userId); }
export async function getDashboardStats() { return analyticsActions.getDashboardStats(); }
export async function getPerformanceStats(dateFrom?: string, dateTo?: string) { return analyticsActions.getPerformanceStats(dateFrom, dateTo); }
export async function getUserPerformanceDetails(userId: string, role: string, dateFrom?: string, dateTo?: string) { return analyticsActions.getUserPerformanceDetails(userId, role, dateFrom, dateTo); }

// ── Stock ──
export async function getStockHistory() { return stockModule.getStockHistory(); }
