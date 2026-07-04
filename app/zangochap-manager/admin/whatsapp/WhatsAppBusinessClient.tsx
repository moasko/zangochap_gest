"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Clipboard,
  ExternalLink,
  FileText,
  KeyRound,
  LayoutDashboard,
  MessageCircle,
  Phone,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { EmptyState, TableCard } from "@/components/UI";
import {
  checkWhatsAppHealth,
  getWhatsAppTemplates,
  sendWhatsAppMessage,
} from "@/modules/whatsapp/actions";

type TabId = "overview" | "send" | "templates" | "activity";

type Template = {
  name: string;
  status: string;
  category: string | null;
  language: string;
  bodyText: string;
  paramCount: number;
};

type Health = {
  checkedAt: string;
  phone: {
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string;
    codeVerificationStatus: string | null;
    platformType: string | null;
    throughputLevel: string | null;
  };
  token: {
    type: string | null;
    isValid: boolean;
    expiresAt: string | null;
    scopes: string[];
  } | null;
};

const ENVIRONMENT_FIELDS = [
  ["WHATSAPP_ACCESS_TOKEN", "Token permanent", "accessToken"],
  ["WHATSAPP_PHONE_NUMBER_ID", "ID du numéro", "phoneNumberId"],
  ["WHATSAPP_BUSINESS_ACCOUNT_ID", "ID du compte WABA", "businessAccountId"],
  ["WHATSAPP_WEBHOOK_VERIFY_TOKEN", "Token de vérification", "verifyToken"],
  ["WHATSAPP_APP_SECRET", "Secret de l'application", "appSecret"],
] as const;

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Aperçu", icon: <LayoutDashboard size={14} /> },
  { id: "send", label: "Envoyer", icon: <Send size={14} /> },
  { id: "templates", label: "Templates", icon: <FileText size={14} /> },
  { id: "activity", label: "Activité", icon: <Activity size={14} /> },
];

function formatDate(value: unknown) {
  if (typeof value !== "string") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function qualityBadge(rating: string) {
  const map: Record<string, { label: string; classes: string }> = {
    GREEN: { label: "Qualité verte", classes: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]" },
    YELLOW: { label: "Qualité moyenne", classes: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]" },
    RED: { label: "Qualité dégradée", classes: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]" },
  };
  return map[rating] || { label: rating || "Inconnue", classes: "bg-[#F1E8DF] text-[#6B4F3B] border-[#E8DED4]" };
}

function templateStatusBadge(status: string) {
  const map: Record<string, string> = {
    APPROVED: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]",
    PENDING: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
    REJECTED: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]",
    PAUSED: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
  };
  return map[status] || "bg-[#F1E8DF] text-[#6B4F3B] border-[#E8DED4]";
}

function deliveryStatusTone(status: string) {
  const map: Record<string, string> = {
    sent: "text-[#806A58]",
    delivered: "text-[#166534]",
    read: "text-[#1D4ED8]",
    failed: "text-[#991B1B]",
  };
  return map[status] || "text-[#806A58]";
}

