"use client";

import Link from "next/link";
import { AlertTriangle, Clock, MapPin, MessageCircle, Phone, UserRound, X } from "lucide-react";
import { motion } from "framer-motion";

export type RiderMessageAlert = {
  id: string;
  senderName: string;
  senderPhone?: string | null;
  body: string;
  createdAt?: string;
};

type RiderMessageAlertOverlayProps = {
  alert: RiderMessageAlert | null;
  pendingCount?: number;
  onClose: () => void;
};

function parseAlertBody(body: string) {
  return body.split("\n").reduce<Record<string, string>>((acc, line) => {
    const [label, ...rest] = line.split(":");
    if (rest.length > 0) acc[label.trim().toLowerCase()] = rest.join(":").trim();
    return acc;
  }, {});
}

export default function RiderMessageAlertOverlay({ alert, pendingCount = 0, onClose }: RiderMessageAlertOverlayProps) {
  if (!alert) return null;

  const details = parseAlertBody(alert.body);
  const title = alert.body.split("\n")[0]?.replace("[ALERTE LIVREUR]", "").trim() || "Alerte livreur";
  const message = details.message || details.motif || alert.body;
  const client = details.client || "Client non precise";
  const commune = details.commune || "Commune non precisee";
  const address = details.adresse || "Adresse non renseignee";
  const riderPhone = alert.senderPhone || details["telephone livreur"] || details["tel livreur"] || "Numero non renseigne";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-[#07111F] px-3 py-4 text-white sm:px-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rider-alert-title"
    >
      <div className="absolute inset-x-0 top-0 h-2 bg-[#FF6B2C]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,#FF6B2C40,transparent_30%),radial-gradient(circle_at_bottom_right,#1E40AF33,transparent_30%),linear-gradient(135deg,#07111F_0%,#0F172A_56%,#111827_100%)]" />

      <motion.div
        initial={{ scale: 0.96, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", damping: 20, stiffness: 180 }}
        className="relative z-10 w-full max-w-5xl overflow-hidden rounded-lg border border-white/12 bg-[#0B1220]/92 shadow-[0_28px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/15"
          aria-label="Fermer l'alerte"
        >
          <X size={22} />
        </button>

        <div className="border-b border-white/10 bg-white/[0.04] px-5 pb-5 pt-6 sm:px-8 sm:pb-7 sm:pt-8">
          <div className="flex items-start gap-4 pr-14">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-[#FF6B2C] text-white shadow-[0_0_0_10px_rgba(255,107,44,0.15)]">
              <AlertTriangle size={34} strokeWidth={2.7} />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-black uppercase tracking-[0.24em] text-[#FDBA74]">
                Assistance livreur
              </p>
              <h2 id="rider-alert-title" className="mt-2 text-[30px] font-black leading-tight tracking-normal text-white sm:text-[44px]">
                {title}
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/70">
                <span className="rounded-md bg-[#FF6B2C]/18 px-3 py-1.5 text-[#FDBA74]">Urgent</span>
                <span className="rounded-md bg-white/8 px-3 py-1.5">Call center</span>
                {pendingCount > 0 && (
                  <span className="rounded-md bg-[#1E40AF]/35 px-3 py-1.5 text-[#BFDBFE]">
                    {pendingCount} en attente
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0">
            <div className="rounded-lg border border-[#FF6B2C]/35 bg-[#FF6B2C]/12 p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2 text-[#FDBA74]">
                <MessageCircle size={20} />
                <p className="text-[12px] font-black uppercase tracking-[0.18em]">Message a traiter</p>
              </div>
              <p className="max-h-[42dvh] overflow-y-auto whitespace-pre-wrap break-words text-[22px] font-black leading-snug text-white sm:text-[30px]">
                {message}
              </p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoTile icon={<Phone size={18} />} label="Client" value={client} />
              <InfoTile icon={<MapPin size={18} />} label="Commune" value={commune} />
              <InfoTile icon={<MapPin size={18} />} label="Adresse" value={address} wide />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-lg border border-white/10 bg-white/8 p-5">
              <div className="mb-3 flex items-center gap-2 text-white/55">
                <UserRound size={18} />
                <p className="text-[11px] font-black uppercase tracking-[0.18em]">Livreur</p>
              </div>
              <p className="break-words text-[28px] font-black leading-tight text-white">{alert.senderName}</p>
              <div className="mt-4 rounded-md border border-white/10 bg-white/8 p-3">
                <div className="mb-1 flex items-center gap-2 text-white/50">
                  <Phone size={15} />
                  <p className="text-[10px] font-black uppercase tracking-[0.16em]">Numero livreur</p>
                </div>
                <p className="break-words text-[18px] font-black text-white">{riderPhone}</p>
              </div>
              {alert.createdAt && (
                <div className="mt-4 flex items-center gap-2 text-[13px] font-bold text-white/60">
                  <Clock size={15} />
                  {new Intl.DateTimeFormat("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "short",
                  }).format(new Date(alert.createdAt))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-white/6 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">Resume brut</p>
              <p className="mt-3 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[13px] font-bold leading-relaxed text-white/70">
                {alert.body}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 bg-white/[0.035] p-5 sm:flex-row sm:justify-end sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-md border border-white/10 bg-white/10 px-5 text-[14px] font-black text-white transition-colors hover:bg-white/15"
          >
            {pendingCount > 0 ? "Alerte suivante" : "Fermer"}
          </button>
          <Link
            href="/zangochap-manager/chat"
            onClick={onClose}
            className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#FF6B2C] px-5 text-[14px] font-black text-white no-underline shadow-[0_12px_30px_rgba(255,107,44,0.3)] transition-transform active:scale-[0.98]"
          >
            <MessageCircle size={18} />
            Ouvrir le chat
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}

function InfoTile({
  icon,
  label,
  value,
  wide = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-white/10 bg-white/8 p-4 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="mb-2 flex items-center gap-2 text-white/50">
        {icon}
        <p className="text-[11px] font-black uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="break-words text-[15px] font-black leading-snug text-white">{value}</p>
    </div>
  );
}
