"use client";

import Link from "next/link";
import { AlertTriangle, MessageCircle, X } from "lucide-react";
import { motion } from "framer-motion";

export type RiderMessageAlert = {
  id: string;
  senderName: string;
  body: string;
  createdAt?: string;
};

type RiderMessageAlertOverlayProps = {
  alert: RiderMessageAlert | null;
  onClose: () => void;
};

export default function RiderMessageAlertOverlay({ alert, onClose }: RiderMessageAlertOverlayProps) {
  if (!alert) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-[#07111F] px-4 py-6 text-white"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rider-alert-title"
    >
      <div className="absolute inset-x-0 top-0 h-2 bg-[#FF6B2C]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#FF6B2C33,transparent_34%),linear-gradient(135deg,#07111F_0%,#0F172A_60%,#111827_100%)]" />

      <motion.div
        initial={{ scale: 0.96, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", damping: 20, stiffness: 180 }}
        className="relative z-10 w-full max-w-4xl border border-white/12 bg-white/8 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-white/10 text-white transition-colors hover:bg-white/15"
          aria-label="Fermer l'alerte"
        >
          <X size={22} />
        </button>

        <div className="mb-8 flex items-center gap-4 pr-14">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-[#FF6B2C] text-white shadow-[0_0_0_10px_rgba(255,107,44,0.14)]">
            <AlertTriangle size={34} strokeWidth={2.6} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-black uppercase tracking-[0.2em] text-[#FDBA74]">
              Alerte livreur
            </p>
            <h2 id="rider-alert-title" className="mt-2 text-[32px] font-black leading-tight tracking-normal text-white sm:text-[46px]">
              Message urgent pour le call center
            </h2>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-md border border-white/10 bg-white/10 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/45">Livreur</p>
            <p className="mt-2 break-words text-[24px] font-black leading-tight text-white">{alert.senderName}</p>
            {alert.createdAt && (
              <p className="mt-3 text-[12px] font-bold text-white/55">
                {new Intl.DateTimeFormat("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "short",
                }).format(new Date(alert.createdAt))}
              </p>
            )}
          </div>

          <div className="min-h-48 rounded-md border border-[#FF6B2C]/35 bg-[#FF6B2C]/12 p-4 sm:p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#FDBA74]">Message</p>
            <p className="mt-3 max-h-[42dvh] overflow-y-auto whitespace-pre-wrap break-words text-[18px] font-bold leading-relaxed text-white sm:text-[22px]">
              {alert.body}
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-md border border-white/10 bg-white/10 px-5 text-[14px] font-black text-white transition-colors hover:bg-white/15"
          >
            Fermer
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
