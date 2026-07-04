"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useMemo, useRef, useState, useTransition } from "react";
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
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { EmptyState, TableCard } from "@/components/UI";
import { formatPrice } from "@/lib/constants";
import {
  checkWhatsAppHealth,
  getWhatsAppTemplates,
  sendWhatsAppMessage,
  updateWhatsAppSettings,
  uploadWhatsAppMedia,
} from "@/modules/whatsapp/actions";
import {
  deleteContactGroup,
  deleteMarketingModel,
  getContactGroupMembers,
  getMarketingWorkspace,
  previewSmartGroup,
  saveContactGroup,
  saveMarketingModel,
  sendMarketingBroadcast,
} from "@/modules/whatsapp/marketing-actions";
import {
  CUSTOMER_TEMPLATE_VARIABLES,
  DEFAULT_ORDER_TEMPLATE,
  ORDER_TEMPLATE_VARIABLES,
  SAMPLE_ORDER,
  buildOrderWhatsAppMessage,
} from "@/modules/whatsapp/message-builder";

type TabId = "overview" | "send" | "templates" | "marketing" | "activity";

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
  { id: "marketing", label: "Marketing", icon: <Megaphone size={14} /> },
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
  const [marketing, setMarketing] = useState<{ models: any[]; customers: any[]; groups: any[]; communes: string[] } | null>(null);
  const [marketingPending, setMarketingPending] = useState(false);

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

  const loadMarketing = async () => {
    setMarketingPending(true);
    try {
      const result = await getMarketingWorkspace();
      setMarketing(result);
    } catch {
      showToast("Impossible de charger l'espace marketing.", "error");
    } finally {
      setMarketingPending(false);
    }
  };

  const openTab = (next: TabId) => {
    setTab(next);
    if ((next === "templates" || next === "send") && templates === null && !templatesPending) {
      loadTemplates(true);
    }
    if (next === "marketing" && marketing === null && !marketingPending) {
      loadMarketing();
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
          settings={initialData.settings || {}}
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
      {tab === "marketing" && (
        <MarketingTab
          settings={initialData.settings || {}}
          marketing={marketing}
          pending={marketingPending}
          onReload={loadMarketing}
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

function OverviewTab({ configuration, webhookUrl, lastIncoming, settings, showToast }: {
  configuration: any;
  webhookUrl: string;
  lastIncoming: any;
  settings: any;
  showToast: (message: string, tone: "success" | "error") => void;
}) {
  const [autoSend, setAutoSend] = useState(Boolean(settings?.autoSendOnOrder));
  const [savingSettings, startSettingsTransition] = useTransition();

  const toggleAutoSend = () => {
    const next = !autoSend;
    setAutoSend(next);
    startSettingsTransition(async () => {
      try {
        await updateWhatsAppSettings({ autoSendOnOrder: next });
        showToast(next
          ? "Confirmation automatique activée : chaque commande confirmée notifie le client."
          : "Confirmation automatique désactivée.", "success");
      } catch {
        setAutoSend(!next);
        showToast("Impossible d'enregistrer le réglage.", "error");
      }
    });
  };

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
        <TableCard title="Automatisations" meta={autoSend ? "Active" : "Inactive"}>
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-[13px] font-black text-[#1A1410]">Confirmation après prise de commande</div>
              <p className="mt-1 text-[11px] font-bold text-[#806A58]">
                Envoie automatiquement le récapitulatif WhatsApp au client dès qu&apos;une commande est créée avec le statut confirmé. Les échecs restent visibles dans l&apos;onglet Activité et l&apos;historique de la commande.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoSend}
              onClick={toggleAutoSend}
              disabled={savingSettings}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${autoSend ? "bg-[#16a34a]" : "bg-[#D8CBBB]"}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${autoSend ? "left-6" : "left-1"}`} />
            </button>
          </div>
        </TableCard>

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
          : { mode: "text", recipient, message, imageUrl: imageUrl || undefined },
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
            <>
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
              <ImagePicker value={imageUrl} onChange={setImageUrl} />
            </>
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
            {(entry.mode === "image" || entry.imageUrl) && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-[#EFF6FF] px-1.5 py-0.5 text-[9px] font-black text-[#1D4ED8]">
                <ImageIcon size={9} /> Image
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] font-bold text-[#806A58]">
            {entry.mode === "template" ? `Template ${entry.templateName}` : entry.preview || (entry.mode === "image" ? "Image sans légende" : "Texte libre")}
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

// Selecteur d'image : upload vers R2 en JPEG (format accepte par WhatsApp),
// apercu miniature et retrait. Retourne l'URL publique via onChange.
function ImagePicker({ value, onChange, label }: {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
}) {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Choisissez un fichier image.", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("Image trop lourde (5 Mo maximum).", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setUploading(true);
      try {
        const result = await uploadWhatsAppMedia(String(reader.result), file.name);
        if (!result.success) {
          showToast(result.error, "error");
          return;
        }
        onChange(result.url);
        showToast("Image prête à être jointe", "success");
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      {value ? (
        <>
          {/* Domaine R2 dynamique : next/image exigerait une config remotePatterns. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Image jointe" className="h-12 w-12 rounded-md border border-[#E8DED4] object-cover" />
          <div className="min-w-0">
            <div className="text-[11px] font-black text-[#166534]">Image jointe</div>
            <button type="button" onClick={() => onChange(null)} className="text-[10px] font-black text-[#991B1B] hover:underline">
              Retirer
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dashed border-[#D8CBBB] bg-[#FCFAF7] px-3 text-[11px] font-black text-[#6B4F3B] hover:bg-[#F1E8DF] disabled:opacity-60"
        >
          <ImageIcon size={14} /> {uploading ? "Upload..." : label || "Joindre une image"}
        </button>
      )}
    </div>
  );
}

function VariableChips({ variables, onInsert }: {
  variables: Array<{ key: string; label: string }>;
  onInsert: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {variables.map((variable) => (
        <button
          key={variable.key}
          type="button"
          title={variable.label}
          onClick={() => onInsert(variable.key)}
          className="rounded-md border border-[#E8DED4] bg-[#FCFAF7] px-1.5 py-0.5 font-mono text-[10px] font-black text-[#6B4F3B] hover:bg-[#F1E8DF]"
        >
          {variable.key}
        </button>
      ))}
    </div>
  );
}

function MarketingTab({ settings, marketing, pending, onReload }: {
  settings: any;
  marketing: { models: any[]; customers: any[]; groups: any[]; communes: string[] } | null;
  pending: boolean;
  onReload: () => void;
}) {
  const { showToast } = useToast();
  const [savingTemplate, startTemplateTransition] = useTransition();
  const [savingModel, startModelTransition] = useTransition();
  const [broadcasting, startBroadcastTransition] = useTransition();

  // --- Message de confirmation de commande ---
  const [orderTemplate, setOrderTemplate] = useState<string>(settings?.orderTemplate || DEFAULT_ORDER_TEMPLATE);
  const [orderImage, setOrderImage] = useState<string | null>(settings?.orderImageUrl || null);
  const [showOrderPreview, setShowOrderPreview] = useState(false);
  const orderPreview = useMemo(() => buildOrderWhatsAppMessage(SAMPLE_ORDER, orderTemplate), [orderTemplate]);
  const isDefaultTemplate = orderTemplate.trim() === DEFAULT_ORDER_TEMPLATE.trim();

  const saveOrderTemplate = () => {
    startTemplateTransition(async () => {
      try {
        // Identique au modele par defaut => on stocke null (suit les futures evolutions).
        await updateWhatsAppSettings({
          orderTemplate: isDefaultTemplate ? "" : orderTemplate,
          orderImageUrl: orderImage || "",
        });
        showToast("Message de confirmation enregistré", "success");
      } catch {
        showToast("Enregistrement impossible.", "error");
      }
    });
  };

  // --- Modeles marketing ---
  const [editingModel, setEditingModel] = useState<any>(null); // null = ferme, {} = nouveau
  const [modelName, setModelName] = useState("");
  const [modelBody, setModelBody] = useState("");

  const openModelForm = (model?: any) => {
    setEditingModel(model || {});
    setModelName(model?.name || "");
    setModelBody(model?.body || "");
  };

  const saveModel = () => {
    startModelTransition(async () => {
      const result = await saveMarketingModel({ id: editingModel?.id, name: modelName, body: modelBody });
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      showToast("Modèle enregistré", "success");
      setEditingModel(null);
      onReload();
    });
  };

  const removeModel = async (model: any) => {
    if (!confirm(`Supprimer le modèle « ${model.name} » ?`)) return;
    const result = await deleteMarketingModel(model.id);
    if (!result.success) {
      showToast(result.error, "error");
      return;
    }
    showToast("Modèle supprimé", "success");
    onReload();
  };

  // --- Diffusion groupee ---
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastImage, setBroadcastImage] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSort, setCustomerSort] = useState<"recent" | "name" | "spent" | "orders">("recent");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [broadcastResult, setBroadcastResult] = useState<any>(null);
  // Membres charges depuis un groupe et absents de la liste des clients recents.
  const [extraMembers, setExtraMembers] = useState<any[]>([]);

  const customers = useMemo(() => {
    const base = marketing?.customers || [];
    const known = new Set(base.map((customer: any) => customer.id));
    return [...extraMembers.filter((member) => !known.has(member.id)), ...base];
  }, [marketing, extraMembers]);

  const filteredCustomers = useMemo(() => {
    const search = customerSearch.trim().toLowerCase();
    const matched = !search ? customers : customers.filter((customer: any) => [customer.name, customer.phone, customer.commune]
      .filter(Boolean)
      .some((value: string) => String(value).toLowerCase().includes(search)));
    const sorted = [...matched];
    if (customerSort === "name") sorted.sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));
    else if (customerSort === "spent") sorted.sort((a: any, b: any) => Number(b.totalSpent || 0) - Number(a.totalSpent || 0));
    else if (customerSort === "orders") sorted.sort((a: any, b: any) => Number(b.totalOrders || 0) - Number(a.totalOrders || 0));
    else sorted.sort((a: any, b: any) => new Date(b.lastOrderAt || 0).getTime() - new Date(a.lastOrderAt || 0).getTime());
    return sorted;
  }, [customers, customerSearch, customerSort]);

  // Charge les membres d'un groupe dans la selection (50 max par diffusion).
  const useGroupMembers = (members: any[], groupName: string) => {
    setExtraMembers((current) => {
      const known = new Set(current.map((member) => member.id));
      return [...current, ...members.filter((member) => !known.has(member.id))];
    });
    setSelectedIds(new Set(members.slice(0, 50).map((member) => member.id)));
    showToast(members.length > 50
      ? `Groupe « ${groupName} » (${members.length}) : les 50 premiers sont sélectionnés — diffusez en plusieurs vagues.`
      : `Groupe « ${groupName} » : ${members.length} client(s) sélectionné(s)`, "success");
  };

  const saveSelectionAsGroup = async () => {
    const name = window.prompt(`Enregistrer ces ${selectedIds.size} client(s) comme groupe.\nNom du groupe :`);
    if (!name?.trim()) return;
    const result = await saveContactGroup({ name: name.trim(), type: "STATIC", customerIds: Array.from(selectedIds) });
    if (!result.success) {
      showToast(result.error, "error");
      return;
    }
    showToast("Groupe enregistré", "success");
    onReload();
  };

  const toggleCustomer = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  };

  const selectFiltered = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const customer of filteredCustomers) {
        if (next.size >= 50) break;
        next.add(customer.id);
      }
      return next;
    });
  };

  const runBroadcast = () => {
    if (!confirm(`Envoyer ce message à ${selectedIds.size} client(s) ?\n\nRappel : hors fenêtre de 24 h, Meta ne délivre pas les textes libres — les échecs seront listés.`)) return;
    startBroadcastTransition(async () => {
      const result = await sendMarketingBroadcast({
        body: broadcastBody,
        imageUrl: broadcastImage || undefined,
        customerIds: Array.from(selectedIds),
      });
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      setBroadcastResult(result);
      showToast(`Diffusion terminée : ${result.sent} envoyé(s), ${result.failed} échec(s)`, result.failed > 0 ? "error" : "success");
      if (result.failed === 0) setSelectedIds(new Set());
    });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <TableCard title="Message de confirmation de commande" meta={isDefaultTemplate ? "Modèle par défaut" : "Personnalisé"}>
          <div className="grid gap-3 p-4">
            <p className="text-[11px] font-bold text-[#806A58]">
              Envoyé au client à la prise de commande (automatique si activé dans l&apos;Aperçu) et proposé dans la liste des commandes. Cliquez une variable pour l&apos;insérer.
            </p>
            <VariableChips variables={ORDER_TEMPLATE_VARIABLES} onInsert={(key) => setOrderTemplate((current) => `${current}${key}`)} />
            <textarea
              className="field-input whitespace-pre-wrap font-mono text-[12px]"
              value={orderTemplate}
              onChange={(event) => setOrderTemplate(event.target.value)}
              rows={14}
              maxLength={4096}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ImagePicker value={orderImage} onChange={setOrderImage} label="Joindre une image (bannière)" />
              <span className="text-[10px] font-bold text-[#806A58]">
                L&apos;image est envoyée avec le message (en légende si court, sinon avant le texte).
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowOrderPreview((value) => !value)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E8DED4] bg-white px-3 text-[11px] font-black text-[#6B4F3B] hover:bg-[#FCFAF7]"
                >
                  {showOrderPreview ? "Masquer l'aperçu" : "Aperçu (commande exemple)"}
                </button>
                {!isDefaultTemplate && (
                  <button
                    type="button"
                    onClick={() => setOrderTemplate(DEFAULT_ORDER_TEMPLATE)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#F4C7B8] bg-[#FFF7ED] px-3 text-[11px] font-black text-[#C2410C] hover:bg-[#FFF1E6]"
                  >
                    Modèle par défaut
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={saveOrderTemplate}
                disabled={savingTemplate || !orderTemplate.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#FF6B2C] px-3 text-[11px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
              >
                <Save size={13} /> {savingTemplate ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
            {showOrderPreview && (
              <div className="rounded-md border border-[#BBF7D0] bg-[#F0FDF4] p-3">
                <div className="mb-1 text-[10px] font-black uppercase text-[#166534]">Aperçu avec une commande exemple</div>
                <p className="whitespace-pre-wrap text-[12px] font-bold text-[#1A1410]">{orderPreview}</p>
              </div>
            )}
          </div>
        </TableCard>

        <TableCard
          title="Modèles marketing"
          meta={marketing ? `${marketing.models.length} modèle(s)` : "—"}
          actions={
            <button
              type="button"
              onClick={() => openModelForm()}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-[#101820] px-2.5 text-[11px] font-black text-white hover:bg-[#1c2a36]"
            >
              <Plus size={12} /> Nouveau
            </button>
          }
        >
          {pending && !marketing ? (
            <div className="p-6 text-center text-[12px] font-bold text-[#806A58]">Chargement...</div>
          ) : !marketing || marketing.models.length === 0 ? (
            <EmptyState icon="M" title="Aucun modèle" description="Créez des messages réutilisables (relance, promo, avis client...) avec les variables {client}, {nom}, {telephone}." />
          ) : (
            <div className="max-h-[420px] divide-y divide-[#F1E8DF] overflow-y-auto">
              {marketing.models.map((model: any) => (
                <div key={model.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-black text-[#1A1410]">{model.name}</div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] font-bold text-[#806A58]">{model.body}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        title="Utiliser pour une diffusion"
                        onClick={() => setBroadcastBody(model.body)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#BBF7D0] bg-[#F0FDF4] text-[#166534] hover:bg-[#ECFDF5]"
                      >
                        <Megaphone size={13} />
                      </button>
                      <button
                        type="button"
                        title="Modifier"
                        onClick={() => openModelForm(model)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E8DED4] bg-white text-[#6B4F3B] hover:bg-[#F1E8DF]"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        title="Supprimer"
                        onClick={() => removeModel(model)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#F4C7B8] bg-[#FFF7ED] text-[#C2410C] hover:bg-[#FEE2E2]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {editingModel !== null && (
            <div className="grid gap-2 border-t-2 border-[#E8DED4] bg-[#FCFAF7] p-4">
              <span className="text-[10px] font-black uppercase text-[#806A58]">{editingModel?.id ? "Modifier le modèle" : "Nouveau modèle"}</span>
              <input
                className="field-input"
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                placeholder="Nom du modèle (ex. Relance avis client)"
              />
              <VariableChips variables={CUSTOMER_TEMPLATE_VARIABLES} onInsert={(key) => setModelBody((current) => `${current}${key}`)} />
              <textarea
                className="field-input whitespace-pre-wrap"
                value={modelBody}
                onChange={(event) => setModelBody(event.target.value)}
                rows={6}
                maxLength={4096}
                placeholder="Bonjour {client}, ..."
              />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setEditingModel(null)}>Annuler</button>
                <button
                  type="button"
                  onClick={saveModel}
                  disabled={savingModel || modelName.trim().length < 2 || modelBody.trim().length < 5}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#FF6B2C] px-3 text-[11px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
                >
                  <Save size={13} /> {savingModel ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </div>
          )}
        </TableCard>
      </div>

      <ContactGroupsCard
        groups={marketing?.groups || []}
        communes={marketing?.communes || []}
        onReload={onReload}
        onUseGroup={useGroupMembers}
      />

      <TableCard
        title="Diffusion groupée"
        meta={`${selectedIds.size}/50 client(s) sélectionné(s)`}
        actions={
          <button
            type="button"
            onClick={onReload}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#E8DED4] bg-white px-2.5 text-[11px] font-black text-[#6B4F3B] hover:bg-[#FCFAF7] disabled:opacity-60"
          >
            <RefreshCw size={12} className={pending ? "animate-spin" : ""} /> Actualiser
          </button>
        }
      >
        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="grid gap-2 content-start">
            <span className="text-[11px] font-black uppercase text-[#806A58]">Message (variables par client)</span>
            <VariableChips variables={CUSTOMER_TEMPLATE_VARIABLES} onInsert={(key) => setBroadcastBody((current) => `${current}${key}`)} />
            <textarea
              className="field-input whitespace-pre-wrap"
              value={broadcastBody}
              onChange={(event) => setBroadcastBody(event.target.value)}
              rows={10}
              maxLength={4096}
              placeholder={"Bonjour {client} 👋\nDécouvrez nos nouveautés..."}
            />
            <ImagePicker value={broadcastImage} onChange={setBroadcastImage} label="Joindre une image (visuel promo)" />
            <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[11px] font-bold text-[#92400E]">
              Meta ne délivre les textes libres qu&apos;aux clients ayant écrit dans les dernières 24 h. Pour une vraie campagne, créez un template <strong>MARKETING</strong> approuvé (onglet Templates).
            </div>
            <button
              type="button"
              onClick={runBroadcast}
              disabled={broadcasting || selectedIds.size === 0 || broadcastBody.trim().length < 5}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#FF6B2C] px-4 text-[13px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
            >
              <Megaphone size={15} /> {broadcasting ? "Diffusion en cours..." : `Diffuser à ${selectedIds.size} client(s)`}
            </button>
            {broadcastResult && (
              <div className="rounded-md border border-[#E8DED4] bg-[#FCFAF7] p-3">
                <div className="text-[11px] font-black text-[#1A1410]">
                  Résultat : <span className="text-[#166534]">{broadcastResult.sent} envoyé(s)</span> · <span className="text-[#991B1B]">{broadcastResult.failed} échec(s)</span>
                </div>
                {broadcastResult.failures?.length > 0 && (
                  <ul className="mt-1 grid gap-0.5">
                    {broadcastResult.failures.map((failure: any, index: number) => (
                      <li key={index} className="text-[10px] font-bold text-[#991B1B]">
                        {failure.name} ({failure.phone}) : {failure.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-2 content-start">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase text-[#806A58]">
                <Users size={13} /> Destinataires ({customers.length} clients récents)
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={selectFiltered} className="text-[10px] font-black text-[#C2410C] hover:underline">Tout cocher (max 50)</button>
                {selectedIds.size > 0 && (
                  <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[10px] font-black text-[#806A58] hover:underline">Vider</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2">
              <label className="flex h-9 items-center gap-2 rounded-md border border-[#E8DED4] bg-white px-3">
                <Search size={14} className="text-[#8B735E]" />
                <input
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Rechercher nom, numéro, commune..."
                  className="min-w-0 flex-1 bg-transparent text-[12px] font-bold text-[#1A1410] outline-none"
                />
              </label>
              <select
                aria-label="Trier les clients"
                className="h-9 rounded-md border border-[#E8DED4] bg-white px-2 text-[11px] font-black text-[#1A1410] outline-none"
                value={customerSort}
                onChange={(event) => setCustomerSort(event.target.value as any)}
              >
                <option value="recent">Plus récents</option>
                <option value="spent">Plus dépensé</option>
                <option value="orders">Plus de commandes</option>
                <option value="name">Nom A→Z</option>
              </select>
            </div>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={saveSelectionAsGroup}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#E8DED4] bg-white px-2.5 text-[11px] font-black text-[#6B4F3B] hover:bg-[#FCFAF7]"
              >
                <Save size={12} /> Enregistrer la sélection comme groupe ({selectedIds.size})
              </button>
            )}
            <div className="max-h-[360px] overflow-y-auto rounded-md border border-[#E8DED4]">
              {filteredCustomers.length === 0 ? (
                <div className="p-4 text-center text-[11px] font-bold text-[#806A58]">
                  {pending ? "Chargement des clients..." : "Aucun client trouvé."}
                </div>
              ) : (
                <div className="divide-y divide-[#F1E8DF]">
                  {filteredCustomers.map((customer: any) => (
                    <label key={customer.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-[#FCFAF7]">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(customer.id)}
                        onChange={() => toggleCustomer(customer.id)}
                        className="h-4 w-4 accent-[#FF6B2C]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-black text-[#1A1410]">{customer.name || "Sans nom"}</div>
                        <div className="font-mono text-[10px] font-bold text-[#806A58]">
                          {customer.phone || "—"}{customer.commune ? ` · ${customer.commune}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[9px] font-bold text-[#806A58]">
                        <div>{Number(customer.totalOrders || 0)} cmd</div>
                        <div>{formatPrice(customer.totalSpent || 0)}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </TableCard>
    </div>
  );
}

// Resume lisible des regles d'un groupe intelligent.
function groupRuleSummary(group: any) {
  if (group.type === "STATIC") return "Sélection manuelle";
  const rules = group.rules || {};
  const parts: string[] = [];
  if (rules.communes?.length) parts.push(`Communes : ${rules.communes.join(", ")}`);
  if (rules.minOrders) parts.push(`≥ ${rules.minOrders} commande(s)`);
  if (rules.minSpent) parts.push(`dépensé ≥ ${formatPrice(rules.minSpent)}`);
  if (rules.maxSpent) parts.push(`dépensé ≤ ${formatPrice(rules.maxSpent)}`);
  if (rules.activeWithinDays) parts.push(`actif < ${rules.activeWithinDays} j`);
  if (rules.inactiveForDays) parts.push(`inactif > ${rules.inactiveForDays} j`);
  return parts.join(" · ") || "Tous les clients";
}

const SMART_PRESETS: Array<{ label: string; name: string; rules: any }> = [
  { label: "⭐ VIP (≥ 3 commandes)", name: "Clients VIP", rules: { minOrders: 3, sortBy: "orders" } },
  { label: "💰 Gros paniers (≥ 50 000 F)", name: "Gros paniers", rules: { minSpent: 50000, sortBy: "spent" } },
  { label: "🔥 Actifs 30 jours", name: "Clients actifs 30 j", rules: { activeWithinDays: 30, sortBy: "recent" } },
  { label: "😴 Inactifs 60 jours", name: "Relance inactifs 60 j", rules: { inactiveForDays: 60, sortBy: "recent" } },
];

function ContactGroupsCard({ groups, communes, onReload, onUseGroup }: {
  groups: any[];
  communes: string[];
  onReload: () => void;
  onUseGroup: (members: any[], groupName: string) => void;
}) {
  const { showToast } = useToast();
  const [saving, startSaveTransition] = useTransition();
  const [loadingGroupId, setLoadingGroupId] = useState<string | null>(null);
  // null = constructeur ferme ; {} = nouveau segment ; objet = edition.
  const [editing, setEditing] = useState<any>(null);
  const [name, setName] = useState("");
  const [ruleCommunes, setRuleCommunes] = useState<Set<string>>(new Set());
  const [minOrders, setMinOrders] = useState("");
  const [minSpent, setMinSpent] = useState("");
  const [maxSpent, setMaxSpent] = useState("");
  const [activeDays, setActiveDays] = useState("");
  const [inactiveDays, setInactiveDays] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "spent" | "orders" | "name">("recent");
  const [preview, setPreview] = useState<{ count: number; members: any[] } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);

  const buildRules = () => ({
    communes: ruleCommunes.size ? Array.from(ruleCommunes) : undefined,
    minOrders: Number(minOrders) > 0 ? Math.round(Number(minOrders)) : undefined,
    minSpent: Number(minSpent) > 0 ? Math.round(Number(minSpent)) : undefined,
    maxSpent: Number(maxSpent) > 0 ? Math.round(Number(maxSpent)) : undefined,
    activeWithinDays: Number(activeDays) > 0 ? Math.round(Number(activeDays)) : undefined,
    inactiveForDays: Number(inactiveDays) > 0 ? Math.round(Number(inactiveDays)) : undefined,
    sortBy,
  });

  const openBuilder = (group?: any) => {
    const rules = group?.rules || {};
    setEditing(group || {});
    setName(group?.name || "");
    setRuleCommunes(new Set<string>(rules.communes || []));
    setMinOrders(rules.minOrders ? String(rules.minOrders) : "");
    setMinSpent(rules.minSpent ? String(rules.minSpent) : "");
    setMaxSpent(rules.maxSpent ? String(rules.maxSpent) : "");
    setActiveDays(rules.activeWithinDays ? String(rules.activeWithinDays) : "");
    setInactiveDays(rules.inactiveForDays ? String(rules.inactiveForDays) : "");
    setSortBy(rules.sortBy || "recent");
    setPreview(null);
  };

  const applyPreset = (preset: typeof SMART_PRESETS[number]) => {
    openBuilder({ name: preset.name, rules: preset.rules });
  };

  const runPreview = async () => {
    setPreviewPending(true);
    try {
      const result = await previewSmartGroup(buildRules());
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      setPreview({ count: result.count, members: result.members });
    } finally {
      setPreviewPending(false);
    }
  };

  const save = () => {
    startSaveTransition(async () => {
      const result = await saveContactGroup({
        id: editing?.id,
        name,
        type: "SMART",
        rules: buildRules(),
      });
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      showToast("Groupe intelligent enregistré", "success");
      setEditing(null);
      onReload();
    });
  };

  const load = async (group: any) => {
    setLoadingGroupId(group.id);
    try {
      const result = await getContactGroupMembers(group.id);
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      onUseGroup(result.members, group.name);
    } finally {
      setLoadingGroupId(null);
    }
  };

  const rename = async (group: any) => {
    const next = window.prompt("Nouveau nom du groupe :", group.name);
    if (!next?.trim()) return;
    const result = await saveContactGroup({ id: group.id, name: next.trim(), type: "STATIC", customerIds: group.customerIds || [] });
    if (!result.success) {
      showToast(result.error, "error");
      return;
    }
    showToast("Groupe renommé", "success");
    onReload();
  };

  const remove = async (group: any) => {
    if (!confirm(`Supprimer le groupe « ${group.name} » ?`)) return;
    const result = await deleteContactGroup(group.id);
    if (!result.success) {
      showToast(result.error, "error");
      return;
    }
    showToast("Groupe supprimé", "success");
    onReload();
  };

  const toggleCommune = (commune: string) => {
    setRuleCommunes((current) => {
      const next = new Set(current);
      if (next.has(commune)) next.delete(commune);
      else next.add(commune);
      return next;
    });
  };

  return (
    <TableCard
      title="Groupes de contacts"
      meta={`${groups.length} groupe(s)`}
      actions={
        <button
          type="button"
          onClick={() => openBuilder()}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-[#101820] px-2.5 text-[11px] font-black text-white hover:bg-[#1c2a36]"
        >
          <Sparkles size={12} /> Nouveau segment
        </button>
      }
    >
      <div className="flex flex-wrap gap-1.5 border-b border-[#F1E8DF] bg-[#FCFAF7] px-4 py-2.5">
        <span className="text-[10px] font-black uppercase text-[#806A58]">Groupements intelligents :</span>
        {SMART_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-md border border-[#E8DED4] bg-white px-2 py-0.5 text-[10px] font-black text-[#6B4F3B] hover:bg-[#F1E8DF]"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {groups.length === 0 && editing === null ? (
        <EmptyState icon="G" title="Aucun groupe" description="Créez un segment intelligent (règles) ou cochez des clients dans la diffusion puis « Enregistrer la sélection comme groupe »." />
      ) : (
        <div className="divide-y divide-[#F1E8DF]">
          {groups.map((group: any) => (
            <div key={group.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-black text-[#1A1410]">{group.name}</span>
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black ${group.type === "SMART"
                    ? "border-[#C7D2FE] bg-[#EEF2FF] text-[#3730A3]"
                    : "border-[#E8DED4] bg-[#FCFAF7] text-[#6B4F3B]"}`}>
                    {group.type === "SMART" ? <><Sparkles size={9} /> Intelligent</> : "Statique"}
                  </span>
                  <span className="rounded-full bg-[#F1E8DF] px-2 py-0.5 text-[9px] font-black text-[#6B4F3B]">
                    {group.memberCount ?? 0} client(s)
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] font-bold text-[#806A58]">{groupRuleSummary(group)}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => load(group)}
                  disabled={loadingGroupId === group.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF6B2C] px-2.5 text-[11px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
                >
                  <Megaphone size={12} /> {loadingGroupId === group.id ? "Chargement..." : "Diffuser"}
                </button>
                <button
                  type="button"
                  title="Modifier"
                  onClick={() => group.type === "SMART" ? openBuilder(group) : rename(group)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E8DED4] bg-white text-[#6B4F3B] hover:bg-[#F1E8DF]"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  title="Supprimer"
                  onClick={() => remove(group)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#F4C7B8] bg-[#FFF7ED] text-[#C2410C] hover:bg-[#FEE2E2]"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <div className="grid gap-3 border-t-2 border-[#E8DED4] bg-[#FCFAF7] p-4">
          <span className="text-[10px] font-black uppercase text-[#806A58]">
            {editing?.id ? "Modifier le segment" : "Nouveau segment intelligent"} — les règles se cumulent (ET)
          </span>
          <input
            className="field-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nom du groupe (ex. VIP Marcory)"
          />
          {communes.length > 0 && (
            <div className="grid gap-1">
              <span className="text-[10px] font-black uppercase text-[#806A58]">Communes (aucune = toutes)</span>
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                {communes.map((commune) => (
                  <button
                    key={commune}
                    type="button"
                    onClick={() => toggleCommune(commune)}
                    className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${ruleCommunes.has(commune)
                      ? "border-[#FF6B2C] bg-[#FFF7ED] text-[#C2410C]"
                      : "border-[#E8DED4] bg-white text-[#806A58] hover:bg-[#F1E8DF]"}`}
                  >
                    {commune}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <label className="grid gap-1">
              <span className="text-[9px] font-black uppercase text-[#806A58]">Commandes ≥</span>
              <input type="number" min={0} className="field-input" value={minOrders} onChange={(event) => setMinOrders(event.target.value)} placeholder="ex. 3" />
            </label>
            <label className="grid gap-1">
              <span className="text-[9px] font-black uppercase text-[#806A58]">Dépensé ≥ (F)</span>
              <input type="number" min={0} className="field-input" value={minSpent} onChange={(event) => setMinSpent(event.target.value)} placeholder="ex. 50000" />
            </label>
            <label className="grid gap-1">
              <span className="text-[9px] font-black uppercase text-[#806A58]">Dépensé ≤ (F)</span>
              <input type="number" min={0} className="field-input" value={maxSpent} onChange={(event) => setMaxSpent(event.target.value)} placeholder="optionnel" />
            </label>
            <label className="grid gap-1">
              <span className="text-[9px] font-black uppercase text-[#806A58]">Actif &lt; N jours</span>
              <input type="number" min={0} className="field-input" value={activeDays} onChange={(event) => setActiveDays(event.target.value)} placeholder="ex. 30" />
            </label>
            <label className="grid gap-1">
              <span className="text-[9px] font-black uppercase text-[#806A58]">Inactif &gt; N jours</span>
              <input type="number" min={0} className="field-input" value={inactiveDays} onChange={(event) => setInactiveDays(event.target.value)} placeholder="ex. 60" />
            </label>
            <label className="grid gap-1">
              <span className="text-[9px] font-black uppercase text-[#806A58]">Tri</span>
              <select className="field-input" value={sortBy} onChange={(event) => setSortBy(event.target.value as any)}>
                <option value="recent">Plus récents</option>
                <option value="spent">Plus dépensé</option>
                <option value="orders">Plus de commandes</option>
                <option value="name">Nom A→Z</option>
              </select>
            </label>
          </div>

          {preview && (
            <div className="rounded-md border border-[#C7D2FE] bg-[#EEF2FF] p-3">
              <div className="text-[11px] font-black text-[#3730A3]">{preview.count} client(s) correspondent à ces règles</div>
              {preview.members.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {preview.members.slice(0, 8).map((member: any) => (
                    <span key={member.id} className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#3730A3]">
                      {member.name} · {Number(member.totalOrders || 0)} cmd · {formatPrice(member.totalSpent || 0)}
                    </span>
                  ))}
                  {preview.count > 8 && <span className="text-[10px] font-bold text-[#3730A3]">+{preview.count - 8} autres...</span>}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Annuler</button>
            <button
              type="button"
              onClick={runPreview}
              disabled={previewPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#C7D2FE] bg-[#EEF2FF] px-3 text-[11px] font-black text-[#3730A3] hover:bg-[#E0E7FF] disabled:opacity-60"
            >
              <Users size={13} /> {previewPending ? "Calcul..." : "Prévisualiser"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || name.trim().length < 2}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#FF6B2C] px-3 text-[11px] font-black text-white hover:bg-[#D4541C] disabled:opacity-60"
            >
              <Save size={13} /> {saving ? "Enregistrement..." : "Enregistrer le segment"}
            </button>
          </div>
        </div>
      )}
    </TableCard>
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
