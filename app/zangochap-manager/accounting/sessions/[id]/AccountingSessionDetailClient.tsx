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
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Landmark,
  Lock,
  LockOpen,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { EmptyState, TableCard } from "@/components/UI";
import Modal from "@/components/Modal";
import AmountInput from "@/components/AmountInput";
import { useToast } from "@/components/Toast";
import { accountingActionLabel, formatDay, formatPrice } from "@/lib/constants";
import {
  closeAccountingSession,
  createAccountingOperation,
  deleteAccountingOperation,
  reopenAccountingSession,
  validateAllRiders,
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
  const [validatingAll, setValidatingAll] = useState(false);
  const [sessionPending, setSessionPending] = useState(false);
  // Type d'operation a ajouter via le modal (null = ferme).
  const [operationModalType, setOperationModalType] = useState<null | "INCOME" | "EXPENSE">(null);
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
  // Cote caisse : on boucle sur le Solde affiche dans l'en-tete.
  // totalIncome (serveur) = livraisons (validees + restant a valider) + entrees manuelles.
  const manualIncomeTotal = manualIncomeOperations.reduce((sum: number, operation: any) => sum + Number(operation.amount || 0), 0);
  const deliveryIncomeTotal = Number(workspace.totals.totalIncome || 0) - manualIncomeTotal;
  const expenseTotal = Number(workspace.totals.totalExpense || 0);
  const cashBalance = Number(workspace.totals.balance || 0);
  // Livreurs avec un encaisse mais pas encore valides en caisse.
  const pendingRiders = workspace.riders.filter((rider: any) => !rider.isValidated && Number(rider.collectedAmount || 0) > 0);
  const riderCount = workspace.riders.length;
  const validatedCount = workspace.riders.filter((rider: any) => rider.isValidated).length;
  const validationPct = riderCount > 0 ? Math.round((validatedCount / riderCount) * 100) : 0;

  const groupedAudit = useMemo(() => workspace.audits.slice(0, 12), [workspace.audits]);

  const closeSession = async () => {
    // Recapitulatif avant verrouillage : on signale ce qui pourrait etre oublie.
    const lines = ["Cloturer cette session ? Les ecritures seront verrouillees.", ""];
    if (pendingRiders.length > 0) {
      lines.push(`! ${pendingRiders.length} livreur(s) non valide(s) : leur encaisse restera dans l'ecriture groupee.`);
    }
    if (collectionGap !== 0) {
      lines.push(`Ecart de caisse (encaisse - attendu) : ${collectionGap > 0 ? "+" : ""}${formatPrice(collectionGap)}`);
    }
    if (expenseOperations.length === 0) {
      lines.push("Aucune depense saisie pour la journee.");
    }
    if (!confirm(lines.join("\n"))) return;
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

  const validateAll = async () => {
    if (!confirm(`Valider ${pendingRiders.length} livreur(s) restant(s) a leur montant encaisse ?`)) return;
    setValidatingAll(true);
    try {
      const result = await validateAllRiders(workspace.session.id);
      showToast(`${result.count} entree(s) livreur validee(s)`, "success");
      router.refresh();
    } catch (error: any) {
      showToast(error.message || "Validation impossible", "error");
    } finally {
      setValidatingAll(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 py-5 md:space-y-5 md:px-6 md:py-6">
      <section className="overflow-hidden rounded-lg border border-[#D8CBBB] bg-[#101820] text-white shadow-sm">
        <div className="flex flex-col gap-4 p-4 md:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link href="/zangochap-manager/accounting" className="mb-2 inline-flex items-center gap-2 text-[12px] font-black text-white/70 hover:text-white">
              <ArrowLeft size={15} /> Retour au journal
            </Link>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase text-[#FFB38A]">
              <ClipboardCheck size={14} /> Detail session comptable
            </div>
            <h1 className="text-[22px] font-black md:text-[26px]">Session du {sessionDate}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-black ${isClosed ? "bg-[#166534]/30 text-[#BBF7D0]" : "bg-white/10 text-white"}`}>
                {isClosed ? <Lock size={12} /> : <LockOpen size={12} />} {isClosed ? "Cloturee" : "Ouverte"}
              </span>
              {riderCount > 0 && (
                <span className="inline-flex items-center gap-2 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">
                  {validatedCount}/{riderCount} livreurs valides
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/20">
                    <span className="block h-full bg-[#FF6B2C]" style={{ width: `${validationPct}%` }} />
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 lg:justify-end">
            <div className="text-right">
              <div className="text-[10px] font-black uppercase text-white/55">Solde de caisse</div>
              <div className="text-[24px] font-black text-[#FFB38A] md:text-[28px]">{formatPrice(cashBalance)}</div>
            </div>
            {isClosed ? (
              canReopen && (
                <button type="button" onClick={reopenSession} disabled={sessionPending} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3.5 py-2.5 text-[12px] font-black hover:bg-white/15 disabled:opacity-60">
                  <LockOpen size={14} /> {sessionPending ? "..." : "Rouvrir"}
                </button>
              )
            ) : (
              <button type="button" onClick={closeSession} disabled={sessionPending} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-white px-3.5 py-2.5 text-[12px] font-black text-[#101820] hover:bg-[#F8FAFC] disabled:opacity-60">
                <Lock size={14} /> {sessionPending ? "..." : "Cloturer la session"}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[#E8DED4] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase text-[#806A58]">
            <Landmark size={13} /> Composition du solde
          </div>
          <div className="grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <FlowTile label="Livraisons" value={formatPrice(deliveryIncomeTotal)} sub={`${deliveryOperations.length} validee(s)`} />
            <FlowOp symbol="+" />
            <FlowTile label="Autres entrees" value={formatPrice(manualIncomeTotal)} sub={`${manualIncomeOperations.length} entree(s)`} />
            <FlowOp symbol="−" />
            <FlowTile label="Sorties" value={formatPrice(expenseTotal)} sub={`${expenseOperations.length} depense(s)`} />
            <FlowOp symbol="=" />
            <FlowTile label="Solde de caisse" value={formatPrice(cashBalance)} accent />
          </div>
        </div>

        <div className="rounded-lg border border-[#E8DED4] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase text-[#806A58]">
            <ClipboardCheck size={13} /> Controle livreurs
          </div>
          <div className="grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <FlowTile label="Attendu" value={formatPrice(expectedRiderTotal)} sub={`${riderCount} livreur(s)`} />
            <FlowArrow />
            <FlowTile
              label="Encaisse"
              value={formatPrice(collectedRiderTotal)}
              chip={collectionGap !== 0
                ? { text: `ecart ${collectionGap > 0 ? "+" : ""}${formatPrice(collectionGap)}`, tone: collectionGap < 0 ? "dang" : "info" }
                : { text: "conforme", tone: "ok" }}
            />
            <FlowArrow />
            <FlowTile
              label="Valide"
              value={formatPrice(validatedRiderTotal)}
              chip={validationGap !== 0
                ? { text: `ecart ${validationGap > 0 ? "+" : ""}${formatPrice(validationGap)}`, tone: validationGap < 0 ? "dang" : "info" }
                : { text: "rapproche", tone: "ok" }}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.7fr)]">
        <TableCard
          title="Entrees par livreur"
          meta={`${validatedCount}/${riderCount} validee(s)`}
          actions={!isClosed && pendingRiders.length > 0 ? (
            <button
              type="button"
              onClick={validateAll}
              disabled={validatingAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF6B2C] px-2.5 text-[11px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
            >
              <ClipboardCheck size={13} /> {validatingAll ? "Validation..." : `Tout valider (${pendingRiders.length})`}
            </button>
          ) : undefined}
        >
          {workspace.riders.length === 0 ? (
            <EmptyState icon="L" title="Aucun livreur sur cette session" description="Les livraisons cloturees du jour apparaitront ici." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {workspace.riders.map((rider: any) => (
                <RiderCard
                  key={rider.riderId}
                  rider={rider}
                  amount={riderAmounts[rider.riderId] || ""}
                  onAmountChange={(raw) => setRiderAmounts((current) => ({ ...current, [rider.riderId]: raw }))}
                  onValidate={() => validateRider(rider)}
                  validating={validatingRiderId === rider.riderId}
                  locked={isClosed}
                />
              ))}
            </div>
          )}
        </TableCard>

        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setOperationModalType("INCOME")}
            disabled={isClosed}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-3 text-[13px] font-black text-white shadow-sm hover:bg-[#1c2a36] disabled:opacity-60"
          >
            <Plus size={16} /> {isClosed ? "Session cloturee" : "Ajouter une operation"}
          </button>

          <TableCard
            title="Autres entrees"
            meta={`${manualIncomeOperations.length} entree(s)`}
            actions={!isClosed ? (
              <button type="button" onClick={() => setOperationModalType("INCOME")} className="inline-flex h-7 items-center gap-1 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-2 text-[11px] font-black text-[#166534] hover:bg-[#ECFDF5]">
                <Plus size={12} /> Entree
              </button>
            ) : undefined}
          >
            {manualIncomeOperations.length === 0 ? (
              <EmptyState icon="E" title="Aucune entree manuelle" description="Vente directe, reglement client, avance... via le bouton + Entree." />
            ) : (
              <>
                <div className="divide-y divide-[#F1E8DF]">
                  {manualIncomeOperations.map((operation: any) => (
                    <OperationRow key={operation.id} operation={operation} locked={isClosed} />
                  ))}
                </div>
                <CardSubtotal label="Total autres entrees" value={manualIncomeTotal} tone="income" />
              </>
            )}
          </TableCard>

          <TableCard
            title="Sorties"
            meta={`${expenseOperations.length} sortie(s)`}
            actions={!isClosed ? (
              <button type="button" onClick={() => setOperationModalType("EXPENSE")} className="inline-flex h-7 items-center gap-1 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2 text-[11px] font-black text-[#991B1B] hover:bg-[#FEE2E2]">
                <Plus size={12} /> Sortie
              </button>
            ) : undefined}
          >
            {expenseOperations.length === 0 ? (
              <EmptyState icon="S" title="Aucune sortie" description="Depenses du jour (carburant, commission...) via le bouton + Sortie." />
            ) : (
              <>
                <div className="divide-y divide-[#F1E8DF]">
                  {expenseOperations.map((operation: any) => (
                    <OperationRow key={operation.id} operation={operation} locked={isClosed} />
                  ))}
                </div>
                <CardSubtotal label="Total sorties" value={expenseTotal} tone="expense" />
              </>
            )}
          </TableCard>
        </div>
      </div>

      <div>
        <TableCard title="Historique de la session" meta={`${workspace.audits.length} trace(s)`}>
          {groupedAudit.length === 0 ? (
            <EmptyState icon="A" title="Aucune trace" description="Les validations et sorties seront journalisees ici." />
          ) : (
            <div className="divide-y divide-[#F1E8DF]">
              {groupedAudit.map((audit: any) => (
                <div key={audit.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-black text-[#1A1410]">{accountingActionLabel(audit.action)}</div>
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

      {operationModalType && (
        <OperationFormModal
          sessionId={workspace.session.id}
          initialType={operationModalType}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          currentBalance={cashBalance}
          onClose={() => setOperationModalType(null)}
        />
      )}
    </div>
  );
}

function riderInitials(name: string) {
  const parts = String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() || "").join("");
  return initials || "?";
}

function RiderStat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-md border border-[#F1E8DF] bg-[#FCFAF7] px-2.5 py-2">
      <div className="text-[9px] font-black uppercase text-[#806A58]">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] font-black ${tone || "text-[#1A1410]"}`}>{value}</div>
      {hint && <div className={`text-[9px] font-bold ${tone || "text-[#806A58]"}`}>{hint}</div>}
    </div>
  );
}

function RiderCard({ rider, amount, onAmountChange, onValidate, validating, locked }: {
  rider: any;
  amount: string;
  onAmountChange: (raw: string) => void;
  onValidate: () => void;
  validating: boolean;
  locked: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const orders = expanded ? rider.orders : rider.orders.slice(0, 4);
  const hasAdjustment = rider.orders.some((order: any) => order.collectedAmount !== order.expectedAmount);
  const collected = Math.round(Number(rider.collectedAmount || 0));
  const typed = Number(amount || 0);
  const liveGap = typed - collected;
  const bigGap = Math.abs(rider.collectionVariance) >= VARIANCE_ALERT_THRESHOLD;

  return (
    <article className={`grid gap-3 border-l-2 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_248px] lg:items-start ${rider.isValidated ? "border-[#166534]" : "border-[#FF6B2C]"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#101820] text-[10px] font-black text-white">{riderInitials(rider.riderName)}</span>
          <h2 className="text-[15px] font-black text-[#1A1410]">{rider.riderName}</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${rider.isValidated ? "bg-[#F0FDF4] text-[#166534]" : "bg-[#FFF7ED] text-[#C2410C]"}`}>
            {rider.isValidated ? "Validee" : "A valider"}
          </span>
          {bigGap && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-black text-[#9A3412]">
              <AlertTriangle size={11} /> Ecart important
            </span>
          )}
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-2">
          <RiderStat label="Livraisons" value={`${rider.ordersCount}`} />
          <RiderStat label="Attendu" value={formatPrice(rider.expectedAmount)} />
          <RiderStat
            label="Encaisse"
            value={formatPrice(rider.collectedAmount)}
            tone={varianceTone(rider.collectionVariance)}
            hint={rider.collectionVariance !== 0 ? `ecart ${rider.collectionVariance > 0 ? "+" : ""}${formatPrice(rider.collectionVariance)}` : "conforme"}
          />
        </div>

        <div className="mt-3 grid gap-1.5 md:grid-cols-2">
          {orders.map((order: any) => {
            const adjusted = order.collectedAmount !== order.expectedAmount;
            return (
              <div key={order.id} className="flex items-center justify-between gap-2 rounded-md border border-[#E8DED4] bg-[#FCFAF7] px-2 py-1.5 text-[11px]">
                <span className="truncate font-bold text-[#806A58]">{order.ref || order.id.slice(0, 8)} · {order.customerName}</span>
                <span className="shrink-0 font-black text-[#1A1410]" title={adjusted ? `Theorique ${formatPrice(order.expectedAmount)}` : undefined}>
                  {formatPrice(order.collectedAmount)}
                  {adjusted && <span className="ml-0.5 text-[#991B1B]">*</span>}
                </span>
              </div>
            );
          })}
        </div>

        {(rider.orders.length > 4 || hasAdjustment) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {rider.orders.length > 4 && (
              <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline">
                <ChevronDown size={13} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
                {expanded ? "Voir moins" : `Voir les ${rider.orders.length} commandes`}
              </button>
            )}
            {hasAdjustment && (
              <span className="text-[10px] font-bold text-[#806A58]"><span className="text-[#991B1B]">*</span> encaisse different du theorique</span>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#E8DED4] bg-[#FCFAF7] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase text-[#806A58]">Montant valide en caisse</span>
          {!locked && collected > 0 && (
            <button type="button" onClick={() => onAmountChange(String(collected))} className="text-[10px] font-black text-[#C2410C] hover:underline">
              = encaisse
            </button>
          )}
        </div>
        <AmountInput className="field-input mt-1" disabled={locked} value={amount} onChange={onAmountChange} />
        {typed > 0 && liveGap !== 0 && (
          <div className={`mt-1 text-[10px] font-bold ${varianceTone(liveGap)}`}>
            ecart vs encaisse {liveGap > 0 ? "+" : ""}{formatPrice(liveGap)}
          </div>
        )}
        {rider.isValidated && rider.variance !== 0 && (
          <div className={`mt-1 text-[10px] font-bold ${varianceTone(rider.variance)}`}>
            valide {formatPrice(rider.validatedAmount)} (ecart {rider.variance > 0 ? "+" : ""}{formatPrice(rider.variance)})
          </div>
        )}
        <button
          type="button"
          className="mt-2.5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#FF6B2C] px-3 text-[12px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
          disabled={locked || validating}
          onClick={onValidate}
        >
          <Save size={14} /> {validating ? "Validation..." : rider.isValidated ? "Mettre a jour" : "Valider entree"}
        </button>
      </div>
    </article>
  );
}

function OperationFormModal({ sessionId, initialType, incomeCategories, expenseCategories, currentBalance, onClose }: {
  sessionId: string;
  initialType: "INCOME" | "EXPENSE";
  incomeCategories: any[];
  expenseCategories: any[];
  currentBalance: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<"INCOME" | "EXPENSE">(initialType);
  const categories = type === "EXPENSE" ? expenseCategories : incomeCategories;
  const [categoryId, setCategoryId] = useState((type === "EXPENSE" ? expenseCategories : incomeCategories)[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [reason, setReason] = useState("");

  const isIncome = type === "INCOME";
  const typed = Number(amount || 0);
  // Solde projete apres cette ecriture. Une sortie qui passe le solde sous zero
  // exige un motif (le serveur le verifie aussi).
  const projectedBalance = currentBalance + (isIncome ? typed : -typed);
  const requiresReason = !isIncome && typed > 0 && projectedBalance < 0;

  const switchType = (next: "INCOME" | "EXPENSE") => {
    setType(next);
    const list = next === "EXPENSE" ? expenseCategories : incomeCategories;
    setCategoryId(list[0]?.id || "");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (requiresReason && !reason.trim()) {
      showToast("Cette sortie rend le solde negatif : un motif est obligatoire.", "error");
      return;
    }
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
          reason: requiresReason ? reason.trim() : undefined,
        });
        showToast(type === "INCOME" ? "Entree ajoutee" : "Sortie ajoutee", "success");
        router.refresh();
        onClose();
      } catch (error: any) {
        showToast(error.message || "Operation impossible", "error");
      }
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Ajouter une operation">
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => switchType("INCOME")}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${isIncome ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" : "border-[#E8DED4] bg-white text-[#806A58]"}`}
          >
            <ArrowUpCircle size={14} /> Entree
          </button>
          <button
            type="button"
            onClick={() => switchType("EXPENSE")}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${!isIncome ? "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]" : "border-[#E8DED4] bg-white text-[#806A58]"}`}
          >
            <ArrowDownCircle size={14} /> Sortie
          </button>
        </div>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Categorie</span>
          <select className="field-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Montant</span>
          <AmountInput className="field-input" value={amount} onChange={setAmount} required />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Libelle</span>
          <textarea className="field-input" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} required placeholder={isIncome ? "Ex. vente directe, reglement client, avance..." : "Ex. carburant, commission, course..."} />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Piece / reference</span>
          <input className="field-input" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="Optionnel" />
        </label>
        {requiresReason && (
          <div className="grid gap-1 rounded-md border border-[#FECACA] bg-[#FEF2F2] p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-black text-[#991B1B]">
              <AlertTriangle size={13} /> Solde de caisse negatif ({formatPrice(projectedBalance)})
            </div>
            <span className="text-[11px] font-black uppercase text-[#806A58]">Motif obligatoire</span>
            <textarea className="field-input" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} required placeholder="Ex. avance sur recette, depense urgente couverte demain..." />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[12px] font-black text-white disabled:opacity-60 ${isIncome ? "bg-[#166534]" : "bg-[#1A1410]"}`} disabled={isPending || (requiresReason && !reason.trim())}>
            {isIncome ? <ArrowUpCircle size={15} /> : <ArrowDownCircle size={15} />} {isPending ? "Ajout..." : isIncome ? "Ajouter l'entree" : "Ajouter la sortie"}
          </button>
        </div>
      </form>
    </Modal>
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

function FlowOp({ symbol }: { symbol: string }) {
  return <div className="hidden items-center justify-center text-[15px] font-black text-[#C9BBAA] md:flex" aria-hidden="true">{symbol}</div>;
}

function CardSubtotal({ label, value, tone }: { label: string; value: number; tone: "income" | "expense" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t-2 border-[#E8DED4] bg-[#FCFAF7] px-4 py-3">
      <span className="text-[10px] font-black uppercase text-[#806A58]">{label}</span>
      <span className={`font-mono text-[13px] font-black ${tone === "expense" ? "text-[#991B1B]" : "text-[#166534]"}`}>
        {tone === "expense" ? "-" : "+"}{formatPrice(value)}
      </span>
    </div>
  );
}

function OperationRow({ operation, locked }: { operation: any; locked?: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const isExpense = operation.type === "EXPENSE";
  // Les ecritures de livraison se regularisent (jamais supprimees) ; le serveur le
  // refuse aussi. On masque donc le bouton pour ces sources et sur session cloturee.
  const canDelete = !locked && operation.source !== "DELIVERY";

  const remove = () => {
    if (!confirm("Supprimer cette operation ?")) return;
    startTransition(async () => {
      try {
        await deleteAccountingOperation(operation.id, "Suppression depuis le detail de session");
        showToast("Operation supprimee", "success");
        router.refresh();
      } catch (error: any) {
        showToast(error.message || "Suppression impossible", "error");
      }
    });
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-black text-[#1A1410]">{operation.description || operationLabel(operation.type)}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold text-[#806A58]">
            <span>{operation.category?.name || "Sans categorie"}</span>
            <span>·</span>
            <span>{operation.createdByName || "Systeme"}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={`text-right font-mono text-[12px] font-black ${isExpense ? "text-[#991B1B]" : "text-[#166534]"}`}>{isExpense ? "-" : "+"}{formatPrice(operation.amount)}</div>
          {canDelete && (
            <button
              type="button"
              onClick={remove}
              disabled={isPending}
              title="Supprimer"
              aria-label="Supprimer l'operation"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#F4C7B8] bg-[#FFF7ED] text-[#C2410C] hover:bg-[#FEE2E2] disabled:opacity-50"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {operation.proofUrl && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-[#FCFAF7] px-2 py-1 text-[10px] font-bold text-[#6B4F3B]">
          <FileText size={12} /> {operation.proofUrl}
        </div>
      )}
    </div>
  );
}
