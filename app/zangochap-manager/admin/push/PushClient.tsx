"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import {
  Activity,
  Apple,
  BellRing,
  CalendarClock,
  Copy,
  Eye,
  Link2,
  Megaphone,
  PackageCheck,
  Search,
  Send,
  Settings2,
  Smartphone,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  cancelPushCampaign,
  deletePushCampaign,
  previewPushAudience,
  resolvePushLink,
  savePushCampaign,
  searchPushProducts,
  sendPushTest,
  updatePushSettings,
} from "@/modules/push/actions";
import {
  BODY_MAX,
  ORDER_PUSH_STATUSES,
  ORDER_PUSH_VARIABLES,
  PUSH_COLLECTIONS,
  TITLE_MAX,
  TOPIC_LABELS,
  describeAudience,
  describeTarget,
  type PushAudience,
  type PushCampaign,
  type PushLogEntry,
  type PushSettings,
  type PushTarget,
  type PushTopic,
} from "@/modules/push/types";

type Overview = {
  total: number;
  active: number;
  ios: number;
  android: number;
  promotions: number;
  orders: number;
  linked: number;
  activeThisWeek: number;
  recent: Array<{
    id: string;
    platform: string;
    appVersion: string | null;
    active: boolean;
    topics: Record<PushTopic, boolean>;
    phones: string[];
    lastSeenAt: string;
    disabledReason: string | null;
  }>;
};

type ConsoleData = {
  settings: PushSettings;
  campaigns: PushCampaign[];
  log: PushLogEntry[];
  overview: Overview;
  categories: Array<{ id: string; name: string }>;
  expoTokenConfigured: boolean;
};

type Tab = "campaigns" | "orders" | "devices" | "settings";

type Draft = {
  id?: string;
  title: string;
  body: string;
  image: string;
  target: PushTarget;
  audience: PushAudience;
  scheduledAt: string; // datetime-local
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Confirmée",
  PREPARING: "En préparation",
  PACKED: "Emballée",
  ON_DELIVERY: "En livraison",
  DELIVERED: "Livrée",
  PARTIALLY_DELIVERED: "Livrée partiellement",
  REPROGRAMMED: "Reprogrammée",
  CANCELLED: "Annulée",
};

const STATUS_BADGE: Record<PushCampaign["status"], { label: string; className: string }> = {
  draft: { label: "Brouillon", className: "bg-[#F1E8DF] text-[#6B4F3B]" },
  scheduled: { label: "Programmée", className: "bg-[#EFF6FF] text-[#1D4ED8]" },
  sending: { label: "En cours", className: "bg-[#FFF7ED] text-[#C2410C]" },
  sent: { label: "Envoyée", className: "bg-[#F0FDF4] text-[#166534]" },
  cancelled: { label: "Annulée", className: "bg-[#F4F4F5] text-[#52525B]" },
  failed: { label: "Échec", className: "bg-[#FEF2F2] text-[#991B1B]" },
};

const input =
  "w-full bg-white border border-[#E8DED4] rounded-xl px-3 py-2.5 text-[13px] text-[#1C1C1E] outline-none focus:border-[#FF6B2C] transition-colors";
const label = "block text-[11px] font-extrabold uppercase tracking-wide text-[#806A58] mb-1.5";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 bg-[#FF6B2C] hover:bg-[#E85A1E] text-white text-[13px] font-extrabold px-4 py-2.5 rounded-xl border-none cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 bg-[#F7F2EC] hover:bg-[#F1E8DF] text-[#6B4F3B] text-[13px] font-bold px-4 py-2.5 rounded-xl border-none cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function blankDraft(): Draft {
  return { title: "", body: "", image: "", target: { type: "home" }, audience: { kind: "all" }, scheduledAt: "" };
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function percent(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)} %` : "—";
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white border border-[#E8DED4] rounded-2xl ${className}`}>{children}</div>;
}

