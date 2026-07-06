"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Check,
  Hourglass,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  cancelQueuedAutomation,
  deleteAutomationRule,
  saveAutomationRule,
  sendAutomationTest,
  toggleAutomationRule,
  updateAutomationSettings,
} from "@/modules/automations/actions";
import {
  AUTOMATION_VARIABLES,
  DAY_LABELS,
  OPERATOR_LABELS,
  ORDER_STATUS_LABELS,
  TRIGGER_DESCRIPTIONS,
  TRIGGER_LABELS,
  conditionFieldsForTrigger,
  describeDelay,
  describeTrigger,
  type AutomationCondition,
  type AutomationConditionOp,
  type AutomationLogEntry,
  type AutomationQueueJob,
  type AutomationRule,
  type AutomationSettings,
  type AutomationTriggerType,
} from "@/modules/automations/types";

type ConsoleData = {
  rules: AutomationRule[];
  log: AutomationLogEntry[];
  settings: AutomationSettings;
  queue: AutomationQueueJob[];
};

type DelayUnit = "minutes" | "heures" | "jours";
const DELAY_UNIT_FACTOR: Record<DelayUnit, number> = { minutes: 1, heures: 60, jours: 1440 };

type Draft = {
  id?: string;
  name: string;
  enabled: boolean;
  trigger: { type: AutomationTriggerType; statuses: string[]; time: string; days: number[] };
  conditions: AutomationCondition[];
  action: {
    recipient: "customer" | "custom";
    phone: string;
    message: string;
    delayValue: number;
    delayUnit: DelayUnit;
    cancelIfStatusChanged: boolean;
  };
};

const TRIGGER_ICONS: Record<AutomationTriggerType, React.ReactNode> = {
  "order.created": <ShoppingBag size={16} />,
  "order.status_changed": <Zap size={16} />,
  "stock.low": <Package size={16} />,
  "schedule": <CalendarClock size={16} />,
};

const ORDER_TRIGGERS: AutomationTriggerType[] = ["order.created", "order.status_changed"];

function blankDraft(): Draft {
  return {
    name: "",
    enabled: true,
    trigger: { type: "order.created", statuses: [], time: "18:00", days: [] },
    conditions: [],
    action: { recipient: "customer", phone: "", message: "", delayValue: 0, delayUnit: "heures", cancelIfStatusChanged: false },
  };
}

function draftFromRule(rule: AutomationRule): Draft {
  const action = rule.actions[0];
  const delayMinutes = Math.max(0, Math.trunc(Number(action?.delayMinutes || 0)));
  let delayValue = delayMinutes;
  let delayUnit: DelayUnit = "minutes";
  if (delayMinutes > 0 && delayMinutes % 1440 === 0) {
    delayValue = delayMinutes / 1440;
    delayUnit = "jours";
  } else if (delayMinutes > 0 && delayMinutes % 60 === 0) {
    delayValue = delayMinutes / 60;
    delayUnit = "heures";
  }
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    trigger: {
      type: rule.trigger.type,
      statuses: rule.trigger.statuses || [],
      time: rule.trigger.time || "18:00",
      days: rule.trigger.days || [],
    },
    conditions: rule.conditions.map((c) => ({ ...c })),
    action: {
      recipient: action?.recipient || "custom",
      phone: action?.phone || "",
      message: action?.message || "",
      delayValue,
      delayUnit,
      cancelIfStatusChanged: Boolean(action?.cancelIfStatusChanged),
    },
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sectionTitle(step: number, label: string) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="w-6 h-6 rounded-lg bg-[#FF6B2C]/10 text-[#FF6B2C] text-[11px] font-black flex items-center justify-center">
        {step}
      </span>
      <span className="text-[13px] font-extrabold text-[#1C1C1E] uppercase tracking-wide">{label}</span>
    </div>
  );
}

