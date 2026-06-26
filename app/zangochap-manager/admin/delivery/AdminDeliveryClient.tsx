"use client";

import React, { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { TableCard, EmptyState, StatCard, StatusBadge } from "@/components/UI";
import Modal from "@/components/Modal";
import { formatPrice, formatDate, COMMUNES } from "@/lib/constants";
import { Truck, User, UserPlus, Clock, Search, X, Check, Filter, MapPin, Calendar, LayoutGrid, List, Archive, ChevronRight, FileText, Phone, Printer, CalendarClock, Download, Undo2, Route, Zap, AlertTriangle } from "lucide-react";
import { assignOrderToDeliveryman, bulkAssignOrders, updateOrderStatus, reopenDeliveryOrder, autoAssignDeliveryOrders } from "@/modules/orders/actions";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";
import "./admin-delivery-client.css";

type Deliveryman = {
  id: string;
  name: string;
  phone: string | null;
};

type DeliveryAdminItem = {
  name: string;
  size: string;
  color: string;
  qty: number;
};

type DeliveryAdminOrder = {
  id: string;
  ref: string;
  customerName: string;
  customerPhone: string;
  customerPhone2?: string | null;
  customerLocation?: string | null;
  commune?: string | null;
  total?: number | null;
  discount?: number | null;
  deliveryFee?: number | null;
  deliveryNote?: string | null;
  deliveryDate?: string | null;
  deliverymanId?: string | null;
  deliverymanName?: string | null;
  status: string;
  type?: string | null;
  settlementId?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  items?: DeliveryAdminItem[];
};

interface AdminDeliveryClientProps {
  activeOrders: DeliveryAdminOrder[];
  archivedOrders: DeliveryAdminOrder[];
  deliverymen: Deliveryman[];
}

const REPRO_DISPO_REASONS = [
  "Client indisponible aujourd'hui",
  "Client demande demain",
  "Adresse a confirmer",
  "Fin de tournee",
];

const DELIVERY_SHEET_STATUSES = new Set(["PACKED", "ON_DELIVERY", "REPRO_DISPO", "REPROGRAMMED"]);
const DELIVERY_ASSIGNABLE_STATUSES = new Set(["PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "UNAVAILABLE", "ALTERNATIVE", "PACKED", "ON_DELIVERY", "REPRO_DISPO"]);
const UNPACKED_STATUSES = ["PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "UNAVAILABLE", "ALTERNATIVE"];

function canAssignDeliveryOrder(order: DeliveryAdminOrder) {
  return DELIVERY_ASSIGNABLE_STATUSES.has(order.status) && !order.settlementId;
}

function getOrderRisks(order: DeliveryAdminOrder) {
  const risks: string[] = [];

  if (!order.deliverymanId && canAssignDeliveryOrder(order)) risks.push("Non attribuee");
  if (!order.customerPhone?.trim()) risks.push("Telephone");
  if (!order.customerLocation?.trim()) risks.push("Adresse");
  if (!order.commune?.trim()) risks.push("Commune");
  if (!order.deliveryDate) risks.push("Date");
  if (Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0) >= 100000) {
    risks.push("Montant eleve");
  }
  if (order.status === "REPRO_DISPO") risks.push("Repro");

  return risks;
}

function matchesDateInput(value: unknown, dateInput: string) {
  return !dateInput || (typeof value === "string" && value.startsWith(dateInput));
}

function getOrderTimestamp(order: DeliveryAdminOrder) {
  return new Date(order.updatedAt || order.createdAt || 0);
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Delivery date = tomorrow, except Sat→Mon and Sun→Mon */
function getNextDeliveryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1); // tomorrow
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (day === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  else if (day === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  return d;
}

export default function AdminDeliveryClient({ activeOrders, archivedOrders, deliverymen }: AdminDeliveryClientProps) {
  const defaultDeliveryFilterValue = dateInputValue(getNextDeliveryDate());
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDeliveryman, setFilterDeliveryman] = useState("ALL");
  const [filterCommune, setFilterCommune] = useState("ALL");
  const [filterDate, setFilterDate] = useState(defaultDeliveryFilterValue); // YYYY-MM-DD
  const [viewMode, setViewMode] = useState<"table" | "grid" | "dispatch" | "history" | "sheet">("table");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [reproOrder, setReproOrder] = useState<DeliveryAdminOrder | null>(null);
  const [reproReason, setReproReason] = useState("");
  const [reproDetails, setReproDetails] = useState("");
  const [reproDate, setReproDate] = useState(() => dateInputValue(getNextDeliveryDate()));
  const [reopenOrder, setReopenOrder] = useState<DeliveryAdminOrder | null>(null);
  const [reopenNote, setReopenNote] = useState("");
  const [autoAssignPreviewOrders, setAutoAssignPreviewOrders] = useState<DeliveryAdminOrder[]>([]);

  const router = useRouter();
  const { showToast } = useToast();
  const accountingDate = filterDate || dateInputValue(new Date());
  const accountingSessionHref = `/zangochap-manager/accounting/sessions/by-date/${accountingDate}`;

  const handleAssign = (orderId: string, dId: string) => {
    const isUnassigning = dId === "unassigned" || dId === "";
    const driver = deliverymen.find(d => d.id === dId);

    if (!isUnassigning && !driver) return;

    const confirmMsg = isUnassigning
      ? "Désattribuer cette commande et la remettre en attente ?"
      : `Attribuer la commande au livreur ${driver?.name} ?`;

    if (!confirm(confirmMsg)) return;

    startTransition(async () => {
      try {
        await assignOrderToDeliveryman(orderId, dId);
        showToast(isUnassigning ? 'Commande désattribuée' : 'Commande attribuée ✓', 'success');
        router.refresh();
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : 'Erreur', 'error');
      }
    });
  };

  const handleBulkAssign = (dId: string) => {
    if (selectedIds.size === 0) return;
    const isUnassigning = dId === "unassigned" || dId === "";
    const driver = deliverymen.find(d => d.id === dId);

    if (!isUnassigning && !driver) return;

    const confirmMsg = isUnassigning
      ? `Désattribuer les ${selectedIds.size} commandes sélectionnées ?`
      : `Attribuer ${selectedIds.size} commandes à ${driver?.name} ?`;

    if (!confirm(confirmMsg)) return;

    startTransition(async () => {
      try {
        await bulkAssignOrders(Array.from(selectedIds), dId);
        showToast(`${selectedIds.size} commandes ${isUnassigning ? 'désattribuées' : 'attribuées ✓'}`, 'success');
        setSelectedIds(new Set());
        router.refresh();
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : 'Erreur', 'error');
      }
    });
  };

  const handleAutoAssign = (ordersToAssign: DeliveryAdminOrder[]) => {
    if (ordersToAssign.length === 0) return;
    if (deliverymen.length === 0) {
      showToast("Aucun livreur disponible pour la repartition.", "error");
      return;
    }

    setAutoAssignPreviewOrders(ordersToAssign);
  };

  const confirmAutoAssign = () => {
    if (autoAssignPreviewOrders.length === 0) return;

    startTransition(async () => {
      try {
        const result = await autoAssignDeliveryOrders(autoAssignPreviewOrders.map((order) => order.id));
        showToast(`${result.assignedCount} commande(s) repartie(s) automatiquement`, "success");
        setSelectedIds(new Set());
        setAutoAssignPreviewOrders([]);
        router.refresh();
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : "Erreur", "error");
      }
    });
  };

  const handleReproDispo = () => {
    if (!reproOrder) return;

    const note = [reproReason, reproDetails.trim()].filter(Boolean).join(" - ");
    if (!note) {
      showToast("Ajoutez un motif pour la repro-dispo.", "error");
      return;
    }

    startTransition(async () => {
      try {
        await updateOrderStatus(reproOrder.id, "REPRO_DISPO", note, undefined, reproDate);
        showToast("Commande mise en repro-dispo ✓", "success");
        setReproOrder(null);
        setReproReason("");
        setReproDetails("");
        setReproDate(dateInputValue(getNextDeliveryDate()));
        router.refresh();
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : 'Erreur', 'error');
      }
    });
  };

  const handleReopenDelivery = () => {
    if (!reopenOrder) return;
    const note = reopenNote.trim();
    if (!note) {
      showToast("Ajoutez un motif de correction.", "error");
      return;
    }

    startTransition(async () => {
      try {
        await reopenDeliveryOrder(reopenOrder.id, note);
        showToast("Commande remise en livraison", "success");
        setReopenOrder(null);
        setReopenNote("");
        router.refresh();
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : "Erreur", "error");
      }
    });
  };

  const toggleSelect = (id: string) => {
    const order = activeOrders.find((o) => o.id === id);
    if (order && !canAssignDeliveryOrder(order)) return;

    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = (filtered: DeliveryAdminOrder[]) => {
    const assignableIds = filtered.filter(canAssignDeliveryOrder).map(o => o.id);
    if (selectedIds.size === assignableIds.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(assignableIds));
  };

  const filteredOrders = useMemo(() => {
    return activeOrders.filter(o => {
      const safeSearchTerm = (searchTerm || "").toLowerCase();
      const refText = String(o.ref || "").toLowerCase();
      const customerText = String(o.customerName || "").toLowerCase();
      const driverText = String(o.deliverymanName || "").toLowerCase();
      const communeText = String(o.commune || "").toLowerCase();

      const matchesSearch =
        refText.includes(safeSearchTerm) ||
        customerText.includes(safeSearchTerm) ||
        driverText.includes(safeSearchTerm) ||
        communeText.includes(safeSearchTerm);

      const matchesStatus = filterStatus === "ALL" ||
        (filterStatus === "UNASSIGNED" && !o.deliverymanId) ||
        (filterStatus === "ASSIGNED" && o.deliverymanId) ||
        (filterStatus === "UNPACKED" && UNPACKED_STATUSES.includes(o.status)) ||
        (o.status === filterStatus);

      const matchesDriver = filterDeliveryman === "ALL" || o.deliverymanId === filterDeliveryman;
      const matchesCommune = filterCommune === "ALL" || o.commune === filterCommune;

      const matchesDate = matchesDateInput(o.deliveryDate, filterDate);

      return matchesSearch && matchesStatus && matchesDriver && matchesCommune && matchesDate;
    });
  }, [activeOrders, searchTerm, filterStatus, filterDeliveryman, filterCommune, filterDate]);

  const filteredArchivedOrders = useMemo(() => {
    return archivedOrders.filter(o => {
      const safeSearchTerm = (searchTerm || "").toLowerCase();
      const refText = String(o.ref || "").toLowerCase();
      const customerText = String(o.customerName || "").toLowerCase();
      const driverText = String(o.deliverymanName || "").toLowerCase();
      const communeText = String(o.commune || "").toLowerCase();

      const matchesSearch =
        refText.includes(safeSearchTerm) ||
        customerText.includes(safeSearchTerm) ||
        driverText.includes(safeSearchTerm) ||
        communeText.includes(safeSearchTerm);

      const matchesDriver = filterDeliveryman === "ALL" || o.deliverymanId === filterDeliveryman;
      const matchesCommune = filterCommune === "ALL" || o.commune === filterCommune;
      const matchesDate = matchesDateInput(o.deliveryDate, filterDate);

      return matchesSearch && matchesDriver && matchesCommune && matchesDate;
    });
  }, [archivedOrders, searchTerm, filterDeliveryman, filterCommune, filterDate]);

  const stats = useMemo(() => {
    return {
      total: filteredOrders.length,
      unassigned: filteredOrders.filter(o => !o.deliverymanId).length,
      onDelivery: filteredOrders.filter(o => o.status === 'ON_DELIVERY').length,
      deliverymen: deliverymen.length
    };
  }, [filteredOrders, deliverymen]);

  // Count only the orders assigned for the selected delivery date, not the full active load.
  const riderLiveCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const countDate = filterDate || dateInputValue(new Date());

    activeOrders.forEach(o => {
      if (o.deliverymanId && matchesDateInput(o.deliveryDate, countDate)) {
        counts[o.deliverymanId] = (counts[o.deliverymanId] || 0) + 1;
      }
    });
    return counts;
  }, [activeOrders, filterDate]);

  // Group by deliveryman for the "grid" view (Rider Load)
  const groupedByDriver = useMemo(() => {
    const groups: Record<string, DeliveryAdminOrder[]> = { "unassigned": [] };
    deliverymen.forEach(d => groups[d.id] = []);

    filteredOrders.forEach(o => {
      const key = o.deliverymanId || "unassigned";
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });
    return groups;
  }, [filteredOrders, deliverymen]);

  const autoAssignableOrders = useMemo(() => {
    return filteredOrders.filter((order) => canAssignDeliveryOrder(order) && !order.deliverymanId);
  }, [filteredOrders]);

  const riskOrders = useMemo(() => {
    return filteredOrders
      .map((order) => ({ order, risks: getOrderRisks(order) }))
      .filter((entry) => entry.risks.length > 0)
      .sort((a, b) => b.risks.length - a.risks.length);
  }, [filteredOrders]);

  const dispatchSummary = useMemo(() => {
    const zones = new Set(filteredOrders.map((order) => order.commune).filter(Boolean));
    const cash = filteredOrders.reduce((sum, order) => {
      return sum + Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0);
    }, 0);

    return {
      zones: zones.size,
      cash,
      riskCount: riskOrders.length,
      assigned: filteredOrders.filter((order) => Boolean(order.deliverymanId)).length,
    };
  }, [filteredOrders, riskOrders]);

  const riderDayStats = useMemo(() => {
    const countDate = filterDate || dateInputValue(new Date());
    const statsByDriver: Record<string, { count: number; alerts: number }> = {};

    deliverymen.forEach((driver) => {
      statsByDriver[driver.id] = { count: 0, alerts: 0 };
    });

    activeOrders.forEach((order) => {
      if (!order.deliverymanId || !matchesDateInput(order.deliveryDate, countDate)) return;

      if (!statsByDriver[order.deliverymanId]) {
        statsByDriver[order.deliverymanId] = { count: 0, alerts: 0 };
      }

      statsByDriver[order.deliverymanId].count += 1;
      if (getOrderRisks(order).length > 0) {
        statsByDriver[order.deliverymanId].alerts += 1;
      }
    });

    return statsByDriver;
  }, [activeOrders, deliverymen, filterDate]);

  const deliverymenByTodayLoad = useMemo(() => {
    return [...deliverymen].sort((a, b) => {
      const countDiff = (riderDayStats[b.id]?.count || 0) - (riderDayStats[a.id]?.count || 0);
      return countDiff || a.name.localeCompare(b.name);
    });
  }, [deliverymen, riderDayStats]);

  const autoAssignPreviewGroups = useMemo(() => {
    const groups: Record<string, { driver: Deliveryman; currentCount: number; orders: DeliveryAdminOrder[] }> = {};
    const loads = new Map<string, number>();
    const communeDriver = new Map<string, string>();
    const countDate = filterDate || dateInputValue(new Date());

    deliverymen.forEach((driver) => {
      const currentCount = riderDayStats[driver.id]?.count || 0;
      groups[driver.id] = { driver, currentCount, orders: [] };
      loads.set(driver.id, currentCount);
    });

    activeOrders.forEach((order) => {
      if (order.deliverymanId && order.commune && matchesDateInput(order.deliveryDate, countDate)) {
        communeDriver.set(order.commune, order.deliverymanId);
      }
    });

    [...autoAssignPreviewOrders]
      .sort((a, b) => String(a.commune || "").localeCompare(String(b.commune || "")) || String(a.ref || "").localeCompare(String(b.ref || "")))
      .forEach((order) => {
        const sortedDrivers = [...deliverymen].sort((a, b) => {
          const loadDiff = (loads.get(a.id) || 0) - (loads.get(b.id) || 0);
          return loadDiff || a.name.localeCompare(b.name);
        });
        const lightest = sortedDrivers[0];
        const existingDriverId = order.commune ? communeDriver.get(order.commune) : null;
        const existingDriver = existingDriverId ? deliverymen.find((driver) => driver.id === existingDriverId) : null;
        const selectedDriver = existingDriver && (loads.get(existingDriver.id) || 0) <= (loads.get(lightest.id) || 0) + 2
          ? existingDriver
          : lightest;

        if (!selectedDriver) return;

        if (order.commune && !communeDriver.has(order.commune)) {
          communeDriver.set(order.commune, selectedDriver.id);
        }

        groups[selectedDriver.id].orders.push(order);
        loads.set(selectedDriver.id, (loads.get(selectedDriver.id) || 0) + 1);
      });

    return Object.values(groups)
      .filter((group) => group.orders.length > 0)
      .sort((a, b) => b.orders.length - a.orders.length || a.driver.name.localeCompare(b.driver.name));
  }, [activeOrders, autoAssignPreviewOrders, deliverymen, filterDate, riderDayStats]);

  // Group by date for the "history" view
  const groupedByDate = useMemo(() => {
    const groups: Record<string, DeliveryAdminOrder[]> = {};
    const sortedOrders = [...filteredArchivedOrders].sort((a, b) =>
      getOrderTimestamp(b).getTime() - getOrderTimestamp(a).getTime()
    );

    sortedOrders.forEach(o => {
      const date = getOrderTimestamp(o).toLocaleDateString("fr-CA"); // YYYY-MM-DD
      if (!groups[date]) groups[date] = [];
      groups[date].push(o);
    });
    return groups;
  }, [filteredArchivedOrders]);

  // Today's assigned orders grouped by deliveryman for delivery sheets
  const todaySheets = useMemo(() => {
    const safeSearchTerm = (searchTerm || "").toLowerCase();
    const sheetBaseOrders = activeOrders.filter(o => {
      const refText = String(o.ref || "").toLowerCase();
      const customerText = String(o.customerName || "").toLowerCase();
      const driverText = String(o.deliverymanName || "").toLowerCase();
      const communeText = String(o.commune || "").toLowerCase();

      const matchesSearch =
        refText.includes(safeSearchTerm) ||
        customerText.includes(safeSearchTerm) ||
        driverText.includes(safeSearchTerm) ||
        communeText.includes(safeSearchTerm);

      const matchesStatus = filterStatus === "ALL" ||
        (filterStatus === "UNASSIGNED" && !o.deliverymanId) ||
        (filterStatus === "ASSIGNED" && o.deliverymanId) ||
        (filterStatus === "UNPACKED" && UNPACKED_STATUSES.includes(o.status)) ||
        (o.status === filterStatus);

      const matchesDriver = filterDeliveryman === "ALL" || o.deliverymanId === filterDeliveryman;
      const matchesCommune = filterCommune === "ALL" || o.commune === filterCommune;
      const matchesDate = matchesDateInput(o.deliveryDate, filterDate) || (Boolean(o.deliverymanId) && !o.deliveryDate);

      return matchesSearch && matchesStatus && matchesDriver && matchesCommune && matchesDate;
    });

    // Get assigned orders + any BJ orders (except Cocody) based on current filters
    const allRelevantOrders = sheetBaseOrders.filter(o => {
      const isBJToBroadcast = o.ref?.toUpperCase().startsWith("BJ") && !o.commune?.toLowerCase().includes("cocody");
      return DELIVERY_SHEET_STATUSES.has(o.status) && (o.deliverymanId || isBJToBroadcast);
    });

    const bjOrders = allRelevantOrders.filter(o => o.ref?.toUpperCase().startsWith("BJ") && !o.commune?.toLowerCase().includes("cocody"));
    const assignedOrders = allRelevantOrders.filter(
      (o): o is DeliveryAdminOrder & { deliverymanId: string } =>
        Boolean(o.deliverymanId) && !(o.ref?.toUpperCase().startsWith("BJ") && !o.commune?.toLowerCase().includes("cocody"))
    );

    // Find all drivers who have at least one order assigned today
    const activeDriverIds = new Set(assignedOrders.map(o => o.deliverymanId));

    const sheets: Record<string, { driver: Deliveryman, orders: DeliveryAdminOrder[] }> = {};

    // Initialize sheets for active drivers and add their specific orders
    activeDriverIds.forEach(dId => {
      const driver = deliverymen.find(d => d.id === dId);
      sheets[dId] = {
        driver: driver || { id: dId, name: 'Livreur Inconnu', phone: '' },
        orders: assignedOrders.filter(o => o.deliverymanId === dId)
      };
    });

    // Add all BJ orders to every active driver's sheet
    Object.keys(sheets).forEach(dId => {
      const existingIds = new Set(sheets[dId].orders.map(o => o.id));
      const bjToAdd = bjOrders.filter(o => !existingIds.has(o.id));
      sheets[dId].orders = [...sheets[dId].orders, ...bjToAdd];
    });

    return Object.values(sheets);
  }, [activeOrders, searchTerm, filterStatus, filterDeliveryman, filterCommune, filterDate, deliverymen]);

  const handleExportWord = (driverId?: string) => {
    const sheetsToExport = driverId
      ? todaySheets.filter(s => s.driver.id === driverId)
      : todaySheets;

    if (sheetsToExport.length === 0) {
      showToast("Aucune fiche à exporter", "error");
      return;
    }

    let bodyContent = "";

    sheetsToExport.forEach(({ driver, orders: driverOrders }, idx) => {
      const totalAmount = driverOrders.reduce((s, o) => s + (o.total || 0) + (o.deliveryFee || 0) - (o.discount || 0), 0);
      const totalProducts = driverOrders.reduce((s, o) => s + (o.total || 0) - (o.discount || 0), 0);
      const totalDeliveryFee = driverOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
      const sheetDateObj = filterDate ? new Date(filterDate) : new Date();
      const dateStr = sheetDateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      const byCommune: Record<string, DeliveryAdminOrder[]> = {};
      driverOrders.forEach(o => {
        const c = o.commune || 'Non défini';
        if (!byCommune[c]) byCommune[c] = [];
        byCommune[c].push(o);
      });

      let sheetHtml = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1A1410;">
          <h1 style="color: #D4541C; font-size: 24px; margin-bottom: 4px; border-bottom: 2px solid #D4541C; padding-bottom: 8px;">
            Fiche de livraison — ${driver.name}
          </h1>
          <p style="font-size: 14px; color: #666; margin-top: 0; margin-bottom: 20px;">
            <strong>Date :</strong> ${dateStr} | <strong>Téléphone :</strong> ${driver.phone || 'N/A'} | <strong>Total Colis :</strong> ${driverOrders.length}
          </p>
      `;

      let globalIdx = 0;

      Object.entries(byCommune).forEach(([commune, communeOrders]) => {
        sheetHtml += `
          <div style="margin-top: 20px; margin-bottom: 15px;">
            <h2 style="font-size: 18px; color: #1A1410; background-color: #FAF6F1; padding: 6px 12px; border-left: 4px solid #D4541C; margin-bottom: 10px;">
              📍 ${commune} (${communeOrders.length} colis)
            </h2>
            <table border="1" cellspacing="0" cellpadding="6" style="width: 100%; border-collapse: collapse; font-size: 12px; border-color: #DDD;">
              <thead>
                <tr style="background-color: #F8F9FA; font-weight: bold; text-align: left;">
                  <th style="width: 30px; text-align: center;">N°</th>
                  <th style="width: 60px;">Réf</th>
                  <th>Client / Adresse</th>
                  <th>Téléphone</th>
                  <th>Articles</th>
                  <th style="text-align: right; width: 80px;">Montant</th>
                </tr>
              </thead>
              <tbody>
        `;

        communeOrders.forEach((o) => {
          globalIdx++;
          const itemsList = o.items?.map((item) => `${item.name} (${item.size}/${item.color}) ×${item.qty}`).join('<br>') || '';
          sheetHtml += `
                <tr>
                  <td style="text-align: center;">${globalIdx}</td>
                  <td style="font-family: monospace; font-weight: bold;">${o.ref?.split('-').pop()}</td>
                  <td>
                    <strong>${o.customerName}</strong>
                    ${o.customerLocation ? `<br><span style="color: #555; font-size: 11px;">${o.customerLocation}</span>` : ''}
                    ${o.deliveryNote ? `<br><span style="color: #D4541C; font-size: 11px;">Note: ${o.deliveryNote}</span>` : ''}
                    ${o.type ? `<br><span style="display: inline-block; background-color: #0F172A; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; margin-top: 4px;">${o.type}</span>` : ''}
                  </td>
                  <td>
                    ${o.customerPhone}
                    ${o.customerPhone2 ? `<br><span style="color: #666;">${o.customerPhone2}</span>` : ''}
                  </td>
                  <td>${itemsList}</td>
                  <td style="text-align: right; font-weight: bold;">${formatPrice((o.total || 0) - (o.discount || 0) + (o.deliveryFee || 0))}</td>
                </tr>
          `;
        });

        sheetHtml += `
              </tbody>
            </table>
          </div>
        `;
      });

      sheetHtml += `
          <div style="margin-top: 30px; padding: 15px; background-color: #FAF6F1; border: 1px solid #E8DDD0; border-radius: 6px;">
            <table style="width: 100%; font-size: 14px;">
              <tr>
                <td><strong>Total Colis :</strong> ${driverOrders.length}</td>
                <td><strong>Total Produits :</strong> ${formatPrice(totalProducts)}</td>
                <td><strong>Total Livraison :</strong> ${formatPrice(totalDeliveryFee)}</td>
                <td style="text-align: right; font-size: 16px; color: #D4541C;"><strong>TOTAL À ENCAISSER : ${formatPrice(totalAmount)}</strong></td>
              </tr>
            </table>
          </div>
        </div>
      `;

      if (idx < sheetsToExport.length - 1) {
        sheetHtml += `<br clear="all" style="page-break-before:always" />`;
      }

      bodyContent += sheetHtml;
    });

    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Fiches de livraison</title></head><body>`;
    const footer = `</body></html>`;
    const fullHtml = header + bodyContent + footer;

    const blob = new Blob([fullHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = driverId
      ? `Fiche_Livraison_${sheetsToExport[0].driver.name.replace(/\s+/g, '_')}.doc`
      : `Fiches_Livraison_Global.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Fiche exportée en Word ✓", "success");
  };

  const handlePrintSheet = (driverId?: string) => {
    const sheets = Array.from(document.querySelectorAll(".delivery-sheet"));
    if (sheets.length === 0) {
      showToast("Aucune fiche a imprimer", "error");
      return;
    }

    document.body.classList.add("delivery-print-mode");

    if (driverId) {
      sheets.forEach((sheet) => sheet.classList.add("print-hidden"));
      document.getElementById(`sheet-${driverId}`)?.classList.remove("print-hidden");
    } else {
      sheets.forEach((sheet) => sheet.classList.remove("print-hidden"));
    }

    const cleanup = () => {
      document.body.classList.remove("delivery-print-mode");
      sheets.forEach((sheet) => sheet.classList.remove("print-hidden"));
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  };

  return (
    <div className="content animate-fade-in">
      {/* STATS */}
      <div className="stats-grid">
        <StatCard label="Total à livrer" value={stats.total} icon={<Truck size={20} />} accent />
        <StatCard label="Non attribuées" value={stats.unassigned} icon={<UserPlus size={20} />} color="var(--red)" />
        <StatCard label="En cours" value={stats.onDelivery} icon={<Clock size={20} />} color="var(--orange)" />
        <StatCard label="Livreurs actifs" value={stats.deliverymen} icon={<User size={20} />} color="var(--blue)" />
      </div>

      <div className="rider-day-strip">
        <div className="rider-day-strip-head">
          <div className="overview-kicker">Colis attribues ce jour</div>
          <div className="rider-day-date">{filterDate ? formatDate(filterDate) : formatDate(new Date().toISOString())}</div>
        </div>
        <div className="rider-day-list">
          <button
            type="button"
            className={`rider-day-all ${filterDeliveryman === "ALL" ? "active" : ""}`}
            onClick={() => {
              setFilterDeliveryman("ALL");
              setViewMode("table");
            }}
          >
            Tous
          </button>
          {deliverymenByTodayLoad.map((driver) => {
            const dayStats = riderDayStats[driver.id] || { count: 0, alerts: 0 };
            const loadTone = dayStats.count === 0 ? "zero" : dayStats.count >= 10 ? "heavy" : dayStats.count >= 6 ? "medium" : "light";

            return (
              <div key={driver.id} className={`rider-day-pill ${loadTone} ${filterDeliveryman === driver.id ? "active" : ""}`}>
                <button
                  type="button"
                  className="rider-day-main"
                  onClick={() => {
                    setFilterDeliveryman(driver.id);
                    setViewMode("table");
                  }}
                  title={`Afficher les colis de ${driver.name}`}
                >
                  <div className="driver-avatar-small">{driver.name.charAt(0)}</div>
                  <span>{driver.name}</span>
                  {dayStats.alerts > 0 && <em>{dayStats.alerts} alerte(s)</em>}
                  <strong>{dayStats.count}</strong>
                </button>
                <button
                  type="button"
                  className="rider-day-sheet"
                  onClick={() => {
                    setFilterDeliveryman(driver.id);
                    setViewMode("sheet");
                  }}
                  disabled={dayStats.count === 0}
                  title={`Voir la fiche de ${driver.name}`}
                >
                  <FileText size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="delivery-overview">
        <div>
          <div className="overview-kicker">Pilotage livraison</div>
          <div className="overview-title">
            {viewMode === "history" ? "Archives cloturees" : viewMode === "sheet" ? "Fiches du jour" : viewMode === "dispatch" ? "Dispatch du jour" : "Commandes actives"}
          </div>
        </div>
        <div className="overview-actions">
          <div className="overview-metrics">
            <span>{activeOrders.length} actives</span>
            <span>{archivedOrders.length} archives recentes</span>
            <span>{todaySheets.reduce((sum, sheet) => sum + sheet.orders.length, 0)} sur les fiches</span>
          </div>
          <Link
            href={accountingSessionHref}
            className="dispatch-auto-btn"
            style={{ background: '#101820', color: 'white', textDecoration: 'none' }}
            title="Ouvrir la validation comptable des livraisons de cette date"
          >
            <FileText size={15} />
            Compta livraisons
          </Link>
          <button
            type="button"
            className="dispatch-auto-btn"
            onClick={() => handleAutoAssign(autoAssignableOrders)}
            disabled={isPending || autoAssignableOrders.length === 0}
            title="Repartir les commandes non attribuees selon la charge et les communes"
          >
            <Zap size={15} />
            Repartir auto ({autoAssignableOrders.length})
          </button>
        </div>
      </div>

      {/* BULK ACTION BAR */}
      {selectedIds.size > 0 && (
        <div className="bulk-bar animate-slide-up">
          <div className="bulk-info">
            <Check size={18} />
            <span>{selectedIds.size} commande(s) sélectionnée(s)</span>
          </div>
          <div className="bulk-actions">
            <select
              className="bulk-select"
              onChange={(e) => handleBulkAssign(e.target.value)}
              value=""
            >
              <option value="" disabled>Attribuer la sélection à...</option>
              <option value="unassigned" style={{ color: 'var(--red)', fontWeight: 'bold' }}>❌ Désattribuer (Remettre en attente)</option>
              <hr />
              {deliverymen.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({riderLiveCounts[d.id] || 0} en cours)
                </option>
              ))}
            </select>
            <button className="bulk-cancel" onClick={() => setSelectedIds(new Set())}>Annuler</button>
          </div>
        </div>
      )}

      {/* SEARCH & FILTERS */}
      <div className="filter-container">
        <div className="search-container">
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--brown-soft)' }} />
          <input
            type="text"
            className="field-input search-input"
            placeholder="Rechercher par réf, client, commune ou livreur..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="date-filter-group">
          <div className="filter-item compact-date">
            <Calendar size={16} className="filter-icon" />
            <input
              type="date"
              className="field-input filter-date-input"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`date-shortcut ${filterDate === defaultDeliveryFilterValue ? "active" : ""}`}
            onClick={() => setFilterDate(defaultDeliveryFilterValue)}
          >
            Demain
          </button>
          {filterDate && (
            <button type="button" className="date-shortcut clear" onClick={() => setFilterDate("")}>
              Tout
            </button>
          )}
        </div>

        <div className="filter-item">
          <Filter size={16} className="filter-icon" />
          <select
            className="field-input filter-select"
            value={filterDeliveryman}
            onChange={e => setFilterDeliveryman(e.target.value)}
          >
            <option value="ALL">Tous les livreurs</option>
            {deliverymen.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({riderLiveCounts[d.id] || 0})
              </option>
            ))}
          </select>
        </div>

        <div className="filter-item">
          <MapPin size={16} className="filter-icon" />
          <select
            className="field-input filter-select"
            value={filterCommune}
            onChange={e => setFilterCommune(e.target.value)}
          >
            <option value="ALL">Toutes les communes</option>
            {Object.keys(COMMUNES).sort().map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {(searchTerm || filterDate || filterDeliveryman !== "ALL" || filterCommune !== "ALL") && (
          <button
            type="button"
            className="filter-reset"
            onClick={() => {
              setSearchTerm("");
              setFilterDate("");
              setFilterDeliveryman("ALL");
              setFilterCommune("ALL");
              setFilterStatus("ALL");
            }}
          >
            <X size={14} /> Effacer
          </button>
        )}
      </div>

      <div className="toolbar compact-toolbar">
        <div className={`filters-bar compact-status-tabs ${viewMode === "history" ? "is-muted" : ""}`}>
          {[
            { key: "ALL", label: "Toutes" },
            { key: "UNASSIGNED", label: "Non attribuées" },
            { key: "ASSIGNED", label: "Attribuées" },
            { key: "UNPACKED", label: "Non emballees" },
            { key: "ON_DELIVERY", label: "En route" },
            { key: "PENDING", label: "En attente" },
          ].map(f => (
            <button
              key={f.key}
              className={`filter-chip ${filterStatus === f.key ? 'active' : ''}`}
              onClick={() => viewMode !== "history" && setFilterStatus(f.key)}
              disabled={viewMode === "history"}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="view-toggle compact-view-tabs">
          <button
            className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
            title="Vue liste"
          >
            <List size={18} />
          </button>
          <button
            className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Vue par livreur"
          >
            <LayoutGrid size={18} />
          </button>
          <button
            className={`toggle-btn ${viewMode === 'dispatch' ? 'active' : ''}`}
            onClick={() => setViewMode('dispatch')}
            title="Vue dispatch"
          >
            <Route size={18} />
          </button>
          <button
            className={`toggle-btn ${viewMode === 'history' ? 'active' : ''}`}
            onClick={() => setViewMode('history')}
            title="Vue Archives"
          >
            <Archive size={18} />
          </button>
          <button
            className={`toggle-btn ${viewMode === 'sheet' ? 'active' : ''}`}
            onClick={() => setViewMode('sheet')}
            title="Fiche de livraison"
          >
            <FileText size={18} />
          </button>
        </div>
      </div>

      {/* TABLE VIEW */}
      {viewMode === "table" && (
        <TableCard title="Suivi des livraisons" meta={`${filteredOrders.length} commande(s)`}>
          {filteredOrders.length === 0 ? (
            <EmptyState icon="📦" title="Aucune commande" description="Aucune commande à livrer trouvée." />
          ) : (
            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === filteredOrders.length && filteredOrders.length > 0}
                        onChange={() => toggleAll(filteredOrders)}
                      />
                    </th>
                    <th>Réf.</th>
                    <th>Client / Commune</th>
                    <th>Date Prévue</th>
                    <th>Livreur actuel</th>
                    <th>Statut</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(order => {
                    const isAssignable = canAssignDeliveryOrder(order);

                    return (
                      <tr key={order.id} className={selectedIds.has(order.id) ? 'row-selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(order.id)}
                            disabled={!isAssignable}
                            onChange={() => toggleSelect(order.id)}
                          />
                        </td>
                        <td><span className="cell-mono">{order.ref}</span></td>
                        <td>
                          <div className="cell-strong">{order.customerName}</div>
                          <div className="cell-commune">
                            <MapPin size={10} style={{ marginRight: 4, display: 'inline' }} />
                            {order.commune || "N/A"}
                          </div>
                          {order.customerLocation && (
                            <div className="cell-location" title={order.customerLocation}>
                              {order.customerLocation}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="cell-date">
                            <Calendar size={12} />
                            {order.deliveryDate ? formatDate(order.deliveryDate) : 'Non définie'}
                          </div>
                        </td>
                        <td>
                          {order.deliverymanId ? (
                            <div className="assigned-driver">
                              <div className="driver-avatar">{order.deliverymanName?.charAt(0)}</div>
                              <div className="driver-info">
                                <span className="driver-name-text">{order.deliverymanName}</span>
                                {order.updatedAt && <span className="driver-time-text">Assigné le {formatDate(order.updatedAt)}</span>}
                              </div>
                            </div>
                          ) : (
                            <span className="unassigned-badge">Non attribuée</span>
                          )}
                        </td>
                        <td><StatusBadge status={order.status} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="cell-btn-icon"
                              onClick={() => setReproOrder(order)}
                              disabled={isPending || order.status === "REPRO_DISPO"}
                              title="Repro-dispo demain"
                            >
                              <CalendarClock size={14} />
                            </button>
                            <select
                              className="assign-select"
                              value={order.deliverymanId || ""}
                              onChange={(e) => handleAssign(order.id, e.target.value)}
                              disabled={isPending || !isAssignable}
                            >
                              <option value="" disabled>Attribuer à...</option>
                              <option value="unassigned" style={{ color: 'var(--red)' }}>❌ Désattribuer</option>
                              {deliverymen.map(d => (
                                <option key={d.id} value={d.id}>
                                  {d.name} ({riderLiveCounts[d.id] || 0})
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
      )}

      {/* GRID VIEW (BY RIDER) */}
      {viewMode === "grid" && (
        <div className="rider-grid">
          {/* Unassigned column */}
          <div className="rider-column unassigned-col">
            <div className="rider-column-header">
              <div className="header-info">
                <UserPlus size={18} />
                <h3>Non assignées</h3>
              </div>
              <span className="count-badge">{groupedByDriver["unassigned"].length}</span>
            </div>
            <div className="order-cards-list">
              {groupedByDriver["unassigned"].map(order => (
                <OrderMiniCard key={order.id} order={order} deliverymen={deliverymen} onAssign={handleAssign} riderLiveCounts={riderLiveCounts} />
              ))}
              {groupedByDriver["unassigned"].length === 0 && <div className="empty-col">Tout est assigné ✓</div>}
            </div>
          </div>

          {/* Riders columns */}
          {deliverymen.map(driver => (
            <div key={driver.id} className="rider-column">
              <div className="rider-column-header">
                <div className="header-info">
                  <div className="driver-avatar-small">{driver.name.charAt(0)}</div>
                  <div className="driver-info">
                    <h3 className="driver-name-text">{driver.name}</h3>
                    <span className="driver-phone-text">{driver.phone}</span>
                  </div>
                </div>
                <span className="count-badge active">{riderLiveCounts[driver.id] || 0}</span>
              </div>
              <div className="order-cards-list">
                {groupedByDriver[driver.id]?.map(order => (
                  <OrderMiniCard key={order.id} order={order} deliverymen={deliverymen} onAssign={handleAssign} riderLiveCounts={riderLiveCounts} />
                ))}
                {(groupedByDriver[driver.id]?.length || 0) === 0 && <div className="empty-col">Aucune livraison</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DISPATCH VIEW */}
      {viewMode === "dispatch" && (
        <div className="dispatch-layout">
          <div className="dispatch-summary-grid">
            <div className="dispatch-summary-card">
              <span className="summary-label">A preparer</span>
              <strong>{filteredOrders.length}</strong>
              <small>{dispatchSummary.assigned} deja attribuee(s)</small>
            </div>
            <div className="dispatch-summary-card alert">
              <span className="summary-label">Sans livreur</span>
              <strong>{autoAssignableOrders.length}</strong>
              <small>eligible(s) a la repartition auto</small>
            </div>
            <div className="dispatch-summary-card">
              <span className="summary-label">Zones</span>
              <strong>{dispatchSummary.zones}</strong>
              <small>commune(s) dans le filtre</small>
            </div>
            <div className="dispatch-summary-card">
              <span className="summary-label">A encaisser</span>
              <strong>{formatPrice(dispatchSummary.cash)}</strong>
              <small>produits + livraison</small>
            </div>
          </div>

          <div className="dispatch-main">
            <section className="dispatch-panel">
              <div className="dispatch-panel-header">
                <div>
                  <h3>Points a verifier</h3>
                  <p>{dispatchSummary.riskCount} commande(s) avec alerte</p>
                </div>
                <AlertTriangle size={18} />
              </div>
              <div className="risk-list">
                {riskOrders.slice(0, 8).map(({ order, risks }) => (
                  <div key={order.id} className="risk-item">
                    <div>
                      <span className="order-ref">{order.ref}</span>
                      <strong>{order.customerName}</strong>
                      <small>{order.commune || "Commune non definie"}</small>
                    </div>
                    <div className="risk-badges">
                      {risks.map((risk) => <span key={risk} className="risk-badge">{risk}</span>)}
                    </div>
                  </div>
                ))}
                {riskOrders.length === 0 && (
                  <div className="empty-col">Aucun point bloquant dans le filtre actuel</div>
                )}
              </div>
            </section>

            <section className="dispatch-board">
              <div className="dispatch-board-header">
                <div>
                  <h3>Repartition par livreur</h3>
                  <p>Les colonnes suivent les filtres actifs et la date prevue.</p>
                </div>
                <button
                  type="button"
                  className="dispatch-auto-btn"
                  onClick={() => handleAutoAssign(autoAssignableOrders)}
                  disabled={isPending || autoAssignableOrders.length === 0}
                >
                  <Zap size={15} /> Repartir auto
                </button>
              </div>

              <div className="dispatch-columns">
                <div className="dispatch-column unassigned-col">
                  <div className="dispatch-column-title">
                    <UserPlus size={16} />
                    <span>Non attribuees</span>
                    <b>{groupedByDriver["unassigned"].length}</b>
                  </div>
                  <div className="order-cards-list">
                    {groupedByDriver["unassigned"].map(order => (
                      <OrderMiniCard key={order.id} order={order} deliverymen={deliverymen} onAssign={handleAssign} riderLiveCounts={riderLiveCounts} />
                    ))}
                    {groupedByDriver["unassigned"].length === 0 && <div className="empty-col">Tout est attribue</div>}
                  </div>
                </div>

                {deliverymen.map(driver => (
                  <div key={driver.id} className="dispatch-column">
                    <div className="dispatch-column-title">
                      <div className="driver-avatar-small">{driver.name.charAt(0)}</div>
                      <span>{driver.name}</span>
                      <b>{groupedByDriver[driver.id]?.length || 0}</b>
                    </div>
                    <div className="order-cards-list">
                      {groupedByDriver[driver.id]?.map(order => (
                        <OrderMiniCard key={order.id} order={order} deliverymen={deliverymen} onAssign={handleAssign} riderLiveCounts={riderLiveCounts} />
                      ))}
                      {(groupedByDriver[driver.id]?.length || 0) === 0 && <div className="empty-col">Aucune livraison</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* HISTORY VIEW (BY DATE) */}
      {viewMode === "history" && (
        <div className="history-archive-container">
          {Object.entries(groupedByDate).map(([date, dateOrders]) => {
            const dateStats = {
              total: dateOrders.length,
              delivered: dateOrders.filter(o => o.status === "DELIVERED").length,
              returned: dateOrders.filter(o => o.status === "RETURNED" || o.status === "CANCELLED").length,
              cash: dateOrders.filter(o => o.status === "DELIVERED").reduce((acc, o) => acc + Number(o.total || 0) + Number(o.deliveryFee || 0), 0)
            };
            const isExpanded = expandedDate === date;

            return (
              <div key={date} className={`history-date-block ${isExpanded ? 'expanded' : ''}`}>
                <div
                  className="history-date-header"
                  onClick={() => setExpandedDate(isExpanded ? null : date)}
                >
                  <div className="date-info">
                    <div className="calendar-box">
                      <Calendar size={18} />
                      <span>{new Date(date).getDate()}</span>
                    </div>
                    <div>
                      <h4>{new Date(date).toLocaleDateString("fr-FR", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h4>
                      <p>{dateOrders.length} commandes au total</p>
                    </div>
                  </div>

                  <div className="header-stats">
                    <div className="mini-stat">
                      <span className="label">CA Encaissé</span>
                      <span className="value text-green">{formatPrice(dateStats.cash)}</span>
                    </div>
                    <div className="mini-stat">
                      <span className="label">Livrés</span>
                      <span className="value">{dateStats.delivered}</span>
                    </div>
                    <div className="mini-stat">
                      <span className="label">Retours</span>
                      <span className="value text-red">{dateStats.returned}</span>
                    </div>
                    <ChevronRight size={20} className="expand-icon" />
                  </div>
                </div>

                {isExpanded && (
                  <div className="history-date-content animate-fade-in">
                    <div className="table-responsive">
                      <table className="mini-table">
                        <thead>
                          <tr>
                            <th>Réf.</th>
                            <th>Client / Commune</th>
                            <th>Livreur</th>
                            <th>Total</th>
                            <th>Statut</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dateOrders.map(o => (
                            <tr key={o.id}>
                              <td><span className="cell-mono">{o.ref}</span></td>
                              <td>
                                <div className="cell-strong">{o.customerName}</div>
                                <div className="cell-muted">{o.commune}</div>
                              </td>
                              <td>{o.deliverymanName || '-'}</td>
                              <td>{formatPrice(Number(o.total || 0) + Number(o.deliveryFee || 0))}</td>
                              <td><StatusBadge status={o.status} size="sm" /></td>
                              <td>
                                <button
                                  type="button"
                                  className="cell-btn-icon"
                                  onClick={() => setReopenOrder(o)}
                                  disabled={isPending || Boolean(o.settlementId)}
                                  title={o.settlementId ? "Commande deja reglee" : "Corriger une livraison"}
                                >
                                  <Undo2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {Object.keys(groupedByDate).length === 0 && (
            <EmptyState icon="📅" title="Aucune archive" description="Aucune donnée historique trouvée pour les filtres actuels." />
          )}
        </div>
      )}
      {/* DELIVERY SHEET VIEW */}
      {viewMode === "sheet" && (
        <div className="delivery-sheets-container">
          <div className="sheet-toolbar no-print">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={18} color="var(--orange)" />
              <span style={{ fontWeight: 800, fontSize: 15 }}>Fiches de livraison du jour</span>
              <span className="count-badge active">{todaySheets.reduce((s, g) => s + g.orders.length, 0)} commandes</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Link href={accountingSessionHref} className="btn-secondary" style={{ gap: 8, textDecoration: 'none', borderColor: 'var(--ink)', color: 'var(--ink)' }}>
                <FileText size={14} /> Valider en compta
              </Link>
              <button className="btn-secondary" onClick={() => handleExportWord()} style={{ gap: 8, borderColor: 'var(--blue)', color: 'var(--blue)' }}>
                <Download size={14} /> Tout exporter Word
              </button>
              <button className="btn-orange" onClick={() => handlePrintSheet()} style={{ gap: 8 }}>
                <Printer size={14} /> Tout imprimer
              </button>
            </div>
          </div>

          {todaySheets.length === 0 ? (
            <EmptyState icon="🚛" title="Aucune commande attribuée aujourd'hui" description="Attribuez des commandes aux livreurs pour générer les fiches." />
          ) : (
            todaySheets.map(({ driver, orders: driverOrders }) => {
              const totalAmount = driverOrders.reduce((s, o) => s + (o.total || 0) + (o.deliveryFee || 0) - (o.discount || 0), 0);
              const totalProducts = driverOrders.reduce((s, o) => s + (o.total || 0) - (o.discount || 0), 0);
              const totalDeliveryFee = driverOrders.reduce((s, o) => s + (o.deliveryFee || 0), 0);
              const initials = driver.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

              const byCommune: Record<string, DeliveryAdminOrder[]> = {};
              driverOrders.forEach(o => {
                const c = o.commune || 'Non défini';
                if (!byCommune[c]) byCommune[c] = [];
                byCommune[c].push(o);
              });

              let globalIdx = 0;

              return (
                <div key={driver.id} id={`sheet-${driver.id}`} className="delivery-sheet print-sheet">
                  <div className="sheet-header">
                    <div className="sheet-driver-info">
                      <div className="sheet-driver-avatar">{initials}</div>
                      <div>
                        <div className="sheet-driver-name">{driver.name}</div>
                        {driver.phone && <div className="sheet-driver-phone"><Phone size={11} /> {driver.phone}</div>}
                      </div>
                    </div>
                    <div className="sheet-meta">
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} className="no-print">
                        <button className="btn-print-single" onClick={() => handleExportWord(driver.id)} style={{ background: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' }}>
                          <Download size={13} /> Word
                        </button>
                        <button className="btn-print-single" onClick={() => handlePrintSheet(driver.id)}>
                          <Printer size={13} /> Imprimer
                        </button>
                      </div>
                      <div className="sheet-date">
                        {(filterDate ? new Date(filterDate) : new Date()).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      </div>
                      <div className="sheet-stats-row">
                        <span><strong>{driverOrders.length}</strong> colis</span>
                        <span>•</span>
                        <span><strong>{Object.keys(byCommune).length}</strong> zones</span>
                        <span>•</span>
                        <span style={{ fontWeight: 800 }}>{formatPrice(totalAmount)}</span>
                      </div>
                    </div>
                  </div>

                  {Object.entries(byCommune).map(([commune, communeOrders]) => (
                    <div key={commune} className="sheet-commune-block">
                      <div className="sheet-commune-header">
                        <MapPin size={13} />
                        <span>{commune}</span>
                        <span className="commune-count">{communeOrders.length}</span>
                      </div>
                      <table className="sheet-table">
                        <thead>
                          <tr>
                            <th className="col-n">N°</th>
                            <th className="col-ref">Réf</th>
                            <th>Client / Adresse</th>
                            <th className="col-phone">Téléphone</th>

                            <th>Articles</th>
                            <th className="col-total">Montant</th>
                          </tr>
                        </thead>
                        <tbody>
                          {communeOrders.map((o) => {
                            globalIdx++;
                            return (
                              <tr key={o.id}>
                                <td className="col-n">{globalIdx}</td>
                                <td className="col-ref"><span className="cell-mono">{o.ref?.split('-').pop()}</span></td>
                                <td>
                                  <strong>{o.customerName}</strong>
                                  {o.customerLocation && <div className="sheet-addr">{o.customerLocation}</div>}
                                  {o.deliveryNote && <div className="sheet-note">Note: {o.deliveryNote}</div>}
                                  {o.type && <div style={{ display: 'inline-block', backgroundColor: '#0F172A', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', marginTop: '4px' }}>{o.type}</div>}
                                </td>
                                <td className="col-phone">
                                  <div>{o.customerPhone}</div>
                                  {o.customerPhone2 && <div className="phone2">{o.customerPhone2}</div>}
                                </td>

                                <td>
                                  {o.items?.map((item, i: number) => (
                                    <div key={i} className="sheet-item">{item.name} <span className="item-variant">{item.size}/{item.color}</span> ×{item.qty}</div>
                                  ))}
                                </td>
                                <td className="col-total">
                                  <div style={{ fontWeight: 900 }}>{formatPrice((o.total || 0) - (o.discount || 0) + (o.deliveryFee || 0))}</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))
                  }

                  <div className="sheet-footer">
                    <div className="sheet-footer-item"><span className="label">Colis</span><span className="val">{driverOrders.length}</span></div>
                    <div className="sheet-footer-item"><span className="label">Total Produits</span><span className="val">{formatPrice(totalProducts)}</span></div>
                    <div className="sheet-footer-item"><span className="label">Total Livraison</span><span className="val">{formatPrice(totalDeliveryFee)}</span></div>
                    <div className="sheet-footer-item total"><span className="label">TOTAL À ENCAISSER</span><span className="val">{formatPrice(totalAmount)}</span></div>
                  </div>
                </div >
              );
            })
          )}
        </div >
      )}

      {
        autoAssignPreviewOrders.length > 0 && (
          <Modal
            isOpen
            onClose={() => setAutoAssignPreviewOrders([])}
            title="Apercu repartition automatique"
            footer={
              <>
                <button className="btn-secondary" onClick={() => setAutoAssignPreviewOrders([])} disabled={isPending}>
                  Annuler
                </button>
                <button className="btn-orange" onClick={confirmAutoAssign} disabled={isPending}>
                  <Zap size={14} /> Confirmer la repartition
                </button>
              </>
            }
          >
            <div className="auto-preview">
              <div className="auto-preview-head">
                <div>
                  <span className="summary-label">Commandes a repartir</span>
                  <strong>{autoAssignPreviewOrders.length}</strong>
                </div>
                <div>
                  <span className="summary-label">Livreurs touches</span>
                  <strong>{autoAssignPreviewGroups.length}</strong>
                </div>
              </div>

              <div className="auto-preview-list">
                {autoAssignPreviewGroups.map(({ driver, currentCount, orders }) => {
                  const communes = Array.from(new Set(orders.map((order) => order.commune).filter(Boolean)));
                  return (
                    <div key={driver.id} className="auto-preview-group">
                      <div className="auto-preview-driver">
                        <div className="driver-avatar-small">{driver.name.charAt(0)}</div>
                        <div>
                          <h4>{driver.name}</h4>
                          <p>{currentCount} deja attribue(s) ce jour, {currentCount + orders.length} apres repartition</p>
                        </div>
                        <strong>+{orders.length}</strong>
                      </div>
                      <div className="auto-preview-communes">
                        {communes.length > 0
                          ? communes.map((commune) => <span key={commune}>{commune}</span>)
                          : <span>Commune non definie</span>}
                      </div>
                      <div className="auto-preview-orders">
                        {orders.slice(0, 5).map((order) => (
                          <span key={order.id}>{order.ref}</span>
                        ))}
                        {orders.length > 5 && <span>+{orders.length - 5}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Modal>
        )
      }

      {
        reopenOrder && (
          <Modal
            isOpen
            onClose={() => {
              setReopenOrder(null);
              setReopenNote("");
            }}
            title={`Corriger la livraison ${reopenOrder.ref}`}
            footer={
              <>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setReopenOrder(null);
                    setReopenNote("");
                  }}
                  disabled={isPending}
                >
                  Annuler
                </button>
                <button className="btn-orange" onClick={handleReopenDelivery} disabled={isPending || !reopenNote.trim()}>
                  <Undo2 size={14} /> Corriger
                </button>
              </>
            }
          >
            <div className="repro-modal">
              <p>
                Cette action remet la commande en statut En livraison pour corriger une erreur livreur.
                Elle est bloquee si la commande est deja rattachee a un reglement livreur.
              </p>
              {reopenOrder.status === "PARTIALLY_DELIVERED" && (
                <p className="text-[12px] font-bold text-[#B91C1C]">
                  Attention : pour une livraison partielle, les quantites modifiees ne sont pas restaurees automatiquement.
                </p>
              )}
              <label className="field-label-sm" htmlFor="reopen-note">Motif de correction obligatoire</label>
              <textarea
                id="reopen-note"
                className="field-input repro-note"
                value={reopenNote}
                onChange={(event) => setReopenNote(event.target.value)}
                placeholder="Ex: livreur s'est trompe de statut, client finalement disponible..."
              />
            </div>
          </Modal>
        )
      }

      {
        reproOrder && (
          <Modal
            isOpen
            onClose={() => {
              setReproOrder(null);
              setReproReason("");
              setReproDetails("");
              setReproDate(dateInputValue(getNextDeliveryDate()));
            }}
            title={`Repro-dispo ${reproOrder.ref}`}
            footer={
              <>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setReproOrder(null);
                    setReproReason("");
                    setReproDetails("");
                    setReproDate(dateInputValue(getNextDeliveryDate()));
                  }}
                  disabled={isPending}
                >
                  Annuler
                </button>
                <button className="btn-orange" onClick={handleReproDispo} disabled={isPending || !reproDate || (!reproReason && !reproDetails.trim())}>
                  <CalendarClock size={14} /> Confirmer le report
                </button>
              </>
            }
          >
            <div className="repro-modal">
              <p>
                Le colis reste emballe et collecte. Choisissez la nouvelle date demandee par le client.
              </p>
              <label className="field-label-sm" htmlFor="repro-date">Nouvelle date de livraison</label>
              <input
                id="repro-date"
                type="date"
                className="field-input"
                value={reproDate}
                onChange={(event) => setReproDate(event.target.value)}
              />
              <div className="repro-reasons">
                {REPRO_DISPO_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className={`repro-reason ${reproReason === reason ? "active" : ""}`}
                    onClick={() => setReproReason(reason)}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <label className="field-label-sm" htmlFor="repro-details">Detail utile</label>
              <textarea
                id="repro-details"
                className="field-input repro-note"
                value={reproDetails}
                onChange={(event) => setReproDetails(event.target.value)}
                placeholder="Precision pour le bureau ou le prochain livreur..."
              />
            </div>
          </Modal>
        )
      }

    </div >
  );
}

function OrderMiniCard({ order, deliverymen, onAssign, riderLiveCounts }: { order: DeliveryAdminOrder, deliverymen: Deliveryman[], onAssign: (oid: string, did: string) => void, riderLiveCounts: Record<string, number> }) {
  const isAssignable = canAssignDeliveryOrder(order);
  const risks = getOrderRisks(order);

  return (
    <div className="order-mini-card">
      <div className="card-header">
        <span className="order-ref">{order.ref}</span>
        <StatusBadge status={order.status} size="sm" />
      </div>
      <div className="card-body">
        <div className="customer-name">{order.customerName}</div>
        <div className="commune-info">
          <MapPin size={12} />
          <span className="font-bold">{order.commune}</span>
        </div>
        {order.customerLocation && (
          <div className="location-info">
            <span className="text-[10px] text-zinc-500 leading-tight block mt-1 italic">
              {order.customerLocation}
            </span>
          </div>
        )}
        {order.deliveryDate && (
          <div className="date-info">
            <Calendar size={12} />
            {formatDate(order.deliveryDate)}
          </div>
        )}
        {risks.length > 0 && (
          <div className="risk-badges compact">
            {risks.slice(0, 3).map((risk) => <span key={risk} className="risk-badge">{risk}</span>)}
          </div>
        )}
      </div>
      <div className="card-footer">
        <select
          className="mini-assign-select"
          value={order.deliverymanId || ""}
          onChange={(e) => onAssign(order.id, e.target.value)}
          disabled={!isAssignable}
        >
          <option value="" disabled>Attribuer à...</option>
          <option value="unassigned">❌ Désattribuer</option>
          {deliverymen.map((d) => (
            <option key={d.id} value={d.id}>{d.name} ({riderLiveCounts[d.id] || 0})</option>
          ))}
        </select>
      </div>

    </div>
  );
}
