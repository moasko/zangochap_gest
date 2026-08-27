"use client";
import React, {
  useState,
  useMemo,
  useCallback,
  useTransition,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  TableCard,
  StatusBadge,
  EmptyState,
  DetailCard,
  ItemLine,
  InfoBanner,
  SectionLabel,
} from "@/components/UI";
import Modal from "@/components/Modal";
import WhatsAppSendModal from "./_components/WhatsAppSendModal";
import { useToast } from "@/components/Toast";
import {
  updateOrderStatus,
  duplicateOrder,
  deleteOrder,
  createOrder,
  addOrderHistoryEntry,
  updateOrderDetails,
  assignOrderToDeliveryman,
  reprogramOrder,
} from "@/modules/orders/actions";
import {
  formatPrice,
  formatDay,
  formatDate,
  CATEGORIES,
  COMMUNES,
  STATUS_LABELS,
  DELIVERY_FEES,
} from "@/lib/constants";
import { getImageUrl } from "@/lib/utils";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Eye,
  Package,
  Trash2,
  Minus,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Copy,
  Edit3,
  Maximize,
  AlertTriangle,
  Phone,
  Save,
  Edit2,
  Download,
  MessageCircle,
  Printer,
  Truck,
  Check,
  ArrowLeftRight,
  Ban,
  Users,
  Calendar,
  CalendarClock,
  MoreHorizontal,
  CreditCard,
} from "lucide-react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import Link from "next/link";

import Script from "next/script";

import VariantSelectionModal from "@/components/VariantSelectionModal";

import ProductCard from "@/components/ProductCard";

import ReceiptModal from "@/components/ReceiptModal";

import "./dashboard.css";

const ZANGOCHAP_LOGO_SVG = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">















  <path d="M 70 60 Q 70 35 100 35 Q 130 35 130 60" stroke="#D4541C" stroke-width="9" fill="none" stroke-linecap="round"/>















  <path d="M 50 60 L 150 60 L 165 175 L 35 175 Z" fill="#D4541C"/>















  <path d="M 75 90 L 90 80 L 110 80 L 125 90 L 130 105 L 120 105 L 120 145 L 80 145 L 80 105 L 70 105 Z" fill="#FFFFFF"/>















  <path d="M 90 80 Q 100 87 110 80" stroke="#D4541C" stroke-width="2" fill="none"/>















</svg>`;

const ITEMS_PER_PAGE = 25;

interface OrdersClientProps {
  initialOrders: any[];

  products: any[];

  deliverymen?: any[];

  staffUsers?: any[];

  user: any;

  totalCount: number;

  currentPage: number;

  pageSize: number;

  statusCounts?: Record<string, number>;

  todayStr?: string;
}

export default function OrdersClient({
  initialOrders,

  products,

  deliverymen = [],

  staffUsers = [],

  user,

  totalCount,

  currentPage: serverPage,

  pageSize,

  statusCounts = {},

  todayStr: serverTodayStr,
}: OrdersClientProps) {
  const router = useRouter();

  const searchParams = useSearchParams();

  // -- Sync local state with URL --

  const [filter, setFilter] = useState(searchParams.get("status") || "all");

  const [communeFilter, setCommuneFilter] = useState(
    searchParams.get("commune") || "all",
  );

  const [scope, setScope] = useState(
    searchParams.get("scope") || (user?.role === "commercial" ? "mine" : "all"),
  );

  const todayStr = serverTodayStr || new Date().toISOString().split("T")[0];

  const [dateFrom, setDateFrom] = useState(
    searchParams.get("from") === null
      ? todayStr
      : searchParams.get("from") || "",
  );

  const [dateTo, setDateTo] = useState(
    searchParams.get("to") === null ? todayStr : searchParams.get("to") || "",
  );

  const [dateType, setDateType] = useState(
    searchParams.get("dateType") || "created",
  );

  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");

  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);

  const queryClient = useQueryClient();

  const page = parseInt(searchParams.get("page") || "1");

  const queryKey = useMemo(
    () => [
      "orders",
      {
        filter,
        communeFilter,
        scope,
        dateFrom,
        dateTo,
        dateType,
        debouncedSearch,
        page,
      },
    ],
    [
      filter,
      communeFilter,
      scope,
      dateFrom,
      dateTo,
      dateType,
      debouncedSearch,
      page,
    ],
  );

  // React Query for Orders

  const {
    data: queryData,
    isLoading: queryLoading,
    isFetching: queryFetching,
  } = useQuery({
    queryKey,

    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),

        status: filter,

        commune: communeFilter,

        scope,

        from: dateFrom,

        to: dateTo,

        dateType,

        q: debouncedSearch,
      });

      const res = await fetch(`/api/orders?${params.toString()}`);

      if (!res.ok) throw new Error("Erreur de chargement");

      return res.json();
    },

    initialData: { orders: initialOrders, totalCount },

    refetchInterval: 10000, // 10s auto-refresh for near real-time

    staleTime: 0,
  });

  const orders = useMemo(
    () => queryData?.orders || initialOrders,
    [queryData, initialOrders],
  );

  const currentTotalCount = queryData?.totalCount || totalCount;

  // Mutations

  const statusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const result = await updateOrderStatus(orderId, status);
      if (!result.success) throw new Error(result.error);
      return result;
    },

    // Optimistic Update

    onMutate: async ({ orderId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });

      const previousData = queryClient.getQueryData(["orders", queryKey[1]]);

      queryClient.setQueryData(["orders", queryKey[1]], (old: any) => {
        if (!old) return old;

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        return {
          ...old,

          orders: old.orders.map((o: any) =>
            o.id === orderId
              ? {
                ...o,
                status,
                ...(status === "REPRO_DISPO" ? { deliveryDate: tomorrow } : {}),
              }
              : o,
          ),
        };
      });

      return { previousData };
    },

    onSuccess: () => {
      showToast("Statut mis à jour ✓", "success");
    },

    onError: (err, variables, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["orders", queryKey[1]], context.previousData);
      }

      if (reloadOnStaleServerAction(err)) return;
      showToast(err.message || "Erreur", "error");
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (orderId: string) => deleteOrder(orderId),

    onMutate: async (orderId) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });

      const previousData = queryClient.getQueryData(["orders", queryKey[1]]);

      queryClient.setQueryData(["orders", queryKey[1]], (old: any) => {
        if (!old) return old;

        return {
          ...old,

          orders: old.orders.filter((o: any) => o.id !== orderId),
        };
      });

      return { previousData };
    },

    onSuccess: () => {
      showToast("Commande supprimée ✓", "success");

      setSelectedOrder(null);
    },

    onError: (err, variables, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["orders", queryKey[1]], context.previousData);
      }

      if (reloadOnStaleServerAction(err)) return;
      showToast(err.message || "Erreur", "error");
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const updateDetailsMutation = useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) =>
      updateOrderDetails(orderId, data),

    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });

      showToast("Détails mis à jour ✓", "success");

      if (selectedOrder?.id === variables.orderId) {
        setSelectedOrder({ ...selectedOrder, ...variables.data });
      }
    },

    onError: (e: any) => {
      if (reloadOnStaleServerAction(e)) return;
      showToast(e.message || "Erreur", "error");
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({
      orderId,
      deliverymanId,
    }: {
      orderId: string;
      deliverymanId: string;
    }) => assignOrderToDeliveryman(orderId, deliverymanId),

    onMutate: async ({ orderId, deliverymanId }) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });

      const previousData = queryClient.getQueryData(["orders", queryKey[1]]);

      const deliveryman = deliverymen.find((d) => d.id === deliverymanId);

      queryClient.setQueryData(["orders", queryKey[1]], (old: any) => {
        if (!old) return old;

        return {
          ...old,

          orders: old.orders.map((o: any) =>
            o.id === orderId
              ? {
                ...o,

                deliverymanId,

                deliverymanName: deliveryman?.name || "Assigné",

                status: o.status === "PACKED" ? "ON_DELIVERY" : o.status,
              }
              : o,
          ),
        };
      });

      return { previousData };
    },

    onSuccess: () => {
      showToast("Livreur assigné ✓", "success");

      setSelectedOrder(null);
    },

    onError: (err, variables, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["orders", queryKey[1]], context.previousData);
      }

      if (reloadOnStaleServerAction(err)) return;
      showToast(err.message || "Erreur", "error");
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const reproDispoMutation = useMutation({
    mutationFn: ({
      orderId,
      deliveryDate,
      note,
    }: {
      orderId: string;
      deliveryDate: string;
      note: string;
    }) => updateOrderStatus(orderId, "REPRO_DISPO", note, undefined, deliveryDate),

    onMutate: async ({ orderId, deliveryDate }) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });

      const previousData = queryClient.getQueryData(["orders", queryKey[1]]);

      queryClient.setQueryData(["orders", queryKey[1]], (old: any) => {
        if (!old) return old;

        const nextDate = new Date(deliveryDate);
        return {
          ...old,

          orders: old.orders.map((o: any) =>
            o.id === orderId
              ? { ...o, status: "REPRO_DISPO", deliveryDate: nextDate }
              : o,
          ),
        };
      });

      return { previousData };
    },

    onSuccess: () => {
      showToast("Commande mise en repro-dispo ✓", "success");

      setSelectedOrder(null);
    },

    onError: (err, variables, context: any) => {
      if (context?.previousData) {
        queryClient.setQueryData(["orders", queryKey[1]], context.previousData);
      }

      if (reloadOnStaleServerAction(err)) return;
      showToast(err.message || "Erreur", "error");
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  const [isEditing, setIsEditing] = useState(false);

  const [orderToDuplicate, setOrderToDuplicate] = useState<any>(null);

  const [orderToExchange, setOrderToExchange] =
    useState<typeof orderToDuplicate>(null);

  const [orderToReprogram, setOrderToReprogram] =
    useState<typeof orderToDuplicate>(null);

  const [orderToEdit, setOrderToEdit] = useState<any>(null);

  const [receiptOrder, setReceiptOrder] = useState<any>(null);

  // Commande pour laquelle le modal d'envoi WhatsApp (apercu + API) est ouvert.
  const [whatsAppOrder, setWhatsAppOrder] = useState<any>(null);

  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const { showToast } = useToast();

  // Debounced search — 300ms delay

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync state to URL when filters change

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;

      return;
    }

    const params = new URLSearchParams(searchParams.toString());

    if (filter !== "all") params.set("status", filter);
    else params.delete("status");

    if (communeFilter !== "all") params.set("commune", communeFilter);
    else params.delete("commune");

    if (scope !== (user?.role === "commercial" ? "mine" : "all"))
      params.set("scope", scope);
    else params.delete("scope");

    // Recherche active + plage par défaut (aujourd'hui) : on retire les dates
    // pour chercher sur tout l'historique — sinon une ref d'un autre jour est introuvable.
    const searchAllDates =
      Boolean(debouncedSearch) &&
      dateFrom === todayStr &&
      (dateTo === todayStr || !dateTo);

    if (searchAllDates) {
      params.delete("from");
      params.delete("to");
    } else {
      if (dateFrom !== null && searchParams.get("from") !== dateFrom)
        params.set("from", dateFrom);

      if (dateTo !== null && searchParams.get("to") !== dateTo)
        params.set("to", dateTo);
    }

    if (dateType !== "created") params.set("dateType", dateType);
    else params.delete("dateType");

    if (debouncedSearch) params.set("q", debouncedSearch);
    else params.delete("q");

    // Always reset to page 1 on filter change

    params.set("page", "1");

    router.push(`?${params.toString()}`);
  }, [
    filter,
    communeFilter,
    scope,
    dateFrom,
    dateTo,
    dateType,
    debouncedSearch,
    todayStr,
    router,
    searchParams,
    user?.role,
  ]);

  // Handle auto-print from URL

  useEffect(() => {
    const printId = searchParams.get("print");

    if (printId && orders.length > 0) {
      const order = orders.find((o: any) => o.id === printId);

      if (order) {
        setReceiptOrder(order);

        // Remove print from URL without full reload to clean up

        const params = new URLSearchParams(searchParams.toString());

        params.delete("print");

        window.history.replaceState(null, "", `?${params.toString()}`);
      }
    }
  }, [searchParams, orders]);

  useEffect(() => {
    if (!selectedOrder) return;

    const freshOrder = orders.find((o: any) => o.id === selectedOrder.id);

    if (freshOrder && freshOrder !== selectedOrder) {
      setSelectedOrder(freshOrder);
    }
  }, [orders, selectedOrder]);

  // Handle page change specifically

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());

    params.set("page", page.toString());

    router.push(`?${params.toString()}`);
  };

  const setQuickDate = (
    range: "today" | "yesterday" | "week" | "month" | "lastMonth" | "all",
  ) => {
    const now = new Date();

    let from = "";

    let to = now.toISOString().split("T")[0];

    if (range === "today") {
      from = to;
    } else if (range === "yesterday") {
      const y = new Date();

      y.setDate(y.getDate() - 1);

      from = y.toISOString().split("T")[0];

      to = from;
    } else if (range === "week") {
      const w = new Date();

      w.setDate(w.getDate() - 7);

      from = w.toISOString().split("T")[0];
    } else if (range === "month") {
      from = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split("T")[0];
    } else if (range === "lastMonth") {
      const lmFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const lmTo = new Date(now.getFullYear(), now.getMonth(), 0);

      from = lmFrom.toISOString().split("T")[0];

      to = lmTo.toISOString().split("T")[0];
    } else if (range === "all") {
      from = "";

      to = "";
    }

    setDateFrom(from);

    setDateTo(to);
  };

  const paginatedOrders = orders;

  const totalPages = Math.ceil(currentTotalCount / pageSize);

  const currentPage = serverPage;

  const handleStatusChange = useCallback(
    (orderId: string, status: string) => {
      statusMutation.mutate({ orderId, status });
    },
    [statusMutation],
  );

  const handleReproDispo = useCallback(
    (orderId: string, deliveryDate: string, note: string) => {
      reproDispoMutation.mutate({ orderId, deliveryDate, note });
    },
    [reproDispoMutation],
  );

  const handleReprogram = useCallback(
    (orderId: string, data: any) => {
      startTransition(async () => {
        try {
          await reprogramOrder(orderId, data);
          showToast("Commande reprogrammée créée ✓", "success");
          setOrderToReprogram(null);
          setSelectedOrder(null);
          queryClient.invalidateQueries({ queryKey: ["orders"] });
        } catch (e: any) {
          if (reloadOnStaleServerAction(e)) return;
          showToast(e.message || "Erreur", "error");
        }
      });
    },
    [showToast, queryClient],
  );

  const handleDuplicate = useCallback(
    (orderId: string, data: any) => {
      startTransition(async () => {
        try {
          await duplicateOrder(orderId, data);

          showToast("Commande dupliquée ✓", "success");

          setOrderToDuplicate(null);
          setOrderToExchange(null);

          queryClient.invalidateQueries({ queryKey: ["orders"] });
        } catch (e: any) {
          if (reloadOnStaleServerAction(e)) return;
          showToast(e.message || "Erreur", "error");
        }
      });
    },
    [showToast, queryClient],
  );

  const handleUpdateDetails = useCallback(
    (orderId: string, data: any) => {
      updateDetailsMutation.mutate({ orderId, data });
    },
    [updateDetailsMutation],
  );

  const handleDelete = useCallback(
    (orderId: string) => {
      if (!confirm("Supprimer cette commande ?")) return;

      deleteMutation.mutate(orderId);
    },
    [deleteMutation],
  );

  const handleAssign = useCallback(
    (orderId: string, deliverymanId: string) => {
      assignMutation.mutate({ orderId, deliverymanId });
    },
    [assignMutation],
  );

  const handleWhatsApp = useCallback(
    (order: any) => {
      if (!order.customerPhone) {
        showToast("Numéro de téléphone manquant", "error");

        return;
      }

      const totalAmount =
        (order.total || 0) + (order.deliveryFee || 0) - (order.discount || 0);

      const names = (order.customerName || "").trim().split(/\s+/);

      const lastName = names[0] || "";

      const firstName = names.slice(1).join(" ") || "—";

      const itemsList = order.items
        .map((i: any) => `${i.name} (${i.size}/${i.color}) x${i.qty}`)
        .join("\n");

      const msg = `🎉 *Votre commande est validée !*