export default function AutomationsClient({ initialData }: { initialData: ConsoleData }) {
  const { showToast } = useToast();
  const [rules, setRules] = useState<AutomationRule[]>(initialData.rules || []);
  const [log] = useState<AutomationLogEntry[]>((initialData.log as AutomationLogEntry[]) || []);
  const [settings, setSettings] = useState<AutomationSettings>(initialData.settings);
  const [queue, setQueue] = useState<AutomationQueueJob[]>(initialData.queue || []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isTesting, startTestTransition] = useTransition();
  const [isSavingSettings, startSettingsTransition] = useTransition();

  const activeCount = useMemo(() => rules.filter((rule) => rule.enabled).length, [rules]);

  const conditionFields = draft ? conditionFieldsForTrigger(draft.trigger.type) : [];
  const variables = draft ? AUTOMATION_VARIABLES[draft.trigger.type] : [];
  const isOrderTrigger = draft ? ORDER_TRIGGERS.includes(draft.trigger.type) : false;

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function changeTriggerType(type: AutomationTriggerType) {
    setDraft((current) => {
      if (!current) return current;
      const recipient = ORDER_TRIGGERS.includes(type) ? current.action.recipient : "custom";
      // Les champs de condition changent avec le declencheur : on repart a vide.
      return {
        ...current,
        trigger: { ...current.trigger, type, statuses: [] },
        conditions: [],
        action: { ...current.action, recipient },
      };
    });
  }

  function saveDraft() {
    if (!draft) return;
    startTransition(async () => {
      try {
        const result = await saveAutomationRule({
          id: draft.id,
          name: draft.name,
          enabled: draft.enabled,
          trigger: {
            type: draft.trigger.type,
            statuses: draft.trigger.type === "order.status_changed" ? draft.trigger.statuses : undefined,
            time: draft.trigger.type === "schedule" ? draft.trigger.time : undefined,
            days: draft.trigger.type === "schedule" && draft.trigger.days.length ? draft.trigger.days : undefined,
          },
          conditions: draft.conditions,
          actions: [{
            type: "whatsapp",
            recipient: draft.action.recipient,
            phone: draft.action.recipient === "custom" ? draft.action.phone : undefined,
            message: draft.action.message,
            delayMinutes: Math.max(0, Math.trunc(draft.action.delayValue)) * DELAY_UNIT_FACTOR[draft.action.delayUnit],
            cancelIfStatusChanged: draft.action.delayValue > 0 ? draft.action.cancelIfStatusChanged : false,
          }],
        });
        setRules(result.rules);
        setDraft(null);
        showToast("Automatisation enregistrée", "success");
      } catch (error: any) {
        showToast(error?.message || "Erreur lors de l'enregistrement", "error");
      }
    });
  }

  function toggleRule(rule: AutomationRule) {
    startTransition(async () => {
      try {
        const result = await toggleAutomationRule(rule.id, !rule.enabled);
        setRules(result.rules);
      } catch (error: any) {
        showToast(error?.message || "Erreur", "error");
      }
    });
  }

  function removeRule(rule: AutomationRule) {
    if (!window.confirm(`Supprimer l'automatisation « ${rule.name} » ?`)) return;
    startTransition(async () => {
      try {
        const result = await deleteAutomationRule(rule.id);
        setRules(result.rules);
        showToast("Automatisation supprimée", "success");
      } catch (error: any) {
        showToast(error?.message || "Erreur", "error");
      }
    });
  }

  function saveSettings() {
    startSettingsTransition(async () => {
      try {
        const result = await updateAutomationSettings(settings);
        setSettings(result.settings);
        showToast("Garde-fous enregistrés", "success");
      } catch (error: any) {
        showToast(error?.message || "Erreur lors de l'enregistrement", "error");
      }
    });
  }

  function cancelQueued(job: AutomationQueueJob) {
    if (!window.confirm(`Annuler cet envoi programmé (règle « ${job.ruleName} ») ?`)) return;
    startTransition(async () => {
      try {
        const result = await cancelQueuedAutomation(job.id);
        setQueue(result.queue);
        showToast("Envoi programmé annulé", "success");
      } catch (error: any) {
        showToast(error?.message || "Erreur", "error");
      }
    });
  }

  function sendTest() {
    if (!draft) return;
    startTestTransition(async () => {
      const result = await sendAutomationTest({
        trigger: draft.trigger.type,
        message: draft.action.message,
        phone: testPhone,
      });
      if (result.success) showToast("Message de test envoyé", "success");
      else showToast(result.error || "Échec de l'envoi du test", "error");
    });
  }

  return (
    <div className="p-4 lg:p-6 flex flex-col gap-5 max-w-[1100px]">
      {/* EN-TÊTE + STATS */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white border border-[#E8DED4] rounded-xl px-3.5 py-2">
            <Zap size={15} className="text-[#FF6B2C]" />
            <span className="text-[13px] font-bold text-[#1C1C1E]">{rules.length} règle{rules.length > 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-2 bg-white border border-[#E8DED4] rounded-xl px-3.5 py-2">
            <Check size={15} className="text-[#166534]" />
            <span className="text-[13px] font-bold text-[#1C1C1E]">{activeCount} active{activeCount > 1 ? "s" : ""}</span>
          </div>
        </div>
        <button
          onClick={() => setDraft(blankDraft())}
          className="flex items-center gap-2 bg-[#FF6B2C] hover:bg-[#E85D1F] text-white text-[13px] font-bold px-4 py-2.5 rounded-xl border-none cursor-pointer transition-colors"
        >
          <Plus size={16} />
          Nouvelle automatisation
        </button>
      </div>

      {/* GARDE-FOUS D'ENVOI CLIENT */}
      <div className="bg-white border border-[#E8DED4] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} className="text-[#166534]" />
          <span className="text-[13px] font-extrabold text-[#1C1C1E] uppercase tracking-wide">Garde-fous d’envoi client</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSettings({ ...settings, quietHoursEnabled: !settings.quietHoursEnabled })}
              className={`relative w-11 h-6 rounded-full border-none cursor-pointer transition-colors ${settings.quietHoursEnabled ? "bg-[#FF6B2C]" : "bg-[#E8DED4]"}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${settings.quietHoursEnabled ? "left-[22px]" : "left-0.5"}`} />
            </button>
            <span className="text-[13px] font-bold text-[#1C1C1E]">Fenêtre d’envoi</span>
            <input
              type="time"
              value={settings.sendStart}
              disabled={!settings.quietHoursEnabled}
              onChange={(event) => setSettings({ ...settings, sendStart: event.target.value })}
              className="bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-[#1C1C1E] outline-none disabled:opacity-40"
            />
            <span className="text-[12px] text-[#806A58]">à</span>
            <input
              type="time"
              value={settings.sendEnd}
              disabled={!settings.quietHoursEnabled}
              onChange={(event) => setSettings({ ...settings, sendEnd: event.target.value })}
              className="bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-[#1C1C1E] outline-none disabled:opacity-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-[#1C1C1E]">Plafond / client / jour</span>
            <input
              type="number"
              min={0}
              max={50}
              value={settings.dailyLimitPerRecipient}
              onChange={(event) => setSettings({ ...settings, dailyLimitPerRecipient: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}
              className="w-[70px] bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-[#1C1C1E] outline-none"
            />
            <span className="text-[11px] text-[#B4A192]">(0 = illimité)</span>
          </div>
          <button
            onClick={saveSettings}
            disabled={isSavingSettings}
            className="flex items-center gap-1.5 bg-[#1C1C1E] hover:bg-black text-white text-[12px] font-bold px-3.5 py-2 rounded-xl border-none cursor-pointer transition-colors disabled:opacity-50"
          >
            <Check size={14} />
            {isSavingSettings ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
        <p className="text-[11px] text-[#806A58] mt-2.5">
          Hors fenêtre, les messages clients sont mis en attente et partent à l’ouverture. Les numéros personnalisés
          (équipe, managers) ne sont jamais limités.
        </p>
      </div>

      {/* ENVOIS PROGRAMMÉS */}
      {queue.length > 0 && (
        <div className="bg-white border border-[#E8DED4] rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E8DED4]">
            <Hourglass size={15} className="text-[#1D4ED8]" />
            <span className="text-[13px] font-extrabold text-[#1C1C1E] uppercase tracking-wide">Envois programmés</span>
            <span className="text-[11px] font-black bg-[#EFF6FF] text-[#1D4ED8] px-2 py-0.5 rounded-md">{queue.length}</span>
          </div>
          <div className="divide-y divide-[#F1E8DF]">
            {queue.slice(0, 20).map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-[220px]">
                  <div className="text-[13px] font-bold text-[#1C1C1E]">{job.ruleName}</div>
                  <div className="text-[11px] text-[#806A58]">
                    Vers {job.recipient}{job.orderRef ? ` · Commande ${job.orderRef}` : ""} · prévu le {formatDate(job.notBefore)}
                  </div>
                </div>
                <div className="text-[11px] text-[#806A58] max-w-[280px] truncate hidden sm:block">{job.message}</div>
                <button
                  onClick={() => cancelQueued(job)}
                  disabled={isPending}
                  title="Annuler cet envoi"
                  className="w-8 h-8 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#991B1B] border-none cursor-pointer flex items-center justify-center transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {queue.length > 20 && (
              <div className="px-4 py-2.5 text-[11px] text-[#B4A192]">+ {queue.length - 20} autre{queue.length - 20 > 1 ? "s" : ""} envoi{queue.length - 20 > 1 ? "s" : ""} en attente</div>
            )}
          </div>
        </div>
      )}

      {/* LISTE DES RÈGLES */}
      {rules.length === 0 ? (
        <div className="bg-white border border-[#E8DED4] rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#FF6B2C]/10 text-[#FF6B2C] flex items-center justify-center"><Zap size={22} /></div>
          <div className="text-[15px] font-bold text-[#1C1C1E]">Aucune automatisation pour le moment</div>
          <p className="text-[13px] text-[#806A58] max-w-[420px]">
            Créez votre première règle : par exemple, envoyer un WhatsApp au client dès que sa commande passe « En livraison »,
            ou recevoir une alerte quand un produit atteint son seuil de stock.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule) => (
            <div key={rule.id} className="bg-white border border-[#E8DED4] rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${rule.enabled ? "bg-[#FF6B2C]/10 text-[#FF6B2C]" : "bg-[#F1E8DF] text-[#B4A192]"}`}>
                {TRIGGER_ICONS[rule.trigger.type] || <Zap size={16} />}
              </div>
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-bold text-[#1C1C1E]">{rule.name}</span>
                  {!rule.enabled && (
                    <span className="text-[10px] font-extrabold uppercase bg-[#F1E8DF] text-[#806A58] px-2 py-0.5 rounded-md">En pause</span>
                  )}
                </div>
                <div className="text-[12px] text-[#806A58] mt-0.5">
                  {TRIGGER_LABELS[rule.trigger.type]} · {describeTrigger(rule.trigger)}
                  {rule.conditions.length > 0 && ` · ${rule.conditions.length} condition${rule.conditions.length > 1 ? "s" : ""}`}
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-[#806A58] mt-0.5">
                  <MessageCircle size={12} className="text-[#25D366]" />
                  {rule.actions[0]?.recipient === "customer" ? "WhatsApp au client" : `WhatsApp au ${rule.actions[0]?.phone || "—"}`}
                  {(rule.actions[0]?.delayMinutes || 0) > 0 && ` (${describeDelay(rule.actions[0]?.delayMinutes)})`}
                  <span className="text-[#B4A192]">· {rule.runCount || 0} exécution{(rule.runCount || 0) > 1 ? "s" : ""}{rule.lastRunAt ? ` · dernière : ${formatDate(rule.lastRunAt)}` : ""}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleRule(rule)}
                  disabled={isPending}
                  title={rule.enabled ? "Mettre en pause" : "Activer"}
                  className={`relative w-11 h-6 rounded-full border-none cursor-pointer transition-colors ${rule.enabled ? "bg-[#FF6B2C]" : "bg-[#E8DED4]"}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${rule.enabled ? "left-[22px]" : "left-0.5"}`} />
                </button>
                <button
                  onClick={() => setDraft(draftFromRule(rule))}
                  className="w-9 h-9 rounded-xl bg-[#F7F2EC] hover:bg-[#F1E8DF] text-[#6B4F3B] border-none cursor-pointer flex items-center justify-center transition-colors"
                  title="Modifier"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => removeRule(rule)}
                  disabled={isPending}
                  className="w-9 h-9 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#991B1B] border-none cursor-pointer flex items-center justify-center transition-colors"
                  title="Supprimer"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* JOURNAL */}
      <div className="bg-white border border-[#E8DED4] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E8DED4]">
          <Activity size={15} className="text-[#FF6B2C]" />
          <span className="text-[13px] font-extrabold text-[#1C1C1E] uppercase tracking-wide">Journal des exécutions</span>
          <span className="text-[11px] text-[#B4A192]">(100 dernières)</span>
        </div>
        {log.length === 0 ? (
          <div className="p-6 text-[13px] text-[#806A58]">Aucune exécution pour le moment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[#806A58] uppercase text-[10px] font-extrabold tracking-wider">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Règle</th>
                  <th className="px-4 py-2.5">Destinataire</th>
                  <th className="px-4 py-2.5">Statut</th>
                  <th className="px-4 py-2.5">Message / erreur</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry, index) => (
                  <tr key={index} className="border-t border-[#F1E8DF]">
                    <td className="px-4 py-2.5 text-[#806A58] whitespace-nowrap">{formatDate(entry.at)}</td>
                    <td className="px-4 py-2.5 font-bold text-[#1C1C1E]">{entry.ruleName}</td>
                    <td className="px-4 py-2.5 text-[#806A58] whitespace-nowrap">{entry.recipient || "—"}</td>
                    <td className="px-4 py-2.5">
                      {entry.status === "sent" && (
                        <span className="text-[10px] font-extrabold uppercase bg-[#F0FDF4] text-[#166534] px-2 py-0.5 rounded-md">Envoyé</span>
                      )}
                      {entry.status === "queued" && (
                        <span className="text-[10px] font-extrabold uppercase bg-[#EFF6FF] text-[#1D4ED8] px-2 py-0.5 rounded-md">Programmé</span>
                      )}
                      {entry.status === "skipped" && (
                        <span className="text-[10px] font-extrabold uppercase bg-[#F1E8DF] text-[#6B4F3B] px-2 py-0.5 rounded-md">Ignoré</span>
                      )}
                      {(entry.status === "failed" || !["sent", "queued", "skipped"].includes(entry.status)) && (
                        <span className="text-[10px] font-extrabold uppercase bg-[#FEF2F2] text-[#991B1B] px-2 py-0.5 rounded-md">Échec</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[#806A58] max-w-[320px] truncate">{entry.error || entry.preview || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ÉDITEUR */}
      <AnimatePresence>
        {draft && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-[10001] flex items-start lg:items-center justify-center overflow-y-auto p-3 lg:p-8"
            onClick={() => setDraft(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              onClick={(event) => event.stopPropagation()}
              className="bg-[#FBF8F4] rounded-2xl w-full max-w-[680px] my-4 shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8DED4]">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#FF6B2C]/10 text-[#FF6B2C] flex items-center justify-center"><Zap size={17} /></div>
                  <span className="text-[15px] font-extrabold text-[#1C1C1E]">
                    {draft.id ? "Modifier l'automatisation" : "Nouvelle automatisation"}
                  </span>
                </div>
                <button onClick={() => setDraft(null)} className="w-8 h-8 rounded-lg bg-white border border-[#E8DED4] text-[#806A58] cursor-pointer flex items-center justify-center">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
                {/* NOM */}
                <div>
                  <label className="text-[12px] font-bold text-[#6B4F3B] block mb-1.5">Nom de la règle</label>
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    placeholder="Ex. : Notifier le client au départ en livraison"
                    className="w-full bg-white border border-[#E8DED4] rounded-xl px-3.5 py-2.5 text-[13px] text-[#1C1C1E] outline-none focus:border-[#FF6B2C]"
                  />
                </div>

                {/* 1. DÉCLENCHEUR */}
                <div>
                  {sectionTitle(1, "Déclencheur")}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => changeTriggerType(type)}
                        className={`text-left p-3 rounded-xl border cursor-pointer transition-all ${
                          draft.trigger.type === type
                            ? "bg-[#FF6B2C]/[0.06] border-[#FF6B2C] shadow-[0_0_0_1px_#FF6B2C]"
                            : "bg-white border-[#E8DED4] hover:border-[#D9C9B8]"
                        }`}
                      >
                        <div className={`flex items-center gap-2 text-[13px] font-bold ${draft.trigger.type === type ? "text-[#FF6B2C]" : "text-[#1C1C1E]"}`}>
                          {TRIGGER_ICONS[type]}
                          {TRIGGER_LABELS[type]}
                        </div>
                        <div className="text-[11px] text-[#806A58] mt-1">{TRIGGER_DESCRIPTIONS[type]}</div>
                      </button>
                    ))}
                  </div>

                  {draft.trigger.type === "order.status_changed" && (
                    <div className="mt-3 bg-white border border-[#E8DED4] rounded-xl p-3">
                      <div className="text-[11px] font-bold text-[#6B4F3B] mb-2">Statuts concernés (aucun = tous)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => {
                          const selected = draft.trigger.statuses.includes(status);
                          return (
                            <button
                              key={status}
                              onClick={() => updateDraft({
                                trigger: {
                                  ...draft.trigger,
                                  statuses: selected
                                    ? draft.trigger.statuses.filter((s) => s !== status)
                                    : [...draft.trigger.statuses, status],
                                },
                              })}
                              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                                selected
                                  ? "bg-[#FF6B2C] border-[#FF6B2C] text-white"
                                  : "bg-[#F7F2EC] border-transparent text-[#6B4F3B] hover:bg-[#F1E8DF]"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {draft.trigger.type === "schedule" && (
                    <div className="mt-3 bg-white border border-[#E8DED4] rounded-xl p-3 flex flex-wrap items-center gap-4">
                      <div>
                        <div className="text-[11px] font-bold text-[#6B4F3B] mb-1.5">Heure d’exécution</div>
                        <input
                          type="time"
                          value={draft.trigger.time}
                          onChange={(event) => updateDraft({ trigger: { ...draft.trigger, time: event.target.value } })}
                          className="bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-3 py-2 text-[13px] font-bold text-[#1C1C1E] outline-none"
                        />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-[#6B4F3B] mb-1.5">Jours (aucun = tous les jours)</div>
                        <div className="flex gap-1">
                          {DAY_LABELS.map((label, day) => {
                            const selected = draft.trigger.days.includes(day);
                            return (
                              <button
                                key={day}
                                onClick={() => updateDraft({
                                  trigger: {
                                    ...draft.trigger,
                                    days: selected ? draft.trigger.days.filter((d) => d !== day) : [...draft.trigger.days, day],
                                  },
                                })}
                                className={`text-[11px] font-bold w-9 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                                  selected
                                    ? "bg-[#FF6B2C] border-[#FF6B2C] text-white"
                                    : "bg-[#F7F2EC] border-transparent text-[#6B4F3B] hover:bg-[#F1E8DF]"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. CONDITIONS */}
                {conditionFields.length > 0 && (
                  <div>
                    {sectionTitle(2, "Conditions (optionnel)")}
                    <div className="flex flex-col gap-2">
                      {draft.conditions.map((condition, index) => {
                        const fieldDef = conditionFields.find((f) => f.key === condition.field);
                        return (
                          <div key={index} className="flex flex-wrap items-center gap-2 bg-white border border-[#E8DED4] rounded-xl p-2.5">
                            <select
                              value={condition.field}
                              onChange={(event) => {
                                const next = [...draft.conditions];
                                next[index] = { ...condition, field: event.target.value };
                                updateDraft({ conditions: next });
                              }}
                              className="bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-2.5 py-2 text-[12px] font-bold text-[#1C1C1E] outline-none"
                            >
                              {conditionFields.map((field) => (
                                <option key={field.key} value={field.key}>{field.label}</option>
                              ))}
                            </select>
                            <select
                              value={condition.op}
                              onChange={(event) => {
                                const next = [...draft.conditions];
                                next[index] = { ...condition, op: event.target.value as AutomationConditionOp };
                                updateDraft({ conditions: next });
                              }}
                              className="bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-2.5 py-2 text-[12px] font-bold text-[#1C1C1E] outline-none"
                            >
                              {Object.entries(OPERATOR_LABELS).map(([op, label]) => (
                                <option key={op} value={op}>{label}</option>
                              ))}
                            </select>
                            <input
                              value={condition.value}
                              type={fieldDef?.kind === "number" ? "number" : "text"}
                              placeholder={fieldDef?.kind === "number" ? "Ex. : 10000" : "Ex. : Marcory"}
                              onChange={(event) => {
                                const next = [...draft.conditions];
                                next[index] = { ...condition, value: event.target.value };
                                updateDraft({ conditions: next });
                              }}
                              className="flex-1 min-w-[120px] bg-white border border-[#E8DED4] rounded-lg px-2.5 py-2 text-[12px] text-[#1C1C1E] outline-none focus:border-[#FF6B2C]"
                            />
                            <button
                              onClick={() => updateDraft({ conditions: draft.conditions.filter((_, i) => i !== index) })}
                              className="w-8 h-8 rounded-lg bg-[#FEF2F2] text-[#991B1B] border-none cursor-pointer flex items-center justify-center"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => updateDraft({
                          conditions: [...draft.conditions, { field: conditionFields[0].key, op: "eq", value: "" }],
                        })}
                        className="self-start flex items-center gap-1.5 text-[12px] font-bold text-[#FF6B2C] bg-[#FF6B2C]/[0.08] hover:bg-[#FF6B2C]/[0.14] px-3 py-2 rounded-lg border-none cursor-pointer transition-colors"
                      >
                        <Plus size={14} />
                        Ajouter une condition
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. ACTION */}
                <div>
                  {sectionTitle(conditionFields.length > 0 ? 3 : 2, "Action : envoyer un WhatsApp")}
                  <div className="bg-white border border-[#E8DED4] rounded-xl p-3 flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => updateDraft({ action: { ...draft.action, recipient: "customer" } })}
                        disabled={!isOrderTrigger}
                        title={!isOrderTrigger ? "Ce déclencheur n'a pas de client associé" : undefined}
                        className={`text-[12px] font-bold px-3 py-2 rounded-lg border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          draft.action.recipient === "customer"
                            ? "bg-[#FF6B2C] border-[#FF6B2C] text-white"
                            : "bg-[#F7F2EC] border-transparent text-[#6B4F3B]"
                        }`}
                      >
                        Client de la commande
                      </button>
                      <button
                        onClick={() => updateDraft({ action: { ...draft.action, recipient: "custom" } })}
                        className={`text-[12px] font-bold px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          draft.action.recipient === "custom"
                            ? "bg-[#FF6B2C] border-[#FF6B2C] text-white"
                            : "bg-[#F7F2EC] border-transparent text-[#6B4F3B]"
                        }`}
                      >
                        Numéro personnalisé
                      </button>
                      {draft.action.recipient === "custom" && (
                        <input
                          value={draft.action.phone}
                          onChange={(event) => updateDraft({ action: { ...draft.action, phone: event.target.value } })}
                          placeholder="Ex. : 0700000000"
                          className="flex-1 min-w-[160px] bg-white border border-[#E8DED4] rounded-lg px-3 py-2 text-[12px] text-[#1C1C1E] outline-none focus:border-[#FF6B2C]"
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-bold text-[#6B4F3B]">Délai avant envoi :</span>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={draft.action.delayValue}
                        onChange={(event) => updateDraft({
                          action: { ...draft.action, delayValue: Math.max(0, Math.trunc(Number(event.target.value) || 0)) },
                        })}
                        className="w-[70px] bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-2.5 py-2 text-[12px] font-bold text-[#1C1C1E] outline-none"
                      />
                      <select
                        value={draft.action.delayUnit}
                        onChange={(event) => updateDraft({ action: { ...draft.action, delayUnit: event.target.value as DelayUnit } })}
                        className="bg-[#F7F2EC] border border-[#E8DED4] rounded-lg px-2.5 py-2 text-[12px] font-bold text-[#1C1C1E] outline-none"
                      >
                        <option value="minutes">minutes</option>
                        <option value="heures">heures</option>
                        <option value="jours">jours</option>
                      </select>
                      <span className="text-[11px] text-[#B4A192]">0 = envoi immédiat</span>
                    </div>

                    {isOrderTrigger && draft.action.delayValue > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={draft.action.cancelIfStatusChanged}
                          onChange={(event) => updateDraft({ action: { ...draft.action, cancelIfStatusChanged: event.target.checked } })}
                          className="w-4 h-4 accent-[#FF6B2C] cursor-pointer"
                        />
                        <span className="text-[12px] text-[#6B4F3B]">
                          Annuler l’envoi si le statut de la commande change entre-temps
                        </span>
                      </label>
                    )}

                    <textarea
                      value={draft.action.message}
                      onChange={(event) => updateDraft({ action: { ...draft.action, message: event.target.value } })}
                      rows={5}
                      placeholder="Votre message WhatsApp... Utilisez les variables ci-dessous."
                      className="w-full bg-[#FBF8F4] border border-[#E8DED4] rounded-xl px-3.5 py-3 text-[13px] text-[#1C1C1E] outline-none focus:border-[#FF6B2C] resize-y"
                    />

                    <div className="flex flex-wrap gap-1.5">
                      {variables.map((variable) => (
                        <button
                          key={variable.key}
                          onClick={() => updateDraft({ action: { ...draft.action, message: `${draft.action.message}${draft.action.message.endsWith(" ") || !draft.action.message ? "" : " "}${variable.key}` } })}
                          title={variable.label}
                          className="text-[11px] font-mono font-bold bg-[#F7F2EC] hover:bg-[#F1E8DF] text-[#6B4F3B] px-2 py-1 rounded-md border-none cursor-pointer transition-colors"
                        >
                          {variable.key}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ACTIVATION */}
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <button
                    onClick={() => updateDraft({ enabled: !draft.enabled })}
                    className={`relative w-11 h-6 rounded-full border-none cursor-pointer transition-colors ${draft.enabled ? "bg-[#FF6B2C]" : "bg-[#E8DED4]"}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${draft.enabled ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                  <span className="text-[13px] font-bold text-[#1C1C1E]">
                    {draft.enabled ? "Règle active dès l'enregistrement" : "Règle en pause"}
                  </span>
                </label>
              </div>

              {/* PIED : TEST + ENREGISTRER */}
              <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-t border-[#E8DED4]">
                <input
                  value={testPhone}
                  onChange={(event) => setTestPhone(event.target.value)}
                  placeholder="N° pour un test"
                  className="w-[150px] bg-white border border-[#E8DED4] rounded-xl px-3 py-2.5 text-[12px] text-[#1C1C1E] outline-none focus:border-[#FF6B2C]"
                />
                <button
                  onClick={sendTest}
                  disabled={isTesting || !draft.action.message.trim() || !testPhone.trim()}
                  className="flex items-center gap-1.5 text-[12px] font-bold text-[#6B4F3B] bg-[#F7F2EC] hover:bg-[#F1E8DF] px-3.5 py-2.5 rounded-xl border border-[#E8DED4] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                  {isTesting ? "Envoi..." : "Tester"}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setDraft(null)}
                  className="text-[13px] font-bold text-[#806A58] bg-transparent px-4 py-2.5 rounded-xl border border-[#E8DED4] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={saveDraft}
                  disabled={isPending || !draft.name.trim() || !draft.action.message.trim()}
                  className="flex items-center gap-2 bg-[#FF6B2C] hover:bg-[#E85D1F] text-white text-[13px] font-bold px-5 py-2.5 rounded-xl border-none cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check size={15} />
                  {isPending ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AIDE */}
      <div className="flex items-start gap-2.5 bg-[#FEF3C7]/60 border border-[#FDE68A] rounded-2xl p-4">
        <AlertTriangle size={16} className="text-[#92400E] shrink-0 mt-0.5" />
        <p className="text-[12px] text-[#92400E] leading-relaxed">
          Les automatisations utilisent le canal <strong>WhatsApp Business</strong> configuré dans la console dédiée.
          Les règles planifiées s’exécutent une fois par jour à l’heure choisie (heure d’Abidjan) ; l’alerte stock bas est
          limitée à une par produit et par jour ; « CA encaissé » se base sur les montants reçus par les livreurs.
          Les envois différés et reportés hors fenêtre partent à la minute près via la file d’attente visible ci-dessus.
        </p>
      </div>
    </div>
  );
}
