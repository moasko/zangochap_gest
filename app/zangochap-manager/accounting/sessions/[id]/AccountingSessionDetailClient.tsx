"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownCircle,
  ArrowLeft,
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Save,
  Truck,
  Wallet,
} from "lucide-react";
import { EmptyState, TableCard } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { formatDay, formatPrice } from "@/lib/constants";
import {
  createAccountingOperation,
  validateRiderAccountingEntry,
} from "@/modules/accounting/actions";

type AccountingSessionDetailClientProps = {
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

export default function AccountingSessionDetailClient({ workspace }: AccountingSessionDetailClientProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [validatingRiderId, setValidatingRiderId] = useState<string | null>(null);
  const [riderAmounts, setRiderAmounts] = useState<Record<string, string>>(() => (
    Object.fromEntries(workspace.riders.map((rider: any) => [rider.riderId, String(rider.validatedAmount || rider.expectedAmount || "")]))
  ));

  const expenseCategories = workspace.categories.filter((category: any) => category.type === "EXPENSE");
  const deliveryOperations = workspace.operations.filter((operation: any) => operation.source === "DELIVERY" && operation.riderId);
  const expenseOperations = workspace.operations.filter((operation: any) => operation.type === "EXPENSE");
  const manualIncomeOperations = workspace.operations.filter((operation: any) => operation.type === "INCOME" && operation.source !== "DELIVERY");
  const expectedRiderTotal = workspace.riders.reduce((sum: number, rider: any) => sum + Number(rider.expectedAmount || 0), 0);
  const validatedRiderTotal = deliveryOperations.reduce((sum: number, operation: any) => sum + Number(operation.amount || 0), 0);
  const sessionDate = dateInputValue(workspace.session.date);

  const groupedAudit = useMemo(() => workspace.audits.slice(0, 12), [workspace.audits]);

  const validateRider = async (rider: any) => {
    const amount = Number(riderAmounts[rider.riderId] || 0);
    setValidatingRiderId(rider.riderId);
    try {
      await validateRiderAccountingEntry({
        sessionId: workspace.session.id,
        riderId: rider.riderId,
        riderName: rider.riderName,
        amount,
        reason: rider.operation ? "Mise a jour validation entree livreur" : "Validation entree livreur",
      });
      showToast("Entree livreur validee", "success");
      router.refresh();
    } catch (error: any) {
      showToast(error.message || "Validation impossible", "error");
    } finally {
      setValidatingRiderId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
      <section className="mb-5 overflow-hidden rounded-lg border border-[#D8CBBB] bg-[#101820] text-white shadow-sm">
        <div className="flex flex-col gap-4 p-4 md:p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/zangochap-manager/accounting" className="mb-3 inline-flex items-center gap-2 text-[12px] font-black text-white/70 hover:text-white">
              <ArrowLeft size={15} /> Retour au journal
            </Link>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase text-[#FFB38A]">
              <ClipboardCheck size={14} />
              Detail session comptable
            </div>
            <h1 className="text-[24px] font-black md:text-[30px]">Session du {sessionDate}</h1>
            <p className="mt-1 max-w-2xl text-[13px] font-semibold text-white/65">
              Validez les entrees remises par chaque livreur et ajoutez les sorties liees a cette session.
            </p>
          </div>

          <div className="grid gap-2 text-right text-[12px] font-black">
            <span className="rounded-md bg-white/10 px-3 py-2">Statut: {workspace.session.status}</span>
            <span className="rounded-md bg-[#FF6B2C] px-3 py-2">Solde: {formatPrice(workspace.totals.balance)}</span>
          </div>
        </div>
      </section>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <MetricCard icon={<Truck size={18} />} label="Livreurs" value={workspace.riders.length} tone="orange" />
        <MetricCard icon={<Banknote size={18} />} label="Attendu livreurs" value={formatPrice(expectedRiderTotal)} tone="blue" />
        <MetricCard icon={<CheckCircle2 size={18} />} label="Valide livreurs" value={formatPrice(validatedRiderTotal)} tone="green" />
        <MetricCard icon={<Wallet size={18} />} label="Sorties" value={formatPrice(workspace.totals.totalExpense)} tone="ink" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
        <TableCard title="Entrees par livreur" meta={`${deliveryOperations.length}/${workspace.riders.length} validee(s)`}>
          {workspace.riders.length === 0 ? (
            <EmptyState icon="L" title="Aucun livreur sur cette session" description="Les livraisons cloturees du jour apparaitront ici." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {workspace.riders.map((rider: any) => (
                <article key={rider.riderId} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-black text-[#1A1410]">{rider.riderName}</h2>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black ${rider.isValidated ? "bg-[#F0FDF4] text-[#166534]" : "bg-[#FFF7ED] text-[#C2410C]"}`}>
                        {rider.isValidated ? "Validee" : "A valider"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-[#806A58]">
                      {rider.ordersCount} livraison(s) · attendu {formatPrice(rider.expectedAmount)}
                      {rider.isValidated && <> · ecart {formatPrice(rider.variance)}</>}
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {rider.orders.slice(0, 6).map((order: any) => (
                        <div key={order.id} className="rounded-md border border-[#E8DED4] bg-[#FCFAF7] p-2">
                          <div className="flex justify-between gap-2 text-[11px] font-black text-[#1A1410]">
                            <span>{order.ref || order.id.slice(0, 8)}</span>
                            <span>{formatPrice(order.expectedAmount)}</span>
                          </div>
                          <div className="mt-1 truncate text-[10px] font-bold text-[#806A58]">{order.customerName}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E8DED4] bg-white p-3 shadow-sm">
                    <label className="grid gap-1">
                      <span className="text-[10px] font-black uppercase text-[#806A58]">Montant remis</span>
                      <input
                        className="field-input"
                        type="number"
                        min={1}
                        value={riderAmounts[rider.riderId] || ""}
                        onChange={(event) => setRiderAmounts((current) => ({ ...current, [rider.riderId]: event.target.value }))}
                      />
                    </label>
                    <button
                      type="button"
                      className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#FF6B2C] px-3 text-[12px] font-black text-white disabled:opacity-60"
                      disabled={validatingRiderId === rider.riderId}
                      onClick={() => validateRider(rider)}
                    >
                      <Save size={14} /> {validatingRiderId === rider.riderId ? "Validation..." : rider.isValidated ? "Mettre a jour" : "Valider entree"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </TableCard>

        <div className="flex flex-col gap-4">
          <QuickExpenseForm sessionId={workspace.session.id} categories={expenseCategories} />
          <TableCard title="Resume ecritures" meta={`${workspace.operations.length} ligne(s)`}>
            <SummaryLine label="Entrees livreurs" value={formatPrice(validatedRiderTotal)} />
            <SummaryLine label="Autres entrees" value={formatPrice(manualIncomeOperations.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0))} />
            <SummaryLine label="Sorties" value={formatPrice(expenseOperations.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0))} danger />
            <SummaryLine label="Solde session" value={formatPrice(workspace.totals.balance)} strong />
          </TableCard>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TableCard title="Sorties de la session" meta={`${expenseOperations.length} sortie(s)`}>
          {expenseOperations.length === 0 ? (
            <EmptyState icon="S" title="Aucune sortie" description="Ajoutez les depenses de la session depuis le formulaire rapide." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {expenseOperations.map((operation: any) => (
                <OperationRow key={operation.id} operation={operation} />
              ))}
            </div>
          )}
        </TableCard>

        <TableCard title="Audit session" meta={`${workspace.audits.length} trace(s)`}>
          {groupedAudit.length === 0 ? (
            <EmptyState icon="A" title="Aucune trace" description="Les validations et sorties seront journalisees ici." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {groupedAudit.map((audit: any) => (
                <div key={audit.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-black text-[#1A1410]">{audit.action}</div>
                    <div className="text-[10px] font-bold text-[#806A58]">{formatDay(audit.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-[#806A58]">
                    {audit.actorName || "Systeme"}{audit.newAmount !== null ? ` · ${formatPrice(audit.newAmount)}` : ""}
                  </div>
                  {audit.reason && <div className="mt-1 text-[11px] text-[#6B4F3B]">{audit.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </TableCard>
      </div>
    </div>
  );
}

function QuickExpenseForm({ sessionId, categories }: { sessionId: string; categories: any[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        await createAccountingOperation({
          sessionId,
          categoryId,
          type: "EXPENSE",
          source: "MANUAL",
          amount: Number(amount),
          description,
          proofUrl,
        });
        showToast("Sortie ajoutee", "success");
        setAmount("");
        setDescription("");
        setProofUrl("");
        router.refresh();
      } catch (error: any) {
        showToast(error.message || "Sortie impossible", "error");
      }
    });
  };

  return (
    <TableCard title="Ajouter une sortie" meta="Depense session">
      <form onSubmit={submit} className="grid gap-3 p-3">
        <label className="grid gap-1">
          <span className="text-[10px] font-black uppercase text-[#806A58]">Categorie</span>
          <select className="field-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-black uppercase text-[#806A58]">Montant</span>
          <input className="field-input" type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-black uppercase text-[#806A58]">Libelle</span>
          <textarea className="field-input" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} required placeholder="Ex. carburant, commission, course..." />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-black uppercase text-[#806A58]">Piece / reference</span>
          <input className="field-input" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="Optionnel" />
        </label>
        <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1A1410] px-3 text-[12px] font-black text-white disabled:opacity-60" disabled={isPending}>
          <ArrowDownCircle size={15} /> {isPending ? "Ajout..." : "Ajouter la sortie"}
        </button>
      </form>
    </TableCard>
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

function SummaryLine({ label, value, danger, strong }: { label: string; value: string; danger?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-[#F1E8DF] px-4 py-3 last:border-b-0 ${strong ? "bg-[#FCFAF7]" : ""}`}>
      <span className="text-[12px] font-bold text-[#806A58]">{label}</span>
      <strong className={`text-[13px] font-black ${danger ? "text-[#991B1B]" : "text-[#1A1410]"}`}>{value}</strong>
    </div>
  );
}

function OperationRow({ operation }: { operation: any }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-[#1A1410]">{operation.description || operationLabel(operation.type)}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold text-[#806A58]">
            <span>{operation.category?.name || "Sans categorie"}</span>
            <span>·</span>
            <span>{operation.createdByName || "Systeme"}</span>
          </div>
        </div>
        <div className="text-right font-mono text-[12px] font-black text-[#991B1B]">{formatPrice(operation.amount)}</div>
      </div>
      {operation.proofUrl && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-[#FCFAF7] px-2 py-1 text-[10px] font-bold text-[#6B4F3B]">
          <FileText size={12} /> {operation.proofUrl}
        </div>
      )}
    </div>
  );
}
