"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileText,
  History,
  Landmark,
  Plus,
  Printer,
  Save,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
} from "lucide-react";
import Modal from "@/components/Modal";
import ReasonModal from "@/components/ReasonModal";
import AmountInput from "@/components/AmountInput";
import { EmptyState, TableCard } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { accountingActionLabel, formatDay, formatPrice } from "@/lib/constants";
import {
  createAccountingCategory,
  createAccountingOperation,
  deleteAccountingCategory,
  deleteAccountingOperation,
  getAccountingReportOperations,
  updateAccountingCategory,
  updateAccountingOperation,
} from "@/modules/accounting/actions";

type CategoryType = "INCOME" | "EXPENSE";
type OperationType = "INCOME" | "EXPENSE" | "CORRECTION";

type AccountingClientProps = {
  workspace: any;
};

function dateInputValue(dateValue?: string | Date) {
  const date = dateValue ? new Date(dateValue) : new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function operationLabel(type: string) {
  if (type === "INCOME") return "Entree";
  if (type === "EXPENSE") return "Sortie";
  return "Correction";
}

// Valeur signee sur la caisse : positive = credit (entree), negative = debit (sortie).
// Une CORRECTION porte deja son signe (negative => elle diminue la caisse), une
// EXPENSE est toujours un debit. Aligne sur summarizeOperations cote serveur.
function signedValue(operation: { type: string; amount: number }) {
  if (operation.type === "EXPENSE") return -Math.abs(Number(operation.amount || 0));
  return Number(operation.amount || 0);
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    DELIVERY: "Livraison",
    CUSTOMER: "Client",
    MANUAL: "Manuel",
    OTHER: "Autre",
  };
  return labels[source] || source;
}

function operationTone(type: string) {
  if (type === "INCOME") return "border-[var(--green-soft)] bg-[var(--green-soft)] text-[var(--green)]";
  if (type === "EXPENSE") return "border-[var(--red-soft)] bg-[var(--red-soft)] text-[var(--red)]";
  return "border-[var(--orange-soft)] bg-[var(--orange-soft)] text-[var(--orange)]";
}