export default function WhatsAppBusinessClient({ initialData }: { initialData: any }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabId>("overview");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthPending, setHealthPending] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templatesPending, setTemplatesPending] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const configuration = initialData.configuration;
  const configuredCount = Object.values(configuration.fields as Record<string, boolean>).filter(Boolean).length;
  const sentLog: any[] = initialData.sentLog || [];
  const webhookLog: any[] = initialData.webhookLog || [];
  const lastIncoming = webhookLog.find((event) => event.direction === "incoming");

  const runHealthCheck = async () => {
    setHealthPending(true);
    try {
      const result = await checkWhatsAppHealth();
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      setHealth(result as Health);
      showToast("Connexion Meta vérifiée", "success");
    } finally {
      setHealthPending(false);
    }
  };

  const loadTemplates = async (silent = false) => {
    setTemplatesPending(true);
    try {
      const result = await getWhatsAppTemplates();
      if (!result.success) {
        if (!silent) showToast(result.error, "error");
        return;
      }
      setTemplates(result.templates);
    } finally {
      setTemplatesPending(false);
    }
  };

  const openTab = (next: TabId) => {
    setTab(next);
    if ((next === "templates" || next === "send") && templates === null && !templatesPending) {
      loadTemplates(true);
    }
  };

  const useTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setTab("send");
  };

  // Expiration du token affichee en jours restants (alerte si < 7 jours ou token USER 24 h).
  const tokenWarning = useMemo(() => {
    if (!health?.token) return null;
    if (!health.token.isValid) return "Le token est invalide ou révoqué.";
    if (health.token.type === "USER") return "Token temporaire (utilisateur) : remplacez-le par un token permanent d'utilisateur système.";
    if (health.token.expiresAt) {
      const days = Math.floor((new Date(health.token.expiresAt).getTime() - Date.now()) / 86_400_000);
      if (days <= 7) return `Le token expire dans ${Math.max(0, days)} jour(s).`;
    }
    return null;
  }, [health]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-5 overflow-hidden rounded-lg border border-[#D8CBBB] bg-[#101820] text-white shadow-sm"
      >
        <div className="flex flex-col gap-4 p-4 md:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#FF6B2C]/15 text-[#FFB38A]">
              <MessageCircle size={26} />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase text-[#FFB38A]">
                <Radio size={13} /> WhatsApp Cloud API
              </div>
              <h1 className="text-[22px] font-black md:text-[26px]">Centre WhatsApp ZangoChap</h1>
              <p className="mt-1 text-[12px] font-bold text-white/60">
                Connexion Meta, templates, envois et messages entrants — sans exposer les secrets au navigateur.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-black ${configuration.isReady ? "bg-[#166534]/30 text-[#BBF7D0]" : "bg-white/10 text-white"}`}>
              {configuration.isReady ? <BadgeCheck size={14} /> : <ShieldCheck size={14} />}
              {configuration.isReady ? "Configuration complète" : `${configuredCount}/5 variables configurées`}
            </span>
            <button
              type="button"
              onClick={runHealthCheck}
              disabled={healthPending}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[#FF6B2C] px-3 text-[12px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
            >
              <Stethoscope size={15} /> {healthPending ? "Diagnostic..." : "Vérifier la connexion"}
            </button>
          </div>
        </div>
      </motion.section>

      {health && (
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 rounded-lg border border-[#E8DED4] bg-white p-4 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase text-[#806A58]">
              <Phone size={13} /> État du numéro (vérifié le {formatDate(health.checkedAt)})
            </div>
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-black ${qualityBadge(health.phone.qualityRating).classes}`}>
              {qualityBadge(health.phone.qualityRating).label}
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <HealthTile label="Numéro" value={health.phone.displayPhoneNumber || "—"} />
            <HealthTile label="Nom vérifié" value={health.phone.verifiedName || "—"} />
            <HealthTile label="Débit" value={health.phone.throughputLevel || "—"} />
            <HealthTile
              label="Token"
              value={health.token
                ? health.token.expiresAt
                  ? `Expire le ${formatDate(health.token.expiresAt)}`
                  : "Permanent"
                : "Non lisible"}
            />
          </div>
          {tokenWarning && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[11px] font-black text-[#991B1B]">
              <XCircle size={14} /> {tokenWarning}
            </div>
          )}
        </motion.section>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openTab(item.id)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12px] font-black ${tab === item.id
              ? "border-[#FF6B2C] bg-[#FFF7ED] text-[#C2410C]"
              : "border-[#E8DED4] bg-white text-[#806A58] hover:bg-[#FCFAF7]"}`}
          >
            {item.icon} {item.label}
            {item.id === "activity" && (sentLog.length + webhookLog.length) > 0 && (
              <span className="rounded-full bg-[#F1E8DF] px-1.5 text-[10px] text-[#6B4F3B]">{sentLog.length + webhookLog.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          configuration={configuration}
          webhookUrl={initialData.webhookUrl}
          lastIncoming={lastIncoming}
          showToast={showToast}
        />
      )}
      {tab === "send" && (
        <SendTab
          templates={templates}
          templatesPending={templatesPending}
          selectedTemplate={selectedTemplate}
          onSelectTemplate={setSelectedTemplate}
          onReloadTemplates={() => loadTemplates()}
          onSent={() => router.refresh()}
          sentLog={sentLog}
        />
      )}
      {tab === "templates" && (
        <TemplatesTab
          templates={templates}
          pending={templatesPending}
          onReload={() => loadTemplates()}
          onUse={useTemplate}
        />
      )}
      {tab === "activity" && <ActivityTab sentLog={sentLog} webhookLog={webhookLog} />}
    </div>
  );
}

function HealthTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#F1E8DF] bg-[#FCFAF7] px-3 py-2.5">
      <div className="text-[10px] font-black uppercase text-[#806A58]">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-black text-[#1A1410]">{value}</div>
    </div>
  );
}

function OverviewTab({ configuration, webhookUrl, lastIncoming, showToast }: {
  configuration: any;
  webhookUrl: string;
  lastIncoming: any;
  showToast: (message: string, tone: "success" | "error") => void;
}) {
  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      showToast("URL du webhook copiée", "success");
    } catch {
      showToast("Copie impossible sur ce navigateur", "error");
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <TableCard title="Configuration serveur" meta="Secrets masqués">
        <div className="divide-y divide-[#F1E8DF]">
          {ENVIRONMENT_FIELDS.map(([variable, label, key]) => {
            const configured = configuration.fields[key];
            return (
              <div key={variable} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-black text-[#1A1410]">{label}</div>
                  <code className="text-[10px] font-bold text-[#806A58]">{variable}</code>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black ${configured
                  ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]"
                  : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"}`}>
                  {configured ? <Check size={11} /> : <XCircle size={11} />}
                  {configured ? "Configuré" : "Manquant"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 border-t-2 border-[#E8DED4] bg-[#FCFAF7] p-3 md:grid-cols-2">
          <div className="rounded-md border border-[#F1E8DF] bg-white px-3 py-2">
            <div className="text-[9px] font-black uppercase text-[#806A58]">Phone number ID</div>
            <div className="truncate font-mono text-[12px] font-black text-[#1A1410]">{configuration.phoneNumberId || "Non configuré"}</div>
          </div>
          <div className="rounded-md border border-[#F1E8DF] bg-white px-3 py-2">
            <div className="text-[9px] font-black uppercase text-[#806A58]">Compte WABA</div>
            <div className="truncate font-mono text-[12px] font-black text-[#1A1410]">{configuration.businessAccountId || "Non configuré"}</div>
          </div>
        </div>
      </TableCard>

      <div className="flex flex-col gap-4">
        <TableCard title="Webhook Meta" meta={lastIncoming ? "Actif" : "En attente"}>
          <div className="p-4">
            <p className="mb-3 text-[11px] font-bold text-[#806A58]">
              Collez cette URL dans Configuration → Webhooks de l&apos;app Meta, avec la valeur de <code className="font-black">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>, puis abonnez-vous au champ <code className="font-black">messages</code>.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-[#E8DED4] bg-[#FCFAF7] px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate text-[11px] font-black text-[#1A1410]">{webhookUrl}</code>
              <button
                type="button"
                onClick={copyWebhookUrl}
                title="Copier l'URL"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#E8DED4] bg-white text-[#6B4F3B] hover:bg-[#F1E8DF]"
              >
                <Clipboard size={14} />
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 text-[11px] font-bold text-[#806A58]">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#166534]" />
              <span>
                Signatures <code>X-Hub-Signature-256</code> vérifiées avant traitement.
                {lastIncoming ? ` Dernier message entrant : ${formatDate(lastIncoming.at)}.` : " Aucun message entrant reçu pour l'instant."}
              </span>
            </div>
          </div>
        </TableCard>

        <TableCard title="Mise en route Meta" meta="Aide">
          <div className="p-4">
            <ol className="grid gap-2">
              {[
                "Créer une application Meta avec le produit WhatsApp.",
                "Associer le compte WhatsApp Business et le numéro professionnel.",
                "Générer un token permanent via un utilisateur système (permissions whatsapp_business_messaging et whatsapp_business_management).",
                "Déclarer l'URL du webhook ci-dessus et s'abonner au champ messages.",
                "Vérifier la connexion puis envoyer un premier template depuis l'onglet Envoyer.",
              ].map((step, index) => (
                <li key={step} className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#101820] text-[10px] font-black text-white">{index + 1}</span>
                  <span className="text-[12px] font-bold text-[#1A1410]">{step}</span>
                </li>
              ))}
            </ol>
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-black text-[#C2410C] hover:underline"
            >
              Documentation Meta <ExternalLink size={12} />
            </a>
          </div>
        </TableCard>
      </div>
    </div>
  );
}

function SendTab({ templates, templatesPending, selectedTemplate, onSelectTemplate, onReloadTemplates, onSent, sentLog }: {
  templates: Template[] | null;
  templatesPending: boolean;
  selectedTemplate: Template | null;
  onSelectTemplate: (template: Template | null) => void;
  onReloadTemplates: () => void;
  onSent: () => void;
  sentLog: any[];
}) {
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"template" | "text">(selectedTemplate ? "template" : "text");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("Bonjour, votre commande ZangoChap est prête.");
  const [params, setParams] = useState<string[]>([]);

  const approvedTemplates = (templates || []).filter((template) => template.status === "APPROVED");
  const activeTemplate = selectedTemplate;

  const pickTemplate = (value: string) => {
    const [name, language] = value.split("::");
    const template = (templates || []).find((item) => item.name === name && item.language === language) || null;
    onSelectTemplate(template);
    setParams(template ? Array.from({ length: template.paramCount }, () => "") : []);
  };

  // Apercu du corps du template avec les variables remplacees en direct.
  const templatePreview = useMemo(() => {
    if (!activeTemplate) return "";
    return activeTemplate.bodyText.replace(/\{\{(\d+)\}\}/g, (raw, index) => params[Number(index) - 1]?.trim() || raw);
  }, [activeTemplate, params]);

  const missingParams = mode === "template" && activeTemplate
    ? Array.from({ length: activeTemplate.paramCount }, (_, i) => params[i]?.trim()).some((value) => !value)
    : false;

  const recentRecipients = useMemo(() => {
    const unique: string[] = [];
    for (const entry of sentLog) {
      if (entry.recipient && !unique.includes(entry.recipient)) unique.push(entry.recipient);
      if (unique.length >= 5) break;
    }
    return unique;
  }, [sentLog]);

  const send = () => {
    if (mode === "template" && !activeTemplate) {
      showToast("Choisissez un template.", "error");
      return;
    }
    startTransition(async () => {
      const result = await sendWhatsAppMessage(
        mode === "template" && activeTemplate
          ? {
            mode: "template",
            recipient,
            templateName: activeTemplate.name,
            language: activeTemplate.language,
            params: activeTemplate.paramCount > 0 ? params.map((value) => value.trim()) : undefined,
          }
          : { mode: "text", recipient, message },
      );
      if (!result.success) {
        showToast(result.error, "error");
        onSent(); // l'echec est journalise : rafraichir l'activite quand meme
        return;
      }
      showToast("Message transmis à WhatsApp Cloud", "success");
      onSent();
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <TableCard title="Composer un message" meta={mode === "template" ? "Via template approuvé" : "Texte libre (fenêtre 24 h)"}>
        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("template")}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${mode === "template"
                ? "border-[#FF6B2C] bg-[#FFF7ED] text-[#C2410C]"
                : "border-[#E8DED4] bg-white text-[#806A58]"}`}
            >
              <FileText size={14} /> Template
            </button>
            <button
              type="button"
              onClick={() => setMode("text")}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-md border text-[12px] font-black ${mode === "text"
                ? "border-[#FF6B2C] bg-[#FFF7ED] text-[#C2410C]"
                : "border-[#E8DED4] bg-white text-[#806A58]"}`}
            >
              <MessageCircle size={14} /> Texte libre
            </button>
          </div>

          <label className="grid gap-1">
            <span className="text-[11px] font-black uppercase text-[#806A58]">Numéro destinataire</span>
            <div className="flex h-10 items-center gap-2 rounded-md border border-[#E8DED4] bg-white px-3">
              <Smartphone size={15} className="text-[#8B735E]" />
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="2250700000000"
                inputMode="tel"
                className="min-w-0 flex-1 bg-transparent text-[13px] font-black text-[#1A1410] outline-none"
              />
            </div>
            <small className="text-[10px] font-bold text-[#806A58]">Format international, sans + ni espaces.</small>
          </label>

          {recentRecipients.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-black uppercase text-[#806A58]">Récents :</span>
              {recentRecipients.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRecipient(value)}
                  className="rounded-md border border-[#E8DED4] bg-[#FCFAF7] px-2 py-1 font-mono text-[10px] font-black text-[#6B4F3B] hover:bg-[#F1E8DF]"
                >
                  {value}
                </button>
              ))}
            </div>
          )}

          {mode === "template" ? (
            <>
              <label className="grid gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase text-[#806A58]">Template</span>
                  <button type="button" onClick={onReloadTemplates} disabled={templatesPending} className="inline-flex items-center gap-1 text-[10px] font-black text-[#C2410C] hover:underline disabled:opacity-60">
                    <RefreshCw size={11} className={templatesPending ? "animate-spin" : ""} /> Recharger
                  </button>
                </div>
                <select
                  className="field-input"
                  value={activeTemplate ? `${activeTemplate.name}::${activeTemplate.language}` : ""}
                  onChange={(event) => pickTemplate(event.target.value)}
                >
                  <option value="">{templatesPending ? "Chargement..." : "Choisir un template approuvé"}</option>
                  {approvedTemplates.map((template) => (
                    <option key={`${template.name}::${template.language}`} value={`${template.name}::${template.language}`}>
                      {template.name} ({template.language}){template.paramCount > 0 ? ` · ${template.paramCount} variable(s)` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {activeTemplate && activeTemplate.paramCount > 0 && (
                <div className="grid gap-2 rounded-md border border-[#E8DED4] bg-[#FCFAF7] p-3">
                  <span className="text-[10px] font-black uppercase text-[#806A58]">Variables du template</span>
                  {Array.from({ length: activeTemplate.paramCount }, (_, index) => (
                    <input
                      key={index}
                      className="field-input"
                      value={params[index] || ""}
                      placeholder={`Variable {{${index + 1}}}`}
                      onChange={(event) => setParams((current) => {
                        const next = [...current];
                        next[index] = event.target.value;
                        return next;
                      })}
                    />
                  ))}
                </div>
              )}

              {activeTemplate && (
                <div className="rounded-md border border-[#BBF7D0] bg-[#F0FDF4] p-3">
                  <div className="mb-1 text-[10px] font-black uppercase text-[#166534]">Aperçu</div>
                  <p className="whitespace-pre-wrap text-[12px] font-bold text-[#1A1410]">{templatePreview || "(corps vide)"}</p>
                </div>
              )}
            </>
          ) : (
            <label className="grid gap-1">
              <span className="text-[11px] font-black uppercase text-[#806A58]">Message</span>
              <textarea
                className="field-input"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={4096}
                rows={4}
              />
              <small className="text-[10px] font-bold text-[#806A58]">
                Le texte libre n&apos;est délivré que dans les 24 h suivant le dernier message du client. Hors fenêtre, utilisez un template.
              </small>
            </label>
          )}

          <button
            type="button"
            onClick={send}
            disabled={isPending || !recipient.trim() || (mode === "template" && (!activeTemplate || missingParams)) || (mode === "text" && !message.trim())}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#FF6B2C] px-4 text-[13px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
          >
            <Send size={15} /> {isPending ? "Envoi..." : "Envoyer le message"}
          </button>
        </div>
      </TableCard>

      <TableCard title="Derniers envois" meta={`${sentLog.length} message(s)`}>
        {sentLog.length === 0 ? (
          <EmptyState icon="W" title="Aucun envoi" description="Les messages envoyés depuis cette console apparaîtront ici." />
        ) : (
          <div className="divide-y divide-[#F1E8DF]">
            {sentLog.slice(0, 8).map((entry, index) => (
              <SentLogRow key={`${entry.at}-${index}`} entry={entry} />
            ))}
          </div>
        )}
      </TableCard>
    </div>
  );
}

function TemplatesTab({ templates, pending, onReload, onUse }: {
  templates: Template[] | null;
  pending: boolean;
  onReload: () => void;
  onUse: (template: Template) => void;
}) {
  return (
    <TableCard
      title="Templates du compte"
      meta={templates ? `${templates.length} template(s)` : "Non chargés"}
      actions={
        <button
          type="button"
          onClick={onReload}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E8DED4] bg-white px-2.5 text-[11px] font-black text-[#6B4F3B] hover:bg-[#FCFAF7] disabled:opacity-60"
        >
          <RefreshCw size={12} className={pending ? "animate-spin" : ""} /> {pending ? "Chargement..." : "Actualiser"}
        </button>
      }
    >
      {!templates && !pending ? (
        <EmptyState icon="T" title="Templates non chargés" description="Cliquez sur Actualiser pour lister les templates du compte WABA." />
      ) : templates && templates.length === 0 ? (
        <EmptyState icon="T" title="Aucun template" description="Créez vos templates dans le WhatsApp Manager de Meta ; ils apparaîtront ici avec leur statut." />
      ) : templates ? (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-[#E8DED4] text-left text-[10px] font-black uppercase text-[#806A58]">
                <th className="min-w-[160px] px-4 py-3">Nom</th>
                <th className="px-3 py-3">Langue</th>
                <th className="px-3 py-3">Catégorie</th>
                <th className="px-3 py-3">Statut</th>
                <th className="min-w-[280px] px-3 py-3">Corps</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={`${template.name}::${template.language}`} className="border-b border-[#F1E8DF] text-[12px] last:border-b-0 hover:bg-[#FCFAF7]">
                  <td className="px-4 py-3 align-top font-mono text-[11px] font-black text-[#1A1410]">{template.name}</td>
                  <td className="px-3 py-3 align-top font-bold text-[#806A58]">{template.language}</td>
                  <td className="px-3 py-3 align-top font-bold text-[#806A58]">{template.category || "—"}</td>
                  <td className="px-3 py-3 align-top">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-black ${templateStatusBadge(template.status)}`}>
                      {template.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <p className="line-clamp-2 max-w-[420px] text-[11px] font-bold text-[#1A1410]">{template.bodyText || "—"}</p>
                    {template.paramCount > 0 && (
                      <span className="mt-1 inline-flex rounded-md bg-[#F1E8DF] px-1.5 py-0.5 text-[9px] font-black text-[#6B4F3B]">
                        {template.paramCount} variable(s)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    {template.status === "APPROVED" && (
                      <button
                        type="button"
                        onClick={() => onUse(template)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#101820] px-2.5 text-[11px] font-black text-white hover:bg-[#1c2a36]"
                      >
                        <Send size={12} /> Utiliser
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 text-center text-[12px] font-bold text-[#806A58]">Chargement des templates...</div>
      )}
    </TableCard>
  );
}

function SentLogRow({ entry }: { entry: any }) {
  const failed = entry.status === "failed";
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <ArrowUpRight size={13} className={failed ? "text-[#991B1B]" : "text-[#166534]"} />
            <span className="font-mono text-[12px] font-black text-[#1A1410]">{entry.recipient}</span>
            <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black ${failed
              ? "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"
              : "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]"}`}>
              {failed ? "Échec" : "Envoyé"}
            </span>
          </div>
          <div className="mt-1 text-[11px] font-bold text-[#806A58]">
            {entry.mode === "template" ? `Template ${entry.templateName}` : entry.preview || "Texte libre"}
          </div>
          {failed && entry.error && <div className="mt-0.5 text-[10px] font-bold text-[#991B1B]">{entry.error}</div>}
        </div>
        <div className="shrink-0 text-right text-[10px] font-bold text-[#806A58]">
          <div>{formatDate(entry.at)}</div>
          <div>{entry.byName || "admin"}</div>
        </div>
      </div>
    </div>
  );
}

function ActivityTab({ sentLog, webhookLog }: { sentLog: any[]; webhookLog: any[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <TableCard title="Messages envoyés" meta={`${sentLog.length} entrée(s)`}>
        {sentLog.length === 0 ? (
          <EmptyState icon="E" title="Aucun envoi" description="Les envois (réussis et échoués) sont journalisés ici." />
        ) : (
          <div className="max-h-[560px] divide-y divide-[#F1E8DF] overflow-y-auto">
            {sentLog.map((entry, index) => <SentLogRow key={`${entry.at}-${index}`} entry={entry} />)}
          </div>
        )}
      </TableCard>

      <TableCard title="Messages entrants & statuts" meta={`${webhookLog.length} événement(s)`}>
        {webhookLog.length === 0 ? (
          <EmptyState icon="R" title="Aucun événement" description="Les messages reçus et accusés (délivré, lu, échec) arrivent via le webhook." />
        ) : (
          <div className="max-h-[560px] divide-y divide-[#F1E8DF] overflow-y-auto">
            {webhookLog.map((event, index) => (
              <div key={`${event.at}-${index}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {event.direction === "incoming" ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ArrowDownLeft size={13} className="text-[#1D4ED8]" />
                          <span className="font-mono text-[12px] font-black text-[#1A1410]">{event.from || "?"}</span>
                          <span className="rounded-md bg-[#EFF6FF] px-1.5 py-0.5 text-[9px] font-black text-[#1D4ED8]">Reçu · {event.type}</span>
                        </div>
                        {event.textPreview && (
                          <p className="mt-1 text-[11px] font-bold text-[#1A1410]">{event.textPreview}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <KeyRound size={13} className="text-[#806A58]" />
                          <span className="font-mono text-[12px] font-black text-[#1A1410]">{event.recipient || "?"}</span>
                          <span className={`text-[10px] font-black uppercase ${deliveryStatusTone(event.status)}`}>{event.status}</span>
                        </div>
                        {event.error && <div className="mt-0.5 text-[10px] font-bold text-[#991B1B]">{event.error}</div>}
                      </>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] font-bold text-[#806A58]">{formatDate(event.at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </TableCard>
    </div>
  );
}
