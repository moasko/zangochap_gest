"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Lock,
  LockOpen,
  Save,
} from "lucide-react";
import { EmptyState, TableCard } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { formatDay, formatPrice } from "@/lib/constants";
import {
  closeAccountingSession,
  createAccountingOperation,
  reopenAccountingSession,
  validateRiderAccountingEntry,
} from "@/modules/accounting/actions";

// Seuil au-dela duquel un ecart de collecte est signale comme important.
const VARIANCE_ALERT_THRESHOLD = 1000;

function varianceTone(variance: number) {
  if (variance === 0) return "text-[#166534]";
  return variance > 0 ? "text-[#1D4ED8]" : "text-[#991B1B]";
}

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
  const [sessionPending, setSessionPending] = useState(false);
  // Par defaut, on pre-remplit le montant a valider avec l'ENCAISSE reel du livreur.
  const [riderAmounts, setRiderAmounts] = useState<Record<string, string>>(() => (
    Object.fromEntries(workspace.riders.map((rider: any) => [
      rider.riderId,
      String(rider.validatedAmount || rider.collectedAmount || rider.expectedAmount || ""),
    ]))
  ));

  const isClosed = workspace.session.status === "CLOSED";
  const canReopen = ["admin", "developer"].includes(workspace.actor?.role);
  const incomeCategories = workspace.categories.filter((category: any) => category.type === "INCOME");
  const expenseCategories = workspace.categories.filter((category: any) => category.type === "EXPENSE");
  const deliveryOperations = workspace.operations.filter((operation: any) => operation.source === "DELIVERY" && operation.riderId);
  const expenseOperations = workspace.operations.filter((operation: any) => operation.type === "EXPENSE");
  const manualIncomeOperations = workspace.operations.filter((operation: any) => operation.type === "INCOME" && operation.source !== "DELIVERY");
  const expectedRiderTotal = workspace.riders.reduce((sum: number, rider: any) => sum + Number(rider.expectedAmount || 0), 0);
  const collectedRiderTotal = workspace.riders.reduce((sum: number, rider: any) => sum + Number(rider.collectedAmount || 0), 0);
  const validatedRiderTotal = deliveryOperations.reduce((sum: number, operation: any) => sum + Number(operation.amount || 0), 0);
  const collectionGap = collectedRiderTotal - expectedRiderTotal;
  const validationGap = validatedRiderTotal - collectedRiderTotal;
  const sessionDate = dateInputValue(workspace.session.date);

  const groupedAudit = useMemo(() => workspace.audits.slice(0, 12), [workspace.audits]);

  const closeSession = async () => {
    if (!confirm("Cloturer cette session ? Les ecritures seront verrouillees.")) return;
    setSessionPending(true);
    try {
      await closeAccountingSession(workspace.session.id);
      showToast("Session cloturee", "success");
      router.refresh();
    } catch (error: any) {
      showToast(error.message || "Cloture impossible", "error");
    } finally {
      setSessionPending(false);
    }
  };

  const reopenSession = async () => {
    const reason = window.prompt("Motif de reouverture de la session :");
    if (!reason?.trim()) return;
    setSessionPending(true);
    try {
      await reopenAccountingSession(workspace.session.id, reason);
      showToast("Session reouverte", "success");
      router.refresh();
    } catch (error: any) {
      showToast(error.message || "Reouverture impossible", "error");
    } finally {
      setSessionPending(false);
    }
  };

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
        <div className="flex flex-col gap-3 p-4 md:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/zangochap-manager/accounting" className="mb-2 inline-flex items-center gap-2 text-[12px] font-black text-white/70 hover:text-white">
              <ArrowLeft size={15} /> Retour au journal
            </Link>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase text-[#FFB38A]">
              <ClipboardCheck size={14} /> Detail session comptable
            </div>
            <h1 className="text-[22px] font-black md:text-[26px]">Session du {sessionDate}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[12px] font-black">
            <span className={`inline-flex items-center justify-end gap-1.5 rounded-md px-3 py-2 ${isClosed ? "bg-[#166534]/30 text-[#BBF7D0]" : "bg-white/10"}`}>
              {isClosed ? <Lock size={13} /> : <LockOpen size={13} />} {isClosed ? "Cloturee" : "Ouverte"}
            </span>
            <span className="rounded-md bg-[#FF6B2C] px-3 py-2">Solde: {formatPrice(workspace.totals.balance)}</span>
            {isClosed ? (
              canReopen && (
                <button type="button" onClick={reopenSession} disabled={sessionPending} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 py-2 hover:bg-white/15 disabled:opacity-60">
                  <LockOpen size={13} /> {sessionPending ? "..." : "Rouvrir"}
                </button>
              )
            ) : (
              <button type="button" onClick={closeSession} disabled={sessionPending} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/20 bg-white px-3 py-2 text-[#101820] hover:bg-[#F8FAFC] disabled:opacity-60">
                <Lock size={13} /> {sessionPending ? "..." : "Cloturer"}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mb-5 rounded-lg border border-[#E8DED4] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase text-[#806A58]">
          <ClipboardCheck size={13} /> Rapprochement de la journee
        </div>
        <div className="grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <FlowTile label="Attendu (theorique)" value={formatPrice(expectedRiderTotal)} sub={`${workspace.riders.length} livreur(s)`} />
          <FlowArrow />
          <FlowTile
            label="Encaisse (reel)"
            value={formatPrice(collectedRiderTotal)}
            accent
            chip={collectionGap !== 0
              ? { text: `ecart ${collectionGap > 0 ? "+" : ""}${formatPrice(collectionGap)}`, tone: collectionGap < 0 ? "dang" : "info" }
              : { text: "conforme", tone: "ok" }}
          />
          <FlowArrow />
          <FlowTile
            label="Valide livreurs"
            value={formatPrice(validatedRiderTotal)}
            chip={validationGap !== 0
              ? { text: `ecart ${validationGap > 0 ? "+" : ""}${formatPrice(validationGap)}`, tone: validationGap < 0 ? "dang" : "info" }
              : { text: "rapproche", tone: "ok" }}
          />
          <FlowArrow />
          <FlowTile label="Sorties" value={formatPrice(workspace.totals.totalExpense)} sub={`${expenseOperations.length} depense(s)`} />
        </div>
      </section>

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
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-[#806A58]">
                      <span>{rider.ordersCount} livraison(s)</span>
                      <span>· attendu {formatPrice(rider.expectedAmount)}</span>
                      <span className={varianceTone(rider.collectionVariance)}>
                        · encaisse {formatPrice(rider.collectedAmount)}
                        {rider.collectionVariance !== 0 && <> (ecart {rider.collectionVariance > 0 ? "+" : ""}{formatPrice(rider.collectionVariance)})</>}
                      </span>
                      {Math.abs(rider.collectionVariance) >= VARIANCE_ALERT_THRESHOLD && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-black text-[#9A3412]">
                          <AlertTriangle size={11} /> Ecart important
                        </span>
                      )}
                      {rider.isValidated && rider.variance !== 0 && (
                        <span className={varianceTone(rider.variance)}>· valide {formatPrice(rider.validatedAmount)} (ecart {rider.variance > 0 ? "+" : ""}{formatPrice(rider.variance)})</span>
                      )}
                    </div>
                    <div className="mt-3 grid gap-1.5 md:grid-cols-2">
                      {rider.orders.slice(0, 4).map((order: any) => (
                        <div key={order.id} className="flex items-center justify-between gap-2 rounded-md border border-[#E8DED4] bg-[#FCFAF7] px-2 py-1.5 text-[11px]">
                          <span className="truncate font-bold text-[#806A58]">{order.ref || order.id.slice(0, 8)} · {order.customerName}</span>
                          <span className="shrink-0 font-black text-[#1A1410]" title={order.collectedAmount !== order.expectedAmount ? `Theorique ${formatPrice(order.expectedAmount)}` : undefined}>
                            {formatPrice(order.collectedAmount)}
                            {order.collectedAmount !== order.expectedAmount && <span className="ml-0.5 text-[#991B1B]">*</span>}
                          </span>
                        </div>
                      ))}
                      {rider.orders.length > 4 && (
                        <div className="flex items-center px-2 py-1.5 text-[11px] font-bold text-[#806A58]">+{rider.orders.length - 4} autre(s)</div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#E8DED4] bg-white p-3 shadow-sm">
                    <label className="grid gap-1">
                      <span className="text-[10px] font-black uppercase text-[#806A58]">Montant valide en caisse</span>
                      <input
                        className="field-input"
                        type="number"
                        min={1}
                        disabled={isClosed}
                        value={riderAmounts[rider.riderId] || ""}
                        onChange={(event) => setRiderAmounts((current) => ({ ...current, [rider.riderId]: event.target.value }))}
                      />
                    </label>
                    <button
                      type="button"
                      className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#FF6B2C] px-3 text-[12px] font-black text-white disabled:opacity-60"
                      disabled={isClosed || validatingRiderId === rider.riderId}
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

        <QuickOperationForm sessionId={workspace.session.id} incomeCategories={incomeCategories} expenseCategories={expenseCategories} locked={isClosed} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TableCard title="Autres entrees de la session" meta={`${manualIncomeOperations.length} entree(s)`}>
          {manualIncomeOperations.length === 0 ? (
            <EmptyState icon="E" title="Aucune entree manuelle" description="Ajoutez une entree (vente directe, reglement client, avance...) depuis le formulaire rapide." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {manualIncomeOperations.map((operation: any) => (
                <OperationRow key={operation.id} operation={operation} />
              ))}
            </div>
          )}
        </TableCard>

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

function QuickOperationForm({ sessionId, incomeCategories, expenseCategories, locked }: { sessionId: string; incomeCategories: any[]; expenseCategories: any[]; locked?: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<"INCOME" | "EXPENSE">("INCOME");
  const categories = type === "EXPENSE" ? expenseCategories : incomeCategories;
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState("");

  const switchType = (next: "INCOME" | "EXPENSE") => {
    setType(next);
    const list = next === "EXPENSE" ? expenseCategories : incomeCategories;
    setCategoryId(list[0]?.id || "");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        await createAccountingOperation({
          sessionId,
          categoryId,
          type,
          source: "MANUAL",
          amount: Number(amount),
          description,
          proofUrl,
        });
        showToast(type === "INCOME" ? "Entree ajoutee" : "Sortie ajoutee", "success");
        setAmount("");
        setDescription("");
        setProofUrl("");
        router.refresh();
      } catch (error: any) {
        showToast(error.message || "Operation impossible", "error");
      }
    });
  };

  const isIncome = type === "INCOME";

  return (
    <TableCard title="Ajouter une operation" meta="Entree ou sortie">
      <form onSubmit={submit} className="grid gap-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => switchType("INCOME")}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${isIncome ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" : "border-[#E8DED4] bg-white text-[#806A58]"}`}
          >
            <ArrowUpCircle size={14} /> Entree
          </button>
          <button
            type="button"
            onClick={() => switchType("EXPENSE")}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${!isIncome ? "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]" : "border-[#E8DED4] bg-white text-[#806A58]"}`}
          >
            <ArrowDownCircle size={14} /> Sortie
          </button>
        </div>
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
          <textarea className="field-input" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} required placeholder={isIncome ? "Ex. vente directe, reglement client, avance..." : "Ex. carburant, commission, course..."} />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-black uppercase text-[#806A58]">Piece / reference</span>
          <input className="field-input" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="Optionnel" />
        </label>
        <button type="submit" className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-[12px] font-black text-white disabled:opacity-60 ${isIncome ? "bg-[#166534]" : "bg-[#1A1410]"}`} disabled={isPending || locked}>
          {isIncome ? <ArrowUpCircle size={15} /> : <ArrowDownCircle size={15} />} {locked ? "Session cloturee" : isPending ? "Ajout..." : isIncome ? "Ajouter l'entree" : "Ajouter la sortie"}
        </button>
      </form>
    </TableCard>
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
    ok: "bg-[#F0FDF4] text-[#166534]",
    dang: "bg-[#FEF2F2] text-[#991B1B]",
    info: "bg-[#EFF6FF] text-[#1D4ED8]",
  };
  return (
    <div className="rounded-md border border-[#F1E8DF] bg-[#FCFAF7] px-3 py-3">
      <div className="text-[10px] font-black uppercase text-[#806A58]">{label}</div>
      <div className={`mt-1 text-[19px] font-black ${accent ? "text-[#D4541C]" : "text-[#1A1410]"}`}>{value}</div>
      {chip && <span className={`mt-1.5 inline-block rounded-md px-2 py-0.5 text-[10px] font-black ${chipClasses[chip.tone]}`}>{chip.text}</span>}
      {sub && <div className="mt-1 text-[10px] font-bold text-[#806A58]">{sub}</div>}
    </div>
  );
}

function FlowArrow() {
  return <div className="hidden items-center justify-center text-[#C9BBAA] md:flex" aria-hidden="true"><ChevronRight size={18} /></div>;
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
        <div className={`text-right font-mono text-[12px] font-black ${operation.type === "EXPENSE" ? "text-[#991B1B]" : "text-[#166534]"}`}>{operation.type === "EXPENSE" ? "-" : "+"}{formatPrice(operation.amount)}</div>
      </div>
      {operation.proofUrl && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-[#FCFAF7] px-2 py-1 text-[10px] font-bold text-[#6B4F3B]">
          <FileText size={12} /> {operation.proofUrl}
        </div>
      )}
    </div>
  );
}
