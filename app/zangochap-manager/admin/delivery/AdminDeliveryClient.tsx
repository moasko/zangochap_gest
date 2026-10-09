"use client";

import React, { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { TableCard, EmptyState, StatusBadge } from "@/components/UI";
import Modal from "@/components/Modal";
import { formatPrice, formatDate, COMMUNES } from "@/lib/constants";
import { UserPlus, Search, X, Check, MapPin, Calendar, LayoutGrid, List, Archive, ChevronLeft, ChevronRight, FileText, Phone, Printer, CalendarClock, Download, Undo2, Zap, AlertTriangle, ShieldCheck } from "lucide-react";
import { assignOrderToDeliveryman, bulkAssignOrders, updateOrderStatus, reopenDeliveryOrder } from "@/modules/orders/actions";
import DeliveryDispatchModal, { type DispatchActions } from "@/modules/orders/components/DeliveryDispatchModal";
import DeliveryDispatchAuditModal, { type DispatchAuditActions } from "@/modules/orders/components/DeliveryDispatchAuditModal";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";
import "./admin-delivery-client.css";

type Deliveryman = {
  id: string;
  name: string;
  phone: string | null;
  // Colis portes sur les 14 derniers jours : distingue l'equipe active des comptes dormants.
  recentCount?: number;
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
  // Apercu local fictif uniquement (/dev/delivery-preview) : remplace les Server Actions.
  demoActions?: {
    assign?: typeof assignOrderToDeliveryman;
    bulkAssign?: typeof bulkAssignOrders;
    dispatch?: Partial<DispatchActions>;
    audit?: Partial<DispatchAuditActions>;
  };
}

const REPRO_DISPO_REASONS = [
  "Client indisponible aujourd'hui",
  "Client demande demain",
  "Adresse a confirmer",
  "Fin de tournee",
];

const DELIVERY_ASSIGNABLE_STATUSES = new Set(["PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "UNAVAILABLE", "ALTERNATIVE", "PACKED", "ON_DELIVERY", "REPRO_DISPO"]);
// Toute commande assignable à un livreur doit aussi pouvoir figurer sur sa fiche imprimée,
// sinon une commande attribuée mais pas encore en PACKED (ex: CONFIRMED) reste invisible.
const DELIVERY_SHEET_STATUSES = new Set([...DELIVERY_ASSIGNABLE_STATUSES, "REPROGRAMMED"]);
const UNPACKED_STATUSES = ["PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "UNAVAILABLE", "ALTERNATIVE"];
// Statuts pris en charge par la repartition automatique (voir modules/orders/helpers/delivery-dispatch.ts).
// Colis confirmes / en preparation inclus : la fenetre les propose par defaut (case decochable).
const DISPATCH_READY_STATUSES = new Set(["PACKED", "ON_DELIVERY", "REPRO_DISPO", "CONFIRMED", "PREPARING"]);

function canAssignDeliveryOrder(order: DeliveryAdminOrder) {
  return DELIVERY_ASSIGNABLE_STATUSES.has(order.status) && !order.settlementId;
}

function getOrderRisks(order: DeliveryAdminOrder) {
  const risks: string[] = [];

  // « Sans livreur » n'est pas une alerte : il a son indicateur et sa colonne dedies.
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

const STATUS_FILTERS = [
  { key: "ALL", label: "A livrer", tone: "" },
  { key: "UNASSIGNED", label: "Sans livreur", tone: "alert" },
  { key: "ASSIGNED", label: "Attribuees", tone: "" },
  { key: "ON_DELIVERY", label: "En route", tone: "" },
  { key: "UNPACKED", label: "Non emballees", tone: "muted" },
] as const;

function matchesStatusFilter(order: DeliveryAdminOrder, filter: string) {
  if (filter === "ALL") return true;
  if (filter === "UNASSIGNED") return !order.deliverymanId;
  if (filter === "ASSIGNED") return Boolean(order.deliverymanId);
  if (filter === "UNPACKED") return UNPACKED_STATUSES.includes(order.status);
  return order.status === filter;
}

function shiftDateInput(value: string, days: number) {
  const base = value ? new Date(`${value}T00:00:00`) : new Date();
  base.setDate(base.getDate() + days);
  return dateInputValue(base);
}

/** Options livreur : equipe active d'abord, comptes sans activite recente a part. */
function RiderOptions({ deliverymen, activeRiderIds, counts }: { deliverymen: Deliveryman[]; activeRiderIds: Set<string>; counts: Record<string, number> }) {
  const active = deliverymen.filter((d) => activeRiderIds.has(d.id));
  const dormant = deliverymen.filter((d) => !activeRiderIds.has(d.id));
  const label = (d: Deliveryman) => `${d.name} (${counts[d.id] || 0})`;
  return (
    <>
      <optgroup label="Equipe active">
        {active.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}
      </optgroup>
      {dormant.length > 0 && (
        <optgroup label="Sans activite recente">
          {dormant.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}
        </optgroup>
      )}
    </>
  );
}

export default function AdminDeliveryClient({ activeOrders, archivedOrders, deliverymen, demoActions }: AdminDeliveryClientProps) {
  const assignAction = demoActions?.assign ?? assignOrderToDeliveryman;
  const bulkAssignAction = demoActions?.bulkAssign ?? bulkAssignOrders;
  const defaultDeliveryFilterValue = dateInputValue(getNextDeliveryDate());
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDeliveryman, setFilterDeliveryman] = useState("ALL");
  const [filterCommune, setFilterCommune] = useState("ALL");
  const [filterDate, setFilterDate] = useState(defaultDeliveryFilterValue); // YYYY-MM-DD
  const [viewMode, setViewMode] = useState<"table" | "dispatch" | "history" | "sheet">("table");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [reproOrder, setReproOrder] = useState<DeliveryAdminOrder | null>(null);
  const [reproReason, setReproReason] = useState("");
  const [reproDetails, setReproDetails] = useState("");
  const [reproDate, setReproDate] = useState(() => dateInputValue(getNextDeliveryDate()));
  const [reopenOrder, setReopenOrder] = useState<DeliveryAdminOrder | null>(null);
  const [reopenNote, setReopenNote] = useState("");
  const [dispatchRequest, setDispatchRequest] = useState<{ date: string; orderIds?: string[] } | null>(null);
  // Controle / correction d'une repartition deja appliquee (date controlee).
  const [auditDate, setAuditDate] = useState<string | null>(null);

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
        await assignAction(orderId, dId);
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
      ? `Désattribuer les ${selectedIds.size} colis sélectionnés ?`
      : `Déplacer ${selectedIds.size} colis vers ${driver?.name} ?`;

    if (!confirm(confirmMsg)) return;

    startTransition(async () => {
      try {
        const result = await bulkAssignAction(Array.from(selectedIds), dId);
        const done = `${result.assignedCount} colis ${isUnassigning ? 'désattribué(s)' : `déplacé(s) vers ${driver?.name}`}`;
        if (result.skipped.length > 0) {
          const detail = result.skipped.slice(0, 3).map((item) => `${item.ref} : ${item.reason}`).join(" · ");
          showToast(`${done}. ${result.skipped.length} ignoré(s) — ${detail}${result.skipped.length > 3 ? " …" : ""}`, 'error');
          setSelectedIds(new Set(result.skipped.map((item) => item.orderId)));
        } else {
          showToast(done, 'success');
          setSelectedIds(new Set());
        }
        router.refresh();
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : 'Erreur', 'error');
      }
    });
  };

  const handleAutoAssign = () => {
    if (!filterDate) {
      showToast("Choisissez une date de livraison avant la repartition.", "error");
      return;
    }
    // Sans filtre : toutes les commandes de la date. Avec filtres : uniquement celles affichees.
    // Le filtre de statut ne restreint pas : le serveur ne prend que les commandes pretes.
    const isNarrowed = Boolean(searchTerm.trim()) || filterDeliveryman !== "ALL" || filterCommune !== "ALL";
    setDispatchRequest({ date: filterDate, orderIds: isNarrowed ? scopeOrders.map((order) => order.id) : undefined });
  };

  const handleAudit = () => {
    if (!filterDate) {
      showToast("Choisissez une date de livraison avant le controle.", "error");
      return;
    }
    setAuditDate(filterDate);
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

  // Perimetre = tous les filtres sauf le statut : sert aux indicateurs cliquables.
  const scopeOrders = useMemo(() => {
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

      const matchesDriver = filterDeliveryman === "ALL" || o.deliverymanId === filterDeliveryman;
      const matchesCommune = filterCommune === "ALL" || o.commune === filterCommune;

      const matchesDate = matchesDateInput(o.deliveryDate, filterDate);

      return matchesSearch && matchesDriver && matchesCommune && matchesDate;
    });
  }, [activeOrders, searchTerm, filterDeliveryman, filterCommune, filterDate]);

  const filteredOrders = useMemo(
    () => scopeOrders.filter((o) => matchesStatusFilter(o, filterStatus)),
    [scopeOrders, filterStatus],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STATUS_FILTERS.forEach(({ key }) => {
      counts[key] = scopeOrders.filter((o) => matchesStatusFilter(o, key)).length;
    });
    return counts;
  }, [scopeOrders]);

  // Equipe active en premier, comptes dormants regroupes a part dans les listes.
  const activeRiderIds = useMemo(() => {
    const ids = new Set(deliverymen.filter((d) => (d.recentCount || 0) > 0).map((d) => d.id));
    activeOrders.forEach((o) => { if (o.deliverymanId) ids.add(o.deliverymanId); });
    return ids;
  }, [deliverymen, activeOrders]);

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
    return scopeOrders.filter((order) => canAssignDeliveryOrder(order)
      && DISPATCH_READY_STATUSES.has(order.status)
      && (!order.deliverymanId || order.status === "REPRO_DISPO"));
  }, [scopeOrders]);

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

  const ridersWithLoad = useMemo(
    () => deliverymenByTodayLoad.filter((driver) => (riderDayStats[driver.id]?.count || 0) > 0),
    [deliverymenByTodayLoad, riderDayStats],
  );

  const boardRiders = useMemo(
    () => deliverymen.filter((driver) => (groupedByDriver[driver.id]?.length || 0) > 0 || filterDeliveryman === driver.id),
    [deliverymen, groupedByDriver, filterDeliveryman],
  );
  const hiddenBoardRiders = deliverymen.length - boardRiders.length;

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
      {/* EN-TETE : date + actions */}
      <div className="dlv-head">
        <div className="dlv-date">
          <button type="button" className="dlv-icon-btn" onClick={() => setFilterDate(shiftDateInput(filterDate, -1))} title="Jour precedent" aria-label="Jour precedent">
            <ChevronLeft size={16} />
          </button>
          <label className="dlv-date-field">
            <Calendar size={15} />
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} aria-label="Date de livraison" />
          </label>
          <button type="button" className="dlv-icon-btn" onClick={() => setFilterDate(shiftDateInput(filterDate, 1))} title="Jour suivant" aria-label="Jour suivant">
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className={`dlv-chip ${filterDate === defaultDeliveryFilterValue ? "active" : ""}`}
            onClick={() => setFilterDate(defaultDeliveryFilterValue)}
          >
            Demain
          </button>
          <button type="button" className={`dlv-chip ${!filterDate ? "active" : ""}`} onClick={() => setFilterDate("")}>
            Toutes dates
          </button>
        </div>
        <div className="dlv-actions">
          <Link href="/zangochap-manager/admin/delivery/planning" className="dlv-btn ghost" title="Jours de travail, absences, communes affectées et plafonds des livreurs">
            <CalendarClock size={15} /> Planning
          </Link>
          <Link href={accountingSessionHref} className="dlv-btn ghost" title="Validation comptable des livraisons de cette date">
            <FileText size={15} /> Compta
          </Link>
          <button
            type="button"
            className="dlv-btn ghost"
            onClick={handleAudit}
            disabled={isPending}
            title="Verifier les colis deja attribues (livreur absent, hors zone, au plafond, alternance) et corriger"
          >
            <ShieldCheck size={15} /> Controler
          </button>
          <button
            type="button"
            className="dlv-btn primary"
            onClick={handleAutoAssign}
            disabled={isPending || autoAssignableOrders.length === 0}
            title="Repartir les colis de la date (emballes et, par defaut, non emballes) selon les communes affectees, la presence et la charge"
          >
            <Zap size={15} /> Repartir auto
            {autoAssignableOrders.length > 0 && <span className="dlv-btn-count">{autoAssignableOrders.length}</span>}
          </button>
        </div>
      </div>

      {/* INDICATEURS = filtres de statut */}
      <div className="dlv-kpis" role="tablist" aria-label="Filtrer par statut">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filterStatus === f.key}
            className={`dlv-kpi ${f.tone} ${filterStatus === f.key ? "active" : ""}`}
            onClick={() => setFilterStatus(f.key)}
            disabled={viewMode === "history"}
          >
            <strong>{statusCounts[f.key] || 0}</strong>
            <span>{f.label}</span>
          </button>
        ))}
        <div className="dlv-kpi static" title="Produits + livraison - remises, commandes affichees">
          <strong>{formatPrice(dispatchSummary.cash)}</strong>
          <span>A encaisser</span>
        </div>
      </div>

      {/* VUES + RECHERCHE + FILTRES */}
      <div className="dlv-bar">
        <div className="dlv-views" role="tablist" aria-label="Affichage">
          {([
            { key: "table", label: "Liste", icon: <List size={15} /> },
            { key: "dispatch", label: "Par livreur", icon: <LayoutGrid size={15} /> },
            { key: "sheet", label: "Fiches", icon: <Printer size={15} /> },
            { key: "history", label: "Archives", icon: <Archive size={15} /> },
          ] as const).map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={viewMode === v.key}
              className={`dlv-view ${viewMode === v.key ? "active" : ""}`}
              onClick={() => setViewMode(v.key)}
            >
              {v.icon}<span>{v.label}</span>
            </button>
          ))}
        </div>

        <div className="dlv-search">
          <Search size={15} />
          <input
            type="text"
            placeholder="Ref, client, commune, livreur..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            aria-label="Rechercher"
          />
        </div>

        <select className="dlv-select" value={filterDeliveryman} onChange={e => setFilterDeliveryman(e.target.value)} aria-label="Livreur">
          <option value="ALL">Tous les livreurs</option>
          <RiderOptions deliverymen={deliverymen} activeRiderIds={activeRiderIds} counts={riderLiveCounts} />
        </select>

        <select className="dlv-select" value={filterCommune} onChange={e => setFilterCommune(e.target.value)} aria-label="Commune">
          <option value="ALL">Toutes les communes</option>
          {Object.keys(COMMUNES).sort().map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {(searchTerm || filterDeliveryman !== "ALL" || filterCommune !== "ALL" || filterStatus !== "ALL") && (
          <button
            type="button"
            className="dlv-reset"
            onClick={() => {
              setSearchTerm("");
              setFilterDeliveryman("ALL");
              setFilterCommune("ALL");
              setFilterStatus("ALL");
            }}
          >
            <X size={14} /> Effacer
          </button>
        )}
      </div>

      {/* CHARGE DU JOUR : seulement les livreurs qui ont des colis */}
      {ridersWithLoad.length > 0 && viewMode !== "history" && (
        <div className="dlv-riders">
          <span className="dlv-riders-label">Charge du jour</span>
          <div className="dlv-riders-list">
            {ridersWithLoad.map((driver) => {
              const dayStats = riderDayStats[driver.id];
              const loadTone = dayStats.count >= 16 ? "heavy" : dayStats.count >= 10 ? "medium" : "light";
              const isActive = filterDeliveryman === driver.id;
              return (
                <button
                  key={driver.id}
                  type="button"
                  className={`dlv-rider ${loadTone} ${isActive ? "active" : ""}`}
                  onClick={() => setFilterDeliveryman(isActive ? "ALL" : driver.id)}
                  title={`${isActive ? "Retirer le filtre" : "Afficher les colis de"} ${driver.name}${dayStats.alerts ? ` - ${dayStats.alerts} alerte(s)` : ""}`}
                >
                  <span>{driver.name}</span>
                  {dayStats.alerts > 0 && <AlertTriangle size={12} />}
                  <strong>{dayStats.count}</strong>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* BULK ACTION BAR */}
      {selectedIds.size > 0 && (
        <div className="bulk-bar animate-slide-up">
          <div className="bulk-info">
            <Check size={18} />
            <span>{selectedIds.size} colis sélectionné(s)</span>
          </div>
          <div className="bulk-actions">
            <select
              className="bulk-select"
              onChange={(e) => handleBulkAssign(e.target.value)}
              value=""
            >
              <option value="" disabled>Déplacer / attribuer vers...</option>
              <option value="unassigned">Désattribuer (remettre en attente)</option>
              <RiderOptions deliverymen={deliverymen} activeRiderIds={activeRiderIds} counts={riderLiveCounts} />
            </select>
            <button className="bulk-cancel" onClick={() => setSelectedIds(new Set())}>Annuler</button>
          </div>
        </div>
      )}

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
                              disabled={isPending}
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
                              <option value="unassigned">Désattribuer</option>
                              <RiderOptions deliverymen={deliverymen} activeRiderIds={activeRiderIds} counts={riderLiveCounts} />
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

      {/* DISPATCH VIEW */}
      {viewMode === "dispatch" && (
        <div className="dispatch-layout">
          <div className={`dispatch-main ${riskOrders.length === 0 ? "no-risk" : ""}`}>
            {riskOrders.length > 0 && (
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
              </div>
            </section>
            )}

            <section className="dispatch-board">
              <div className="dispatch-board-header">
                <div>
                  <h3>Repartition par livreur</h3>
                  <p>{boardRiders.length} livreur(s) avec des colis{hiddenBoardRiders > 0 ? ` · ${hiddenBoardRiders} sans colis masque(s)` : ""}</p>
                </div>
                <div className="dispatch-board-actions">
                  <button type="button" className="dispatch-auto-btn is-ghost" onClick={handleAudit} disabled={isPending}>
                    <ShieldCheck size={15} /> Controler
                  </button>
                  <button
                    type="button"
                    className="dispatch-auto-btn"
                    onClick={handleAutoAssign}
                    disabled={isPending || autoAssignableOrders.length === 0}
                  >
                    <Zap size={15} /> Repartir auto
                  </button>
                </div>
              </div>

              <div className="dispatch-columns">
                <div className="dispatch-column unassigned-col">
                  <div className="dispatch-column-title">
                    <UserPlus size={16} />
                    <span>Non attribuees</span>
                    <ColumnSelect orders={groupedByDriver["unassigned"]} selectedIds={selectedIds} onChange={setSelectedIds} />
                    <b>{groupedByDriver["unassigned"].length}</b>
                  </div>
                  <div className="order-cards-list">
                    {groupedByDriver["unassigned"].map(order => (
                      <OrderMiniCard key={order.id} order={order} deliverymen={deliverymen} activeRiderIds={activeRiderIds} onAssign={handleAssign} riderLiveCounts={riderLiveCounts} selected={selectedIds.has(order.id)} onToggle={toggleSelect} />
                    ))}
                    {groupedByDriver["unassigned"].length === 0 && <div className="empty-col">Tout est attribue</div>}
                  </div>
                </div>

                {boardRiders.map(driver => (
                  <div key={driver.id} className="dispatch-column">
                    <div className="dispatch-column-title">
                      <div className="driver-avatar-small">{driver.name.charAt(0)}</div>
                      <span>{driver.name}</span>
                      <ColumnSelect orders={groupedByDriver[driver.id] || []} selectedIds={selectedIds} onChange={setSelectedIds} />
                      <b>{groupedByDriver[driver.id]?.length || 0}</b>
                    </div>
                    <div className="order-cards-list">
                      {groupedByDriver[driver.id]?.map(order => (
                        <OrderMiniCard key={order.id} order={order} deliverymen={deliverymen} activeRiderIds={activeRiderIds} onAssign={handleAssign} riderLiveCounts={riderLiveCounts} selected={selectedIds.has(order.id)} onToggle={toggleSelect} />
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
        dispatchRequest && (
          <DeliveryDispatchModal
            date={dispatchRequest.date}
            orderIds={dispatchRequest.orderIds}
            actions={demoActions?.dispatch}
            onClose={() => {
              setDispatchRequest(null);
              router.refresh();
            }}
            onApplied={(assignedCount) => {
              setSelectedIds(new Set());
              showToast(`${assignedCount} commande(s) attribuee(s) automatiquement`, "success");
            }}
            onOpenAudit={() => {
              setAuditDate(dispatchRequest.date);
              setDispatchRequest(null);
              router.refresh();
            }}
          />
        )
      }

      {
        auditDate && (
          <DeliveryDispatchAuditModal
            date={auditDate}
            actions={demoActions?.audit}
            onClose={() => {
              setAuditDate(null);
              router.refresh();
            }}
            onApplied={(correctedCount) => {
              setSelectedIds(new Set());
              showToast(`${correctedCount} colis corrige(s)`, "success");
            }}
          />
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

/** Coche / decoche tous les colis attribuables d'une colonne. */
function ColumnSelect({ orders, selectedIds, onChange }: { orders: DeliveryAdminOrder[]; selectedIds: Set<string>; onChange: (ids: Set<string>) => void }) {
  const ids = orders.filter(canAssignDeliveryOrder).map((order) => order.id);
  if (ids.length === 0) return null;
  const allSelected = ids.every((id) => selectedIds.has(id));
  return (
    <button
      type="button"
      className="column-select"
      onClick={() => {
        const next = new Set(selectedIds);
        ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
        onChange(next);
      }}
      title={allSelected ? "Tout désélectionner" : "Tout sélectionner"}
    >
      {allSelected ? "Aucun" : "Tous"}
    </button>
  );
}

function OrderMiniCard({ order, deliverymen, activeRiderIds, onAssign, riderLiveCounts, selected, onToggle }: { order: DeliveryAdminOrder, deliverymen: Deliveryman[], activeRiderIds: Set<string>, onAssign: (oid: string, did: string) => void, riderLiveCounts: Record<string, number>, selected: boolean, onToggle: (id: string) => void }) {
  const isAssignable = canAssignDeliveryOrder(order);
  const risks = getOrderRisks(order);

  return (
    <div className={`order-mini-card ${selected ? "is-selected" : ""}`}>
      <div className="card-header">
        <label className="mini-select">
          <input
            type="checkbox"
            checked={selected}
            disabled={!isAssignable}
            onChange={() => onToggle(order.id)}
            aria-label={`Sélectionner ${order.ref}`}
          />
          <span className="order-ref">{order.ref}</span>
        </label>
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
          <option value="unassigned">Désattribuer</option>
          <RiderOptions deliverymen={deliverymen} activeRiderIds={activeRiderIds} counts={riderLiveCounts} />
        </select>
      </div>

    </div>
  );
}
