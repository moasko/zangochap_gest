"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarOff, Check, ChevronDown, Plus, RotateCcw, Search, Trash2, Truck } from "lucide-react";
import { COMMUNES } from "@/lib/constants";
import { useToast } from "@/components/Toast";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";
import { resetRiderPlanning, saveRiderPlanning, setAutoAssignOnConfirm } from "@/modules/delivery-planning/actions";
import {
  DEFAULT_WORK_DAYS,
  WEEK_DAYS,
  getRiderAvailability,
  type RiderAbsence,
  type RiderPlanning,
} from "@/modules/delivery-planning/types";
import "./planning.css";

type Overview = Awaited<ReturnType<typeof import("@/modules/delivery-planning/actions").getDeliveryPlanningOverview>>;
type RiderRow = Overview["riders"][number];

const COMMUNE_NAMES = Object.keys(COMMUNES).sort((a, b) => a.localeCompare(b));
const DEFAULT_PLANNING: RiderPlanning = { inDispatch: true, workDays: DEFAULT_WORK_DAYS, absences: [], fixedCommunes: [], capacity: null };

function formatDay(value: string) {
  return value.split("-").reverse().join("/");
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : String(Date.now());
}

/** Actions remplacables pour l'apercu local fictif ; par defaut les Server Actions. */
export type PlanningActions = {
  save: typeof saveRiderPlanning;
  reset: typeof resetRiderPlanning;
  setAuto: typeof setAutoAssignOnConfirm;
};

