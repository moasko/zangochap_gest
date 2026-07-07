"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Download,
  Landmark,
  Save,
} from "lucide-react";
import { EmptyState, TableCard } from "@/components/UI";
import ReasonModal from "@/components/ReasonModal";
import { useToast } from "@/components/Toast";
import { formatPrice } from "@/lib/constants";
import { createAccountingReport, getAccountingBilan } from "@/modules/accounting/actions";

type Preset = "week" | "month" | "prev-month" | "custom";
type Scope = "BOTH" | "INCOME" | "EXPENSE";

function fmt(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function monthRange(offset = 0) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: fmt(from), to: fmt(to) };
}
function weekRange() {
  const now = new Date();
  const isoDay = (now.getDay() + 6) % 7; // lundi = 0
  const from = new Date(now);
  from.setDate(now.getDate() - isoDay);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  return { from: fmt(from), to: fmt(to) };
}

const SOURCE_LABELS: Record<string, string> = { DELIVERY: "Livraison", MANUAL: "Manuel", CUSTOMER: "Client", OTHER: "Autre" };

// Neutralise l'injection de formule tableur : une cellule texte commencant par
// =, +, @ ou - (hors nombre) est prefixee d'une apostrophe avant l'echappement.
function csvCell(value: unknown) {
  const text = String(value ?? "");
  const risky = /^[=+@-]/.test(text) && Number.isNaN(Number(text));
  return `"${(risky ? `'${text}` : text).replace(/"/g, '""')}"`;
}

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "week", label: "Cette semaine" },
  { id: "month", label: "Ce mois" },
  { id: "prev-month", label: "Mois dernier" },
  { id: "custom", label: "Personnalise" },
];