Veuillez vérifier vos informations enregistrées pour la commande















Nom: ${lastName}















Prenom: ${firstName}































Numéro joignable 1: ${order.customerPhone}































Numéro joignable 2 : ${order.customerPhone2 || "—"}































Lieu de livraison : ${order.customerLocation} (${order.commune})































Nom du produit :















${itemsList}































Prix total: ${totalAmount.toLocaleString("fr-FR")} FCFA































1️⃣ Téléchargez l’application dès maintenant en cliquant ici 👇🏾:















📲 *Android* : https://play.google.com/store/apps/details?id=com.zangochap.zangochap&pcampaignid=web_share































🍏 iPhone : https://apps.apple.com/ci/app/zangochap/id6737241287































2️⃣ Envoyez-nous une capture d’écran de l’application installée pour activer votre surprise .































Ne passez pas à côté de cette belle surprise ! 😍🔥`;

      let phone = order.customerPhone.replace(/[^0-9]/g, "");

      if (phone.startsWith("0")) phone = "225" + phone.substring(1);
      else if (!phone.startsWith("225") && phone.length === 10)
        phone = "225" + phone;

      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,
        "_blank",
      );

      startTransition(async () => {
        await addOrderHistoryEntry(
          order.id,
          `Récapitulatif WhatsApp envoyé par ${user?.name}`,
        );
      });

      showToast("WhatsApp ouvert ✓", "success");
    },
    [user, showToast],
  );

  const handlePrintReceipt = useCallback(
    (order: any, format: "a4" | "a6" | "thermal") => {
      const totalPayer =
        (order.total || 0) + (order.deliveryFee || 0) - (order.discount || 0);

      const dateStr = new Date(order.createdAt).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const itemsHtml = order.items
        .map(
          (i: any) => `















      <tr>















        <td style="padding:6px 4px;border-bottom:1px solid #eee">















          <strong>${i.name}</strong>















          ${i.isCustom ? '<span style="font-size:9px;background:#DCEAFC;color:#1F5C8C;padding:1px 5px;border-radius:3px;margin-left:4px">PERSO</span>' : ""}















          <div style="font-size:11px;color:#666;margin-top:2px">Taille ${i.size} · ${i.color}</div>















        </td>















        <td style="padding:6px 4px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>















        <td style="padding:6px 4px;border-bottom:1px solid #eee;text-align:right">${formatPrice(i.price)}</td>















        <td style="padding:6px 4px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${formatPrice(i.price * i.qty)}</td>















      </tr>















    `,
        )
        .join("");

      let html = "";

      const getTypeStyle = (type: string) => {
        const typeColors: Record<string, { bg: string; text: string }> = {
          Echange: { bg: "#F5F3FF", text: "#7C3AED" },

          Reprogrammé: { bg: "#EEF2FF", text: "#4F46E5" },

          Express: { bg: "#FEF2F2", text: "#EF4444" },

          Recuperation: { bg: "#F0FDF4", text: "#16A34A" },
        };

        return typeColors[type] || { bg: "#FFF8E1", text: "#B8860B" };
      };

      const typeStyle = order.type
        ? getTypeStyle(order.type)
        : { bg: "", text: "" };

      if (format === "a4") {
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reçu ${order.ref}</title>















      <style>















        @page { size: A4; margin: 12mm; }















        body { font-family: 'Helvetica', Arial, sans-serif; color: #1A1410; margin: 0; }















        .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #D4541C; margin-bottom: 18px; }















        .logo-block { display: flex; align-items: center; gap: 12px; }















        .logo-mark { width: 64px; height: 64px; }















        .logo-text { font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: #4A2E1F; line-height: 1; }















        .logo-sub { font-size: 11px; color: #6B4838; margin-top: 3px; }















        .receipt-title { text-align: right; }















        .receipt-title h1 { margin: 0; font-size: 22px; color: #D4541C; }















        .receipt-ref { font-family: monospace; font-size: 16px; font-weight: 700; color: #4A2E1F; }















        .receipt-label { display: inline-block; padding: 2px 10px; background: #FFF8E1; color: #B8860B; font-size: 10px; font-weight: 700; text-transform: uppercase; border-radius: 4px; margin-bottom: 4px; }















        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 18px; }















        .info-block h3 { font-size: 11px; color: #6B4838; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 6px 0; }















        .info-block p { margin: 2px 0; font-size: 13px; }















        .note-block { background: #FFF8E1; border-left: 3px solid #FFC107; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 12px; color: #4A2E1F; }















        table.items { width: 100%; border-collapse: collapse; margin: 18px 0; }















        table.items th { background: #FAF6F1; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #4A2E1F; border-bottom: 2px solid #D4541C; }















        table.items th.right { text-align: right; }















        table.items th.center { text-align: center; }















        .totals { margin-left: auto; width: 280px; margin-top: 8px; }















        .totals tr td { padding: 6px 8px; }















        .totals tr.grand td { border-top: 2px solid #1A1410; font-weight: 700; font-size: 18px; color: #D4541C; padding-top: 12px; }















        .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #E8DDD0; font-size: 11px; color: #6B4838; text-align: center; }















        .footer .commercial-block { background: #FAF6F1; padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; font-size: 12px; color: #4A2E1F; }















        .footer .commercial-block strong { color: #D4541C; }















      </style></head><body>















        <div class="header">















          <div class="logo-block">















            <div class="logo-mark">${ZANGOCHAP_LOGO_SVG}</div>















            <div>















              <div class="logo-text">zangochap</div>















              <div class="logo-sub">mieux s'habiller à bas prix · Abidjan</div>















            </div>















          </div>















          <div class="receipt-title">















            ${order.type && order.type !== "Standard" ? `<div class="receipt-label" style="background:${typeStyle.bg};color:${typeStyle.text};">${order.type}</div><br>` : ""}















            <h1>REÇU</h1>















            <div class="receipt-ref">${order.ref}</div>















            <div style="font-size:11px;color:#666;margin-top:2px">${dateStr}</div>















          </div>















        </div>















        <div class="grid2">















          <div class="info-block">















            <h3>Client</h3>















            <p><strong>${order.customerName}</strong></p>















            <p>📞 ${order.customerPhone}</p>















            ${order.customerPhone2 ? `<p>📞 ${order.customerPhone2}</p>` : ""}















          </div>















          <div class="info-block">















            <h3>Livraison</h3>















            <p>${order.customerLocation || ""}</p>















            <p style="color:#D4541C;font-weight:600">${order.commune || ""}</p>















            ${order.deliveryNote ? `<p style="font-style:italic;color:#666">Note livreur : ${order.deliveryNote}</p>` : ""}















          </div>















        </div>















        ${order.notes ? `<div class="note-block"><strong>📝 Note :</strong> ${order.notes}</div>` : ""}















        <table class="items">















          <thead><tr>















            <th>Article</th><th class="center">Qté</th><th class="right">P.U.</th><th class="right">Total</th>















          </tr></thead>















          <tbody>${itemsHtml}</tbody>















        </table>















        <table class="totals">















          <tr><td>Sous-total</td><td style="text-align:right">${formatPrice(order.total)}</td></tr>















          <tr><td>Livraison</td><td style="text-align:right">${formatPrice(order.deliveryFee || 0)}</td></tr>















          ${order.discount > 0 ? `<tr><td>Remise</td><td style="text-align:right">-${formatPrice(order.discount)}</td></tr>` : ""}















          <tr class="grand"><td>TOTAL À PAYER</td><td style="text-align:right">${formatPrice(totalPayer)}</td></tr>















          <tr><td colspan="2" style="text-align:center;padding-top:8px;font-size:11px;color:#6B4838">💵 Paiement à la livraison</td></tr>















        </table>















        <div class="footer">















          <div class="commercial-block">















            Commande traitée par <strong>${order.commercialName || "—"}</strong>















          </div>















          <p>Merci pour votre confiance ! En cas d'erreur, contactez-nous immédiatement.</p>















          <p style="margin-top:6px">zangochap.com</p>















        </div>















      </body></html>`;
      } else if (format === "a6") {
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reçu ${order.ref}</title>















      <style>















        @page { size: A6 portrait; margin: 6mm; }















        body { font-family: 'Helvetica', Arial, sans-serif; color: #1A1410; margin: 0; font-size: 11px; }















        .header { text-align: center; padding-bottom: 8px; border-bottom: 2px solid #D4541C; margin-bottom: 10px; }















        .logo-mark { width: 36px; height: 36px; margin: 0 auto 4px; }















        .logo-text { font-family: Georgia, serif; font-size: 18px; font-weight: 700; color: #D4541C; }















        .ref { font-family: monospace; font-size: 13px; font-weight: 700; margin-top: 2px; }















        .label-tag { display: inline-block; padding: 1px 8px; background: #FFF8E1; color: #B8860B; font-size: 9px; font-weight: 700; text-transform: uppercase; border-radius: 3px; margin-bottom: 2px; }















        .meta { font-size: 9px; color: #666; margin-top: 2px; }















        .info { margin: 8px 0; line-height: 1.4; }















        .info strong { color: #D4541C; }















        .note { background: #FFF8E1; padding: 5px 8px; border-radius: 4px; margin: 6px 0; font-size: 10px; }















        table { width: 100%; border-collapse: collapse; font-size: 10px; margin: 8px 0; }















        th { background: #FAF6F1; padding: 4px; border-bottom: 1px solid #D4541C; text-align: left; font-size: 9px; text-transform: uppercase; }















        td { padding: 3px 4px; border-bottom: 1px dashed #ccc; }















        .total { margin-top: 8px; padding-top: 6px; border-top: 1px solid #1A1410; }















        .total-row { display: flex; justify-content: space-between; padding: 2px 0; }















        .total-row.grand { font-size: 13px; font-weight: 700; color: #D4541C; padding-top: 4px; border-top: 1px solid #D4541C; margin-top: 4px; }















        .footer { text-align: center; margin-top: 10px; font-size: 9px; color: #6B4838; }















        .footer strong { color: #D4541C; }















      </style></head><body>















        <div class="header">















          <div class="logo-mark">${ZANGOCHAP_LOGO_SVG}</div>















          <div class="logo-text">zangochap</div>















          ${order.type && order.type !== "Standard" ? `<div class="label-tag" style="background:${typeStyle.bg};color:${typeStyle.text};">${order.type}</div><br>` : ""}















          <div class="ref">${order.ref}</div>















          <div class="meta">${dateStr}</div>















        </div>















        <div class="info">















          <strong>${order.customerName}</strong><br>















          📞 ${order.customerPhone}${order.customerPhone2 ? " / " + order.customerPhone2 : ""}<br>















          📍 ${order.customerLocation || ""} (${order.commune || ""})















        </div>















        ${order.notes ? `<div class="note">📝 ${order.notes}</div>` : ""}















        <table>















          <thead><tr><th>Article</th><th style="text-align:center">Qté</th><th style="text-align:right">Prix</th></tr></thead>















          <tbody>















            ${order.items
            .map(
              (i: any) => `















              <tr>















                <td>${i.name}<br><span style="font-size:8px;color:#666">${i.size} · ${i.color}</span></td>















                <td style="text-align:center">${i.qty}</td>















                <td style="text-align:right">${formatPrice(i.price * i.qty)}</td>















              </tr>















            `,
            )
            .join("")}















          </tbody>















        </table>















        <div class="total">















          <div class="total-row"><span>Sous-total</span><span>${formatPrice(order.total)}</span></div>















          <div class="total-row"><span>Livraison</span><span>${formatPrice(order.deliveryFee || 0)}</span></div>















          ${order.discount > 0 ? `<div class="total-row"><span>Remise</span><span>-${formatPrice(order.discount)}</span></div>` : ""}















          <div class="total-row grand"><span>À PAYER</span><span>${formatPrice(totalPayer)}</span></div>















          <div style="text-align:center;font-size:9px;margin-top:4px;color:#666">💵 Paiement à la livraison</div>















        </div>















        <div class="footer">















          Servi par <strong>${order.commercialName || "—"}</strong>















          <br>Merci pour votre confiance ! 🧡















        </div>















      </body></html>`;
      } else if (format === "thermal") {
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reçu ${order.ref}</title>















      <style>















        @page { size: 80mm auto; margin: 3mm; }















        body { font-family: 'Courier New', monospace; color: #000; margin: 0; font-size: 11px; line-height: 1.3; width: 74mm; }















        .center { text-align: center; }















        .right { text-align: right; }















        .bold { font-weight: 700; }















        .big { font-size: 14px; font-weight: 700; }















        .logo-mark { width: 40px; height: 40px; margin: 0 auto 4px; display: block; }















        .label-tag { display: inline-block; padding: 1px 8px; background: #000; color: #fff; font-size: 10px; font-weight: 700; }















        .sep { border-top: 1px dashed #000; margin: 6px 0; }















        .row { display: flex; justify-content: space-between; padding: 1px 0; }















        .item { margin: 4px 0; }















        .item-name { font-weight: 700; }















        .item-meta { font-size: 9px; color: #333; }















        .grand { font-size: 14px; font-weight: 700; }















        .note-box { border: 1px dashed #000; padding: 4px 6px; margin: 4px 0; font-size: 10px; }















      </style></head><body>















        <div class="center">















          <div class="logo-mark">${ZANGOCHAP_LOGO_SVG}</div>















          <div class="big">ZANGOCHAP</div>















          <div style="font-size:9px">mieux s'habiller à bas prix</div>















          <div style="font-size:9px">Abidjan, Côte d'Ivoire</div>















        </div>















        <div class="sep"></div>















        ${order.type && order.type !== "Standard" ? `<div class="center"><span class="label-tag" style="background:${typeStyle.bg};color:${typeStyle.text};">${order.type}</span></div>` : ""}















        <div class="center bold" style="margin-top:4px">${order.ref}</div>















        <div class="center" style="font-size:9px">${dateStr}</div>















        <div class="sep"></div>















        <div><strong>${order.customerName}</strong></div>















        <div>Tel: ${order.customerPhone}</div>















        ${order.customerPhone2 ? `<div>Tel2: ${order.customerPhone2}</div>` : ""}















        <div>${order.customerLocation || ""}</div>















        <div class="bold">${order.commune || ""}</div>















        ${order.notes ? `<div class="note-box"><strong>NOTE:</strong> ${order.notes}</div>` : ""}















        <div class="sep"></div>















        ${order.items
            .map(
              (i: any) => `















          <div class="item">















            <div class="item-name">${i.name}</div>















            <div class="item-meta">${i.size} · ${i.color}</div>















            <div class="row">















              <span>${i.qty} x ${formatPrice(i.price)}</span>















              <span class="bold">${formatPrice(i.price * i.qty)}</span>















            </div>















          </div>















        `,
            )
            .join("")}















        <div class="sep"></div>















        <div class="row"><span>Sous-total</span><span>${formatPrice(order.total)}</span></div>















        <div class="row"><span>Livraison</span><span>${formatPrice(order.deliveryFee || 0)}</span></div>















        ${order.discount > 0 ? `<div class="row"><span>Remise</span><span>-${formatPrice(order.discount)}</span></div>` : ""}















        <div class="sep"></div>















        <div class="row grand"><span>TOTAL</span><span>${formatPrice(totalPayer)}</span></div>















        <div class="center" style="margin-top:4px;font-size:10px">PAIEMENT A LA LIVRAISON</div>















        <div class="sep"></div>















        <div class="center" style="font-size:9px">















          Servi par ${order.commercialName || "—"}<br>















          Merci pour votre confiance !















        </div>















      </body></html>`;
      }

      const win = window.open("", "_blank", "width=800,height=600");

      if (!win) {
        showToast(
          "Le navigateur a bloqué la fenêtre. Autorise les pop-ups.",
          "error",
        );

        return;
      }

      win.document.write(html);

      win.document.close();

      win.focus();

      setTimeout(() => {
        win.print();

        startTransition(async () => {
          await addOrderHistoryEntry(
            order.id,
            `Reçu imprimé au format ${format.toUpperCase()} (par ${user?.name})`,
          );
        });
      }, 500);
    },
    [user, showToast],
  );

  const handleDownloadPDF = useCallback(
    (order: any) => {
      if (typeof (window as any).html2pdf === "undefined") {
        showToast("La librairie PDF est en cours de chargement...", "success");

        return;
      }

      showToast("Génération du PDF en cours...", "success");

      const totalPayer =
        (order.total || 0) + (order.deliveryFee || 0) - (order.discount || 0);

      const dateStr = new Date(order.createdAt).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const itemsHtml = order.items
        .map(
          (i: any) => `















      <tr>















        <td style="padding:6px 4px;border-bottom:1px solid #eee">















          <strong>${i.name}</strong>















          ${i.isCustom ? '<span style="font-size:9px;background:#DCEAFC;color:#1F5C8C;padding:1px 5px;border-radius:3px;margin-left:4px">PERSO</span>' : ""}















          <div style="font-size:11px;color:#666;margin-top:2px">Taille ${i.size} · ${i.color}</div>















        </td>















        <td style="padding:6px 4px;border-bottom:1px solid #eee;text-align:center">${i.qty}</td>















        <td style="padding:6px 4px;border-bottom:1px solid #eee;text-align:right">${formatPrice(i.price)}</td>















        <td style="padding:6px 4px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${formatPrice(i.price * i.qty)}</td>















      </tr>















    `,
        )
        .join("");

      const getTypeStyle = (type: string) => {
        const typeColors: Record<string, { bg: string; text: string }> = {
          Echange: { bg: "#F5F3FF", text: "#7C3AED" },

          Reprogrammé: { bg: "#EEF2FF", text: "#4F46E5" },

          Express: { bg: "#FEF2F2", text: "#EF4444" },

          Recuperation: { bg: "#F0FDF4", text: "#16A34A" },
        };

        return typeColors[type] || { bg: "#FFF8E1", text: "#B8860B" };
      };

      const typeStyle = order.type
        ? getTypeStyle(order.type)
        : { bg: "", text: "" };

      const html = `















      <div style="font-family: 'Helvetica', Arial, sans-serif; color: #1A1410; background: white; padding: 20px;">















        <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #D4541C; margin-bottom: 18px;">















          <div style="display: flex; align-items: center; gap: 12px;">















            <div style="width: 64px; height: 64px;">${ZANGOCHAP_LOGO_SVG}</div>















            <div>















              <div style="font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: #4A2E1F; line-height: 1;">zangochap</div>















              <div style="font-size: 11px; color: #6B4838; margin-top: 3px;">mieux s'habiller à bas prix · Abidjan</div>















            </div>















          </div>















          <div style="text-align: right;">















            ${order.type && order.type !== "Standard" ? `<div style="display: inline-block; padding: 2px 8px; background: ${typeStyle.bg}; color: ${typeStyle.text}; font-size: 9px; font-weight: 800; text-transform: uppercase; border-radius: 4px; margin-bottom: 4px;">${order.type}</div><br>` : ""}















            <h1 style="margin: 0; font-size: 22px; color: #D4541C;">REÇU</h1>















            <div style="font-family: monospace; font-size: 16px; font-weight: 700; color: #4A2E1F;">${order.ref}</div>















            <div style="font-size:11px;color:#666;margin-top:2px">${dateStr}</div>















          </div>















        </div>















        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 18px;">















          <div>















            <h3 style="font-size: 11px; color: #6B4838; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 6px 0;">Client</h3>















            <p style="margin: 2px 0; font-size: 13px;"><strong>${order.customerName}</strong></p>















            <p style="margin: 2px 0; font-size: 13px;">📞 ${order.customerPhone}</p>















            ${order.customerPhone2 ? `<p style="margin: 2px 0; font-size: 13px;">📞 ${order.customerPhone2}</p>` : ""}















          </div>















          <div>















            <h3 style="font-size: 11px; color: #6B4838; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 6px 0;">Livraison</h3>















            <p style="margin: 2px 0; font-size: 13px;">${order.customerLocation || ""}</p>















            <p style="margin: 2px 0; font-size: 13px; color:#D4541C;font-weight:600">${order.commune || ""}</p>















            ${order.deliveryNote ? `<p style="font-style:italic;color:#666;font-size:12px">Note livreur : ${order.deliveryNote}</p>` : ""}















          </div>















        </div>















        ${order.notes ? `<div style="background: #FFF8E1; border-left: 3px solid #FFC107; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 12px; color: #4A2E1F;"><strong>📝 Note :</strong> ${order.notes}</div>` : ""}















        <table style="width: 100%; border-collapse: collapse; margin: 18px 0;">















          <thead><tr>















            <th style="background: #FAF6F1; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #4A2E1F; border-bottom: 2px solid #D4541C;">Article</th>















            <th style="background: #FAF6F1; padding: 8px; text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #4A2E1F; border-bottom: 2px solid #D4541C;">Qté</th>















            <th style="background: #FAF6F1; padding: 8px; text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #4A2E1F; border-bottom: 2px solid #D4541C;">P.U.</th>















            <th style="background: #FAF6F1; padding: 8px; text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #4A2E1F; border-bottom: 2px solid #D4541C;">Total</th>















          </tr></thead>















          <tbody>${itemsHtml}</tbody>















        </table>















        <div style="margin-left: auto; width: 280px; margin-top: 8px;">















          <div style="display: flex; justify-content: space-between; padding: 6px 8px;"><span>Sous-total</span><span>${formatPrice(order.total)}</span></div>















          <div style="display: flex; justify-content: space-between; padding: 6px 8px;"><span>Livraison</span><span>${formatPrice(order.deliveryFee || 0)}</span></div>















          ${order.discount > 0 ? `<div style="display: flex; justify-content: space-between; padding: 6px 8px; color: #2D7A4F;"><span>Remise</span><span>-${formatPrice(order.discount)}</span></div>` : ""}















          <div style="display: flex; justify-content: space-between; padding: 12px 8px; border-top: 2px solid #1A1410; font-weight: 700; font-size: 18px; color: #D4541C;"><span>TOTAL</span><span>${formatPrice(totalPayer)}</span></div>















        </div>















        <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #E8DDD0; font-size: 11px; color: #6B4838; text-align: center;">















          <p>Merci pour votre confiance ! En cas d'erreur, contactez-nous immédiatement.</p>















          <p style="margin-top:6px">zangochap.com</p>















        </div>















      </div>















    `;

      const container = document.createElement("div");

      container.style.position = "absolute";

      container.style.left = "-9999px";

      container.style.top = "0";

      container.style.width = "800px";

      container.innerHTML = html;

      document.body.appendChild(container);

      const filename = `Recu_${order.ref}_${order.customerName.split(" ")[0]}.pdf`;

      const opt = {
        margin: 10,

        filename: filename,

        image: { type: "jpeg", quality: 0.98 },

        html2canvas: { scale: 2, useCORS: true },

        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      };

      (window as any)
        .html2pdf()
        .from(container)
        .set(opt)
        .save()
        .then(() => {
          document.body.removeChild(container);

          showToast("PDF téléchargé ✓", "success");

          startTransition(async () => {
            await addOrderHistoryEntry(
              order.id,
              `PDF du reçu téléchargé (par ${user?.name})`,
            );
          });
        })
        .catch((err: any) => {
          console.error(err);

          document.body.removeChild(container);

          showToast("Erreur lors de la génération du PDF", "error");
        });
    },
    [user, showToast],
  );

  const filters = [
    { key: "all", label: "Toutes", count: statusCounts.all || 0 },

    { key: "pending", label: "En attente", count: statusCounts.pending || 0 },

    {
      key: "confirmed",
      label: "Confirmées",
      count: statusCounts.confirmed || 0,
    },

    { key: "packed", label: "Emballées", count: statusCounts.packed || 0 },

    { key: "delivered", label: "Livrées", count: statusCounts.delivered || 0 },

    { key: "cancelled", label: "Annulées", count: statusCounts.cancelled || 0 },
  ];

  const activeRange = useMemo(() => {
    if (!dateFrom && !dateTo) return "all";

    const today = new Date().toISOString().split("T")[0];

    if (dateFrom === today && (dateTo === today || !dateTo)) return "today";

    const y = new Date();

    y.setDate(y.getDate() - 1);

    const yesterday = y.toISOString().split("T")[0];

    if (dateFrom === yesterday && (dateTo === yesterday || !dateTo))
      return "yesterday";

    const w = new Date();

    w.setDate(w.getDate() - 7);

    const week = w.toISOString().split("T")[0];

    if (dateFrom === week && (dateTo === today || !dateTo)) return "week";

    const m = new Date();

    m.setDate(1);

    const month = m.toISOString().split("T")[0];

    if (dateFrom === month && (dateTo === today || !dateTo)) return "month";

    return "custom";
  }, [dateFrom, dateTo]);

  return (
    <div className="content animate-fade-in">
      {/* SEARCH BAR */}

      <div className="search-container" style={{ marginBottom: 14 }}>
        <Search
          size={16}
          style={{
            position: "absolute",
            left: 14,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--brown-soft)",
          }}
        />

        <input
          type="text"
          className="field-input search-input"
          placeholder="Rechercher par réf, nom, téléphone, commercial..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="cell-btn-icon"
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "#DEE2E6",
              width: 22,
              height: 22,
              borderRadius: "50%",
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* FILTERS */}

      <div className="filters-bar">
        {filters.map((f) => (
          <button
            key={f.key}
            className={`filter-chip ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}

            {f.count > 0 && <span className="chip-count">{f.count}</span>}
          </button>
        ))}

        <select
          className="filter-select"
          value={communeFilter}
          onChange={(e) => setCommuneFilter(e.target.value)}
        >
          <option value="all">Toutes communes</option>

          {Object.keys(COMMUNES).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {user?.role === "commercial" && (
          <select
            className="filter-select"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">Toutes commandes</option>
            <option value="mine">Mes commandes</option>
          </select>
        )}

        <div className="filter-spacer" />

        <div
          className="dashboard-actions"
          style={{
            background: "var(--cream)",
            padding: "2px 6px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            alignItems: "center",
          }}
        >
          <button
            className={`shortcut-btn ${activeRange === "all" ? "active" : ""}`}
            onClick={() => setQuickDate("all")}
          >
            Tout
          </button>

          <button
            className={`shortcut-btn ${activeRange === "today" ? "active" : ""}`}
            onClick={() => setQuickDate("today")}
          >
            Aujourd'hui
          </button>

          <button
            className={`shortcut-btn ${activeRange === "yesterday" ? "active" : ""}`}
            onClick={() => setQuickDate("yesterday")}
          >
            Hier
          </button>

          <button
            className={`shortcut-btn ${activeRange === "custom" ? "active" : ""}`}
            onClick={() => {
              if (!dateFrom && !dateTo) setQuickDate("today");
            }}
          >
            Perso
          </button>

          <button
            className={`shortcut-btn ${activeRange === "week" ? "active" : ""}`}
            onClick={() => setQuickDate("week")}
          >
            7 jours
          </button>

          <button
            className={`shortcut-btn ${activeRange === "month" ? "active" : ""}`}
            onClick={() => setQuickDate("month")}
          >
            Ce mois
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <select
            className="filter-select"
            value={dateType}
            onChange={(e) => setDateType(e.target.value)}
            style={{ width: 110, fontSize: 11 }}
          >
            <option value="created">Création</option>

            <option value="delivery">Livraison</option>
          </select>

          <input
            type="date"
            className="filter-date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />

          <input
            type="date"
            className="filter-date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(queryFetching || queryLoading) && (
            <RefreshCw size={14} className="animate-spin text-orange" />
          )}

          <button
            className="btn-secondary"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["orders"] })
            }
            title="Actualiser"
            style={{ padding: "8px 10px" }}
            disabled={queryFetching}
          >
            <RefreshCw
              size={14}
              className={queryFetching ? "animate-spin" : ""}
            />
          </button>
        </div>

        <Link href="/zangochap-manager/orders/new" className="btn-orange">
          <Plus size={14} /> Nouvelle commande
        </Link>
      </div>

      {/* TABLE */}

      <TableCard
        title="Commandes"
        meta={`${totalCount} commande(s) · Page ${currentPage}/${totalPages}`}
      >
        {paginatedOrders.length === 0 ? (
          <EmptyState
            icon="📦"
            title="Aucune commande"
            description="Aucune commande trouvée avec ces filtres."
          />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Référence</th>

                  <th>Date Création</th>

                  <th>Livraison</th>

                  <th>Client</th>

                  <th>Commercial</th>

                  <th>Commune</th>

                  <th>Articles</th>

                  <th>Total</th>

                  <th>Statut</th>

                  <th></th>
                </tr>
              </thead>

              <tbody>
                {paginatedOrders.map((order: any) => {
                  const firstItem = order.items?.[0];
                  const canManageOrder =
                    user?.role === "admin" ||
                    user?.role === "developer" ||
                    (user?.role === "commercial" && order.commercialId === user?.id);

                  return (
                    <tr key={order.id}>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <span
                            className="cell-mono"
                            style={{ fontWeight: 700 }}
                          >
                            {order.ref}
                          </span>

                          <TypeBadge type={order.type} compact />
                        </div>
                      </td>

                      <td>
                        <span className="cell-muted">
                          {formatDate(order.createdAt)}
                        </span>
                      </td>

                      <td>
                        <div
                          style={{
                            fontWeight: 600,
                            color: ["REPROGRAMMED", "REPRO_DISPO"].includes(
                              order.status,
                            )
                              ? "var(--orange)"
                              : "var(--ink)",
                          }}
                        >
                          {order.deliveryDate
                            ? formatDate(order.deliveryDate)
                            : "—"}
                        </div>

                        {["REPROGRAMMED", "REPRO_DISPO"].includes(
                          order.status,
                        ) && (
                            <div
                              style={{
                                fontSize: 9,
                                color: "var(--orange)",
                                fontWeight: 800,
                                textTransform: "uppercase",
                              }}
                            >
                              {order.status === "REPRO_DISPO"
                                ? "Repro-dispo"
                                : "Reprogrammée"}
                            </div>
                          )}
                      </td>

                      <td>
                        <div className="cell-strong">{order.customerName}</div>

                        <div className="cell-muted">{order.customerPhone}</div>
                      </td>

                      <td>
                        {order.commercialName === "Site Web" ? (
                          <span className="source-badge">Site Web</span>
                        ) : (
                          <span className="cell-muted" style={{ fontSize: 12 }}>
                            {order.commercialName || "—"}
                          </span>
                        )}
                      </td>

                      <td>{order.commune || "—"}</td>

                      <td>
                        <span className="cell-muted">
                          {order.items.length} article
                          {order.items.length > 1 ? "s" : ""}
                        </span>
                      </td>

                      <td>
                        <div
                          style={{ display: "flex", flexDirection: "column" }}
                        >
                          <span className="cell-price">
                            {formatPrice(
                              order.total +
                              (order.deliveryFee || 0) -
                              (order.discount || 0),
                            )}
                          </span>
                        </div>
                      </td>

                      <td>
                        <StatusBadge status={order.status} />

                        {order.status === "ON_DELIVERY" &&
                          order.deliverymanName && (
                            <div
                              style={{
                                fontSize: 10,
                                color: "var(--brown-soft)",
                                marginTop: 4,
                                justifyContent: "center",
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Truck size={10} /> {order.deliverymanName}
                            </div>
                          )}
                      </td>

                      <td>
                        <div className="row-actions">
                          <button
                            className="action-btn"
                            title="Voir le détail"
                            onClick={() => setSelectedOrder(order)}
                          >
                            <Eye size={14} />
                          </button>

                          {canManageOrder && (
                              <>
                                <button
                                  className="action-btn"
                                  title="Modifier"
                                  onClick={() => setOrderToEdit(order)}
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  className="action-btn"
                                  title="Dupliquer"
                                  onClick={() => setOrderToDuplicate(order)}
                                >
                                  <Copy size={14} />
                                </button>
                              </>
                            )}
                          <button
                            className="action-btn"
                            title="Envoyer un message WhatsApp au client (aperçu + envoi direct)"
                            onClick={() => setWhatsAppOrder(order)}
                            style={{ background: "#dcfce7", color: "#16a34a" }}
                          >
                            <MessageCircle size={14} />
                          </button>
                          <details className="action-menu">
                            <summary
                              className="action-btn"
                              title="Plus d'actions"
                              aria-label="Plus d'actions"
                            >
                              <MoreHorizontal size={14} />
                            </summary>
                            <div className="action-menu-panel">
                              {canManageOrder && (
                                  <button
                                    type="button"
                                    className="action-menu-item"
                                    onClick={() => setOrderToExchange(order)}
                                  >
                                    <Copy size={14} /> Créer un échange
                                  </button>
                                )}
                              {canManageOrder && (
                                  <button
                                    type="button"
                                    className="action-menu-item"
                                    onClick={() => setOrderToReprogram(order)}
                                  >
                                    <Calendar size={14} /> Reprogrammer
                                  </button>
                                )}
                              {canManageOrder && ![
                                "DELIVERED",
                                "CANCELLED",
                              ].includes(order.status) && (
                                  <button
                                    type="button"
                                    className="action-menu-item"
                                    onClick={() => setSelectedOrder(order)}
                                  >
                                    <CalendarClock size={14} /> Repro-dispo
                                  </button>
                                )}
                              <button
                                type="button"
                                className="action-menu-item"
                                onClick={() => setReceiptOrder(order)}
                              >
                                <Printer size={14} /> Imprimer reçu
                              </button>
                              {canManageOrder && (
                                  <button
                                    type="button"
                                    className="action-menu-item danger"
                                    onClick={() => handleDelete(order.id)}
                                  >
                                    <Trash2 size={14} /> Supprimer
                                  </button>
                                )}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* PAGINATION */}

            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 18px",
                  borderTop: "1px solid var(--line)",
                  background: "var(--cream)",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--brown-soft)",
                    fontWeight: 500,
                  }}
                >
                  {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, totalCount)} sur{" "}
                  {totalCount}
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    className="action-btn"
                    disabled={currentPage <= 1}
                    onClick={() => goToPage(currentPage - 1)}
                    style={{ opacity: currentPage <= 1 ? 0.3 : 1 }}
                  >
                    <ChevronLeft size={16} />
                  </button>

                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;

                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => goToPage(pageNum)}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,

                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",

                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: "none",

                          background:
                            currentPage === pageNum ? "var(--ink)" : "white",

                          color:
                            currentPage === pageNum ? "white" : "var(--brown)",

                          boxShadow:
                            currentPage === pageNum
                              ? "none"
                              : "0 1px 2px rgba(0,0,0,0.06)",

                          transition: "all 0.15s",
                        }}
                      >
                        {pageNum}
                      </button>
                    );
                  })}

                  <button
                    className="action-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => goToPage(currentPage + 1)}
                    style={{ opacity: currentPage >= totalPages ? 0.3 : 1 }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </TableCard>

      {/* ORDER DETAIL MODAL */}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          user={user}
          onClose={() => {
            setSelectedOrder(null);
            setIsEditing(false);
          }}
          onStatusChange={handleStatusChange}
          onUpdateDetails={handleUpdateDetails}
          onDelete={handleDelete}
          onAssign={handleAssign}
          onWhatsApp={(o: any) => setWhatsAppOrder(o)}
          onReproDispo={handleReproDispo}
          onReprogram={() => {
            setOrderToReprogram(selectedOrder);
            setSelectedOrder(null);
          }}
          deliverymen={deliverymen}
          staffUsers={staffUsers}
          isPending={isPending}
          isEditing={isEditing}
          setIsEditing={setIsEditing}
          onPrintReceipt={setReceiptOrder}
          onPreviewImage={setPreviewImage}
          products={products}
          onEdit={() => {
            setSelectedOrder(null);
            setOrderToEdit(selectedOrder);
          }}
        />
      )}

      {orderToDuplicate && (
        <OrderFormModal
          mode="duplicate"
          order={orderToDuplicate}
          onClose={() => setOrderToDuplicate(null)}
          onConfirm={(data) => handleDuplicate(orderToDuplicate.id, data)}
          isPending={isPending}
          onPreviewImage={setPreviewImage}
          products={products}
        />
      )}

      {orderToExchange && (
        <OrderFormModal
          mode="exchange"
          order={orderToExchange}
          onClose={() => setOrderToExchange(null)}
          onConfirm={(data) => handleDuplicate(orderToExchange.id, data)}
          isPending={isPending}
          onPreviewImage={setPreviewImage}
          products={products}
        />
      )}

      {orderToReprogram && (
        <OrderFormModal
          mode="reprogram"
          order={orderToReprogram}
          onClose={() => setOrderToReprogram(null)}
          onConfirm={(data) => handleReprogram(orderToReprogram.id, data)}
          isPending={isPending}
          onPreviewImage={setPreviewImage}
          products={products}
        />
      )}

      {orderToEdit && (
        <OrderFormModal
          mode="edit"
          order={orderToEdit}
          onClose={() => setOrderToEdit(null)}
          onReproDispo={() => {
            setSelectedOrder(orderToEdit);
            setOrderToEdit(null);
          }}
          onConfirm={(data) => {
            handleUpdateDetails(orderToEdit.id, data);

            setOrderToEdit(null);
          }}
          isPending={updateDetailsMutation.isPending}
          onPreviewImage={setPreviewImage}
          products={products}
        />
      )}

      {receiptOrder && (
        <ReceiptModal
          order={receiptOrder}
          onClose={() => setReceiptOrder(null)}
          onPrint={handlePrintReceipt}
          onDownloadPDF={handleDownloadPDF}
          onWhatsApp={(o: any) => setWhatsAppOrder(o)}
        />
      )}

      {whatsAppOrder && (
        <WhatsAppSendModal
          order={whatsAppOrder}
          onClose={() => setWhatsAppOrder(null)}
          onOpenWaMe={handleWhatsApp}
        />
      )}

      {previewImage &&
        createPortal(
          <div
            className="lightbox-overlay"
            onClick={() => setPreviewImage(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.85)",
              backdropFilter: "blur(5px)",
              cursor: "zoom-out",
            }}
          >
            <div
              className="lightbox-content animate-zoom-in"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "relative",
                maxWidth: "90%",
                maxHeight: "90%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={getImageUrl(previewImage)}
                alt="Preview"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: 12,
                  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
                }}
              />

              <button
                className="lightbox-close"
                onClick={() => setPreviewImage(null)}
                style={{
                  position: "absolute",
                  top: -40,
                  right: 0,
                  background: "transparent",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <X size={24} />
              </button>
            </div>
          </div>,

          document.body,
        )}

      <style>{`















        .receipt-format-btn {















          transition: all 0.2s ease;















        }















        .receipt-format-btn:hover {















          border-color: var(--orange) !important;















          background: var(--orange-soft) !important;















          transform: translateY(-2px);















          box-shadow: 0 4px 12px rgba(212, 84, 28, 0.1);















        }















        .receipt-format-btn:active {















          transform: translateY(0);















        }















      `}</style>

      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"
        strategy="lazyOnload"
      />
    </div>
  );
}

// ============================================

// HELPER COMPONENTS

// ============================================

const TypeBadge = ({
  type,
  compact = false,
}: {
  type: string;
  compact?: boolean;
}) => {
  if (!type || type === "Standard") return null;

  const colors: Record<string, { bg: string; text: string }> = {
    Echange: { bg: "#F5F3FF", text: "#7C3AED" },

    Reprogrammé: { bg: "#EEF2FF", text: "#4F46E5" },

    Express: { bg: "#FEF2F2", text: "#EF4444" },

    Recuperation: { bg: "#F0FDF4", text: "#16A34A" },
  };

  const color = colors[type] || {
    bg: "var(--orange-soft)",
    text: "var(--orange)",
  };

  return (
    <span
      style={{
        fontSize: compact ? 9 : 10,

        fontWeight: 800,

        color: color.text,

        background: color.bg,

        padding: compact ? "2px 6px" : "3px 10px",

        borderRadius: 6,

        textTransform: "uppercase",

        letterSpacing: "0.04em",

        display: "inline-flex",

        alignItems: "center",

        gap: 4,
      }}
    >
      {type}
    </span>
  );
};

// ============================================

// ORDER DETAIL MODAL

// ============================================

function OrderDetailModal({
  order,
  user,
  onClose,
  onStatusChange,
  onUpdateDetails,
  onDelete,
  onAssign,
  onWhatsApp,
  onReproDispo,
  onReprogram,
  deliverymen,
  staffUsers,
  isPending,
  isEditing,
  setIsEditing,
  onPrintReceipt,
  onPreviewImage,
  products,
  onEdit,
}: {
  order: any;
  user: any;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;

  onUpdateDetails: (id: string, data: any) => void;

  onDelete: (id: string) => void;

  onAssign: (id: string, dId: string) => void;

  onWhatsApp: (order: any) => void;

  onReproDispo: (id: string, date: string, note: string) => void;

  onReprogram: () => void;

  deliverymen?: any[];

  staffUsers?: any[];

  isPending: boolean;

  isEditing: boolean;
  setIsEditing: (v: boolean) => void;

  onPrintReceipt: (order: any) => void;

  onPreviewImage: (url: string | null) => void;

  products: any[];

  onEdit: () => void;
}) {
  const [editData, setEditData] = useState({
    customerName: order.customerName,

    customerPhone: order.customerPhone,

    customerPhone2: order.customerPhone2 || "",

    customerLocation: order.customerLocation || "",

    commune: order.commune || "",

    deliveryFee: order.deliveryFee || 0,

    notes: order.notes || "",

    deliveryNote: order.deliveryNote || "",
  });

  const [isReprogramming, setIsReprogramming] = useState(false);

  const [reprogramDate, setReprogramDate] = useState(() => {
    const tomorrow = new Date();

    tomorrow.setDate(tomorrow.getDate() + 1);

    if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1); // Skip Sunday

    return tomorrow.toISOString().split("T")[0];
  });
  const [reprogramNote, setReprogramNote] = useState("");

  const history = Array.isArray(order.history) ? order.history : [];

  const isAdmin = user?.role === "admin" || user?.role === "developer";

  const isOwner = order.commercialId === user?.id;

  const canEdit = isAdmin || (user?.role === "commercial" && isOwner);

  const handleSave = () => {
    onUpdateDetails(order.id, editData);

    setIsEditing(false);
  };

  const collectors = useMemo(() => {
    return Array.from(
      new Set(
        history

          .filter(
            (h: any) =>
              h.action.includes("collecté") ||
              h.action.includes("indisponible"),
          )

          .map((h: any) => h.byName as string),
      ),
    ).filter(Boolean) as string[];
  }, [history]);

  const findPhone = (name?: string | null, idOrEmail?: string | null) => {
    if (!name && !idOrEmail) return null;

    const found = staffUsers?.find(
      (u) => u.id === idOrEmail || u.email === idOrEmail || u.name === name,
    );

    return found?.phone;
  };

  return (
    <>
      <Modal
        isOpen={true}
        onClose={onClose}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 16 }}>Commande · {order.ref}</span>

              <div style={{ marginTop: 2 }}>
                <TypeBadge type={order.type} />
              </div>
            </div>

            {canEdit && order.status !== "CANCELLED" && (
              <button
                className="action-btn-sm"
                onClick={onEdit}
                title="Modifier"
              >
                <Edit2 size={12} />
              </button>
            )}
          </div>
        }
        large
        footer={
          <>
            {isEditing ? (
              <>
                <button
                  className="btn-orange"
                  onClick={handleSave}
                  disabled={isPending}
                >
                  <Save size={14} /> Enregistrer
                </button>

                <button
                  className="btn-secondary"
                  onClick={() => setIsEditing(false)}
                >
                  Annuler
                </button>
              </>
            ) : (
              <>
                {canEdit && order.status !== "CANCELLED" && (
                  <>
                    {["PENDING", "TO_PROCESS"].includes(order.status) && (
                      <button
                        className="btn-orange"
                        onClick={() => onStatusChange(order.id, "CONFIRMED")}
                        disabled={isPending}
                      >
                        <Check size={14} /> Confirmer
                      </button>
                    )}

                    {order.status === "CONFIRMED" && (
                      <button
                        className="btn-secondary"
                        onClick={() => onStatusChange(order.id, "PACKED")}
                        disabled={isPending}
                      >
                        <Package size={14} /> Marquer emballé
                      </button>
                    )}

                    {["CONFIRMED", "PREPARING", "PARTIAL", "UNAVAILABLE", "ALTERNATIVE", "PACKED"].includes(order.status) && (
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <select
                          className="btn-secondary"
                          style={{
                            padding: "0 10px",
                            height: 38,
                            fontSize: 12,
                          }}
                          onChange={(e) => {
                            const val = e.target.value;

                            if (val) {
                              if (
                                confirm(
                                  `Attribuer cette commande à ${deliverymen?.find((d) => d.id === val)?.name} ?`,
                                )
                              ) {
                                onAssign(order.id, val);
                              }
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Attribuer livreur...
                          </option>

                          {deliverymen?.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {["CONFIRMED", "PACKED", "ON_DELIVERY"].includes(
                      order.status,
                    ) && (
                        <button
                          className="btn-orange"
                          onClick={() => onStatusChange(order.id, "DELIVERED")}
                          disabled={isPending}
                        >
                          <Truck size={14} /> Livré
                        </button>
                      )}

                    {!["DELIVERED", "CANCELLED"].includes(
                      order.status,
                    ) && (
                        <button
                          className="btn-secondary"
                          onClick={() => setIsReprogramming(true)}
                          disabled={isPending}
                        >
                          <CalendarClock size={14} /> Repro-dispo
                        </button>
                      )}
                    <button
                      className="btn-secondary"
                      onClick={() => onDelete(order.id)}
                      disabled={isPending}
                      style={{ borderColor: "var(--red)", color: "var(--red)" }}
                    >
                      <Trash2 size={14} /> Supprimer
                    </button>

                    <button
                      className="btn-secondary"
                      onClick={() => onStatusChange(order.id, "CANCELLED")}
                      disabled={isPending}
                      style={{
                        borderColor: "var(--amber)",
                        color: "var(--amber)",
                      }}
                    >
                      <Ban size={14} /> Annuler
                    </button>
                  </>
                )}

                <button
                  className="btn-whatsapp"
                  onClick={() => onWhatsApp(order)}
                >
                  <MessageCircle size={14} /> WhatsApp
                </button>

                <button
                  className="btn-secondary"
                  onClick={() => onPrintReceipt(order)}
                  style={{
                    background: "#fef3c7",
                    color: "#b45309",
                    borderColor: "#fcd34d",
                  }}
                >
                  <Printer size={14} /> Imprimer
                </button>

                <button
                  className="btn-secondary"
                  onClick={onReprogram}
                  style={{
                    background: "var(--orange-soft)",
                    color: "var(--orange)",
                    borderColor: "var(--orange-soft)",
                  }}
                >
                  <Calendar size={14} /> Reprogrammer
                </button>

                <button className="btn-secondary" onClick={onClose}>
                  Fermer
                </button>
              </>
            )}
          </>
        }
      >
        {isReprogramming ? (
          <div style={{ padding: 20, textAlign: "center" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "var(--orange-soft)",
                color: "var(--orange)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <Calendar size={32} />
            </div>

            <h3
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "var(--ink)",
                marginBottom: 8,
              }}
            >
              Mettre en repro-dispo
            </h3>

            <p
              style={{
                fontSize: 13,
                color: "var(--brown-soft)",
                marginBottom: 24,
              }}
            >
              Le colis reste emballe, etiquete et collecte. Choisissez la
              nouvelle date demandee par le client.
            </p>

            <div
              className="form-row"
              style={{ maxWidth: 300, margin: "0 auto" }}
            >
              <label className="field-label-sm">
                NOUVELLE DATE DE LIVRAISON
              </label>

              <input
                type="date"
                className="field-input"
                value={reprogramDate}
                onChange={(e) => setReprogramDate(e.target.value)}
                style={{ textAlign: "center", fontWeight: 700, fontSize: 16 }}
              />
            </div>
            <div className="form-row" style={{ maxWidth: 300, margin: "16px auto 0" }}>
              <label className="field-label-sm">MOTIF DU REPORT</label>
              <textarea
                className="field-input"
                value={reprogramNote}
                onChange={(event) => setReprogramNote(event.target.value)}
                placeholder="Ex: report demande par le client"
              />
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                marginTop: 32,
              }}
            >
              <button
                className="btn-secondary"
                onClick={() => setIsReprogramming(false)}
              >
                Annuler
              </button>

              <button
                className="btn-orange"
                onClick={() => onReproDispo(order.id, reprogramDate, reprogramNote.trim())}
                disabled={isPending || !reprogramDate || !reprogramNote.trim()}
              >
                {isPending ? (
                  <div className="animate-spin" />
                ) : (
                  "Confirmer la repro-dispo"
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="order-detail-grid">
            {/* LIFE CYCLE PROGRESS */}

            <div style={{ gridColumn: "1 / -1", marginBottom: 20 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 10,
                  position: "relative",
                }}
              >
                {[
                  "PENDING",
                  "CONFIRMED",
                  "PACKED",
                  "ON_DELIVERY",
                  "DELIVERED",
                ].map((s, i, arr) => {
                  const statuses = [
                    "PENDING",
                    "CONFIRMED",
                    "PACKED",
                    "ON_DELIVERY",
                    "DELIVERED",
                  ];

                  const currentIndex = statuses.indexOf(order.status);

                  const stepIndex = i;

                  const isCompleted =
                    stepIndex < currentIndex || order.status === "DELIVERED";

                  const isCurrent =
                    stepIndex === currentIndex && order.status !== "CANCELLED";

                  const isCancelled = order.status === "CANCELLED";

                  return (
                    <div
                      key={s}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        flex: 1,
                        position: "relative",
                        zIndex: 1,
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",

                          background: isCancelled
                            ? "#FEE2E2"
                            : isCompleted || isCurrent
                              ? "var(--orange)"
                              : "white",

                          border: `2px solid ${isCancelled ? "#EF4444" : isCompleted || isCurrent ? "var(--orange)" : "var(--line)"}`,

                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",

                          color:
                            isCompleted || isCurrent
                              ? "white"
                              : "var(--brown-soft)",

                          transition: "all 0.3s",
                        }}
                      >
                        {isCompleted ? (
                          <Check size={14} strokeWidth={3} />
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 800 }}>
                            {i + 1}
                          </span>
                        )}
                      </div>

                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          marginTop: 6,

                          color: isCancelled
                            ? "#EF4444"
                            : isCurrent
                              ? "var(--orange)"
                              : "var(--brown-soft)",

                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {s === "ON_DELIVERY"
                          ? "Livraison"
                          : s === "DELIVERED"
                            ? "Livré"
                            : s === "PACKED"
                              ? "Emballé"
                              : s === "CONFIRMED"
                                ? "Confirmé"
                                : "Attente"}
                      </span>

                      {/* Connecting line */}

                      {i < arr.length - 1 && (
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            right: "-50%",
                            top: 14,
                            height: 2,

                            background:
                              stepIndex < currentIndex
                                ? "var(--orange)"
                                : "var(--line)",

                            zIndex: -1,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <DetailCard label="Client">
                {isEditing ? (
                  <div className="form-grid" style={{ gap: 10 }}>
                    <div className="form-row" style={{ gridColumn: "1 / -1" }}>
                      <label className="field-label-sm">NOM CLIENT</label>

                      <input
                        className="field-input-sm"
                        value={editData.customerName}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            customerName: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="form-row">
                      <label className="field-label-sm">TÉLÉPHONE</label>

                      <input
                        className="field-input-sm"
                        value={editData.customerPhone}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            customerPhone: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="form-row">
                      <label className="field-label-sm">TÉLÉPHONE 2</label>

                      <input
                        className="field-input-sm"
                        value={editData.customerPhone2}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            customerPhone2: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="form-row">
                      <label className="field-label-sm">COMMUNE</label>

                      <select
                        className="field-input-sm"
                        value={editData.commune}
                        onChange={(e) =>
                          setEditData({ ...editData, commune: e.target.value })
                        }
                      >
                        {Object.keys(COMMUNES).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-row">
                      <label className="field-label-sm">FRAIS LIVR.</label>

                      <input
                        type="number"
                        className="field-input-sm"
                        value={editData.deliveryFee}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            deliveryFee: parseInt(e.target.value) || 0,
                          })
                        }
                      />
                    </div>

                    <div className="form-row" style={{ gridColumn: "1 / -1" }}>
                      <label className="field-label-sm">
                        ADRESSE / EMPLACEMENT
                      </label>

                      <textarea
                        className="field-input-sm"
                        value={editData.customerLocation}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            customerLocation: e.target.value,
                          })
                        }
                        style={{ minHeight: 60 }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {order.customerName}
                    </div>

                    <div className="cell-muted" style={{ marginTop: 4 }}>
                      {order.customerPhone}
                    </div>

                    {order.customerPhone2 && (
                      <div className="cell-muted">{order.customerPhone2}</div>
                    )}

                    {order.customerLocation && (
                      <div className="cell-muted" style={{ marginTop: 4 }}>
                        {order.customerLocation}
                      </div>
                    )}

                    {order.commune && (
                      <div
                        style={{
                          marginTop: 4,
                          color: "var(--orange)",
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        {order.commune}
                      </div>
                    )}

                    {order.paymentMethod && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "4px 8px",
                          background: "var(--blue-soft)",
                          color: "var(--blue)",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 800,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <CreditCard size={12} />

                        <span>
                          SOLDER PAR : {order.paymentMethod.toUpperCase()}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </DetailCard>

              <div style={{ marginTop: 14 }}>
                <DetailCard label="Articles commandés">
                  {order.items.map((item: any, i: number) => {
                    const fallbackImg = products.find(
                      (p) => p.id === item.productId,
                    )?.images?.[0]?.url;

                    return (
                      <ItemLine
                        key={i}
                        emoji={item.emoji}
                        image={item.image || fallbackImg}
                        onImageClick={onPreviewImage}
                        name={item.name}
                        meta={`Taille ${item.size} · ${item.color} · Qté ${item.qty}`}
                        price={formatPrice(item.price * item.qty)}
                        isGift={item.isGift}
                      />
                    );
                  })}
                </DetailCard>
              </div>

              <div style={{ marginTop: 14 }}>
                <DetailCard>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span>Sous-total</span>
                    <span className="cell-price">
                      {formatPrice(order.total)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span>Livraison</span>
                    <span>{formatPrice(order.deliveryFee || 0)}</span>
                  </div>

                  {order.discount > 0 && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 6,
                        color: "var(--green)",
                      }}
                    >
                      <span>
                        Remise {order.promoCode && `(${order.promoCode})`}
                      </span>
                      <span>-{formatPrice(order.discount)}</span>
                    </div>
                  )}

                  <div
                    style={{
                      borderTop: "1px solid var(--line)",
                      paddingTop: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      fontSize: 16,
                    }}
                  >
                    <span>Total</span>
                    <span className="cell-price">
                      {formatPrice(
                        (order.total || 0) +
                        (order.deliveryFee || 0) -
                        (order.discount || 0),
                      )}
                    </span>
                  </div>
                </DetailCard>
              </div>
            </div>

            <div>
              <DetailCard label="Statut">
                <StatusBadge status={order.status} />

                <div
                  className="cell-muted"
                  style={{ marginTop: 6, fontSize: 11 }}
                >
                  Créée le {formatDay(order.createdAt)}
                </div>
              </DetailCard>

              <div style={{ marginTop: 14 }}>
                <DetailCard label="Intervenants">
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      marginTop: 4,
                    }}
                  >
                    <StaffRow
                      label="Commercial"
                      value={order.commercialName}
                      phone={findPhone(
                        order.commercialName,
                        order.commercialId,
                      )}
                      icon={<Users size={12} />}
                    />

                    <StaffRow
                      label="Collecte"
                      value={collectors.join(", ")}
                      phone={
                        collectors.length === 1
                          ? findPhone(collectors[0])
                          : null
                      }
                      icon={<ArrowLeftRight size={12} />}
                    />

                    <StaffRow
                      label="Emballage"
                      value={order.packedByName}
                      phone={findPhone(order.packedByName, order.packedBy)}
                      icon={<Package size={12} />}
                    />

                    <StaffRow
                      label="Livreur"
                      value={order.deliverymanName}
                      phone={findPhone(
                        order.deliverymanName,
                        order.deliverymanId,
                      )}
                      icon={<Truck size={12} />}
                    />
                  </div>
                </DetailCard>
              </div>

              {order.notes || isEditing ? (
                <div style={{ marginTop: 14 }}>
                  <DetailCard label="Notes internes">
                    {isEditing ? (
                      <textarea
                        className="field-input-sm"
                        value={editData.notes}
                        onChange={(e) =>
                          setEditData({ ...editData, notes: e.target.value })
                        }
                        placeholder="Notes internes (non visibles par le client)..."
                        style={{ minHeight: 80 }}
                      />
                    ) : (
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                        {order.notes}
                      </div>
                    )}
                  </DetailCard>
                </div>
              ) : null}

              {isEditing && (
                <div style={{ marginTop: 14 }}>
                  <DetailCard label="Note de livraison">
                    <textarea
                      className="field-input-sm"
                      value={editData.deliveryNote}
                      onChange={(e) =>
                        setEditData({
                          ...editData,
                          deliveryNote: e.target.value,
                        })
                      }
                      placeholder="Instructions pour le livreur..."
                    />
                  </DetailCard>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <DetailCard label="Historique détaillé">
                  {(() => {
                    const formatAction = (action: string) => {
                      if (!action) return "—";

                      // Status mapping

                      const statusMap: Record<string, string> = {
                        PENDING: "En attente",

                        CONFIRMED: "Confirmée",

                        PACKED: "Emballée",

                        ON_DELIVERY: "En livraison",

                        DELIVERED: "Livrée",

                        CANCELLED: "Annulée",

                        RETURNED: "Retournée",

                        REPROGRAMMED: "Reprogrammée",

                        TO_PROCESS: "À traiter",
                      };

                      let formatted = action;

                      // Clean up "Statut → STATUS par NAME"

                      if (action.includes("Statut →")) {
                        const parts = action.split(" ");

                        const status = parts[2];

                        const frStatus = statusMap[status] || status;

                        formatted = `Statut : ${frStatus}`;
                      }

                      return formatted;
                    };

                    const getActionColor = (action: string) => {
                      const lower = action.toLowerCase();

                      if (
                        lower.includes("livrée") ||
                        lower.includes("delivered")
                      )
                        return "var(--green)";

                      if (
                        lower.includes("annulée") ||
                        lower.includes("cancelled")
                      )
                        return "var(--red)";

                      if (
                        lower.includes("reprogrammée") ||
                        lower.includes("reprogrammed")
                      )
                        return "var(--orange)";

                      if (
                        lower.includes("emballée") ||
                        lower.includes("packed")
                      )
                        return "var(--blue)";

                      if (
                        lower.includes("confirmée") ||
                        lower.includes("confirmed")
                      )
                        return "var(--green)";

                      return "inherit";
                    };

                    return (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 0,
                          paddingLeft: 4,
                        }}
                      >
                        {history.length === 0 ? (
                          <div
                            className="cell-muted"
                            style={{ fontSize: 12, padding: "10px 0" }}
                          >
                            Aucun événement enregistré
                          </div>
                        ) : (
                          history
                            .slice()
                            .reverse()
                            .map((h: any, i: number) => {
                              const actionText = formatAction(h.action);

                              const actionColor = getActionColor(actionText);

                              return (
                                <div
                                  key={i}
                                  style={{
                                    display: "flex",
                                    gap: 12,
                                    position: "relative",
                                    paddingBottom: 16,
                                  }}
                                >
                                  {i < history.length - 1 && (
                                    <div
                                      style={{
                                        position: "absolute",
                                        left: 5,
                                        top: 14,
                                        bottom: -4,
                                        width: 2,
                                        background: "var(--line)",
                                      }}
                                    />
                                  )}

                                  <div
                                    style={{
                                      width: 12,
                                      height: 12,
                                      borderRadius: "50%",

                                      background:
                                        i === 0
                                          ? "var(--orange)"
                                          : "var(--line)",

                                      border: "2px solid white",
                                      marginTop: 3,
                                      zIndex: 1,

                                      boxShadow: "0 0 0 2px white",
                                    }}
                                  />

                                  <div style={{ flex: 1 }}>
                                    <div
                                      style={{
                                        fontSize: 13,

                                        fontWeight: 700,

                                        color:
                                          i === 0
                                            ? "var(--ink)"
                                            : "var(--brown)",

                                        lineHeight: 1.2,
                                      }}
                                    >
                                      <span
                                        style={{
                                          color:
                                            actionColor !== "inherit"
                                              ? actionColor
                                              : undefined,
                                        }}
                                      >
                                        {actionText}
                                      </span>
                                    </div>

                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginTop: 4,
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: 11,
                                          color: "var(--brown-soft)",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {h.byName}
                                      </span>

                                      <span
                                        style={{
                                          fontSize: 10,
                                          color: "var(--brown-soft)",
                                          fontFamily: "var(--font-mono)",
                                          opacity: 0.8,
                                        }}
                                      >
                                        {formatDate(h.at)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                        )}
                      </div>
                    );
                  })()}
                </DetailCard>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function StaffRow({
  label,
  value,
  phone,
  icon,
}: {
  label: string;
  value?: string | null;
  phone?: string | null;
  icon: React.ReactNode;
}) {
  if (!value || value === "—") return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: "var(--cream-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--brown-soft)",
        }}
      >
        {icon}
      </div>

      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--brown-soft)",
            textTransform: "uppercase",
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
          {value}

          {phone && (
            <span
              style={{
                marginLeft: 8,
                color: "var(--orange)",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {phone}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderFormModal({
  order,
  mode = "duplicate",
  onClose,
  onConfirm,
  isPending,
  onPreviewImage,
  products = [],
  onReproDispo,
}: {
  order: any;
  mode?: "duplicate" | "exchange" | "reprogram" | "edit";
  onClose: () => void;
  onConfirm: (data: any) => void;
  isPending: boolean;
  onPreviewImage: (url: string | null) => void;
  products?: any[];
  onReproDispo?: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const getDefaultDeliveryDate = () => {
    const now = new Date();

    const target = new Date(now);

    target.setDate(now.getDate() + 1);

    if (target.getDay() === 0) target.setDate(target.getDate() + 1);

    return target.toISOString().split("T")[0];
  };

  const [formData, setFormData] = useState(() => {
    // Pre-load original order items into cart

    const initialItems = (order.items || []).map((item: any, idx: number) => ({
      id: mode === "edit" ? item.id : `dup-${idx}-${Date.now()}`,

      productId: item.productId,

      variantId: item.variantId,

      name: item.name,

      size: item.size,

      color: item.color,

      qty: item.qty,

      price: item.price,

      emoji: item.emoji || "📦",

      image: getImageUrl(item.image),

      isGift: !!item.isGift,

      originalPrice: item.isGift ? item.originalPrice || item.price : undefined,
    }));

    return {
      customerName: order.customerName,

      customerPhone: order.customerPhone,

      customerPhone2: order.customerPhone2 || "",

      customerLocation: order.customerLocation || "",

      commune: order.commune || "",

      deliveryFee: order.deliveryFee || 0,

      notes: order.notes || "",

      type: mode === "exchange" ? "Echange" : mode === "reprogram" ? "Reprogrammé" : order.type || "Standard",

      total: initialItems.reduce(
        (sum: number, i: any) => sum + Number(i.price) * Number(i.qty),
        0,
      ),

      items: initialItems as any[],

      // En édition, pré-remplit le motif depuis la ligne "MOTIF ECHANGE: ..." des notes
      exchangeReason:
        mode === "edit"
          ? String(order.notes || "").match(/MOTIF ECHANGE:\s*([^\n]*)/i)?.[1]?.trim() || ""
          : "",

      deliveryDate: getDefaultDeliveryDate(),
    };
  });

  // En édition d'un échange, réinjecte le motif dans les notes (updateOrderDetails ne connaît que "notes")
  const buildConfirmData = () => {
    if (mode !== "edit") return formData;
    const reason = String(formData.exchangeReason || "").trim();
    const lines = String(formData.notes || "")
      .split("\n")
      .filter((l) => !/^\s*MOTIF ECHANGE:/i.test(l));
    if (formData.type === "Echange" && reason) lines.unshift(`MOTIF ECHANGE: ${reason}`);
    return { ...formData, notes: lines.join("\n").trim() };
  };

  // Product search via API

  const [productSearch, setProductSearch] = useState("");

  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [catalogPage, setCatalogPage] = useState(1);

  const [selectedProductForVariant, setSelectedProductForVariant] =
    useState<any>(null);

  const [selectedVariant, setSelectedVariant] = useState<any>(null);

  const [selectedQty, setSelectedQty] = useState(1);

  const [sizeFilter, setSizeFilter] = useState("all");

  const [colorFilter, setColorFilter] = useState("all");

  const [isTotalManuallySet, setIsTotalManuallySet] = useState(false);

  // Debounce search

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(productSearch);
      setCatalogPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [productSearch]);

  // Fetch products from API

  const { data: catalogData, isFetching: isCatalogLoading } = useQuery({
    queryKey: [
      "catalog-products",
      debouncedSearch,
      selectedCategory,
      catalogPage,
    ],

    queryFn: async () => {
      const params = new URLSearchParams({ page: String(catalogPage) });

      if (debouncedSearch) params.set("q", debouncedSearch);

      if (selectedCategory) params.set("category", selectedCategory);

      params.set("allStatus", "true");

      const res = await fetch(`/api/products/search?${params}`);

      if (!res.ok) throw new Error("Erreur");

      return res.json();
    },

    staleTime: 30_000,
  });

  const catalogProducts = catalogData?.products || [];

  const catalogTotalPages = catalogData?.totalPages || 1;

  const categories = catalogData?.categories || [];

  // Identify unique product IDs from original order items in the cart

  const cartProductIds = useMemo(() => {
    const ids = (formData.items || [])

      .map((i: any) => i.productId)

      .filter(Boolean);

    return Array.from(new Set(ids));
  }, [formData.items]);

  // Fetch full product details (including variants) for the items in the cart

  const { data: cartProductsData } = useQuery({
    queryKey: ["cart-products-details", cartProductIds.join(",")],

    queryFn: async () => {
      if (cartProductIds.length === 0) return { products: [] };

      const res = await fetch(
        `/api/products/search?ids=${cartProductIds.join(",")}&allStatus=true`,
      );

      if (!res.ok) throw new Error("Erreur");

      return res.json();
    },

    enabled: cartProductIds.length > 0,

    staleTime: 60_000,
  });

  const cartProductsDetails = cartProductsData?.products || [];

  // Auto-focus search when overlay closes

  useEffect(() => {
    if (!selectedProductForVariant) searchInputRef.current?.focus();
  }, [selectedProductForVariant]);

  // Sync total when items change

  useEffect(() => {
    if (!isTotalManuallySet) {
      const calculatedTotal = formData.items.reduce(
        (sum, i) => sum + Number(i.price) * Number(i.qty),
        0,
      );

      setFormData((prev) => ({ ...prev, total: calculatedTotal }));
    }
  }, [formData.items, isTotalManuallySet]);

  const addItemWithVariant = () => {
    if (!selectedProductForVariant || !selectedVariant) return;

    const newItem = {
      id: Math.random().toString(),

      productId: selectedProductForVariant.id,

      variantId: selectedVariant.id,

      name: selectedProductForVariant.name,

      size: selectedVariant.size,

      color: selectedVariant.color,

      qty: selectedQty,

      price:
        selectedProductForVariant.basePrice ||
        Number(selectedProductForVariant.price),

      emoji: selectedProductForVariant.emoji || "📦",

      image: getImageUrl(
        selectedProductForVariant.images?.[0]?.dataUrl ||
        selectedProductForVariant.images?.[0]?.url,
      ),
    };

    setFormData((prev) => ({ ...prev, items: [...prev.items, newItem] }));

    setSelectedProductForVariant(null);

    setSelectedVariant(null);

    setSelectedQty(1);
  };

  const removeItem = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.id !== id),
    }));
  };

  const toggleItemGift = (itemId: string) => {
    setFormData((prev: any) => ({
      ...prev,

      items: prev.items.map((item: any) => {
        if (item.id === itemId) {
          const isCurrentlyGift = !!item.isGift;

          return {
            ...item,

            isGift: !isCurrentlyGift,

            price: isCurrentlyGift ? item.originalPrice || 0 : 0,

            originalPrice: isCurrentlyGift ? undefined : item.price || 0,
          };
        }

        return item;
      }),
    }));
  };

  const updateItemQty = (id: string, delta: number) => {
    setFormData((prev) => ({
      ...prev,

      items: prev.items.map((i) =>
        i.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i,
      ),
    }));
  };

  const getVariantStock = (productId: string, size: string, color: string) => {
    const product = catalogProducts.find((p: any) => p.id === productId);

    if (!product) return -1; // unknown

    const variant = product.variants?.find(
      (v: any) => v.size === size && v.color === color,
    );

    return variant ? variant.stock : product.stock;
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={
        mode === "duplicate"
          ? "Dupliquer la commande"
          : mode === "exchange"
            ? "Créer une commande d'échange"
            : mode === "reprogram"
              ? "Reprogrammer la commande"
            : "Modifier la commande"
      }
      full
      footer={
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "flex-end",
            padding: "4px 0",
          }}
        >
          <button
            className="btn-secondary"
            style={{
              height: 42,
              borderRadius: 10,
              padding: "0 24px",
              fontSize: 13,
              fontWeight: 700,
            }}
            onClick={onClose}
          >
            Annuler
          </button>
          {mode === "edit" &&
            onReproDispo &&
            !["DELIVERED", "CANCELLED"].includes(
              order.status,
            ) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={onReproDispo}
                disabled={isPending}
              >
                <CalendarClock size={16} /> Repro-dispo
              </button>
            )}
          <button
            className="btn-orange"
            style={{
              height: 42,
              borderRadius: 10,
              padding: "0 32px",
              boxShadow: "0 4px 12px rgba(212, 84, 28, 0.2)",
              fontSize: 13,
              fontWeight: 800,
            }}
            onClick={() => onConfirm(buildConfirmData())}
            disabled={isPending || formData.items.length === 0}
          >
            {isPending ? (
              <div className="animate-spin" />
            ) : (
              <>
                <Check size={18} />{" "}
                {mode === "duplicate"
                  ? "Dupliquer"
                  : mode === "exchange"
                    ? "Créer l'échange"
                    : mode === "reprogram"
                      ? "Créer la reprogrammation"
                    : "Enregistrer"}
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="order-modal-grid">
        {/* LEFT PANEL: CLIENT INFO */}

        <div
          style={{
            background: "white",
            padding: 24,
            borderRight: "1px solid var(--line)",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                width: 4,
                height: 16,
                background: "var(--orange)",
                borderRadius: 2,
              }}
            ></div>

            <label
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: "var(--brown-soft)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Destinataire & Logistique
            </label>
          </div>

          <div className="form-grid full" style={{ gap: 20 }}>
            <div className="form-row">
              <label className="field-label-sm" style={{ marginBottom: 8 }}>
                TYPE DE TRANSACTION
              </label>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                {[
                  "Standard",
                  "Echange",
                  "Express",
                  "Recuperation",
                  "Reprogrammé",
                ].map((t) => {
                  const typeColors: Record<
                    string,
                    { bg: string; text: string }
                  > = {
                    Echange: { bg: "#F5F3FF", text: "#7C3AED" },

                    Reprogrammé: { bg: "#EEF2FF", text: "#4F46E5" },

                    Express: { bg: "#FEF2F2", text: "#EF4444" },

                    Recuperation: { bg: "#F0FDF4", text: "#16A34A" },

                    Standard: { bg: "var(--ink)", text: "white" },
                  };

                  const isActive = formData.type === t;

                  const colors = typeColors[t] || {
                    bg: "var(--cream)",
                    text: "var(--brown-soft)",
                  };

                  return (
                    <button
                      key={t}
                      onClick={() => setFormData({ ...formData, type: t })}
                      style={{
                        padding: "10px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 8,

                        border: isActive
                          ? `1.5px solid ${colors.text}`
                          : "1.5px solid var(--line)",

                        background: isActive ? colors.bg : "var(--cream)",

                        color: isActive ? colors.text : "var(--brown-soft)",

                        cursor: "pointer",

                        transition: "all 0.2s",

                        boxShadow: isActive
                          ? "0 4px 8px rgba(0,0,0,0.05)"
                          : "none",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {formData.type === "Echange" && (
              <div className="form-row" style={{ animation: "fadeIn 0.3s" }}>
                <label
                  className="field-label-sm"
                  style={{ color: "var(--orange)" }}
                >
                  MOTIF DE L'ÉCHANGE
                </label>

                <input
                  className="field-input"
                  value={formData.exchangeReason}
                  onChange={(e) =>
                    setFormData({ ...formData, exchangeReason: e.target.value })
                  }
                  style={{
                    border: "1.5px solid var(--orange-soft)",
                    background: "var(--orange-soft)",
                    borderRadius: 8,
                    fontWeight: 600,
                  }}
                  placeholder="Pourquoi faire un échange ? (ex: Problème de taille)"
                />
              </div>
            )}

            <div className="form-row">
              <label className="field-label-sm">NOM DU CLIENT</label>

              <input
                className="field-input"
                value={formData.customerName}
                onChange={(e) =>
                  setFormData({ ...formData, customerName: e.target.value })
                }
                style={{ background: "var(--cream)", borderRadius: 8 }}
              />
            </div>

            <div className="form-row">
              <label className="field-label-sm">NUMÉRO DE TÉLÉPHONE</label>

              <div style={{ position: "relative" }}>
                <Phone
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--brown-soft)",
                  }}
                />

                <input
                  className="field-input"
                  value={formData.customerPhone}
                  onChange={(e) =>
                    setFormData({ ...formData, customerPhone: e.target.value })
                  }
                  style={{
                    paddingLeft: 36,
                    background: "var(--cream)",
                    borderRadius: 8,
                  }}
                />
              </div>
            </div>

            <div className="form-row">
              <label className="field-label-sm">TÉLÉPHONE 2 (OPTIONNEL)</label>

              <div style={{ position: "relative" }}>
                <Phone
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--brown-soft)",
                  }}
                />

                <input
                  className="field-input"
                  value={formData.customerPhone2}
                  onChange={(e) =>
                    setFormData({ ...formData, customerPhone2: e.target.value })
                  }
                  style={{
                    paddingLeft: 36,
                    background: "var(--cream)",
                    borderRadius: 8,
                  }}
                />
              </div>
            </div>

            <div className="form-row">
              <label className="field-label-sm">ZONE DE LIVRAISON</label>

              <select
                className="field-input"
                value={formData.commune}
                onChange={(e) => {
                  const newCommune = e.target.value;

                  const newFee = DELIVERY_FEES[newCommune] || 0;

                  setFormData((prev) => ({
                    ...prev,
                    commune: newCommune,
                    deliveryFee: newFee,
                  }));
                }}
                style={{
                  background: "var(--cream)",
                  borderRadius: 8,
                  fontWeight: 700,
                }}
              >
                {Object.keys(COMMUNES).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label className="field-label-sm">FRAIS DE COURSIER (CFA)</label>

              <input
                type="number"
                className="field-input"
                value={formData.deliveryFee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    deliveryFee: parseInt(e.target.value) || 0,
                  })
                }
                style={{
                  background: "var(--cream)",
                  borderRadius: 8,
                  fontWeight: 700,
                }}
              />
            </div>

            <div className="form-row">
              <label
                className="field-label-sm"
                style={{ color: "var(--orange)", fontWeight: 700 }}
              >
                DATE DE LIVRAISON
              </label>

              <input
                type="date"
                className="field-input"
                value={formData.deliveryDate}
                onChange={(e) =>
                  setFormData({ ...formData, deliveryDate: e.target.value })
                }
                style={{
                  border: "1.5px solid var(--orange-soft)",
                  borderRadius: 8,
                  fontWeight: 700,
                }}
              />
            </div>

            <div className="form-row">
              <label className="field-label-sm">ADRESSE DÉTAILLÉE</label>

              <textarea
                className="field-input"
                value={formData.customerLocation}
                onChange={(e) =>
                  setFormData({ ...formData, customerLocation: e.target.value })
                }
                style={{
                  minHeight: 80,
                  background: "var(--cream)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
                placeholder="Ex: Riviera Palmeraie, Rue I52..."
              />
            </div>
          </div>
        </div>

        {/* MIDDLE PANEL: PRODUCT CATALOG */}

        <div
          style={{
            background: "var(--cream)",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 4,
                  height: 16,
                  background: "var(--ink)",
                  borderRadius: 2,
                }}
              ></div>

              <label
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--ink)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Catalogue Produits
              </label>
            </div>

            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--brown-soft)",
                background: "var(--cream-2)",
                padding: "4px 10px",
                borderRadius: 20,
              }}
            >
              {catalogData?.total || 0} ARTICLES
              {isCatalogLoading && (
                <span style={{ marginLeft: 6, color: "var(--orange)" }}>⟳</span>
              )}
            </div>
          </div>

          <div style={{ position: "relative" }}>
            <Search
              style={{
                position: "absolute",
                left: 16,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--brown-soft)",
              }}
              size={18}
            />

            <input
              ref={searchInputRef}
              autoFocus
              className="field-input"
              style={{
                paddingLeft: 48,
                paddingRight: 40,
                height: 48,
                fontSize: 13,
                borderRadius: 12,
                border: "1.5px solid var(--line-2)",
                background: "white",
                boxShadow: "var(--shadow-sm)",
              }}
              placeholder="Rechercher un produit..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && catalogProducts.length === 1) {
                  const p = catalogProducts[0];

                  setSelectedProductForVariant(p);

                  setSelectedVariant(
                    p.variants?.length > 0
                      ? null
                      : { size: "Standard", color: "Standard" },
                  );

                  setSelectedQty(1);
                }
              }}
            />

            {productSearch && (
              <button
                onClick={() => setProductSearch("")}
                style={{
                  position: "absolute",
                  right: 16,
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--brown-soft)",
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            <button
              onClick={() => {
                setSelectedCategory(null);
                setCatalogPage(1);
              }}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 20,
                border: "1px solid var(--line)",

                background: !selectedCategory ? "var(--ink)" : "white",

                color: !selectedCategory ? "white" : "var(--brown-soft)",

                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              Tous
            </button>

            {categories.map((cat: any) => (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setCatalogPage(1);
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 20,
                  border: "1px solid var(--line)",

                  background:
                    selectedCategory === cat.id ? "var(--ink)" : "white",

                  color:
                    selectedCategory === cat.id ? "white" : "var(--brown-soft)",

                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {catalogProducts.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "white",
                borderRadius: 12,
                border: "1px dashed var(--line-2)",
                padding: 32,
                textAlign: "center",
              }}
            >
              <Package
                size={32}
                style={{
                  color: "var(--brown-soft)",
                  opacity: 0.5,
                  marginBottom: 12,
                }}
              />

              <div
                style={{
                  fontSize: 11,
                  color: "var(--brown-soft)",
                  marginTop: 4,
                }}
              >
                {isCatalogLoading
                  ? "Chargement du catalogue..."
                  : "Aucun produit trouvé."}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 10,
                overflowY: "auto",
                flex: 1,
                padding: 4,
              }}
            >
              {catalogProducts.map((p: any) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onPreview={onPreviewImage}
                  onAdd={(p) => {
                    setSelectedProductForVariant(p);

                    setSelectedVariant(
                      p.variants?.length > 0
                        ? null
                        : { size: "Standard", color: "Standard" },
                    );

                    setSelectedQty(1);
                  }}
                />
              ))}
            </div>
          )}

          {/* Pagination */}

          {catalogTotalPages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 10,
                paddingTop: 8,
                borderTop: "1px solid var(--line)",
              }}
            >
              <button
                disabled={catalogPage <= 1}
                onClick={() => setCatalogPage((p) => p - 1)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "white",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: catalogPage > 1 ? "pointer" : "default",
                  opacity: catalogPage <= 1 ? 0.4 : 1,
                }}
              >
                ← Préc.
              </button>

              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {catalogPage}{" "}
                <span style={{ color: "#8E8E93", fontWeight: 400 }}>
                  / {catalogTotalPages}
                </span>
              </span>

              <button
                disabled={catalogPage >= catalogTotalPages}
                onClick={() => setCatalogPage((p) => p + 1)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "white",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor:
                    catalogPage < catalogTotalPages ? "pointer" : "default",
                  opacity: catalogPage >= catalogTotalPages ? 0.4 : 1,
                }}
              >
                Suiv. →
              </button>
            </div>
          )}
        </div>

        {/* RIGHT PANEL: CART RECAP */}

        <div
          style={{
            background: "var(--cream-2)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 3,
                height: 14,
                background: "var(--brown)",
                borderRadius: 2,
              }}
            ></div>

            <label
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: "var(--brown)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Panier
            </label>

            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--brown-soft)",
              }}
            >
              {formData.items.length} ITÉMS
            </span>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              paddingRight: 4,
            }}
          >
            {formData.items.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "white",
                  borderRadius: 12,
                  border: "1px dashed var(--line-2)",
                  padding: 32,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: "var(--cream)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Package size={24} style={{ color: "var(--brown-soft)" }} />
                </div>

                <div
                  style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}
                >
                  Panier vide
                </div>

                <div
                  style={{
                    fontSize: 11,
                    color: "var(--brown-soft)",
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}
                >
                  Sélectionnez des articles
                  <br />
                  dans le catalogue.
                </div>
              </div>
            ) : (
              formData.items.map((item: any) => (
                <div
                  key={item.id}
                  style={{
                    background: "white",
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid var(--line-2)",
                    position: "relative",
                    display: "flex",
                    gap: 10,
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      background: "var(--cream)",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      border: "1px solid var(--line)",
                    }}
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <Package size={20} color="var(--brown-soft)" />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "var(--ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.name}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 4,
                        marginTop: 4,
                        alignItems: "center",
                      }}
                    >
                      {(() => {
                        const productObj =
                          products?.find((p: any) => p.id === item.productId) ||
                          catalogProducts?.find(
                            (p: any) => p.id === item.productId,
                          ) ||
                          cartProductsDetails?.find(
                            (p: any) => p.id === item.productId,
                          );

                        return item.productId &&
                          productObj?.variants?.length > 0 ? (
                          <>
                            <select
                              value={item.size}
                              onChange={(e) => {
                                const newSize = e.target.value;

                                const matchingVariant =
                                  productObj.variants.find(
                                    (v: any) =>
                                      v.size === newSize &&
                                      v.color === item.color,
                                  ) ||
                                  productObj.variants.find(
                                    (v: any) => v.size === newSize,
                                  );

                                if (matchingVariant) {
                                  setFormData((prev: any) => ({
                                    ...prev,

                                    items: prev.items.map((it: any) =>
                                      it.id === item.id
                                        ? {
                                          ...it,

                                          size: matchingVariant.size,

                                          color: matchingVariant.color,

                                          variantId: matchingVariant.id,
                                        }
                                        : it,
                                    ),
                                  }));
                                }
                              }}
                              style={{
                                fontSize: 10,

                                fontWeight: 700,

                                color: "var(--ink)",

                                background: "var(--cream)",

                                border: "1px solid var(--line)",

                                borderRadius: 6,

                                padding: "2px 4px",

                                outline: "none",

                                cursor: "pointer",
                              }}
                            >
                              {Array.from(
                                new Set(
                                  productObj.variants.map((v: any) => v.size),
                                ),
                              ).map((size: any) => (
                                <option key={size} value={size}>
                                  {size}
                                </option>
                              ))}
                            </select>

                            <select
                              value={item.color}
                              onChange={(e) => {
                                const newColor = e.target.value;

                                const matchingVariant =
                                  productObj.variants.find(
                                    (v: any) =>
                                      v.size === item.size &&
                                      v.color === newColor,
                                  ) ||
                                  productObj.variants.find(
                                    (v: any) => v.color === newColor,
                                  );

                                if (matchingVariant) {
                                  setFormData((prev: any) => ({
                                    ...prev,

                                    items: prev.items.map((it: any) =>
                                      it.id === item.id
                                        ? {
                                          ...it,

                                          size: matchingVariant.size,

                                          color: matchingVariant.color,

                                          variantId: matchingVariant.id,
                                        }
                                        : it,
                                    ),
                                  }));
                                }
                              }}
                              style={{
                                fontSize: 10,

                                fontWeight: 700,

                                color: "var(--ink)",

                                background: "var(--cream)",

                                border: "1px solid var(--line)",

                                borderRadius: 6,

                                padding: "2px 4px",

                                outline: "none",

                                cursor: "pointer",
                              }}
                            >
                              {Array.from(
                                new Set(
                                  productObj.variants
                                    .filter((v: any) => v.size === item.size)
                                    .map((v: any) => v.color),
                                ),
                              ).map((color: any) => (
                                <option key={color} value={color}>
                                  {color}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <>
                            {item.isCustom ? (
                              <div style={{ display: "flex", gap: 4 }}>
                                <input
                                  type="text"
                                  placeholder="Taille"
                                  value={item.size}
                                  onChange={(e) => {
                                    const val = e.target.value;

                                    setFormData((prev: any) => ({
                                      ...prev,

                                      items: prev.items.map((it: any) =>
                                        it.id === item.id
                                          ? { ...it, size: val }
                                          : it,
                                      ),
                                    }));
                                  }}
                                  style={{
                                    width: 50,

                                    fontSize: 10,

                                    fontWeight: 700,

                                    color: "var(--ink)",

                                    background: "var(--cream)",

                                    border: "1px solid var(--line)",

                                    borderRadius: 6,

                                    padding: "2px 4px",

                                    outline: "none",
                                  }}
                                />

                                <input
                                  type="text"
                                  placeholder="Couleur"
                                  value={item.color}
                                  onChange={(e) => {
                                    const val = e.target.value;

                                    setFormData((prev: any) => ({
                                      ...prev,

                                      items: prev.items.map((it: any) =>
                                        it.id === item.id
                                          ? { ...it, color: val }
                                          : it,
                                      ),
                                    }));
                                  }}
                                  style={{
                                    width: 60,

                                    fontSize: 10,

                                    fontWeight: 700,

                                    color: "var(--ink)",

                                    background: "var(--cream)",

                                    border: "1px solid var(--line)",

                                    borderRadius: 6,

                                    padding: "2px 4px",

                                    outline: "none",
                                  }}
                                />
                              </div>
                            ) : (
                              <>
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    color: "var(--brown-soft)",
                                    background: "var(--cream)",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                  }}
                                >
                                  {item.size || "Standard"}
                                </span>
                              </>
                            )}
                          </>
                        );
                      })()}

                      {(!item.productId ||
                        !(
                          products?.find((p: any) => p.id === item.productId) ||
                          catalogProducts?.find(
                            (p: any) => p.id === item.productId,
                          ) ||
                          cartProductsDetails?.find(
                            (p: any) => p.id === item.productId,
                          )
                        )?.variants?.length) &&
                        !item.isCustom && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: "var(--brown-soft)",
                              background: "var(--cream)",
                              padding: "1px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {item.color || "Standard"}
                          </span>
                        )}

                      {getVariantStock(item.productId, item.size, item.color) <=
                        0 && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 800,
                              color: "white",
                              background: "var(--red)",
                              padding: "1px 6px",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              gap: 2,
                            }}
                          >
                            <AlertTriangle size={8} /> RUPTURE
                          </span>
                        )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <input
                            type="number"
                            value={item.price}
                            disabled={item.isGift}
                            onChange={(e) => {
                              const newPrice = Math.max(
                                0,
                                parseInt(e.target.value) || 0,
                              );

                              setFormData((prev: any) => ({
                                ...prev,

                                items: prev.items.map((it: any) =>
                                  it.id === item.id
                                    ? { ...it, price: newPrice }
                                    : it,
                                ),
                              }));
                            }}
                            style={{
                              width: 70,

                              fontSize: 12,

                              fontWeight: 800,

                              color: "var(--orange)",

                              background: item.isGift
                                ? "rgba(0,0,0,0.03)"
                                : "var(--cream)",

                              border: "1px solid var(--line)",

                              borderRadius: 6,

                              padding: "2px 4px",

                              textAlign: "right",

                              outline: "none",

                              opacity: item.isGift ? 0.6 : 1,

                              textDecoration: item.isGift
                                ? "line-through"
                                : "none",
                            }}
                          />

                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: "var(--orange)",
                              opacity: item.isGift ? 0.6 : 1,
                            }}
                          >
                            FCFA
                          </span>
                        </div>

                        <button
                          onClick={() => toggleItemGift(item.id)}
                          type="button"
                          style={{
                            fontSize: 9,

                            fontWeight: 700,

                            color: item.isGift ? "var(--ink)" : "var(--orange)",

                            background: item.isGift
                              ? "#F2F2F7"
                              : "var(--orange-soft)",

                            border: "none",

                            padding: "3px 8px",

                            borderRadius: 6,

                            cursor: "pointer",

                            transition: "all 0.15s ease",
                          }}
                        >
                          {item.isGift ? "Cadeau ✓" : "Offrir"}
                        </button>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          background: "var(--cream)",
                          borderRadius: 6,
                          padding: 2,
                          border: "1px solid var(--line)",
                        }}
                      >
                        <button
                          onClick={() => updateItemQty(item.id, -1)}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 4,
                            background: "white",
                            border: "1px solid var(--line)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--ink)",
                          }}
                        >
                          <Minus size={12} />
                        </button>

                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) => {
                            const newQty = Math.max(
                              1,
                              parseInt(e.target.value) || 1,
                            );

                            setFormData((prev: any) => ({
                              ...prev,

                              items: prev.items.map((it: any) =>
                                it.id === item.id ? { ...it, qty: newQty } : it,
                              ),
                            }));
                          }}
                          style={{
                            width: 28,

                            border: "none",

                            background: "transparent",

                            textAlign: "center",

                            fontSize: 11,

                            fontWeight: 800,

                            color: "var(--ink)",

                            outline: "none",

                            MozAppearance: "textfield",
                          }}
                        />

                        <button
                          onClick={() => updateItemQty(item.id, 1)}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 4,
                            background: "white",
                            border: "1px solid var(--line)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--ink)",
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(item.id)}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "var(--ink)",
                      color: "white",
                      border: "2px solid white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      boxShadow: "var(--shadow-md)",
                    }}
                  >
                    <X size={12} strokeWidth={3} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div
            style={{
              marginTop: 24,
              padding: 24,
              background: "var(--ink)",
              borderRadius: 12,
              color: "white",
              boxShadow: "var(--shadow-lg)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -20,
                right: -20,
                width: 100,
                height: 100,
                background: "rgba(255,255,255,0.03)",
                borderRadius: "50%",
              }}
            ></div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 12,
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.5)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Total des articles
                </div>

                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "white",
                    fontFamily: "var(--font-mono)",
                    marginTop: 2,
                  }}
                >
                  {formatPrice(
                    formData.items.reduce((sum, i) => sum + i.price * i.qty, 0),
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, total: 0 }));

                    setIsTotalManuallySet(true);
                  }}
                  style={{
                    height: "fit-content",
                    background: "var(--red)",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: "pointer",
                    textTransform: "uppercase",
                  }}
                >
                  Solder (0F)
                </button>

                {isTotalManuallySet && (
                  <button
                    onClick={() => setIsTotalManuallySet(false)}
                    style={{
                      height: "fit-content",
                      background: "var(--orange)",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 12px",
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                  >
                    Auto-fix
                  </button>
                )}
              </div>
            </div>

            <label
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: "var(--orange-soft)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 8,
                display: "block",
              }}
            >
              Montant net à encaisser
            </label>

            <div style={{ position: "relative" }}>
              <input
                type="number"
                className="field-input"
                value={formData.total}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    total: parseInt(e.target.value) || 0,
                  });

                  setIsTotalManuallySet(true);
                }}
                style={{
                  fontWeight: 800,
                  color: "white",
                  fontSize: 32,
                  background: "rgba(255,255,255,0.05)",
                  border: "2px solid var(--orange)",

                  height: 64,
                  borderRadius: 10,
                  padding: "0 20px",
                  fontFamily: "var(--font-display)",
                  width: "100%",
                  outline: "none",
                }}
              />

              <div
                style={{
                  position: "absolute",
                  right: 20,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 14,
                  fontWeight: 800,
                  color: "var(--orange)",
                }}
              >
                CFA
              </div>
            </div>
          </div>
        </div>

        {/* VARIANT SELECTOR MODAL */}

        <VariantSelectionModal
          product={selectedProductForVariant}
          onClose={() => setSelectedProductForVariant(null)}
          onAdd={addItemWithVariant}
          sizeFilter={sizeFilter}
          setSizeFilter={setSizeFilter}
          colorFilter={colorFilter}
          setColorFilter={setColorFilter}
          selectedVariant={selectedVariant}
          setSelectedVariant={setSelectedVariant}
          modalQty={selectedQty}
          setModalQty={setSelectedQty}
          setPreviewImage={onPreviewImage}
        />
      </div>
    </Modal>
  );
}
