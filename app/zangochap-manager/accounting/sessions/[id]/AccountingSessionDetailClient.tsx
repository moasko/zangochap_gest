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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  History,
  Landmark,
  Lock,
  LockOpen,
  Plus,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { EmptyState, TableCard } from "@/components/UI";
import Modal from "@/components/Modal";
import ReasonModal from "@/components/ReasonModal";
import AmountInput from "@/components/AmountInput";
import { useToast } from "@/components/Toast";
import { accountingActionLabel, formatDay, formatPrice } from "@/lib/constants";
import {
  cancelRiderValidation,
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
  if (variance === 0) return "text-[var(--green)]";
  return variance > 0 ? "text-[var(--blue)]" : "text-[var(--red)]";
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
  const [closeChecklistOpen, setCloseChecklistOpen] = useState(false);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [cancellingRider, setCancellingRider] = useState<any>(null);
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
  // totalIncome (serveur) = livraisons (validees + restant a valider) + entrees
  // manuelles + corrections positives. On retire ces deux dernieres pour que la
  // tuile "Livraisons" ne soit pas gonflee par une correction.
  const manualIncomeTotal = manualIncomeOperations.reduce((sum: number, operation: any) => sum + Number(operation.amount || 0), 0);
  const positiveCorrectionTotal = workspace.operations
    .filter((operation: any) => operation.type === "CORRECTION" && Number(operation.amount) > 0)
    .reduce((sum: number, operation: any) => sum + Number(operation.amount || 0), 0);
  const deliveryIncomeTotal = Number(workspace.totals.totalIncome || 0) - manualIncomeTotal - positiveCorrectionTotal;
  const expenseTotal = Number(workspace.totals.totalExpense || 0);
  const cashBalance = Number(workspace.totals.balance || 0);
  // Livreurs avec un encaisse mais pas encore valides en caisse.
  const pendingRiders = workspace.riders.filter((rider: any) => !rider.isValidated && Number(rider.collectedAmount || 0) > 0);
  const riderCount = workspace.riders.length;
  const validatedCount = workspace.riders.filter((rider: any) => rider.isValidated).length;
  const validationPct = riderCount > 0 ? Math.round((validatedCount / riderCount) * 100) : 0;

  const groupedAudit = useMemo(() => workspace.audits.slice(0, 12), [workspace.audits]);

  // Points de vigilance affiches dans le modal-checklist de cloture.
  const closeWarnings = [
    pendingRiders.length > 0
      ? `${pendingRiders.length} livreur(s) non valide(s) : leur encaisse restera dans l'ecriture groupee.`
      : null,
    collectionGap !== 0
      ? `Ecart de caisse (encaisse - attendu) : ${collectionGap > 0 ? "+" : ""}${formatPrice(collectionGap)}.`
      : null,
    expenseOperations.length === 0
      ? "Aucune depense saisie pour la journee."
      : null,
  ].filter(Boolean) as string[];

  const closeSession = async (processedAt: string) => {
    setSessionPending(true);
    try {
      await closeAccountingSession(workspace.session.id, { processedAt });
      showToast("Session cloturee", "success");
      setCloseChecklistOpen(false);
      router.refresh();
    } catch (error: any) {
      showToast(error.message || "Cloture impossible", "error");
    } finally {
      setSessionPending(false);
    }
  };

  const reopenSession = async (reason: string) => {
    setSessionPending(true);
    try {
      await reopenAccountingSession(workspace.session.id, reason);
      showToast("Session reouverte", "success");
      setReopenModalOpen(false);
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

  const cancelValidation = async (rider: any, reason: string) => {
    setValidatingRiderId(rider.riderId);
    try {
      await cancelRiderValidation({ sessionId: workspace.session.id, riderId: rider.riderId, reason });
      showToast("Validation annulee : le livreur repasse a valider", "success");
      setCancellingRider(null);
      router.refresh();
    } catch (error: any) {
      showToast(error.message || "Annulation impossible", "error");
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
      <section className="overflow-hidden rounded-lg border border-[var(--line-2)] bg-[var(--navy)] text-white shadow-sm">
        <div className="flex flex-col gap-4 p-4 md:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link href="/zangochap-manager/accounting" className="mb-2 inline-flex items-center gap-2 text-[12px] font-black text-white/70 hover:text-white">
              <ArrowLeft size={15} /> Retour au journal
            </Link>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--orange-light)]">
              <ClipboardCheck size={14} /> Detail session comptable
            </div>
            <h1 className="text-[22px] font-black md:text-[26px]">Session du {sessionDate}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-black ${isClosed ? "bg-[var(--green)]/30 text-[var(--green-soft)]" : "bg-white/10 text-white"}`}>
                {isClosed ? <Lock size={12} /> : <LockOpen size={12} />} {isClosed ? "Cloturee" : "Ouverte"}
              </span>
              {isClosed && workspace.session.processedAt && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">
                  Traitee le {dateInputValue(workspace.session.processedAt)}
                </span>
              )}
              {riderCount > 0 && (
                <span className="inline-flex items-center gap-2 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/90">
                  {validatedCount}/{riderCount} livreurs valides
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/20">
                    <span className="block h-full bg-[var(--orange)]" style={{ width: `${validationPct}%` }} />
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 lg:justify-end">
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase text-white/55">Solde de caisse</div>
              <div className="text-[24px] font-black text-[var(--orange-light)] md:text-[28px]">{formatPrice(cashBalance)}</div>
            </div>
            {isClosed ? (
              canReopen && (
                <button type="button" onClick={() => setReopenModalOpen(true)} disabled={sessionPending} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3.5 py-2.5 text-[12px] font-black hover:bg-white/15 disabled:opacity-60">
                  <LockOpen size={14} /> {sessionPending ? "..." : "Rouvrir"}
                </button>
              )
            ) : (
              <button type="button" onClick={() => setCloseChecklistOpen(true)} disabled={sessionPending} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-white px-3.5 py-2.5 text-[12px] font-black text-[var(--navy)] hover:bg-[var(--cream)] disabled:opacity-60">
                <Lock size={14} /> {sessionPending ? "..." : "Cloturer la session"}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--brown-soft)]">
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

        <div className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--brown-soft)]">
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
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--orange)] px-2.5 text-[11px] font-black text-white hover:bg-[var(--orange-dark)] disabled:opacity-60"
            >
              <ClipboardCheck size={13} /> {validatingAll ? "Validation..." : `Tout valider (${pendingRiders.length})`}
            </button>
          ) : undefined}
        >
          {workspace.riders.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={22} />} title="Aucun livreur sur cette session" description="Les livraisons cloturees du jour apparaitront ici." />
          ) : (
            <div className="divide-y divide-[var(--cream-2)]">
              {workspace.riders.map((rider: any) => (
                <RiderCard
                  key={rider.riderId}
                  rider={rider}
                  amount={riderAmounts[rider.riderId] || ""}
                  onAmountChange={(raw) => setRiderAmounts((current) => ({ ...current, [rider.riderId]: raw }))}
                  onValidate={() => validateRider(rider)}
                  onCancelValidation={() => setCancellingRider(rider)}
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
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--navy)] px-3 text-[13px] font-black text-white shadow-sm hover:bg-[var(--navy-2)] disabled:opacity-60"
          >
            <Plus size={16} /> {isClosed ? "Session cloturee" : "Ajouter une operation"}
          </button>

          <TableCard
            title="Autres entrees"
            meta={`${manualIncomeOperations.length} entree(s)`}
            actions={!isClosed ? (
              <button type="button" onClick={() => setOperationModalType("INCOME")} className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--green-soft)] bg-[var(--green-soft)] px-2 text-[11px] font-black text-[var(--green)] hover:bg-[var(--green-soft)]">
                <Plus size={12} /> Entree
              </button>
            ) : undefined}
          >
            {manualIncomeOperations.length === 0 ? (
              <EmptyState icon={<ArrowUpCircle size={22} />} title="Aucune entree manuelle" description="Vente directe, reglement client, avance... via le bouton + Entree." />
            ) : (
              <>
                <div className="divide-y divide-[var(--cream-2)]">
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
              <button type="button" onClick={() => setOperationModalType("EXPENSE")} className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--red-soft)] bg-[var(--red-soft)] px-2 text-[11px] font-black text-[var(--red)] hover:bg-[var(--red-soft)]">
                <Plus size={12} /> Sortie
              </button>
            ) : undefined}
          >
            {expenseOperations.length === 0 ? (
              <EmptyState icon={<ArrowDownCircle size={22} />} title="Aucune sortie" description="Depenses du jour (carburant, commission...) via le bouton + Sortie." />
            ) : (
              <>
                <div className="divide-y divide-[var(--cream-2)]">
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
            <EmptyState icon={<History size={22} />} title="Aucune trace" description="Les validations et sorties seront journalisees ici." />
          ) : (
            <div className="divide-y divide-[var(--cream-2)]">
              {groupedAudit.map((audit: any) => (
                <div key={audit.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-black text-[var(--ink)]">{accountingActionLabel(audit.action)}</div>
                    <div className="text-[11px] font-semibold text-[var(--brown-soft)]">{formatDay(audit.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-[var(--brown-soft)]">
                    {audit.actorName || "Systeme"}{audit.newAmount !== null ? ` · ${formatPrice(audit.newAmount)}` : ""}
                  </div>
                  {audit.reason && <div className="mt-1 text-[11px] text-[var(--brown-soft)]">{audit.reason}</div>}
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
      {closeChecklistOpen && (
        <CloseSessionModal
          sessionDate={sessionDate}
          cashBalance={cashBalance}
          warnings={closeWarnings}
          pending={sessionPending}
          onConfirm={closeSession}
          onClose={() => setCloseChecklistOpen(false)}
        />
      )}
      {reopenModalOpen && (
        <ReasonModal
          title="Rouvrir la session"
          description={`Session du ${sessionDate} : la reouverture deverrouille toutes les ecritures. Elle est journalisee avec votre nom.`}
          confirmLabel="Rouvrir la session"
          placeholder="Ex. oubli d'une depense, correction d'un montant livreur..."
          onConfirm={reopenSession}
          onClose={() => setReopenModalOpen(false)}
        />
      )}
      {cancellingRider && (
        <ReasonModal
          title={`Annuler la validation de ${cancellingRider.riderName}`}
          description={`Le montant valide (${formatPrice(cancellingRider.validatedAmount)}) sera retire de la caisse et l'encaisse du livreur repassera dans les entrees a valider.`}
          confirmLabel="Annuler la validation"
          danger
          placeholder="Ex. montant valide errone, reglement recompte..."
          onConfirm={(reason) => cancelValidation(cancellingRider, reason)}
          onClose={() => setCancellingRider(null)}
        />
      )}
    </div>
  );
}

