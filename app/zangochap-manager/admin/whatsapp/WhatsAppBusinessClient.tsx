"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  KeyRound,
  MessageCircle,
  Radio,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { sendWhatsAppTest } from "@/modules/whatsapp/actions";
import styles from "./whatsapp.module.css";

type Configuration = {
  fields: {
    accessToken: boolean;
    appSecret: boolean;
    businessAccountId: boolean;
    phoneNumberId: boolean;
    verifyToken: boolean;
  };
  graphApiVersion: string;
  isReady: boolean;
  phoneNumberId: string;
  businessAccountId: string;
};

type ConsoleData = {
  configuration: Configuration;
  webhookUrl: string;
  lastWebhook: unknown;
  lastTest: unknown;
};

const ENVIRONMENT_FIELDS = [
  ["WHATSAPP_ACCESS_TOKEN", "Token permanent", "accessToken"],
  ["WHATSAPP_PHONE_NUMBER_ID", "ID du numéro", "phoneNumberId"],
  ["WHATSAPP_BUSINESS_ACCOUNT_ID", "ID du compte WABA", "businessAccountId"],
  ["WHATSAPP_WEBHOOK_VERIFY_TOKEN", "Token de vérification", "verifyToken"],
  ["WHATSAPP_APP_SECRET", "Secret de l'application", "appSecret"],
] as const;