export default function AccountingClient({ workspace }: AccountingClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [activeModal, setActiveModal] = useState<"operation" | "category" | "categoryPlan" | null>(null);
  const [editingOperation, setEditingOperation] = useState<any>(null);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [operationDraftType, setOperationDraftType] = useState<OperationType>("INCOME");
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [deletingOperation, setDeletingOperation] = useState<any>(null);

  const incomeCategories = workspace.categories.filter((category: any) => category.type === "INCOME");
  const expenseCategories = workspace.categories.filter((category: any) => category.type === "EXPENSE");
  const sessionDate = dateInputValue(workspace.session.date);
  const isClosed = workspace.session.status === "CLOSED";
  const hasActiveFilters = Boolean(searchTerm.trim() || typeFilter !== "ALL" || categoryFilter !== "ALL");
  // Sessions d'autres jours encore ouvertes : on les remonte pour ne pas les oublier.
  const staleOpenSessions = workspace.sessions.filter(
    (session: any) => session.status !== "CLOSED" && dateInputValue(session.date) !== sessionDate,
  );

  const openOperationModal = (type: OperationType) => {
    if (isClosed) {
      showToast("Session cloturee : reouvrez-la depuis le detail pour ajouter une ecriture.", "error");
      return;
    }
    setOperationDraftType(type);
    setActiveModal("operation");
  };

  const filteredOperations = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return workspace.operations.filter((operation: any) => {
      const matchesSearch = !search || [
        operation.description,
        operation.category?.name,
        operation.deliveryOrderRef,
        operation.clientName,
        operation.riderName,
        operation.createdByName,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      const matchesType = typeFilter === "ALL" || operation.type === typeFilter;
      const matchesCategory = categoryFilter === "ALL" || operation.categoryId === categoryFilter;
      return matchesSearch && matchesType && matchesCategory;
    });
  }, [workspace.operations, searchTerm, typeFilter, categoryFilter]);
  const filteredTotals = useMemo(() => {
    return filteredOperations.reduce((totals: { debit: number; credit: number }, operation: any) => {
      const value = signedValue(operation);
      if (value < 0) totals.debit += -value;
      else totals.credit += value;
      return totals;
    }, { debit: 0, credit: 0 });
  }, [filteredOperations]);

  // Solde cumule calcule sur TOUTES les ecritures de la session, dans l'ordre
  // chronologique (plus ancien -> plus recent). Reste correct meme sous filtre :
  // chaque ligne affiche le solde reel de la caisse a cet instant.
  const balanceById = useMemo(() => {
    const ordered = [...workspace.operations].sort(
      (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const map: Record<string, number> = {};
    let running = 0;
    for (const operation of ordered) {
      running += signedValue(operation);
      map[operation.id] = running;
    }
    return map;
  }, [workspace.operations]);

  // Affichage chronologique ascendant : un grand livre se lit du haut vers le bas
  // avec un solde cumule croissant.
  const displayedOperations = useMemo(
    () => [...filteredOperations].sort(
      (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
    [filteredOperations],
  );

  const changeDate = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", value);
    router.push(`?${params.toString()}`);
  };

  // Navigation jour precedent / suivant sans passer par le date picker.
  const shiftDate = (days: number) => {
    const date = new Date(`${sessionDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    changeDate(dateInputValue(date));
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
      <section className="mb-5 overflow-hidden rounded-lg border border-[var(--line-2)] bg-[var(--navy)] text-white shadow-sm">
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--orange-light)]">
              <Landmark size={14} /> Comptabilite generale
            </div>
            <h1 className="text-[22px] font-black md:text-[26px]">Journal de caisse</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex h-10 items-center overflow-hidden rounded-md border border-white/15 bg-white/10">
              <button
                type="button"
                onClick={() => shiftDate(-1)}
                aria-label="Jour precedent"
                className="flex h-full w-9 items-center justify-center text-white/70 hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft size={16} />
              </button>
              <label className="flex h-full items-center gap-2 border-x border-white/15 px-3">
                <Calendar size={15} className="text-white/70" />
                <input
                  type="date"
                  value={sessionDate}
                  onChange={(event) => changeDate(event.target.value)}
                  className="bg-transparent text-[13px] font-black text-white outline-none [color-scheme:dark]"
                />
              </label>
              <button
                type="button"
                onClick={() => shiftDate(1)}
                aria-label="Jour suivant"
                className="flex h-full w-9 items-center justify-center text-white/70 hover:bg-white/10 hover:text-white"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--orange)] px-3 text-[12px] font-black text-white hover:bg-[var(--orange-dark)]" onClick={() => openOperationModal("INCOME")}>
              <ArrowUpCircle size={15} /> Entree
            </button>
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 bg-white px-3 text-[12px] font-black text-[var(--navy)] hover:bg-[var(--cream)]" onClick={() => openOperationModal("EXPENSE")}>
              <ArrowDownCircle size={15} /> Sortie
            </button>
            <Link href="/zangochap-manager/accounting/bilan" className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-[12px] font-black text-white hover:bg-white/15">
              <FileText size={15} /> Bilan
            </Link>
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-[12px] font-black text-white hover:bg-white/15" onClick={() => setActiveModal("categoryPlan")}>
              <Tag size={15} /> Categories
            </button>
          </div>
        </div>
      </section>

      {isClosed && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--green-soft)] bg-[var(--green-soft)] px-4 py-2.5 text-[12px] font-bold text-[var(--green)]">
          <span>Session cloturee : les ecritures sont verrouillees.</span>
          <Link href={`/zangochap-manager/accounting/sessions/${workspace.session.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--green-soft)] bg-white px-3 py-1.5 font-black hover:bg-[var(--green-soft)]">
            Gerer la cloture
          </Link>
        </div>
      )}

      {staleOpenSessions.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--orange-soft)] bg-[var(--orange-soft)] px-4 py-2.5 text-[12px] font-bold text-[var(--red)]">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle size={14} /> {staleOpenSessions.length} session(s) d&apos;autres jours encore ouverte(s) a cloturer.
          </span>
          <Link href={`/zangochap-manager/accounting/sessions/${staleOpenSessions[0].id}`} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--orange-soft)] bg-white px-3 py-1.5 font-black hover:bg-[var(--orange-soft)]">
            Traiter ({dateInputValue(staleOpenSessions[0].date)})
          </Link>
        </div>
      )}

      <section className="mb-5 rounded-lg border border-[var(--line)] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--brown-soft)]">
            <Landmark size={13} /> Flux de caisse du jour
          </div>
          <span className="text-[11px] font-semibold text-[var(--brown-soft)]">{workspace.totals.count} operation(s)</span>
        </div>
        <div className="grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <FlowTile label="Total entrees" value={formatPrice(workspace.totals.totalIncome)} chip={{ text: "credit", tone: "ok" }} />
          <FlowArrow />
          <FlowTile label="Total sorties" value={formatPrice(workspace.totals.totalExpense)} chip={{ text: "debit", tone: "dang" }} />
          <FlowArrow />
          <FlowTile label="Solde final" value={formatPrice(workspace.totals.balance)} accent sub="entrees moins sorties" />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <TableCard
          title="Grand livre de la session"
          meta={`${filteredOperations.length}/${workspace.operations.length} ecriture(s)`}
          actions={
            <div className="hidden items-center gap-2 text-[11px] font-bold uppercase text-[var(--brown-soft)] md:flex">
              <SlidersHorizontal size={13} />
              Controle
            </div>
          }
        >
          <div className="grid gap-2 border-b border-[var(--line)] bg-[var(--cream)] p-3 lg:grid-cols-[minmax(220px,1fr)_150px_190px]">
            <label className="flex h-10 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3">
              <Search size={15} className="text-[var(--brown-soft)]" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Rechercher libelle, client, livreur, reference..."
                className="min-w-0 flex-1 bg-transparent text-[12px] font-bold text-[var(--ink)] outline-none"
              />
            </label>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-[12px] font-black text-[var(--ink)] outline-none"
            >
              <option value="ALL">Tous types</option>
              <option value="INCOME">Entrees</option>
              <option value="EXPENSE">Sorties</option>
              <option value="CORRECTION">Corrections</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-[12px] font-black text-[var(--ink)] outline-none"
            >
              <option value="ALL">Toutes categories</option>
              {workspace.categories.map((category: any) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-white px-4 py-2">
              <div className="text-[11px] font-bold text-[var(--brown-soft)]">
                Vue filtree: credit {formatPrice(filteredTotals.credit)} / debit {formatPrice(filteredTotals.debit)}
              </div>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-[var(--line)] px-2 text-[11px] font-black text-[var(--brown-soft)] hover:bg-[var(--cream)]"
                onClick={() => {
                  setSearchTerm("");
                  setTypeFilter("ALL");
                  setCategoryFilter("ALL");
                }}
              >
                Effacer les filtres
              </button>
            </div>
          )}
          {workspace.operations.length === 0 ? (
            <EmptyState icon={<Landmark size={22} />} title="Aucune operation" description="Les livraisons du jour seront ajoutees automatiquement apres synchronisation." />
          ) : filteredOperations.length === 0 ? (
            <EmptyState icon={<Search size={22} />} title="Aucune ecriture trouvee" description="Ajustez la recherche, le type ou la categorie." />
          ) : (
            <>
            {/* Vue cartes mobile : le tableau 8 colonnes est illisible sous md. */}
            <div className="divide-y divide-[var(--cream-2)] md:hidden">
              {displayedOperations.map((operation: any) => {
                const value = signedValue(operation);
                const isDebit = value < 0;
                const runningBalance = balanceById[operation.id] ?? 0;
                return (
                  <div key={operation.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-black text-[var(--ink)]">{operation.description || operationLabel(operation.type)}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[var(--brown-soft)]">
                          <span className={`inline-flex rounded-sm border px-1.5 py-0.5 ${operationTone(operation.type)}`}>
                            {operationLabel(operation.type)}
                          </span>
                          <span>{operation.category?.name || "Sans categorie"}</span>
                          {operation.deliveryOrderRef && <span className="font-mono">Ref {operation.deliveryOrderRef}</span>}
                        </div>
                        <div className="mt-1 text-[11px] font-semibold text-[var(--brown-soft)]">
                          {dateInputValue(operation.createdAt)} {new Date(operation.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {operation.createdByName || "Systeme"}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`font-mono text-[14px] font-black ${isDebit ? "text-[var(--red)]" : "text-[var(--green)]"}`}>
                          {isDebit ? "-" : "+"}{formatPrice(Math.abs(value))}
                        </div>
                        <div className={`mt-0.5 font-mono text-[11px] font-semibold ${runningBalance < 0 ? "text-[var(--red)]" : "text-[var(--brown-soft)]"}`}>
                          solde {formatPrice(runningBalance)}
                        </div>
                        <div className="mt-2 flex justify-end gap-1">
                          <button
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--brown-soft)]"
                            title="Modifier ou regulariser"
                            aria-label="Modifier ou regulariser l'ecriture"
                            onClick={() => setEditingOperation(operation)}
                          >
                            <Edit3 size={14} />
                          </button>
                          {operation.source !== "DELIVERY" && (
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--orange-soft)] bg-[var(--orange-soft)] text-[var(--orange)]"
                              title="Supprimer"
                              aria-label="Supprimer l'ecriture"
                              onClick={() => setDeletingOperation(operation)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3 border-t-2 border-[var(--line)] bg-[var(--cream)] px-4 py-3 text-[12px] font-black">
                <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Totaux</span>
                <span className="font-mono">
                  <span className="text-[var(--green)]">+{formatPrice(filteredTotals.credit)}</span>
                  <span className="mx-1 text-[var(--line-2)]">/</span>
                  <span className="text-[var(--red)]">-{formatPrice(filteredTotals.debit)}</span>
                </span>
              </div>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-[11px] font-bold uppercase text-[var(--brown-soft)]">
                    <th className="w-[110px] px-4 py-3">Date</th>
                    <th className="min-w-[320px] px-3 py-3">Libelle</th>
                    <th className="min-w-[170px] px-3 py-3">Categorie</th>
                    <th className="min-w-[130px] px-3 py-3">Source</th>
                    <th className="px-3 py-3 text-right">Debit</th>
                    <th className="px-3 py-3 text-right">Credit</th>
                    <th className="px-3 py-3 text-right">Solde</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedOperations.map((operation: any) => {
                    const value = signedValue(operation);
                    const isDebit = value < 0;
                    const runningBalance = balanceById[operation.id] ?? 0;
                    return (
                    <tr key={operation.id} className="border-b border-[var(--cream-2)] text-[12px] last:border-b-0 hover:bg-[var(--cream)] transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-[11px] font-black text-[var(--ink)]">{dateInputValue(operation.createdAt)}</div>
                        <div className="text-[11px] font-semibold text-[var(--brown-soft)]">{new Date(operation.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-black text-[var(--ink)]">{operation.description || operationLabel(operation.type)}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[var(--brown-soft)]">
                          <span className={`inline-flex rounded-sm border px-1.5 py-0.5 ${operationTone(operation.type)}`}>
                            {operationLabel(operation.type)}
                          </span>
                          {operation.deliveryOrderRef && <span className="font-mono">Ref {operation.deliveryOrderRef}</span>}
                          {operation.clientName && <span>Client: {operation.clientName}</span>}
                          {operation.riderName && <span>Livreur: {operation.riderName}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="inline-flex rounded-md bg-[var(--cream-2)] px-2 py-1 text-[11px] font-bold text-[var(--brown-soft)]">
                          {operation.category?.name || "Sans categorie"}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="text-[12px] font-black text-[var(--ink)]">{sourceLabel(operation.source)}</div>
                        <div className="text-[11px] font-semibold text-[var(--brown-soft)]">{operation.createdByName || "Systeme"}</div>
                      </td>
                      <td className="px-3 py-3 text-right align-top font-mono text-[12px] font-black text-[var(--red)]">
                        {isDebit ? formatPrice(-value) : <span className="text-[var(--line-2)]">·</span>}
                      </td>
                      <td className="px-3 py-3 text-right align-top font-mono text-[12px] font-black text-[var(--green)]">
                        {!isDebit ? formatPrice(value) : <span className="text-[var(--line-2)]">·</span>}
                      </td>
                      <td className={`px-3 py-3 text-right align-top font-mono text-[12px] font-black ${runningBalance < 0 ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>
                        {formatPrice(runningBalance)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex justify-end gap-1">
                          <button
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--brown-soft)] hover:bg-[var(--cream-2)]"
                            title="Modifier ou regulariser"
                            aria-label="Modifier ou regulariser l'ecriture"
                            onClick={() => setEditingOperation(operation)}
                          >
                            <Edit3 size={14} />
                          </button>
                          {operation.source !== "DELIVERY" && (
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--orange-soft)] bg-[var(--orange-soft)] text-[var(--orange)] hover:bg-[var(--red-soft)]"
                              title="Supprimer"
                              aria-label="Supprimer l'ecriture"
                              onClick={() => setDeletingOperation(operation)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--line)] bg-[var(--cream)] text-[12px] font-black">
                    <td colSpan={4} className="px-4 py-3 text-right text-[10px] uppercase text-[var(--brown-soft)]">
                      Totaux ({displayedOperations.length} ecriture(s))
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-[var(--red)]">{formatPrice(filteredTotals.debit)}</td>
                    <td className="px-3 py-3 text-right font-mono text-[var(--green)]">{formatPrice(filteredTotals.credit)}</td>
                    <td className="px-3 py-3 text-right font-mono text-[var(--orange)]">{formatPrice(filteredTotals.credit - filteredTotals.debit)}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          )}
        </TableCard>

        <div className="flex flex-col gap-4">
          <TableCard title="Grand livre des sessions" meta={`${workspace.openSessionsCount || 0} ouverte(s)`}>
            <div className="divide-y divide-[var(--cream-2)]">
              {workspace.sessions.map((session: any) => {
                const open = session.status !== "CLOSED";
                return (
                  <Link
                    key={session.id}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--cream)] ${open ? "border-l-2 border-[var(--orange)]" : "border-l-2 border-transparent"}`}
                    href={`/zangochap-manager/accounting/sessions/${session.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-black text-[var(--ink)]">{dateInputValue(session.date)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${open ? "bg-[var(--orange-soft)] text-[var(--orange)]" : "bg-[var(--green-soft)] text-[var(--green)]"}`}>
                          {open ? "Ouverte" : "Cloturee"}
                        </span>
                        {session.pendingDelivery && (
                          <span className="rounded-full bg-[var(--amber-soft)] px-2 py-0.5 text-[11px] font-semibold uppercase text-[var(--amber)]">A valider</span>
                        )}
                      </div>
                      <div className="text-[11px] font-semibold text-[var(--brown-soft)]">{session.summary.count} operation(s)</div>
                    </div>
                    <div className="text-right text-[12px] font-black text-[var(--orange)]">{formatPrice(session.summary.balance)}</div>
                  </Link>
                );
              })}
            </div>
          </TableCard>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TableCard title="Bilans sauvegardes" meta={`${workspace.reports.length} bilan(s)`}>
          {workspace.reports.length === 0 ? (
            <EmptyState icon={<FileText size={22} />} title="Aucun bilan sauvegarde" description="Creez un bilan journalier, hebdomadaire, mensuel ou filtre libre." />
          ) : (
            <div className="divide-y divide-[var(--cream-2)]">
              {workspace.reports.map((report: any) => (
                <div key={report.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-[13px] font-black text-[var(--ink)]">{report.name}</div>
                    <div className="text-[11px] font-semibold text-[var(--brown-soft)]">
                      {dateInputValue(report.dateFrom)} - {dateInputValue(report.dateTo)} · {report.operationsCount} operation(s)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-black text-[var(--ink)]">{formatPrice(report.balance)}</span>
                    <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)]" title="Imprimer" aria-label={`Imprimer le bilan ${report.name}`} onClick={() => printReport(report)}>
                      <Printer size={13} />
                    </button>
                    <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)]" title="Exporter CSV" aria-label={`Exporter le bilan ${report.name} en CSV`} onClick={() => exportReportCsv(report)}>
                      <Download size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TableCard>

        <TableCard title="Historique et regularisations" meta={`${workspace.audits.length} trace(s)`}>
          {workspace.audits.length === 0 ? (
            <EmptyState icon={<History size={22} />} title="Aucun historique" description="Les creations, modifications et regularisations seront listees ici." />
          ) : (
            <div className="divide-y divide-[var(--cream-2)]">
              {workspace.audits.map((audit: any) => (
                <div key={audit.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-black text-[var(--ink)]">{accountingActionLabel(audit.action)}</div>
                    <div className="text-[11px] font-semibold text-[var(--brown-soft)]">{formatDay(audit.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-[var(--brown-soft)]">
                    {audit.actorName || "Systeme"}{audit.previousAmount !== null && audit.newAmount !== null ? ` · ${formatPrice(audit.previousAmount)} vers ${formatPrice(audit.newAmount)}` : ""}
                  </div>
                  {audit.reason && <div className="mt-1 text-[11px] text-[var(--brown-soft)]">{audit.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </TableCard>
      </div>

      {(activeModal === "operation" || editingOperation) && (
        <OperationModal
          sessionId={workspace.session.id}
          operation={editingOperation}
          initialType={operationDraftType}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          customers={workspace.customers || []}
          currentBalance={workspace.totals.balance}
          onClose={() => {
            setActiveModal(null);
            setEditingOperation(null);
          }}
        />
      )}
      {(activeModal === "category" || editingCategory) && (
        <CategoryModal
          category={editingCategory}
          onClose={() => {
            setActiveModal(null);
            setEditingCategory(null);
          }}
        />
      )}
      {deletingOperation && (
        <ReasonModal
          title="Supprimer l'ecriture"
          description={`Suppression de "${deletingOperation.description || operationLabel(deletingOperation.type)}" (${formatPrice(deletingOperation.amount)}). Cette action est journalisee.`}
          confirmLabel="Supprimer l'ecriture"
          danger
          placeholder="Ex. doublon de saisie, erreur de montant..."
          onConfirm={async (reason) => {
            try {
              await deleteAccountingOperation(deletingOperation.id, reason);
              showToast("Operation supprimee", "success");
              setDeletingOperation(null);
              router.refresh();
            } catch (error: any) {
              showToast(error.message || "Suppression impossible", "error");
            }
          }}
          onClose={() => setDeletingOperation(null)}
        />
      )}
      {activeModal === "categoryPlan" && (
        <CategoryPlanModal
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          onNewCategory={() => {
            setActiveModal("category");
          }}
          onEdit={setEditingCategory}
          onDelete={async (category: any) => {
            await deleteAccountingCategory(category.id);
            showToast("Categorie supprimee", "success");
            router.refresh();
          }}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

function FlowTile({ label, value, sub, chip, accent }: {
  label: string;
  value: string;
  sub?: string;
  chip?: { text: string; tone: "ok" | "dang" | "info" };
  accent?: boolean;
}) {
  const chipClasses: Record<string, string> = {
    ok: "bg-[var(--green-soft)] text-[var(--green)]",
    dang: "bg-[var(--red-soft)] text-[var(--red)]",
    info: "bg-[var(--blue-soft)] text-[var(--blue)]",
  };
  return (
    <div className="rounded-md border border-[var(--cream-2)] bg-[var(--cream)] px-3 py-3">
      <div className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">{label}</div>
      <div className={`mt-1 text-[19px] font-black ${accent ? "text-[var(--orange)]" : "text-[var(--ink)]"}`}>{value}</div>
      {chip && <span className={`mt-1.5 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${chipClasses[chip.tone]}`}>{chip.text}</span>}
      {sub && <div className="mt-1 text-[11px] font-semibold text-[var(--brown-soft)]">{sub}</div>}
    </div>
  );
}

function FlowArrow() {
  return <div className="hidden items-center justify-center text-[var(--line-2)] md:flex" aria-hidden="true"><ChevronRight size={18} /></div>;
}

function CategoryList({ title, categories, onEdit, onDelete }: { title: string; categories: any[]; onEdit: (category: any) => void; onDelete: (category: any) => void }) {
  return (
    <div className="border-b border-[var(--cream-2)] last:border-b-0">
      <div className="bg-[var(--cream)] px-4 py-2 text-[11px] font-bold uppercase text-[var(--brown-soft)]">{title}</div>
      {categories.map((category) => (
        <div key={category.id} className="flex items-center justify-between gap-2 px-4 py-2">
          <div>
            <div className="text-[12px] font-black text-[var(--ink)]">{category.name}</div>
            <div className="text-[11px] font-semibold text-[var(--brown-soft)]">{category.isDefault ? "Par defaut" : "Personnalisee"}</div>
          </div>
          <div className="flex gap-1">
            <button className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--line)]" onClick={() => onEdit(category)} title="Modifier" aria-label={`Modifier la categorie ${category.name}`}>
              <Edit3 size={12} />
            </button>
            {!category.isDefault && (
              <button className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--orange-soft)] text-[var(--orange)]" onClick={() => onDelete(category)} title="Supprimer" aria-label={`Supprimer la categorie ${category.name}`}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryPlanModal({
  incomeCategories,
  expenseCategories,
  onNewCategory,
  onEdit,
  onDelete,
  onClose,
}: {
  incomeCategories: any[];
  expenseCategories: any[];
  onNewCategory: () => void;
  onEdit: (category: any) => void;
  onDelete: (category: any) => void;
  onClose: () => void;
}) {
  return (
    <Modal isOpen onClose={onClose} title="Plan de categories" xl>
      <div className="grid gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--cream)] p-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[13px] font-black text-[var(--ink)]">Categories comptables</div>
            <div className="text-[11px] font-bold text-[var(--brown-soft)]">
              Classez chaque ecriture pour obtenir des bilans fiables.
            </div>
          </div>
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-3 text-[12px] font-black text-white" onClick={onNewCategory}>
            <Plus size={14} /> Nouvelle categorie
          </button>
        </div>
        <div className="grid overflow-hidden rounded-lg border border-[var(--line)] lg:grid-cols-2">
          <CategoryList title="Categories d'entree" categories={incomeCategories} onEdit={onEdit} onDelete={onDelete} />
          <CategoryList title="Categories de sortie" categories={expenseCategories} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
    </Modal>
  );
}

function OperationModal({ sessionId, operation, initialType, incomeCategories, expenseCategories, customers = [], currentBalance = 0, onClose }: any) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<OperationType>(operation?.type || initialType || "INCOME");
  const categories = type === "EXPENSE" ? expenseCategories : incomeCategories;
  const [categoryId, setCategoryId] = useState(operation?.categoryId || categories[0]?.id || "");

  // Changer de type invalide la categorie courante (une categorie d'entree ne peut
  // pas porter une sortie) : on la realigne sur la liste du nouveau type.
  const switchType = (next: OperationType) => {
    setType(next);
    const list = next === "EXPENSE" ? expenseCategories : incomeCategories;
    setCategoryId(operation && operation.type === next ? operation.categoryId : list[0]?.id || "");
  };
  const [amount, setAmount] = useState(operation?.amount || "");
  const [description, setDescription] = useState(operation?.description || "");
  const [proofUrl, setProofUrl] = useState(operation?.proofUrl || "");
  const [reason, setReason] = useState(operation?.reason || "");
  const [customerId, setCustomerId] = useState(operation?.customerId || "");
  // Le rattachement client n'a de sens que pour une entree creee manuellement.
  const isCorrection = type === "CORRECTION";
  const showCustomer = !operation && type === "INCOME";

  // Valeur signee sur la caisse (sortie = negatif, correction garde son signe).
  const typed = Number(amount || 0);
  const signed = type === "EXPENSE" ? -Math.abs(typed) : typed;
  const projectedBalance = Number(currentBalance) + signed;
  // A la creation, une operation qui rend le solde negatif exige un motif.
  const requiresNegativeReason = !operation && signed < 0 && projectedBalance < 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (requiresNegativeReason && !reason.trim()) {
      showToast("Cette operation rend le solde negatif : un motif est obligatoire.", "error");
      return;
    }
    startTransition(async () => {
      try {
        if (operation) {
          await updateAccountingOperation(operation.id, { amount: Number(amount), categoryId, description, proofUrl, reason });
          showToast("Operation regularisee", "success");
        } else {
          await createAccountingOperation({ sessionId, categoryId, type, amount: Number(amount), description, proofUrl, source: "MANUAL", customerId: customerId || undefined, reason: requiresNegativeReason ? reason.trim() : undefined });
          showToast("Operation ajoutee", "success");
        }
        router.refresh();
        onClose();
      } catch (error: any) {
        showToast(error.message || "Erreur comptable", "error");
      }
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={operation ? "Modifier / regulariser" : "Ajouter une operation"}>
      <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Type</span>
          <select className="field-input" value={type} onChange={(event) => switchType(event.target.value as OperationType)} disabled={Boolean(operation?.source === "DELIVERY")}>
            <option value="INCOME">Entree</option>
            <option value="EXPENSE">Sortie</option>
            <option value="CORRECTION">Correction</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Categorie</span>
          <select className="field-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            {categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <div className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Montant {operation?.source === "DELIVERY" ? "recu" : ""}</span>
          <div className="flex items-center gap-2">
            <AmountInput className="field-input flex-1" allowNegative={isCorrection} value={amount} onChange={setAmount} required />
            {operation?.source === "DELIVERY" && operation.originalAmount && (
              <button type="button" className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--line)] bg-white px-3 text-[11px] font-black text-[var(--brown-soft)] whitespace-nowrap hover:bg-[var(--cream)]" onClick={() => setAmount(operation.originalAmount)}>
                Matcher ({formatPrice(operation.originalAmount)})
              </button>
            )}
          </div>
          {operation?.source === "DELIVERY" && operation.originalAmount !== undefined && operation.originalAmount !== null && (
            <div className={`mt-1 text-[11px] font-bold ${Number(amount) === operation.originalAmount ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {Number(amount) === operation.originalAmount
                ? "OK - Le montant correspond au total attendu"
                : `Ecart : ${Number(amount) > operation.originalAmount ? '+' : ''}${formatPrice(Number(amount) - operation.originalAmount)} (Attendu: ${formatPrice(operation.originalAmount)})`
              }
            </div>
          )}
          {isCorrection && (
            <div className="mt-1 text-[11px] font-bold text-[var(--orange)]">
              Montant negatif autorise pour diminuer la caisse (ex. -5000).
            </div>
          )}
        </div>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Description</span>
          <textarea className="field-input" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        {showCustomer && (
          <label className="grid gap-1">
            <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Client (optionnel)</span>
            <select className="field-input" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Aucun client</option>
              {customers.map((customer: any) => (
                <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` (${customer.phone})` : ""}</option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Piece justificative</span>
          <input className="field-input" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="URL ou reference interne" />
        </label>
        {operation && (
          <label className="grid gap-1">
            <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Raison de la modification</span>
            <input className="field-input" value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Ex. Regularisation montant livreur" />
          </label>
        )}
        {requiresNegativeReason && (
          <div className="grid gap-1 rounded-md border border-[var(--red-soft)] bg-[var(--red-soft)] p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-black text-[var(--red)]">
              <AlertTriangle size={13} /> Solde de caisse negatif ({formatPrice(projectedBalance)})
            </div>
            <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Motif obligatoire</span>
            <textarea className="field-input" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} required placeholder="Ex. avance sur recette, depense urgente couverte demain..." />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-orange" disabled={isPending || (requiresNegativeReason && !reason.trim())}>
            <Save size={14} /> {isPending ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryModal({ category, onClose }: any) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(category?.name || "");
  const [type, setType] = useState<CategoryType>(category?.type || "INCOME");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        if (category) {
          await updateAccountingCategory(category.id, { name });
          showToast("Categorie modifiee", "success");
        } else {
          await createAccountingCategory({ name, type });
          showToast("Categorie creee", "success");
        }
        router.refresh();
        onClose();
      } catch (error: any) {
        showToast(error.message || "Erreur categorie", "error");
      }
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={category ? "Modifier la categorie" : "Nouvelle categorie"}>
      <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Nom</span>
          <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Type</span>
          <select className="field-input" value={type} onChange={(event) => setType(event.target.value as CategoryType)} disabled={Boolean(category)}>
            <option value="INCOME">Entree</option>
            <option value="EXPENSE">Sortie</option>
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-orange" disabled={isPending}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

// Neutralise l'injection de formule tableur : une cellule texte commencant par
// =, +, @ ou - (hors nombre) est prefixee d'une apostrophe avant l'echappement.
function csvCell(value: unknown) {
  const text = String(value ?? "");
  const risky = /^[=+@-]/.test(text) && Number.isNaN(Number(text));
  return `"${(risky ? `'${text}` : text).replace(/"/g, '""')}"`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string
  ));
}

// Impression dediee : window.print() sur la page imprimait tout le back office.
// On genere un document minimal contenant uniquement le bilan demande.
async function printReport(report: any) {
  let operations: any[] = [];
  try {
    operations = await getAccountingReportOperations(report.id);
  } catch {
    operations = [];
  }
  const rows = operations.map((op) => `
    <tr>
      <td>${escapeHtml(dateInputValue(op.date))}</td>
      <td>${escapeHtml(operationLabel(op.type))}</td>
      <td>${escapeHtml(op.categoryName || "")}</td>
      <td>${escapeHtml((op.description || "").replace(/\s+/g, " "))}</td>
      <td class="num">${escapeHtml(formatPrice(op.amount))}</td>
    </tr>
  `).join("");
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.name)}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #1A1410; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #6B4838; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #E8DDD0; padding: 6px 8px; text-align: left; }
  th { text-transform: uppercase; font-size: 10px; color: #6B4838; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 2px solid #E8DDD0; }
</style>
</head>
<body>
<h1>${escapeHtml(report.name)}</h1>
<div class="meta">Du ${escapeHtml(dateInputValue(report.dateFrom))} au ${escapeHtml(dateInputValue(report.dateTo))} · ${escapeHtml(String(report.operationsCount))} operation(s)</div>
<table>
<thead><tr><th>Date</th><th>Type</th><th>Categorie</th><th>Libelle</th><th class="num">Montant</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="4">Solde</td><td class="num">${escapeHtml(formatPrice(report.balance))}</td></tr></tfoot>
</table>
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
}

async function exportReportCsv(report: any) {
  let operations: any[] = [];
  try {
    operations = await getAccountingReportOperations(report.id);
  } catch {
    operations = [];
  }
  const header = ["Date", "Type", "Source", "Categorie", "Libelle", "Livreur", "Client", "Montant"];
  const body = operations.map((op) => [
    dateInputValue(op.date),
    operationLabel(op.type),
    sourceLabel(op.source),
    op.categoryName || "",
    (op.description || "").replace(/\s+/g, " "),
    op.riderName || "",
    op.clientName || "",
    op.amount,
  ]);
  const summary = ["", "", "", "", `${report.name}`, "Solde", "", report.balance];
  const rows = [header, ...body, summary];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
