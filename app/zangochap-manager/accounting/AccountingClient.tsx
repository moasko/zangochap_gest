"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  Download,
  Edit3,
  FileText,
  Filter,
  Landmark,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Tag,
  Trash2,
  Wallet,
} from "lucide-react";
import Modal from "@/components/Modal";
import { EmptyState, StatusBadge, TableCard } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { formatDay, formatPrice } from "@/lib/constants";
import {
  createAccountingCategory,
  createAccountingOperation,
  createAccountingReport,
  deleteAccountingCategory,
  deleteAccountingOperation,
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

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    DELIVERY: "Livraison",
    CUSTOMER: "Client",
    MANUAL: "Manuel",
    OTHER: "Autre",
  };
  return labels[source] || source;
}

export default function AccountingClient({ workspace }: AccountingClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [activeModal, setActiveModal] = useState<"operation" | "category" | "report" | null>(null);
  const [editingOperation, setEditingOperation] = useState<any>(null);
  const [editingCategory, setEditingCategory] = useState<any>(null);

  const incomeCategories = workspace.categories.filter((category: any) => category.type === "INCOME");
  const expenseCategories = workspace.categories.filter((category: any) => category.type === "EXPENSE");
  const sessionDate = dateInputValue(workspace.session.date);

  const changeDate = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", value);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
      <div className="mb-5 flex flex-col gap-4 border-b border-[#E8DED4] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase text-[#D4541C]">
            <Landmark size={14} />
            Comptabilite
          </div>
          <h1 className="text-[24px] font-black text-[#1A1410] md:text-[28px]">Session comptable journaliere</h1>
          <p className="mt-1 max-w-2xl text-[13px] font-semibold text-[#806A58]">
            Entrees de livraison synchronisees, sorties manuelles, regularisations et bilans sauvegardes.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex h-10 items-center gap-2 rounded-md border border-[#E8DED4] bg-white px-3 shadow-sm">
            <Calendar size={15} className="text-[#8B735E]" />
            <input
              type="date"
              value={sessionDate}
              onChange={(event) => changeDate(event.target.value)}
              className="bg-transparent text-[13px] font-black text-[#1A1410] outline-none"
            />
          </label>
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[#1A1410] px-3 text-[12px] font-black text-white" onClick={() => setActiveModal("operation")}>
            <Plus size={15} /> Operation
          </button>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-[#E8DED4] bg-white px-3 text-[12px] font-black text-[#6B4F3B]" onClick={() => setActiveModal("report")}>
            <FileText size={15} /> Bilan
          </button>
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <MetricCard icon={<Wallet size={18} />} label="Total entrees" value={formatPrice(workspace.totals.totalIncome)} tone="orange" />
        <MetricCard icon={<ReceiptText size={18} />} label="Total sorties" value={formatPrice(workspace.totals.totalExpense)} tone="blue" />
        <MetricCard icon={<Landmark size={18} />} label="Solde final" value={formatPrice(workspace.totals.balance)} tone="ink" />
        <MetricCard icon={<Filter size={18} />} label="Operations" value={workspace.totals.count} tone="green" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <TableCard title="Operations de la session" meta={`${workspace.operations.length} ligne(s)`}>
          {workspace.operations.length === 0 ? (
            <EmptyState icon="$" title="Aucune operation" description="Les livraisons du jour seront ajoutees automatiquement apres synchronisation." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-[#E8DED4] text-left text-[10px] font-black uppercase text-[#806A58]">
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-3 py-3">Categorie</th>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Auteur</th>
                    <th className="px-3 py-3">Trace</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.operations.map((operation: any) => (
                    <tr key={operation.id} className="border-b border-[#F1E8DF] text-[12px] last:border-b-0">
                      <td className="max-w-[280px] px-4 py-3">
                        <div className="font-black text-[#1A1410]">{operation.description || operationLabel(operation.type)}</div>
                        <div className="text-[10px] font-bold text-[#806A58]">{formatDay(operation.createdAt)}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex rounded-md bg-[#FFF1E8] px-2 py-1 text-[10px] font-black text-[#D4541C]">
                          {operation.category?.name || "-"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-[#1A1410]">{sourceLabel(operation.source)}</div>
                        {operation.deliveryOrderRef && <div className="font-mono text-[10px] text-[#806A58]">{operation.deliveryOrderRef}</div>}
                      </td>
                      <td className="px-3 py-3 text-[#6B4F3B]">{operation.createdByName || "-"}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={operation.type === "EXPENSE" ? "RETURNED" : operation.type === "CORRECTION" ? "REPROGRAMMED" : "DELIVERED"} size="sm" />
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-black text-[#1A1410]">{formatPrice(operation.amount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E8DED4] bg-white text-[#6B4F3B]"
                            title="Modifier ou regulariser"
                            onClick={() => setEditingOperation(operation)}
                          >
                            <Edit3 size={14} />
                          </button>
                          {operation.source !== "DELIVERY" && (
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#F4C7B8] bg-[#FFF7ED] text-[#C2410C]"
                              title="Supprimer"
                              onClick={async () => {
                                if (!confirm("Supprimer cette operation ?")) return;
                                await deleteAccountingOperation(operation.id, "Suppression depuis la session");
                                showToast("Operation supprimee", "success");
                                router.refresh();
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>

        <div className="flex flex-col gap-4">
          <TableCard
            title="Categories"
            meta={`${workspace.categories.length} categorie(s)`}
            actions={
              <button className="inline-flex h-8 items-center gap-1 rounded-md bg-[#1A1410] px-2 text-[11px] font-black text-white" onClick={() => setActiveModal("category")}>
                <Tag size={13} /> Ajouter
              </button>
            }
          >
            <CategoryList
              title="Entrees"
              categories={incomeCategories}
              onEdit={setEditingCategory}
              onDelete={async (category) => {
                await deleteAccountingCategory(category.id);
                showToast("Categorie supprimee", "success");
                router.refresh();
              }}
            />
            <CategoryList
              title="Sorties"
              categories={expenseCategories}
              onEdit={setEditingCategory}
              onDelete={async (category) => {
                await deleteAccountingCategory(category.id);
                showToast("Categorie supprimee", "success");
                router.refresh();
              }}
            />
          </TableCard>

          <TableCard title="Sessions recentes" meta="30 derniers jours">
            <div className="divide-y divide-[#F1E8DF]">
              {workspace.sessions.map((session: any) => (
                <button
                  key={session.id}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#FCFAF7]"
                  onClick={() => changeDate(dateInputValue(session.date))}
                >
                  <div>
                    <div className="text-[13px] font-black text-[#1A1410]">{dateInputValue(session.date)}</div>
                    <div className="text-[10px] font-bold text-[#806A58]">{session.summary.count} operation(s)</div>
                  </div>
                  <div className="text-right text-[12px] font-black text-[#D4541C]">{formatPrice(session.summary.balance)}</div>
                </button>
              ))}
            </div>
          </TableCard>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TableCard title="Bilans sauvegardes" meta={`${workspace.reports.length} bilan(s)`}>
          {workspace.reports.length === 0 ? (
            <EmptyState icon="B" title="Aucun bilan sauvegarde" description="Creez un bilan journalier, hebdomadaire, mensuel ou filtre libre." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {workspace.reports.map((report: any) => (
                <div key={report.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-[13px] font-black text-[#1A1410]">{report.name}</div>
                    <div className="text-[10px] font-bold text-[#806A58]">
                      {dateInputValue(report.dateFrom)} - {dateInputValue(report.dateTo)} · {report.operationsCount} operation(s)
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-black text-[#1A1410]">{formatPrice(report.balance)}</span>
                    <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E8DED4]" title="Imprimer" onClick={() => window.print()}>
                      <Printer size={13} />
                    </button>
                    <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E8DED4]" title="Exporter CSV" onClick={() => exportReportCsv(report)}>
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
            <EmptyState icon="H" title="Aucun historique" description="Les creations, modifications et regularisations seront listees ici." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {workspace.audits.map((audit: any) => (
                <div key={audit.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-black text-[#1A1410]">{audit.action}</div>
                    <div className="text-[10px] font-bold text-[#806A58]">{formatDay(audit.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-[#806A58]">
                    {audit.actorName || "Systeme"}{audit.previousAmount !== null && audit.newAmount !== null ? ` · ${formatPrice(audit.previousAmount)} vers ${formatPrice(audit.newAmount)}` : ""}
                  </div>
                  {audit.reason && <div className="mt-1 text-[11px] text-[#6B4F3B]">{audit.reason}</div>}
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
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
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
      {activeModal === "report" && (
        <ReportModal
          workspace={workspace}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: "orange" | "ink" | "blue" | "green" }) {
  const classes: Record<string, string> = {
    orange: "bg-[#FF6B2C] text-white",
    ink: "border-[#E8DED4] bg-white text-[#1A1410]",
    blue: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
    green: "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]",
  };

  return (
    <div className={`flex min-h-[92px] items-center gap-3 rounded-lg border p-4 shadow-sm ${classes[tone]}`}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-md ${tone === "orange" ? "bg-white/20" : "bg-white"}`}>{icon}</div>
      <div>
        <div className={`text-[10px] font-black uppercase ${tone === "orange" ? "text-white/80" : "text-current/70"}`}>{label}</div>
        <div className="text-[20px] font-black">{value}</div>
      </div>
    </div>
  );
}

function CategoryList({ title, categories, onEdit, onDelete }: { title: string; categories: any[]; onEdit: (category: any) => void; onDelete: (category: any) => void }) {
  return (
    <div className="border-b border-[#F1E8DF] last:border-b-0">
      <div className="bg-[#FCFAF7] px-4 py-2 text-[10px] font-black uppercase text-[#806A58]">{title}</div>
      {categories.map((category) => (
        <div key={category.id} className="flex items-center justify-between gap-2 px-4 py-2">
          <div>
            <div className="text-[12px] font-black text-[#1A1410]">{category.name}</div>
            <div className="text-[10px] font-bold text-[#806A58]">{category.isDefault ? "Par defaut" : "Personnalisee"}</div>
          </div>
          <div className="flex gap-1">
            <button className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#E8DED4]" onClick={() => onEdit(category)} title="Modifier">
              <Edit3 size={12} />
            </button>
            {!category.isDefault && (
              <button className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#F4C7B8] text-[#C2410C]" onClick={() => onDelete(category)} title="Supprimer">
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OperationModal({ sessionId, operation, incomeCategories, expenseCategories, onClose }: any) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<OperationType>(operation?.type || "INCOME");
  const categories = type === "EXPENSE" ? expenseCategories : incomeCategories;
  const [categoryId, setCategoryId] = useState(operation?.categoryId || categories[0]?.id || "");
  const [amount, setAmount] = useState(operation?.amount || "");
  const [description, setDescription] = useState(operation?.description || "");
  const [proofUrl, setProofUrl] = useState(operation?.proofUrl || "");
  const [reason, setReason] = useState(operation?.reason || "");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        if (operation) {
          await updateAccountingOperation(operation.id, { amount: Number(amount), categoryId, description, proofUrl, reason });
          showToast("Operation regularisee", "success");
        } else {
          await createAccountingOperation({ sessionId, categoryId, type, amount: Number(amount), description, proofUrl, source: "MANUAL" });
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
          <span className="text-[11px] font-black uppercase text-[#806A58]">Type</span>
          <select className="field-input" value={type} onChange={(event) => setType(event.target.value as OperationType)} disabled={Boolean(operation?.source === "DELIVERY")}>
            <option value="INCOME">Entree</option>
            <option value="EXPENSE">Sortie</option>
            <option value="CORRECTION">Correction</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Categorie</span>
          <select className="field-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            {categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Montant</span>
          <input className="field-input" type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Description</span>
          <textarea className="field-input" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Piece justificative</span>
          <input className="field-input" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="URL ou reference interne" />
        </label>
        {operation && (
          <label className="grid gap-1">
            <span className="text-[11px] font-black uppercase text-[#806A58]">Raison de la modification</span>
            <input className="field-input" value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Ex. Regularisation montant livreur" />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-orange" disabled={isPending}>
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
          <span className="text-[11px] font-black uppercase text-[#806A58]">Nom</span>
          <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Type</span>
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

function ReportModal({ workspace, onClose }: any) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("Bilan journalier");
  const [dateFrom, setDateFrom] = useState(dateInputValue(workspace.session.date));
  const [dateTo, setDateTo] = useState(dateInputValue(workspace.session.date));
  const [categoryId, setCategoryId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [operationScope, setOperationScope] = useState("BOTH");

  const operationTypes = useMemo(() => {
    if (operationScope === "INCOME") return ["INCOME"];
    if (operationScope === "EXPENSE") return ["EXPENSE"];
    return ["INCOME", "EXPENSE", "CORRECTION"];
  }, [operationScope]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        await createAccountingReport({
          name,
          dateFrom,
          dateTo,
          categoryIds: categoryId ? [categoryId] : [],
          riderIds: riderId ? [riderId] : [],
          customerIds: customerId ? [customerId] : [],
          sessionIds: sessionId ? [sessionId] : [],
          operationTypes: operationTypes as OperationType[],
        });
        showToast("Bilan enregistre", "success");
        router.refresh();
        onClose();
      } catch (error: any) {
        showToast(error.message || "Erreur bilan", "error");
      }
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Creer un bilan personnalise">
      <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Nom du bilan</span>
          <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-[11px] font-black uppercase text-[#806A58]">Debut</span>
            <input className="field-input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} required />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-black uppercase text-[#806A58]">Fin</span>
            <input className="field-input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} required />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Type d&apos;operations</span>
          <select className="field-input" value={operationScope} onChange={(event) => setOperationScope(event.target.value)}>
            <option value="BOTH">Entrees et sorties</option>
            <option value="INCOME">Entrees seulement</option>
            <option value="EXPENSE">Sorties seulement</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Categorie</span>
          <select className="field-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Toutes categories</option>
            {workspace.categories.map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Livreur</span>
          <select className="field-input" value={riderId} onChange={(event) => setRiderId(event.target.value)}>
            <option value="">Tous livreurs</option>
            {workspace.riders.map((rider: any) => <option key={rider.id} value={rider.id}>{rider.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Client</span>
          <select className="field-input" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">Tous clients</option>
            {workspace.customers.map((customer: any) => <option key={customer.id} value={customer.id}>{customer.name} - {customer.phone}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Session</span>
          <select className="field-input" value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
            <option value="">Toutes sessions</option>
            {workspace.sessions.map((session: any) => <option key={session.id} value={session.id}>{dateInputValue(session.date)}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-orange" disabled={isPending}>
            <Save size={14} /> {isPending ? "Creation..." : "Enregistrer le bilan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function exportReportCsv(report: any) {
  const rows = [
    ["Nom", "Debut", "Fin", "Entrees", "Sorties", "Solde", "Operations"],
    [
      report.name,
      dateInputValue(report.dateFrom),
      dateInputValue(report.dateTo),
      report.totalIncome,
      report.totalExpense,
      report.balance,
      report.operationsCount,
    ],
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