// Modal-checklist de cloture : l'action la plus lourde du module merite mieux
// qu'un confirm() natif. Les points de vigilance doivent etre lus et acquittes
// explicitement avant de verrouiller la session.
function CloseSessionModal({ sessionDate, cashBalance, warnings, pending, onConfirm, onClose }: {
  sessionDate: string;
  cashBalance: number;
  warnings: string[];
  pending: boolean;
  onConfirm: (processedAt: string) => void;
  onClose: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  // Date de traitement saisie manuellement, pre-remplie avec aujourd'hui.
  const [processedAt, setProcessedAt] = useState(() => dateInputValue());
  const canConfirm = (warnings.length === 0 || acknowledged) && Boolean(processedAt);

  return (
    <Modal isOpen onClose={onClose} title="Cloturer la session">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-[var(--cream)] px-3 py-2.5">
          <div>
            <div className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Session du {sessionDate}</div>
            <div className="text-[12px] font-semibold text-[var(--brown-soft)]">Les ecritures seront verrouillees.</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Solde de caisse</div>
            <div className="text-[17px] font-black text-[var(--orange)]">{formatPrice(cashBalance)}</div>
          </div>
        </div>

        <label className="grid gap-1.5 rounded-md border border-[var(--line)] bg-white px-3 py-2.5">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Date de traitement</span>
          <input
            type="date"
            value={processedAt}
            onChange={(event) => setProcessedAt(event.target.value)}
            required
            className="field-input"
          />
          <span className="text-[11px] font-semibold text-[var(--brown-soft)]">Jour ou la caisse a ete reellement traitee avant verrouillage.</span>
        </label>

        {warnings.length > 0 ? (
          <div className="grid gap-1.5">
            {warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2 rounded-md border border-[var(--orange-soft)] bg-[var(--orange-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--red)]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-[var(--green-soft)] bg-[var(--green-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--green)]">
            <CheckCircle2 size={14} className="shrink-0" /> Rien a signaler : livreurs valides, pas d&apos;ecart de caisse.
          </div>
        )}

        {warnings.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-[var(--line)] px-3 py-2.5">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="h-4 w-4 accent-[var(--orange)]"
            />
            <span className="text-[12px] font-bold text-[var(--ink)]">J&apos;ai verifie ces points, je cloture quand meme.</span>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Annuler</button>
          <button
            type="button"
            onClick={() => onConfirm(processedAt)}
            disabled={pending || !canConfirm}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-4 text-[12px] font-black text-white hover:bg-[var(--navy-2)] disabled:opacity-60"
          >
            <Lock size={14} /> {pending ? "Cloture..." : "Cloturer la session"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function riderInitials(name: string) {
  const parts = String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() || "").join("");
  return initials || "?";
}

function RiderStat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-md border border-[var(--cream-2)] bg-[var(--cream)] px-2.5 py-2">
      <div className="text-[11px] font-semibold uppercase text-[var(--brown-soft)]">{label}</div>
      <div className={`mt-0.5 font-mono text-[13px] font-black ${tone || "text-[var(--ink)]"}`}>{value}</div>
      {hint && <div className={`text-[10px] font-semibold ${tone || "text-[var(--brown-soft)]"}`}>{hint}</div>}
    </div>
  );
}

function RiderCard({ rider, amount, onAmountChange, onValidate, onCancelValidation, validating, locked }: {
  rider: any;
  amount: string;
  onAmountChange: (raw: string) => void;
  onValidate: () => void;
  onCancelValidation: () => void;
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
    <article className={`grid gap-3 border-l-2 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_248px] lg:items-start ${rider.isValidated ? "border-[var(--green)]" : "border-[var(--orange)]"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] text-[11px] font-bold text-white">{riderInitials(rider.riderName)}</span>
          <h2 className="text-[15px] font-black text-[var(--ink)]">{rider.riderName}</h2>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${rider.isValidated ? "bg-[var(--green-soft)] text-[var(--green)]" : "bg-[var(--orange-soft)] text-[var(--orange)]"}`}>
            {rider.isValidated ? "Validee" : "A valider"}
          </span>
          {bigGap && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--red-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--red)]">
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
              <div key={order.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[var(--cream)] px-2 py-1.5 text-[11px]">
                <span className="truncate font-bold text-[var(--brown-soft)]">{order.ref || order.id.slice(0, 8)} · {order.customerName}</span>
                <span className="shrink-0 font-black text-[var(--ink)]" title={adjusted ? `Theorique ${formatPrice(order.expectedAmount)}` : undefined}>
                  {formatPrice(order.collectedAmount)}
                  {adjusted && <span className="ml-0.5 text-[var(--red)]">*</span>}
                </span>
              </div>
            );
          })}
        </div>

        {(rider.orders.length > 4 || hasAdjustment) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {rider.orders.length > 4 && (
              <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 text-[11px] font-black text-[var(--orange)] hover:underline">
                <ChevronDown size={13} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
                {expanded ? "Voir moins" : `Voir les ${rider.orders.length} commandes`}
              </button>
            )}
            {hasAdjustment && (
              <span className="text-[11px] font-semibold text-[var(--brown-soft)]"><span className="text-[var(--red)]">*</span> encaisse different du theorique</span>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--cream)] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Montant valide en caisse</span>
          {!locked && collected > 0 && (
            <button type="button" onClick={() => onAmountChange(String(collected))} className="text-[11px] font-bold text-[var(--orange)] hover:underline">
              = encaisse
            </button>
          )}
        </div>
        <AmountInput className="field-input mt-1" disabled={locked} value={amount} onChange={onAmountChange} />
        {typed > 0 && liveGap !== 0 && (
          <div className={`mt-1 text-[11px] font-semibold ${varianceTone(liveGap)}`}>
            ecart vs encaisse {liveGap > 0 ? "+" : ""}{formatPrice(liveGap)}
          </div>
        )}
        {rider.isValidated && rider.variance !== 0 && (
          <div className={`mt-1 text-[11px] font-semibold ${varianceTone(rider.variance)}`}>
            valide {formatPrice(rider.validatedAmount)} (ecart {rider.variance > 0 ? "+" : ""}{formatPrice(rider.variance)})
          </div>
        )}
        <button
          type="button"
          className="mt-2.5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[var(--orange)] px-3 text-[12px] font-black text-white hover:bg-[var(--orange-dark)] disabled:opacity-60"
          disabled={locked || validating}
          onClick={onValidate}
        >
          <Save size={14} /> {validating ? "Validation..." : rider.isValidated ? "Mettre a jour" : "Valider entree"}
        </button>
        {rider.isValidated && !locked && (
          <button
            type="button"
            className="mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--orange-soft)] bg-white px-3 text-[11px] font-black text-[var(--orange)] hover:bg-[var(--orange-soft)] disabled:opacity-60"
            disabled={validating}
            onClick={onCancelValidation}
          >
            <Undo2 size={13} /> Annuler la validation
          </button>
        )}
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
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${isIncome ? "border-[var(--green-soft)] bg-[var(--green-soft)] text-[var(--green)]" : "border-[var(--line)] bg-white text-[var(--brown-soft)]"}`}
          >
            <ArrowUpCircle size={14} /> Entree
          </button>
          <button
            type="button"
            onClick={() => switchType("EXPENSE")}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${!isIncome ? "border-[var(--red-soft)] bg-[var(--red-soft)] text-[var(--red)]" : "border-[var(--line)] bg-white text-[var(--brown-soft)]"}`}
          >
            <ArrowDownCircle size={14} /> Sortie
          </button>
        </div>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Categorie</span>
          <select className="field-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Montant</span>
          <AmountInput className="field-input" value={amount} onChange={setAmount} required />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Libelle</span>
          <textarea className="field-input" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} required placeholder={isIncome ? "Ex. vente directe, reglement client, avance..." : "Ex. carburant, commission, course..."} />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">Piece / reference</span>
          <input className="field-input" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="Optionnel" />
        </label>
        {requiresReason && (
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
          <button type="submit" className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[12px] font-black text-white disabled:opacity-60 ${isIncome ? "bg-[var(--green)]" : "bg-[var(--ink)]"}`} disabled={isPending || (requiresReason && !reason.trim())}>
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

function FlowOp({ symbol }: { symbol: string }) {
  return <div className="hidden items-center justify-center text-[15px] font-black text-[var(--line-2)] md:flex" aria-hidden="true">{symbol}</div>;
}

function CardSubtotal({ label, value, tone }: { label: string; value: number; tone: "income" | "expense" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t-2 border-[var(--line)] bg-[var(--cream)] px-4 py-3">
      <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">{label}</span>
      <span className={`font-mono text-[13px] font-black ${tone === "expense" ? "text-[var(--red)]" : "text-[var(--green)]"}`}>
        {tone === "expense" ? "-" : "+"}{formatPrice(value)}
      </span>
    </div>
  );
}

function OperationRow({ operation, locked }: { operation: any; locked?: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const isExpense = operation.type === "EXPENSE";
  // Les ecritures de livraison se regularisent (jamais supprimees) ; le serveur le
  // refuse aussi. On masque donc le bouton pour ces sources et sur session cloturee.
  const canDelete = !locked && operation.source !== "DELIVERY";

  const remove = (reason: string) => {
    startTransition(async () => {
      try {
        await deleteAccountingOperation(operation.id, reason);
        showToast("Operation supprimee", "success");
        setDeleteModalOpen(false);
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
          <div className="text-[12px] font-black text-[var(--ink)]">{operation.description || operationLabel(operation.type)}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold text-[var(--brown-soft)]">
            <span>{operation.category?.name || "Sans categorie"}</span>
            <span>·</span>
            <span>{operation.createdByName || "Systeme"}</span>
          </div>
          {isExpense && operation.reason && (
            <div className="mt-1 inline-flex max-w-full items-start gap-1 rounded-md bg-[var(--red-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--red)]">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="break-words">Motif : {operation.reason}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={`text-right font-mono text-[12px] font-black ${isExpense ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{isExpense ? "-" : "+"}{formatPrice(operation.amount)}</div>
          {canDelete && (
            <button
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              disabled={isPending}
              title="Supprimer"
              aria-label="Supprimer l'operation"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--orange-soft)] bg-[var(--orange-soft)] text-[var(--orange)] hover:bg-[var(--red-soft)] disabled:opacity-50"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {operation.proofUrl && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--cream)] px-2 py-1 text-[11px] font-semibold text-[var(--brown-soft)]">
          <FileText size={12} /> {operation.proofUrl}
        </div>
      )}
      {deleteModalOpen && (
        <ReasonModal
          title="Supprimer l'ecriture"
          description={`Suppression de "${operation.description || operationLabel(operation.type)}" (${formatPrice(operation.amount)}). Cette action est journalisee.`}
          confirmLabel="Supprimer l'ecriture"
          danger
          placeholder="Ex. doublon de saisie, erreur de montant..."
          onConfirm={remove}
          onClose={() => setDeleteModalOpen(false)}
        />
      )}
    </div>
  );
}