const SETUP_STEPS = [
  "Créer une application Meta avec le cas d'utilisation WhatsApp.",
  "Associer le compte WhatsApp Business et le numéro professionnel.",
  "Créer un utilisateur système et un token permanent avec les trois permissions requises.",
  "Déclarer l'URL du webhook et s'abonner au champ messages.",
  "Envoyer hello_world, répondre sur WhatsApp, puis tester un texte libre dans les 24 heures.",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function formatDate(value: unknown) {
  if (typeof value !== "string") return "Aucun événement reçu";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function WhatsAppBusinessClient({ initialData }: { initialData: ConsoleData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [recipient, setRecipient] = useState("");
  const [mode, setMode] = useState<"template" | "text">("template");
  const [message, setMessage] = useState("Bonjour, votre commande ZangoChap est prête.");
  const lastWebhook = asRecord(initialData.lastWebhook);
  const lastTest = asRecord(initialData.lastTest);
  const configuredCount = Object.values(initialData.configuration.fields).filter(Boolean).length;

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(initialData.webhookUrl);
      showToast("URL du webhook copiée", "success");
    } catch {
      showToast("Copie impossible sur ce navigateur", "error");
    }
  };

  const handleSend = () => {
    startTransition(async () => {
      const result = await sendWhatsAppTest(
        mode === "template"
          ? { mode, recipient }
          : { mode, recipient, message },
      );

      if (!result.success) {
        showToast(result.error, "error");
        return;
      }

      showToast("Message transmis à WhatsApp Cloud", "success");
      router.refresh();
    });
  };

  return (
    <div className={styles.page}>
      <motion.section
        className={styles.hero}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className={styles.heroIcon}><MessageCircle size={30} /></div>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>WhatsApp Cloud API</span>
          <h2>Centre de connexion Jasper&apos;s Market</h2>
          <p>Configurez Meta, vérifiez le webhook et envoyez votre premier message sans exposer les secrets au navigateur.</p>
        </div>
        <div className={`${styles.readiness} ${initialData.configuration.isReady ? styles.ready : ""}`}>
          <span>{initialData.configuration.isReady ? "Prêt" : `${configuredCount}/5 configurés`}</span>
          <small>{initialData.configuration.graphApiVersion}</small>
        </div>
      </motion.section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardTitle}>
            <div><ShieldCheck size={19} /><span>Configuration serveur</span></div>
            <span className={styles.secure}>Secrets masqués</span>
          </div>
          <div className={styles.configList}>
            {ENVIRONMENT_FIELDS.map(([variable, label, key]) => {
              const configured = initialData.configuration.fields[key];
              return (
                <div className={styles.configRow} key={variable}>
                  <div>
                    <strong>{label}</strong>
                    <code>{variable}</code>
                  </div>
                  <span className={configured ? styles.statusOk : styles.statusMissing}>
                    {configured ? <Check size={13} /> : null}
                    {configured ? "Configuré" : "Manquant"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={styles.ids}>
            <div><span>Phone number ID</span><strong>{initialData.configuration.phoneNumberId || "Non configuré"}</strong></div>
            <div><span>WhatsApp Business Account</span><strong>{initialData.configuration.businessAccountId || "Non configuré"}</strong></div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}>
            <div><Send size={19} /><span>Envoyer un test</span></div>
          </div>
          <div className={styles.modeSwitch}>
            <button type="button" className={mode === "template" ? styles.modeActive : ""} onClick={() => setMode("template")}>hello_world</button>
            <button type="button" className={mode === "text" ? styles.modeActive : ""} onClick={() => setMode("text")}>Texte libre</button>
          </div>
          <label className={styles.field}>
            <span>Numéro destinataire</span>
            <div className={styles.inputWrap}>
              <Smartphone size={16} />
              <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="2250700000000" inputMode="tel" />
            </div>
            <small>Format international, sans + ni espaces.</small>
          </label>
          {mode === "text" && (
            <label className={styles.field}>
              <span>Message</span>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4096} rows={4} />
              <small>Le texte libre fonctionne pendant la fenêtre de service de 24 heures après un message du client.</small>
            </label>
          )}
          <button className={styles.sendButton} type="button" disabled={isPending || !recipient.trim()} onClick={handleSend}>
            <Send size={16} /> {isPending ? "Envoi..." : mode === "template" ? "Envoyer hello_world" : "Envoyer le message"}
          </button>
          <div className={styles.lastActivity}>
            <span>Dernier test</span>
            <strong>{formatDate(lastTest?.at)}</strong>
            {lastTest?.recipient ? <small>Vers {String(lastTest.recipient)} par {String(lastTest.byName || "admin")}</small> : null}
          </div>
        </section>

        <section className={`${styles.card} ${styles.webhookCard}`}>
          <div className={styles.cardTitle}>
            <div><Radio size={19} /><span>Webhook Meta</span></div>
            <span className={lastWebhook ? styles.statusOk : styles.statusNeutral}>{lastWebhook ? "Événement reçu" : "En attente"}</span>
          </div>
          <p className={styles.cardIntro}>Collez cette URL dans Configuration &gt; Webhooks de votre application Meta, puis utilisez la même valeur que <code>WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>.</p>
          <div className={styles.webhookUrl}>
            <code>{initialData.webhookUrl}</code>
            <button type="button" onClick={copyWebhookUrl} title="Copier l'URL"><Clipboard size={16} /></button>
          </div>
          <div className={styles.webhookMeta}>
            <Server size={16} />
            <div>
              <strong>Dernière réception : {formatDate(lastWebhook?.at)}</strong>
              <span>Les signatures <code>X-Hub-Signature-256</code> sont vérifiées avant traitement.</span>
            </div>
          </div>
        </section>

        <section className={`${styles.card} ${styles.stepsCard}`}>
          <div className={styles.cardTitle}>
            <div><KeyRound size={19} /><span>Mise en route Meta</span></div>
            <a href="https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started" target="_blank" rel="noreferrer">Documentation <ExternalLink size={13} /></a>
          </div>
          <ol className={styles.steps}>
            {SETUP_STEPS.map((step, index) => (
              <li key={step}><span>{index + 1}</span><p>{step}</p></li>
            ))}
          </ol>
          <div className={styles.permissions}>
            <CheckCircle2 size={17} />
            <div>
              <strong>Permissions du token permanent</strong>
              <code>business_management</code>
              <code>whatsapp_business_messaging</code>
              <code>whatsapp_business_management</code>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