export default function PlanningClient({ initial, actions }: { initial: Overview; actions?: Partial<PlanningActions> }) {
  const saveAction = actions?.save ?? saveRiderPlanning;
  const resetAction = actions?.reset ?? resetRiderPlanning;
  const setAutoAction = actions?.setAuto ?? setAutoAssignOnConfirm;
  const [rows, setRows] = useState<RiderRow[]>(initial.riders);
  const [autoOnConfirm, setAutoOnConfirm] = useState(initial.autoAssignOnConfirm);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RiderPlanning>(DEFAULT_PLANNING);
  const [absenceForm, setAbsenceForm] = useState({ from: initial.tomorrow, to: initial.tomorrow, reason: "" });
  const [search, setSearch] = useState("");
  const [showDormant, setShowDormant] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const withAvailability = (row: RiderRow, planning: RiderPlanning | null): RiderRow => ({
    ...row,
    planning,
    today: getRiderAvailability(planning || undefined, initial.today, row.recentlyActive),
    tomorrow: getRiderAvailability(planning || undefined, initial.tomorrow, row.recentlyActive),
  });

  const isTeam = (row: RiderRow) => Boolean(row.planning) || row.recentlyActive;
  const team = rows.filter(isTeam);
  const dormantCount = rows.length - team.length;
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => (showDormant || isTeam(row) || openId === row.id)
      && (!term || row.name.toLowerCase().includes(term)));
  }, [rows, search, showDormant, openId]);

  const tomorrowPresent = rows.filter((row) => row.tomorrow.present).length;
  const tomorrowAbsent = team.filter((row) => !row.tomorrow.present).length;
  const todayPresent = rows.filter((row) => row.today.present).length;

  const open = (row: RiderRow) => {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    setDraft(structuredClone(row.planning || DEFAULT_PLANNING));
    setAbsenceForm({ from: initial.tomorrow, to: initial.tomorrow, reason: "" });
  };

  const current = rows.find((row) => row.id === openId) || null;
  const isDirty = Boolean(current) && JSON.stringify(draft) !== JSON.stringify(current!.planning || null);

  const toggleDay = (day: number) => setDraft((d) => ({
    ...d,
    workDays: d.workDays.includes(day) ? d.workDays.filter((x) => x !== day) : [...d.workDays, day].sort(),
  }));
  const toggleCommune = (commune: string) => setDraft((d) => ({
    ...d,
    fixedCommunes: d.fixedCommunes.includes(commune) ? d.fixedCommunes.filter((x) => x !== commune) : [...d.fixedCommunes, commune],
  }));
  const addAbsence = () => {
    if (!absenceForm.from || !absenceForm.to) return;
    if (absenceForm.to < absenceForm.from) {
      showToast("La fin de l'absence precede son debut.", "error");
      return;
    }
    const absence: RiderAbsence = { id: newId(), from: absenceForm.from, to: absenceForm.to, reason: absenceForm.reason.trim() };
    setDraft((d) => ({ ...d, absences: [...d.absences, absence].sort((a, b) => a.from.localeCompare(b.from)) }));
    setAbsenceForm((f) => ({ ...f, reason: "" }));
  };
  const removeAbsence = (id: string) => setDraft((d) => ({ ...d, absences: d.absences.filter((a) => a.id !== id) }));

  const toggleAutoOnConfirm = (enabled: boolean) => {
    if (enabled && !confirm("Activer l'attribution automatique ? Chaque commande confirmee par le call center recevra immediatement un livreur.")) return;
    startTransition(async () => {
      try {
        const result = await setAutoAction(enabled);
        if (!result.success) {
          showToast(result.error, "error");
          return;
        }
        setAutoOnConfirm(result.enabled);
        showToast(result.enabled ? "Attribution a la validation activee" : "Attribution a la validation desactivee", "success");
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : "Erreur", "error");
      }
    });
  };

  const save = () => {
    if (!current) return;
    startTransition(async () => {
      try {
        const result = await saveAction(current.id, draft);
        if (!result.success) {
          showToast(result.error, "error");
          return;
        }
        setRows((list) => list.map((row) => (row.id === current.id ? withAvailability(row, result.planning) : row)));
        setDraft(structuredClone(result.planning));
        showToast(`Planning de ${current.name} enregistre`, "success");
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : "Erreur", "error");
      }
    });
  };

  const reset = () => {
    if (!current || !current.planning) return;
    if (!confirm(`Supprimer le planning de ${current.name} ? Il sera propose selon son activite recente.`)) return;
    startTransition(async () => {
      try {
        const result = await resetAction(current.id);
        if (!result.success) {
          showToast(result.error, "error");
          return;
        }
        setRows((list) => list.map((row) => (row.id === current.id ? withAvailability(row, null) : row)));
        setDraft(structuredClone(DEFAULT_PLANNING));
        showToast(`${current.name} repasse en automatique`, "success");
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        showToast(e instanceof Error ? e.message : "Erreur", "error");
      }
    });
  };

  return (
    <div className="content animate-fade-in plan">
      <div className="plan-head">
        <Link href="/zangochap-manager/admin/delivery" className="plan-back"><ArrowLeft size={15} /> Livraisons</Link>
        <div className="plan-summary">
          <div><strong>{todayPresent}</strong><span>presents aujourd&apos;hui</span></div>
          <div><strong>{tomorrowPresent}</strong><span>presents demain ({formatDay(initial.tomorrow)})</span></div>
          <div className={tomorrowAbsent ? "warn" : ""}><strong>{tomorrowAbsent}</strong><span>absents ou au repos demain</span></div>
        </div>
      </div>

      <section className={`plan-auto ${autoOnConfirm ? "on" : ""}`}>
        <label className="plan-switch">
          <input
            type="checkbox"
            checked={autoOnConfirm}
            disabled={isPending}
            onChange={(e) => toggleAutoOnConfirm(e.target.checked)}
          />
          <span>Attribuer le livreur des la validation par le call center</span>
        </label>
        <small>
          {autoOnConfirm
            ? "Actif : chaque commande confirmee recoit immediatement son livreur (communes affectees, presence, plafond). Le livreur ne la voit qu'une fois emballee. L'admin peut toujours deplacer les colis."
            : "Inactif : les livreurs sont attribues le soir avec « Repartir auto » ou a la main."}
        </small>
      </section>

      <p className="plan-help">
        La repartition automatique coche les livreurs <b>presents</b> du jour. Sans planning, un livreur est propose
        s&apos;il a livre ces 7 derniers jours. Les colis d&apos;une commune sont <b>partages a parts egales</b> entre
        les livreurs qui y sont <b>affectes</b> (15 colis, 3 livreurs : 5 chacun). Hors Abidjan ne part jamais chez un livreur non affecte.
      </p>

      <div className="plan-tools">
        <label className="plan-search">
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un livreur" aria-label="Rechercher un livreur" />
        </label>
        {dormantCount > 0 && (
          <button type="button" className={`plan-toggle ${showDormant ? "active" : ""}`} onClick={() => setShowDormant((v) => !v)}>
            {showDormant ? "Masquer" : "Afficher"} les comptes sans activite ({dormantCount})
          </button>
        )}
      </div>

      <div className="plan-list">
        {visible.map((row) => {
          const isOpen = openId === row.id;
          const planning = row.planning;
          return (
            <section key={row.id} className={`plan-row ${isOpen ? "open" : ""} ${!isTeam(row) ? "dormant" : ""}`}>
              <button type="button" className="plan-row-head" onClick={() => open(row)} aria-expanded={isOpen}>
                <div className="plan-avatar">{row.name.charAt(0)}</div>
                <div className="plan-name">
                  <strong>{row.name}</strong>
                  <small>{row.recentCount} colis / 14 j{row.lastDelivery ? ` · dernier ${formatDay(row.lastDelivery)}` : ""}</small>
                </div>
                <div className="plan-days" aria-label="Jours de travail">
                  {WEEK_DAYS.map((day) => (
                    <span key={day.value} className={(planning?.workDays || (row.recentlyActive ? DEFAULT_WORK_DAYS : [])).includes(day.value) ? "on" : ""} title={day.label}>
                      {day.short}
                    </span>
                  ))}
                </div>
                <div className="plan-meta">
                  {planning?.fixedCommunes.length ? <span className="plan-tag">{planning.fixedCommunes.join(", ")}</span> : null}
                  {planning?.capacity ? <span className="plan-tag">max {planning.capacity}</span> : null}
                  <span className={`plan-mode ${planning ? "manual" : ""}`}>{planning ? "Planning" : "Auto"}</span>
                </div>
                <div className={`plan-status ${row.tomorrow.present ? "ok" : "off"}`} title={`Demain : ${row.tomorrow.reason}`}>
                  {row.tomorrow.present ? "Demain : present" : `Demain : ${row.tomorrow.reason.replace("Absent : ", "")}`}
                </div>
                <ChevronDown size={16} className="plan-chevron" />
              </button>

              {isOpen && (
                <div className="plan-editor">
                  <label className="plan-switch">
                    <input type="checkbox" checked={draft.inDispatch} onChange={(e) => setDraft((d) => ({ ...d, inDispatch: e.target.checked }))} />
                    <span>Inclus dans la repartition automatique</span>
                  </label>

                  <div className="plan-field">
                    <span className="plan-label">Jours de travail</span>
                    <div className="plan-day-toggles">
                      {WEEK_DAYS.map((day) => (
                        <button
                          key={day.value}
                          type="button"
                          className={draft.workDays.includes(day.value) ? "on" : ""}
                          onClick={() => toggleDay(day.value)}
                          aria-pressed={draft.workDays.includes(day.value)}
                          disabled={!draft.inDispatch}
                        >
                          {day.label.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="plan-field">
                    <span className="plan-label">Plafond de colis par jour</span>
                    <div className="plan-capacity">
                      <input
                        type="number"
                        min={1}
                        max={60}
                        placeholder="General"
                        value={draft.capacity ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value ? Math.max(1, Math.min(60, Number(e.target.value))) : null }))}
                        disabled={!draft.inDispatch}
                      />
                      <small>Vide = plafond choisi dans la fenetre de repartition.</small>
                    </div>
                  </div>

                  <div className="plan-field">
                    <span className="plan-label">Communes affectees <small>(partage egal avec les autres livreurs affectes)</small></span>
                    <div className="plan-communes">
                      {COMMUNE_NAMES.map((commune) => (
                        <button
                          key={commune}
                          type="button"
                          className={draft.fixedCommunes.includes(commune) ? "on" : ""}
                          onClick={() => toggleCommune(commune)}
                          aria-pressed={draft.fixedCommunes.includes(commune)}
                          disabled={!draft.inDispatch}
                        >
                          {commune}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="plan-field">
                    <span className="plan-label"><CalendarOff size={14} /> Absences</span>
                    {draft.absences.length === 0 && <small className="plan-empty">Aucune absence prevue.</small>}
                    <ul className="plan-absences">
                      {draft.absences.map((absence) => (
                        <li key={absence.id}>
                          <span>{absence.from === absence.to ? formatDay(absence.from) : `${formatDay(absence.from)} → ${formatDay(absence.to)}`}</span>
                          {absence.reason && <em>{absence.reason}</em>}
                          <button type="button" onClick={() => removeAbsence(absence.id)} aria-label="Supprimer l'absence"><Trash2 size={14} /></button>
                        </li>
                      ))}
                    </ul>
                    <div className="plan-absence-form">
                      <label>Du <input type="date" value={absenceForm.from} onChange={(e) => setAbsenceForm((f) => ({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to }))} /></label>
                      <label>Au <input type="date" value={absenceForm.to} min={absenceForm.from} onChange={(e) => setAbsenceForm((f) => ({ ...f, to: e.target.value }))} /></label>
                      <input type="text" maxLength={80} placeholder="Motif (conge, malade...)" value={absenceForm.reason} onChange={(e) => setAbsenceForm((f) => ({ ...f, reason: e.target.value }))} />
                      <button type="button" className="plan-btn ghost" onClick={addAbsence}><Plus size={14} /> Ajouter</button>
                    </div>
                  </div>

                  <div className="plan-actions">
                    {row.planning && (
                      <button type="button" className="plan-btn link" onClick={reset} disabled={isPending}>
                        <RotateCcw size={14} /> Revenir en automatique
                      </button>
                    )}
                    <button type="button" className="plan-btn ghost" onClick={() => setOpenId(null)} disabled={isPending}>Fermer</button>
                    <button type="button" className="plan-btn primary" onClick={save} disabled={isPending || !isDirty}>
                      <Check size={14} /> {isPending ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
        {visible.length === 0 && (
          <div className="plan-none"><Truck size={18} /> Aucun livreur ne correspond.</div>
        )}
      </div>
    </div>
  );
}