function Stat({ icon, value, caption }: { icon: React.ReactNode; value: React.ReactNode; caption: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <span className="w-10 h-10 rounded-xl bg-[#FF6B2C]/10 text-[#FF6B2C] flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[20px] font-black text-[#1C1C1E] leading-none">{value}</div>
        <div className="text-[11px] text-[#806A58] mt-1">{caption}</div>
      </div>
    </Card>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full border-none cursor-pointer transition-colors shrink-0 ${checked ? "bg-[#FF6B2C]" : "bg-[#E8DED4]"}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Apercu d'une notification sur l'ecran verrouille. */
function PhonePreview({ title, body, image }: { title: string; body: string; image: string }) {
  return (
    <div className="rounded-[28px] bg-gradient-to-b from-[#2B2420] to-[#5B4434] p-4 pt-10 min-h-[260px]">
      <div className="text-center text-white/80 text-[32px] font-light leading-none mb-6">09:41</div>
      <div className="bg-white/90 backdrop-blur rounded-2xl p-3 shadow-lg">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-5 h-5 rounded-md bg-[#E76300] flex items-center justify-center">
            <BellRing size={11} className="text-white" />
          </span>
          <span className="text-[11px] font-bold text-[#1C1C1E] uppercase tracking-wide">ZangoChap</span>
          <span className="text-[11px] text-[#806A58] ml-auto">maintenant</span>
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold text-[#1C1C1E] truncate">{title || "Titre de la notification"}</div>
            <div className="text-[12px] text-[#3F3A36] line-clamp-3 whitespace-pre-line">{body || "Votre message apparaîtra ici."}</div>
          </div>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TargetPicker({ target, onChange, categories }: { target: PushTarget; onChange: (target: PushTarget) => void; categories: ConsoleData["categories"] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; price: number; image: string | null }>>([]);
  const [link, setLink] = useState("");
  const [isSearching, startSearch] = useTransition();
  const { showToast } = useToast();

  useEffect(() => {
    if (target.type !== "product" || query.trim().length < 2) return;
    const timer = setTimeout(() => startSearch(async () => setResults(await searchPushProducts(query))), 300);
    return () => clearTimeout(timer);
  }, [query, target.type]);

  const types: Array<{ type: PushTarget["type"]; label: string }> = [
    { type: "home", label: "Accueil" },
    { type: "collection", label: "Collection" },
    { type: "category", label: "Rayon" },
    { type: "product", label: "Produit" },
    { type: "url", label: "Lien" },
  ];

  function pick(type: PushTarget["type"]) {
    if (type === "home") onChange({ type: "home" });
    if (type === "collection") onChange({ type: "collection", key: PUSH_COLLECTIONS[0].key, title: PUSH_COLLECTIONS[0].title });
    if (type === "category" && categories[0]) onChange({ type: "category", id: categories[0].id, name: categories[0].name });
    if (type === "product") onChange({ type: "product", id: "", name: "" });
    if (type === "url") onChange({ type: "url", url: "" });
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {types.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => pick(item.type)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border cursor-pointer transition-colors ${
              target.type === item.type ? "bg-[#1C1C1E] text-white border-[#1C1C1E]" : "bg-white text-[#6B4F3B] border-[#E8DED4] hover:border-[#FF6B2C]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {target.type === "collection" && (
        <select
          className={input}
          value={target.key}
          onChange={(event) => {
            const collection = PUSH_COLLECTIONS.find((item) => item.key === event.target.value)!;
            onChange({ type: "collection", key: collection.key, title: collection.title });
          }}
        >
          {PUSH_COLLECTIONS.map((collection) => (
            <option key={collection.key} value={collection.key}>
              {collection.title}
            </option>
          ))}
        </select>
      )}

      {target.type === "category" && (
        <select
          className={input}
          value={target.id}
          onChange={(event) => {
            const category = categories.find((item) => item.id === event.target.value)!;
            onChange({ type: "category", id: category.id, name: category.name });
          }}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      )}

      {target.type === "product" && (
        <div>
          {target.id ? (
            <div className="flex items-center gap-2 bg-[#F7F2EC] rounded-xl px-3 py-2">
              <PackageCheck size={15} className="text-[#FF6B2C]" />
              <span className="text-[13px] font-bold text-[#1C1C1E] flex-1 truncate">{target.name || target.id}</span>
              <button type="button" onClick={() => onChange({ type: "product", id: "", name: "" })} className="bg-transparent border-none cursor-pointer text-[#806A58]">
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B4A192]" />
                <input className={`${input} pl-8`} placeholder="Rechercher un produit publié…" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              {isSearching && <div className="text-[12px] text-[#806A58] mt-1.5">Recherche…</div>}
              {results.length > 0 && (
                <div className="mt-1.5 border border-[#E8DED4] rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                  {results.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => onChange({ type: "product", id: product.id, name: product.name })}
                      className="w-full flex items-center gap-2.5 px-3 py-2 bg-white hover:bg-[#F7F2EC] border-none border-b border-[#F1E8DF] cursor-pointer text-left"
                    >
                      {product.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image} alt="" className="w-8 h-8 rounded-md object-cover" />
                      ) : (
                        <span className="w-8 h-8 rounded-md bg-[#F1E8DF]" />
                      )}
                      <span className="text-[13px] text-[#1C1C1E] flex-1 truncate">{product.name}</span>
                      <span className="text-[12px] font-bold text-[#806A58]">{new Intl.NumberFormat("fr-FR").format(product.price)} F</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {target.type === "url" && (
        <div className="space-y-2">
          <input className={input} placeholder="https://…" value={target.url} onChange={(event) => onChange({ type: "url", url: event.target.value })} />
          <div className="flex gap-2">
            <input className={input} placeholder="ou coller un lien du site : /product/…, /shop?category=…" value={link} onChange={(event) => setLink(event.target.value)} />
            <button
              type="button"
              className={ghostBtn}
              disabled={!link.trim()}
              onClick={async () => {
                try {
                  const resolved = await resolvePushLink(link);
                  onChange(resolved);
                  setLink("");
                  showToast(`Cible : ${describeTarget(resolved)}`, "success");
                } catch {
                  showToast("Lien non reconnu.", "error");
                }
              }}
            >
              <Link2 size={14} /> Convertir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AudiencePicker({ audience, onChange }: { audience: PushAudience; onChange: (audience: PushAudience) => void }) {
  const [phonesText, setPhonesText] = useState((audience.phones ?? []).join("\n"));
  const options: Array<{ kind: PushAudience["kind"]; label: string; hint: string }> = [
    { kind: "all", label: "Tous", hint: "Tous les appareils abonnés aux offres" },
    { kind: "customers", label: "Clients récents", hint: "Ont commandé récemment" },
    { kind: "inactive", label: "Inactifs", hint: "N'ont pas ouvert l'app depuis un moment" },
    { kind: "platform", label: "Plateforme", hint: "Android ou iPhone seulement" },
    { kind: "phones", label: "Numéros", hint: "Liste de numéros précise" },
  ];
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        {options.map((option) => (
          <button
            key={option.kind}
            type="button"
            title={option.hint}
            onClick={() =>
              onChange(
                option.kind === "customers"
                  ? { kind: "customers", orderedWithinDays: 30 }
                  : option.kind === "inactive"
                    ? { kind: "inactive", inactiveDays: 14 }
                    : option.kind === "platform"
                      ? { kind: "platform", platform: "android" }
                      : option.kind === "phones"
                        ? { kind: "phones", phones: [] }
                        : { kind: "all" },
              )
            }
            className={`px-2 py-2 rounded-lg text-[12px] font-bold border cursor-pointer transition-colors ${
              audience.kind === option.kind ? "bg-[#1C1C1E] text-white border-[#1C1C1E]" : "bg-white text-[#6B4F3B] border-[#E8DED4] hover:border-[#FF6B2C]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {audience.kind === "customers" && (
        <div className="flex items-center gap-2 text-[13px] text-[#6B4F3B]">
          Ayant commandé dans les
          <input type="number" min={1} max={365} className={`${input} w-20`} value={audience.orderedWithinDays ?? 30} onChange={(e) => onChange({ ...audience, orderedWithinDays: Number(e.target.value) || 30 })} />
          derniers jours
        </div>
      )}
      {audience.kind === "inactive" && (
        <div className="flex items-center gap-2 text-[13px] text-[#6B4F3B]">
          Sans ouverture de l&apos;app depuis
          <input type="number" min={1} max={365} className={`${input} w-20`} value={audience.inactiveDays ?? 14} onChange={(e) => onChange({ ...audience, inactiveDays: Number(e.target.value) || 14 })} />
          jours
        </div>
      )}
      {audience.kind === "platform" && (
        <select className={input} value={audience.platform} onChange={(e) => onChange({ kind: "platform", platform: e.target.value as "ios" | "android" })}>
          <option value="android">Android</option>
          <option value="ios">iPhone</option>
        </select>
      )}
      {audience.kind === "phones" && (
        <textarea
          className={`${input} min-h-[90px] font-mono`}
          placeholder={"Un numéro par ligne\n0700000000"}
          value={phonesText}
          onChange={(e) => {
            setPhonesText(e.target.value);
            onChange({ kind: "phones", phones: e.target.value.split(/[\s,;]+/).map((p) => p.trim()).filter((p) => p.length >= 8).slice(0, 500) });
          }}
        />
      )}
    </div>
  );
}

export default function PushClient({ initialData }: { initialData: ConsoleData }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("campaigns");
  const [campaigns, setCampaigns] = useState(initialData.campaigns);
  const [settings, setSettings] = useState(initialData.settings);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [audienceCount, setAudienceCount] = useState<{ count: number; afterLimit: number } | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => setCampaigns(initialData.campaigns), [initialData.campaigns]);

  // Taille de l'audience recalculee a chaque changement de ciblage.
  const audienceKey = draft ? JSON.stringify(draft.audience) : "";
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewPushAudience(draft.audience).catch(() => ({ success: false as const, error: "Audience indisponible." }));
      if (cancelled) return;
      setAudienceCount(result.success ? result.data ?? null : null);
      setAudienceError(result.success ? null : result.error);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey]);

  const totals = useMemo(() => {
    const sent = campaigns.filter((c) => c.status === "sent");
    const delivered = sent.reduce((sum, c) => sum + c.stats.sent, 0);
    const opened = sent.reduce((sum, c) => sum + c.stats.opened, 0);
    return { count: sent.length, delivered, opened };
  }, [campaigns]);

  const { overview } = initialData;

  function openDraft(campaign?: PushCampaign, duplicate = false) {
    setAudienceCount(null);
    setAudienceError(null);
    setDraft(
      campaign
        ? {
            id: duplicate ? undefined : campaign.id,
            title: campaign.title,
            body: campaign.body,
            image: campaign.image ?? "",
            target: campaign.target,
            audience: campaign.audience,
            scheduledAt: duplicate ? "" : toLocalInput(campaign.scheduledAt),
          }
        : blankDraft(),
    );
  }

  function draftValid() {
    if (!draft) return false;
    if (!draft.title.trim() || !draft.body.trim()) return false;
    if (draft.target.type === "product" && !draft.target.id) return false;
    if (draft.target.type === "url" && !/^https?:\/\//.test(draft.target.url)) return false;
    return true;
  }

  function submit(mode: "draft" | "now" | "schedule") {
    if (!draft) return;
    if (mode === "now" && !window.confirm(`Envoyer maintenant à ${audienceCount?.afterLimit ?? "?"} appareil(s) ?`)) return;
    startTransition(async () => {
      const result = await savePushCampaign({
        id: draft.id,
        title: draft.title,
        body: draft.body,
        image: draft.image.trim() || null,
        target: draft.target,
        audience: draft.audience,
        mode,
        scheduledAt: mode === "schedule" && draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
      });
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      showToast(
        mode === "now" ? `Notification envoyée à ${result.data?.sent ?? 0} appareil(s).` : mode === "schedule" ? "Campagne programmée." : "Brouillon enregistré.",
        "success",
      );
      setDraft(null);
      window.location.reload();
    });
  }

  function test() {
    if (!draft) return;
    startTransition(async () => {
      const result = await sendPushTest({ phone: testPhone, title: draft.title, body: draft.body, image: draft.image.trim() || null, target: draft.target });
      showToast(result.success ? "Test envoyé : vérifiez le téléphone." : result.error, result.success ? "success" : "error");
    });
  }

  function saveSettings(next: PushSettings) {
    setSettings(next);
    startTransition(async () => {
      const result = await updatePushSettings(next);
      showToast(result.success ? "Réglages enregistrés." : result.error, result.success ? "success" : "error");
    });
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "campaigns", label: "Campagnes", icon: <Megaphone size={15} /> },
    { id: "orders", label: "Suivi de commande", icon: <PackageCheck size={15} /> },
    { id: "devices", label: "Appareils", icon: <Smartphone size={15} /> },
    { id: "settings", label: "Réglages & journal", icon: <Settings2 size={15} /> },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1200px]">
      {!settings.enabled && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] rounded-xl px-4 py-3 text-[13px] font-bold">
          Les notifications push sont désactivées (onglet Réglages) : aucune campagne ni suivi de commande ne part.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={<Smartphone size={18} />} value={overview.active} caption={`appareils actifs · ${overview.activeThisWeek} cette semaine`} />
        <Stat icon={<Megaphone size={18} />} value={overview.promotions} caption={`abonnés aux offres (${percent(overview.promotions, overview.active)})`} />
        <Stat icon={<Send size={18} />} value={totals.delivered} caption={`notifications envoyées · ${totals.count} campagne(s)`} />
        <Stat icon={<Eye size={18} />} value={percent(totals.opened, totals.delivered)} caption={`taux d'ouverture (${totals.opened} ouvertures)`} />
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold border cursor-pointer whitespace-nowrap transition-colors ${
              tab === item.id ? "bg-[#1C1C1E] text-white border-[#1C1C1E]" : "bg-white text-[#6B4F3B] border-[#E8DED4] hover:border-[#FF6B2C]"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {tab === "campaigns" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-[#806A58]">Promotions, nouveautés, ventes flash : envoi immédiat ou programmé, avec lien direct vers un produit, un rayon ou une collection.</p>
            <button className={`${primaryBtn} whitespace-nowrap shrink-0`} onClick={() => openDraft()}>
              <Megaphone size={15} /> Nouvelle campagne
            </button>
          </div>

          {campaigns.length === 0 ? (
            <Card className="p-8 text-center text-[13px] text-[#806A58]">Aucune campagne pour le moment.</Card>
          ) : (
            <div className="space-y-2">
              {campaigns.map((campaign) => {
                const badge = STATUS_BADGE[campaign.status];
                return (
                  <Card key={campaign.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${badge.className}`}>{badge.label}</span>
                        <span className="text-[14px] font-extrabold text-[#1C1C1E] truncate">{campaign.title}</span>
                      </div>
                      <div className="text-[12px] text-[#6B4F3B] mt-1 line-clamp-1">{campaign.body}</div>
                      <div className="text-[11px] text-[#B4A192] mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>
                          <Users size={11} className="inline -mt-0.5" /> {describeAudience(campaign.audience)}
                        </span>
                        <span>→ {describeTarget(campaign.target)}</span>
                        <span>
                          {campaign.status === "scheduled" ? (
                            <>
                              <CalendarClock size={11} className="inline -mt-0.5" /> {formatDate(campaign.scheduledAt)}
                            </>
                          ) : campaign.sentAt ? (
                            `Envoyée ${formatDate(campaign.sentAt)}`
                          ) : (
                            `Créée ${formatDate(campaign.createdAt)}`
                          )}
                        </span>
                      </div>
                      {campaign.error && <div className="text-[11px] text-[#991B1B] mt-1">{campaign.error}</div>}
                    </div>
                    {campaign.status === "sent" && (
                      <div className="flex gap-4 text-center shrink-0">
                        <div>
                          <div className="text-[16px] font-black text-[#1C1C1E]">{campaign.stats.sent}</div>
                          <div className="text-[10px] uppercase font-bold text-[#806A58]">envoyées</div>
                        </div>
                        <div>
                          <div className="text-[16px] font-black text-[#1C1C1E]">{campaign.stats.opened}</div>
                          <div className="text-[10px] uppercase font-bold text-[#806A58]">ouvertes</div>
                        </div>
                        <div>
                          <div className="text-[16px] font-black text-[#FF6B2C]">{percent(campaign.stats.opened, campaign.stats.sent)}</div>
                          <div className="text-[10px] uppercase font-bold text-[#806A58]">taux</div>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-1.5 shrink-0">
                      {["draft", "scheduled"].includes(campaign.status) && (
                        <button className={ghostBtn} onClick={() => openDraft(campaign)}>
                          Modifier
                        </button>
                      )}
                      <button className={ghostBtn} title="Dupliquer" onClick={() => openDraft(campaign, true)}>
                        <Copy size={14} />
                      </button>
                      {campaign.status === "scheduled" && (
                        <button
                          className={ghostBtn}
                          disabled={isPending}
                          onClick={() =>
                            startTransition(async () => {
                              const result = await cancelPushCampaign(campaign.id);
                              if (result.success) setCampaigns((list) => list.map((c) => (c.id === campaign.id ? { ...c, status: "cancelled" } : c)));
                            })
                          }
                        >
                          Annuler
                        </button>
                      )}
                      {["draft", "cancelled"].includes(campaign.status) && (
                        <button
                          className="w-10 h-10 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#991B1B] border-none cursor-pointer flex items-center justify-center"
                          title="Supprimer"
                          disabled={isPending}
                          onClick={() =>
                            window.confirm("Supprimer cette campagne ?") &&
                            startTransition(async () => {
                              const result = await deletePushCampaign(campaign.id);
                              if (result.success) setCampaigns((list) => list.filter((c) => c.id !== campaign.id));
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="space-y-3">
          <p className="text-[13px] text-[#806A58]">
            Envoyées automatiquement à chaque changement de statut, aux appareils depuis lesquels la commande a été passée (ou liés au même numéro) et abonnés au suivi. Variables :{" "}
            {ORDER_PUSH_VARIABLES.map((variable) => (
              <code key={variable.key} title={variable.label} className="mx-0.5 bg-[#F7F2EC] text-[#6B4F3B] px-1.5 py-0.5 rounded text-[11px]">
                {variable.key}
              </code>
            ))}
          </p>
          {ORDER_PUSH_STATUSES.map((status) => {
            const template = settings.orderStatus[status];
            const update = (patch: Partial<typeof template>) =>
              setSettings((current) => ({ ...current, orderStatus: { ...current.orderStatus, [status]: { ...current.orderStatus[status], ...patch } } }));
            return (
              <Card key={status} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Toggle checked={template.enabled} onChange={(enabled) => update({ enabled })} />
                  <span className="text-[14px] font-extrabold text-[#1C1C1E]">{ORDER_STATUS_LABELS[status]}</span>
                  {!template.enabled && <span className="text-[11px] text-[#B4A192]">désactivée</span>}
                </div>
                <div className={`grid sm:grid-cols-[1fr_2fr] gap-2 ${template.enabled ? "" : "opacity-50"}`}>
                  <input className={input} maxLength={TITLE_MAX} value={template.title} onChange={(e) => update({ title: e.target.value })} />
                  <input className={input} maxLength={BODY_MAX} value={template.body} onChange={(e) => update({ body: e.target.value })} />
                </div>
              </Card>
            );
          })}
          <div className="flex justify-end">
            <button className={primaryBtn} disabled={isPending} onClick={() => saveSettings(settings)}>
              Enregistrer les modèles
            </button>
          </div>
        </div>
      )}

      {tab === "devices" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={<Smartphone size={18} />} value={overview.android} caption="Android actifs" />
            <Stat icon={<Apple size={18} />} value={overview.ios} caption="iPhone actifs" />
            <Stat icon={<PackageCheck size={18} />} value={overview.orders} caption="abonnés au suivi de commande" />
            <Stat icon={<Users size={18} />} value={overview.linked} caption="liés à un numéro client" />
          </div>
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E8DED4] text-[13px] font-extrabold text-[#1C1C1E] uppercase tracking-wide">Derniers appareils</div>
            {overview.recent.length === 0 ? (
              <div className="p-6 text-[13px] text-[#806A58]">
                Aucun appareil enregistré. Les appareils apparaissent quand un client accepte les notifications dans l&apos;application.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#806A58] uppercase text-[10px] font-extrabold tracking-wider">
                      <th className="px-4 py-2.5">Appareil</th>
                      <th className="px-4 py-2.5">Abonnements</th>
                      <th className="px-4 py-2.5">Numéros</th>
                      <th className="px-4 py-2.5">Dernière ouverture</th>
                      <th className="px-4 py-2.5">État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recent.map((device) => (
                      <tr key={device.id} className="border-t border-[#F1E8DF]">
                        <td className="px-4 py-2.5 font-bold text-[#1C1C1E] whitespace-nowrap">
                          {device.platform === "ios" ? "iPhone" : device.platform === "android" ? "Android" : "Web"}
                          {device.appVersion ? <span className="text-[#B4A192] font-normal"> · v{device.appVersion}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-[#806A58]">
                          {(Object.keys(TOPIC_LABELS) as PushTopic[]).filter((topic) => device.topics[topic]).map((topic) => TOPIC_LABELS[topic]).join(", ") || "Aucun"}
                        </td>
                        <td className="px-4 py-2.5 text-[#806A58] whitespace-nowrap">{device.phones.join(", ") || "—"}</td>
                        <td className="px-4 py-2.5 text-[#806A58] whitespace-nowrap">{formatDate(device.lastSeenAt)}</td>
                        <td className="px-4 py-2.5">
                          {device.active ? (
                            <span className="text-[10px] font-extrabold uppercase bg-[#F0FDF4] text-[#166534] px-2 py-0.5 rounded-md">Actif</span>
                          ) : (
                            <span title={device.disabledReason ?? ""} className="text-[10px] font-extrabold uppercase bg-[#F4F4F5] text-[#52525B] px-2 py-0.5 rounded-md">
                              Inactif
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-3">
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Toggle checked={settings.enabled} onChange={(enabled) => saveSettings({ ...settings, enabled })} disabled={isPending} />
              <div>
                <div className="text-[14px] font-extrabold text-[#1C1C1E]">Notifications push activées</div>
                <div className="text-[12px] text-[#806A58]">Interrupteur général : campagnes et suivi de commande.</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Toggle checked={settings.quietHoursEnabled} onChange={(quietHoursEnabled) => setSettings({ ...settings, quietHoursEnabled })} />
              <div className="text-[13px] text-[#1C1C1E] flex flex-wrap items-center gap-2">
                Campagnes programmées envoyées seulement entre
                <input type="time" className={`${input} w-28`} value={settings.sendStart} onChange={(e) => setSettings({ ...settings, sendStart: e.target.value })} />
                et
                <input type="time" className={`${input} w-28`} value={settings.sendEnd} onChange={(e) => setSettings({ ...settings, sendEnd: e.target.value })} />
                (heure d&apos;Abidjan)
              </div>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-[#1C1C1E]">
              Au plus
              <input
                type="number"
                min={0}
                max={20}
                className={`${input} w-20`}
                value={settings.dailyLimitPerDevice}
                onChange={(e) => setSettings({ ...settings, dailyLimitPerDevice: Math.max(0, Number(e.target.value) || 0) })}
              />
              campagne(s) par appareil et par jour (0 = illimité ; le suivi de commande n&apos;est pas compté).
            </div>
            <div className="flex justify-end">
              <button className={primaryBtn} disabled={isPending} onClick={() => saveSettings(settings)}>
                Enregistrer
              </button>
            </div>
          </Card>

          <Card className="p-4 text-[12px] text-[#6B4F3B] space-y-1">
            <div className="font-extrabold text-[#1C1C1E] text-[13px]">Configuration technique</div>
            <div>Envoi via le service Expo Push (Android : Firebase Cloud Messaging ; iPhone : APNs), identifiants configurés dans le projet EAS « zangochap ».</div>
            <div>
              Jeton d&apos;accès Expo (<code>EXPO_ACCESS_TOKEN</code>) : {initialData.expoTokenConfigured ? "configuré" : "non configuré (facultatif, requis seulement si la sécurité des envois push est activée sur Expo)"}.
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E8DED4]">
              <Activity size={15} className="text-[#FF6B2C]" />
              <span className="text-[13px] font-extrabold text-[#1C1C1E] uppercase tracking-wide">Journal des envois</span>
            </div>
            {initialData.log.length === 0 ? (
              <div className="p-6 text-[13px] text-[#806A58]">Aucun envoi pour le moment.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[#806A58] uppercase text-[10px] font-extrabold tracking-wider">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Type</th>
                      <th className="px-4 py-2.5">Notification</th>
                      <th className="px-4 py-2.5">Envoyées</th>
                      <th className="px-4 py-2.5">Erreur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {initialData.log.map((entry, index) => (
                      <tr key={index} className="border-t border-[#F1E8DF]">
                        <td className="px-4 py-2.5 text-[#806A58] whitespace-nowrap">{formatDate(entry.at)}</td>
                        <td className="px-4 py-2.5 text-[#806A58]">{entry.kind === "campaign" ? "Campagne" : entry.kind === "order" ? "Commande" : "Test"}</td>
                        <td className="px-4 py-2.5 font-bold text-[#1C1C1E]">{entry.label}</td>
                        <td className="px-4 py-2.5 text-[#1C1C1E]">
                          {entry.sent}
                          {entry.failed ? <span className="text-[#991B1B]"> / {entry.failed} échec(s)</span> : null}
                        </td>
                        <td className="px-4 py-2.5 text-[#991B1B] max-w-[280px] truncate">{entry.error || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-[10001] flex items-start lg:items-center justify-center overflow-y-auto p-3 lg:p-8" onClick={() => setDraft(null)}>
          <div className="bg-[#FBF8F5] rounded-2xl w-full max-w-[980px] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8DED4]">
              <div className="text-[16px] font-black text-[#1C1C1E]">{draft.id ? "Modifier la campagne" : "Nouvelle campagne"}</div>
              <button onClick={() => setDraft(null)} className="w-9 h-9 rounded-xl bg-[#F7F2EC] border-none cursor-pointer flex items-center justify-center text-[#6B4F3B]">
                <X size={16} />
              </button>
            </div>
            <div className="grid lg:grid-cols-[1fr_300px] gap-5 p-5">
              <div className="space-y-4">
                <div>
                  <label className={label}>
                    Titre <span className="normal-case font-normal text-[#B4A192]">({draft.title.length}/{TITLE_MAX})</span>
                  </label>
                  <input className={input} maxLength={TITLE_MAX} placeholder="Ex. -30 % sur les sneakers ce week-end 🔥" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </div>
                <div>
                  <label className={label}>
                    Message <span className="normal-case font-normal text-[#B4A192]">({draft.body.length}/{BODY_MAX})</span>
                  </label>
                  <textarea className={`${input} min-h-[80px]`} maxLength={BODY_MAX} placeholder="Court et concret : l'offre, la durée, l'action." value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                </div>
                <div>
                  <label className={label}>
                    Image <span className="normal-case font-normal text-[#B4A192]">(facultatif, lien https — copiez-le depuis la Galerie Media)</span>
                  </label>
                  <input className={input} placeholder="https://…" value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} />
                </div>
                <div>
                  <label className={label}>Ouvre dans l&apos;app</label>
                  <TargetPicker target={draft.target} onChange={(target) => setDraft({ ...draft, target })} categories={initialData.categories} />
                </div>
                <div>
                  <label className={label}>Audience</label>
                  <AudiencePicker audience={draft.audience} onChange={(audience) => setDraft({ ...draft, audience })} />
                  <div className="text-[12px] text-[#6B4F3B] mt-2">
                    {audienceError ? (
                      <span className="text-[#991B1B]">{audienceError}</span>
                    ) : audienceCount === null ? (
                      "Calcul de l'audience…"
                    ) : (
                      <>
                        <b className="text-[#1C1C1E]">{audienceCount.afterLimit}</b> appareil(s) recevront la notification
                        {audienceCount.count !== audienceCount.afterLimit && ` (${audienceCount.count - audienceCount.afterLimit} exclus : plafond quotidien atteint)`}.
                        Les clients désabonnés des offres ne sont jamais ciblés.
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <PhonePreview title={draft.title} body={draft.body} image={draft.image} />
                <Card className="p-3 space-y-2">
                  <div className={label}>Tester sur un téléphone</div>
                  <input className={input} placeholder="Numéro utilisé dans l'app" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                  <button className={`${ghostBtn} w-full`} disabled={isPending || !draftValid() || !testPhone.trim()} onClick={test}>
                    <Send size={14} /> Envoyer un test
                  </button>
                </Card>
                <Card className="p-3 space-y-2">
                  <div className={label}>Programmer</div>
                  <input type="datetime-local" className={input} value={draft.scheduledAt} onChange={(e) => setDraft({ ...draft, scheduledAt: e.target.value })} />
                  <button className={`${ghostBtn} w-full`} disabled={isPending || !draftValid() || !draft.scheduledAt} onClick={() => submit("schedule")}>
                    <CalendarClock size={14} /> Programmer
                  </button>
                </Card>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 border-t border-[#E8DED4]">
              <button className={ghostBtn} disabled={isPending || !draftValid()} onClick={() => submit("draft")}>
                Enregistrer le brouillon
              </button>
              <button className={primaryBtn} disabled={isPending || !draftValid() || !audienceCount?.afterLimit} onClick={() => submit("now")}>
                <Send size={15} /> Envoyer maintenant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