export default function BilanClient({ initial, defaultRange, defaultPreset }: {
  initial: any;
  defaultRange: { from: string; to: string };
  defaultPreset: Preset;
}) {
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<any>(initial);
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [scope, setScope] = useState<Scope>("BOTH");
  const [categoryId, setCategoryId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [source, setSource] = useState("ALL");
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const run = (override: Partial<{ from: string; to: string; scope: Scope; categoryId: string; riderId: string; customerId: string; source: string }> = {}) => {
    const category = override.categoryId ?? categoryId;
    const rider = override.riderId ?? riderId;
    const customer = override.customerId ?? customerId;
    const payload = {
      dateFrom: override.from ?? from,
      dateTo: override.to ?? to,
      scope: override.scope ?? scope,
      categoryIds: category ? [category] : [],
      riderIds: rider ? [rider] : [],
      customerIds: customer ? [customer] : [],
      source: override.source ?? source,
    };
    startTransition(async () => {
      try {
        const res = await getAccountingBilan(payload);
        setData(res);
      } catch (error: any) {
        showToast(error.message || "Bilan impossible", "error");
      }
    });
  };

  const applyPreset = (next: Preset) => {
    setPreset(next);
    if (next === "custom") return;
    const range = next === "week" ? weekRange() : next === "prev-month" ? monthRange(-1) : monthRange(0);
    setFrom(range.from);
    setTo(range.to);
    run({ from: range.from, to: range.to });
  };

  const maxCategory = useMemo(
    () => Math.max(1, ...(data.byCategory || []).map((c: any) => c.income + c.expense)),
    [data],
  );
  const maxDay = useMemo(
    () => Math.max(1, ...(data.byDay || []).map((d: any) => Math.max(d.income, d.expense))),
    [data],
  );

  const exportCsv = () => {
    const header = ["Date", "Type", "Source", "Categorie", "Libelle", "Livreur", "Client", "Montant"];
    const rows = (data.operations || []).map((op: any) => [
      fmt(new Date(op.date)),
      op.type,
      SOURCE_LABELS[op.source] || op.source,
      op.categoryName || "",
      (op.description || "").replace(/\s+/g, " "),
      op.riderName || "",
      op.clientName || "",
      op.amount,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bilan-${data.range.from}-${data.range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveReport = (name: string) => {
    const operationTypes = scope === "INCOME" ? ["INCOME"] : scope === "EXPENSE" ? ["EXPENSE"] : ["INCOME", "EXPENSE", "CORRECTION"];
    startTransition(async () => {
      try {
        await createAccountingReport({
          name,
          dateFrom: from,
          dateTo: to,
          categoryIds: categoryId ? [categoryId] : [],
          riderIds: riderId ? [riderId] : [],
          customerIds: customerId ? [customerId] : [],
          source,
          operationTypes: operationTypes as any,
        });
        showToast("Bilan enregistre dans le journal", "success");
        setSaveModalOpen(false);
      } catch (error: any) {
        showToast(error.message || "Enregistrement impossible", "error");
      }
    });
  };

  const totals = data.totals || { totalIncome: 0, totalExpense: 0, balance: 0, count: 0 };

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
      <section className="mb-4 overflow-hidden rounded-lg border border-[var(--line-2)] bg-[var(--navy)] text-white shadow-sm">
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5">
          <div>
            <Link href="/zangochap-manager/accounting" className="mb-2 inline-flex items-center gap-2 text-[12px] font-black text-white/70 hover:text-white">
              <ArrowLeft size={15} /> Retour au journal
            </Link>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase text-[var(--orange-light)]">
              <Landmark size={14} /> Comptabilite generale
            </div>
            <h1 className="text-[22px] font-black md:text-[26px]">Bilan par periode</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-[12px] font-black text-white hover:bg-white/15">
              <Download size={15} /> Export CSV
            </button>
            <button onClick={() => setSaveModalOpen(true)} disabled={isPending} className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--orange)] px-3 text-[12px] font-black text-white hover:bg-[var(--orange-dark)] disabled:opacity-60">
              <Save size={15} /> Enregistrer
            </button>
          </div>
        </div>
      </section>

      <div className="mb-4 rounded-lg border border-[var(--line)] bg-white p-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((option) => (
              <button
                key={option.id}
                onClick={() => applyPreset(option.id)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-black ${preset === option.id ? "border-[var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)]" : "border-[var(--line)] bg-white text-[var(--brown-soft)] hover:bg-[var(--cream)]"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--brown-soft)]">
            {isPending ? <span className="text-[var(--orange)]">Calcul...</span> : <><Calendar size={12} /> {data.range?.from} → {data.range?.to} · {data.operationsCount} ecriture(s)</>}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-7">
          <input type="date" aria-label="Du" className="field-input" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); run({ from: e.target.value }); }} />
          <input type="date" aria-label="Au" className="field-input" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); run({ to: e.target.value }); }} />
          <select className="field-input" aria-label="Type d'operations" value={scope} onChange={(e) => { setScope(e.target.value as Scope); run({ scope: e.target.value as Scope }); }}>
            <option value="BOTH">Entrees + sorties</option>
            <option value="INCOME">Entrees</option>
            <option value="EXPENSE">Sorties</option>
          </select>
          <select className="field-input" aria-label="Categorie" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); run({ categoryId: e.target.value }); }}>
            <option value="">Toutes categories</option>
            {(data.categories || []).map((category: any) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <select className="field-input" aria-label="Livreur" value={riderId} onChange={(e) => { setRiderId(e.target.value); run({ riderId: e.target.value }); }}>
            <option value="">Tous livreurs</option>
            {(data.riders || []).map((rider: any) => <option key={rider.id} value={rider.id}>{rider.name}</option>)}
          </select>
          <select className="field-input" aria-label="Client" value={customerId} onChange={(e) => { setCustomerId(e.target.value); run({ customerId: e.target.value }); }}>
            <option value="">Tous clients</option>
            {(data.customers || []).map((customer: any) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
          <select className="field-input" aria-label="Source" value={source} onChange={(e) => { setSource(e.target.value); run({ source: e.target.value }); }}>
            <option value="ALL">Toutes sources</option>
            <option value="DELIVERY">Livraison</option>
            <option value="MANUAL">Manuel</option>
            <option value="CUSTOMER">Client</option>
            <option value="OTHER">Autre</option>
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <BilanTile label="Entrees" value={formatPrice(totals.totalIncome)} tone="green" />
        <BilanTile label="Sorties" value={formatPrice(totals.totalExpense)} tone="red" />
        <BilanTile label="Solde" value={formatPrice(totals.balance)} tone={totals.balance < 0 ? "red" : "accent"} />
        <BilanTile label="Operations" value={String(totals.count)} tone="ink" />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <TableCard title="Repartition par categorie" meta={`${(data.byCategory || []).length} categorie(s)`}>
          {(data.byCategory || []).length === 0 ? (
            <EmptyState icon="C" title="Aucune donnee" description="Aucune ecriture sur cette periode avec ces filtres." />
          ) : (
            <div className="divide-y divide-[var(--cream-2)]">
              {data.byCategory.map((cat: any) => {
                const total = cat.income + cat.expense;
                return (
                  <div key={cat.categoryId} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[12px] font-black text-[var(--ink)]">{cat.name}</span>
                      <span className={`shrink-0 text-[12px] font-black ${cat.type === "EXPENSE" ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{formatPrice(total)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--cream-2)]">
                      <div className={`h-full ${cat.type === "EXPENSE" ? "bg-[var(--red)]" : "bg-[var(--green)]"}`} style={{ width: `${Math.round((total / maxCategory) * 100)}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-[var(--brown-soft)]">{cat.count} ecriture(s)</div>
                  </div>
                );
              })}
            </div>
          )}
        </TableCard>

        <TableCard title="Evolution par jour" meta={`${(data.byDay || []).length} jour(s)`}>
          {(data.byDay || []).length === 0 ? (
            <EmptyState icon="J" title="Aucune donnee" description="Aucune ecriture sur cette periode." />
          ) : (
            <div className="divide-y divide-[var(--cream-2)]">
              {data.byDay.map((day: any) => (
                <div key={day.date} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-[var(--brown-soft)]">
                    <span>{day.date}</span>
                    <span><span className="text-[var(--green)]">+{formatPrice(day.income)}</span> / <span className="text-[var(--red)]">-{formatPrice(day.expense)}</span></span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    <div className="h-1.5 rounded-full bg-[var(--green)]" style={{ width: `${Math.round((day.income / maxDay) * 50)}%` }} />
                    <div className="h-1.5 rounded-full bg-[var(--red)]" style={{ width: `${Math.round((day.expense / maxDay) * 50)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </TableCard>
      </div>

      <div className="mt-3">
        <TableCard title="Ecritures de la periode" meta={data.operationsCount > (data.operations || []).length ? `${(data.operations || []).length} sur ${data.operationsCount}` : `${(data.operations || []).length} ligne(s)`}>
          {(data.operations || []).length === 0 ? (
            <EmptyState icon="$" title="Aucune ecriture" description="Ajustez la periode ou les filtres." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-[11px] font-bold uppercase text-[var(--brown-soft)]">
                    <th className="w-[100px] px-4 py-3">Date</th>
                    <th className="min-w-[260px] px-3 py-3">Libelle</th>
                    <th className="min-w-[150px] px-3 py-3">Categorie</th>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {data.operations.map((op: any) => {
                    const expense = op.type === "EXPENSE" || (op.type === "CORRECTION" && Number(op.amount) < 0);
                    return (
                      <tr key={op.id} className="border-b border-[var(--cream-2)] text-[12px] last:border-b-0 hover:bg-[var(--cream)]">
                        <td className="px-4 py-2.5 align-top font-mono text-[11px] font-black text-[var(--ink)]">{fmt(new Date(op.date))}</td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-black text-[var(--ink)]">{op.description || (expense ? "Sortie" : "Entree")}</div>
                          {op.riderName && <div className="text-[11px] font-semibold text-[var(--brown-soft)]">Livreur: {op.riderName}</div>}
                          {op.clientName && <div className="text-[11px] font-semibold text-[var(--brown-soft)]">Client: {op.clientName}</div>}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <span className="inline-flex rounded-md bg-[var(--cream-2)] px-2 py-1 text-[11px] font-bold text-[var(--brown-soft)]">{op.categoryName || "Sans categorie"}</span>
                        </td>
                        <td className="px-3 py-2.5 align-top text-[11px] font-bold text-[var(--brown-soft)]">{SOURCE_LABELS[op.source] || op.source}</td>
                        <td className={`px-4 py-2.5 text-right align-top font-mono text-[12px] font-black ${expense ? "text-[var(--red)]" : "text-[var(--green)]"}`}>{expense ? "-" : "+"}{formatPrice(op.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
      </div>

      {saveModalOpen && (
        <ReasonModal
          title="Enregistrer le bilan"
          description={`Periode du ${from} au ${to} · ${data.operationsCount || 0} ecriture(s). Le bilan sera disponible dans le journal de caisse.`}
          confirmLabel="Enregistrer le bilan"
          label="Nom du bilan"
          singleLine
          initialValue={`Bilan ${from} - ${to}`}
          onConfirm={saveReport}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
    </div>
  );
}

function BilanTile({ label, value, tone }: { label: string; value: string; tone: "green" | "red" | "accent" | "ink" }) {
  const valueClasses: Record<string, string> = {
    green: "text-[var(--green)]",
    red: "text-[var(--red)]",
    accent: "text-[var(--orange)]",
    ink: "text-[var(--ink)]",
  };
  return (
    <div className="rounded-md border border-[var(--cream-2)] bg-[var(--cream)] px-3 py-2.5">
      <div className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">{label}</div>
      <div className={`mt-0.5 text-[18px] font-black ${valueClasses[tone]}`}>{value}</div>
    </div>
  );
}
