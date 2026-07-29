"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import { TableCard, EmptyState, StatusBadge } from "@/components/UI";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import { Trash2, Search, RotateCcw, X, History } from "lucide-react";
import { restoreOrder } from "@/modules/orders/actions/trash-actions";
import { useRouter } from "next/navigation";

interface TrashClientProps {
  initialOrders: any[];
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDeletionInfo(history: any): { by?: string; at?: string } {
  if (!Array.isArray(history)) return {};
  const entry = [...history]
    .reverse()
    .find((h) => typeof h?.action === "string" && h.action.includes("SUPPRIMÉE"));
  return entry ? { by: entry.byName || entry.by, at: entry.at } : {};
}

export default function TrashClient({ initialOrders }: TrashClientProps) {
  const [search, setSearch] = useState("");
  const [toRestore, setToRestore] = useState<any>(null);
  const [historyOrder, setHistoryOrder] = useState<any>(null);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const orders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return initialOrders;
    return initialOrders.filter((o) =>
      [o.ref, o.customerName, o.customerPhone]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(q))
    );
  }, [initialOrders, search]);

  const handleRestore = (order: any) => {
    startTransition(async () => {
      try {
        const res = await restoreOrder(order.id);
        showToast(`Commande ${res.ref || ""} restaurée (statut : Annulée).`, "success");
        setToRestore(null);
        router.refresh();
      } catch (e: any) {
        showToast(e?.message || "Impossible de restaurer la commande.", "error");
      }
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par ref, client ou téléphone…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-orange-400"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Effacer la recherche"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <TableCard
        title={`Commandes supprimées (${orders.length})`}
        meta="Les commandes supprimées restent en base : leur ref est préfixée [SUPPRIMÉ] et elles n'apparaissent plus dans les listes. Vous pouvez les restaurer ici."
      >
        {orders.length === 0 ? (
          <EmptyState
            icon={<Trash2 size={28} />}
            title="Corbeille vide"
            description={search ? "Aucune commande supprimée ne correspond à cette recherche." : "Aucune commande supprimée."}
          />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {orders.map((order) => {
              const deletion = getDeletionInfo(order.history);
              return (
                <div
                  key={order.id}
                  className="py-3 px-1 flex flex-col md:flex-row md:items-center gap-2 md:gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{order.ref || "Sans ref"}</span>
                      <StatusBadge status={order.status} size="sm" />
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {order.customerName} · {order.customerPhone}
                      {order.commune ? ` · ${order.commune}` : ""} · {order._count?.items ?? 0} article(s) ·{" "}
                      {(order.total + (order.deliveryFee || 0)).toLocaleString("fr-FR")} F
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Supprimée le {formatDate(deletion.at || order.deletedAt)}
                      {deletion.by ? ` par ${deletion.by}` : ""} · créée le {formatDate(order.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setHistoryOrder(order)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <History size={14} /> Historique
                    </button>
                    <button
                      onClick={() => setToRestore(order)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
                    >
                      <RotateCcw size={14} /> Restaurer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </TableCard>

      {toRestore && (
        <Modal isOpen onClose={() => setToRestore(null)} title="Restaurer la commande">
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Restaurer <span className="font-semibold">{toRestore.ref || toRestore.customerName}</span> ?
              La commande réapparaîtra dans les listes avec le statut <span className="font-semibold">Annulée</span> —
              vous pourrez ensuite lui redonner le bon statut.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setToRestore(null)}
                className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700"
              >
                Annuler
              </button>
              <button
                onClick={() => handleRestore(toRestore)}
                disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {isPending ? "Restauration…" : "Restaurer"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {historyOrder && (
        <Modal isOpen onClose={() => setHistoryOrder(null)} title={`Historique — ${historyOrder.ref || historyOrder.customerName}`}>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {Array.isArray(historyOrder.history) && historyOrder.history.length > 0 ? (
              [...historyOrder.history].reverse().map((h: any, i: number) => (
                <div key={i} className="text-xs border-l-2 border-orange-300 pl-3 py-1">
                  <div className="text-gray-700 dark:text-gray-200">{h.action || "—"}</div>
                  <div className="text-gray-400">
                    {formatDate(h.at)} · {h.byName || h.by || "Système"}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">Aucun historique enregistré.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
