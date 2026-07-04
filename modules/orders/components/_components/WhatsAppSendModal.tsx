"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MessageCircle, RotateCcw, Send, Smartphone } from "lucide-react";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { buildOrderWhatsAppMessage, normalizeIvorianPhone } from "@/modules/whatsapp/message-builder";
import { getOrderMessagePreview, sendOrderWhatsAppMessage } from "@/modules/whatsapp/order-actions";

// Apercu + envoi direct du recapitulatif de commande via l'API WhatsApp Cloud.
// Le bouton wa.me reste disponible en secours (message marketing complet).
export default function WhatsAppSendModal({ order, onClose, onOpenWaMe }: {
  order: any;
  onClose: () => void;
  onOpenWaMe?: (order: any) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  // Rendu local immediat (modele par defaut), remplace par le rendu serveur qui
  // applique le modele personnalise configure dans la console admin.
  const fallbackMessage = useMemo(() => buildOrderWhatsAppMessage(order), [order]);
  const [initialMessage, setInitialMessage] = useState(fallbackMessage);
  const [message, setMessage] = useState(fallbackMessage);
  // Image configuree dans la console admin, jointe automatiquement a l'envoi.
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const phone = normalizeIvorianPhone(order?.customerPhone || "");

  useEffect(() => {
    let cancelled = false;
    getOrderMessagePreview(order.id)
      .then((result) => {
        if (cancelled || !result.success) return;
        setInitialMessage(result.message);
        setAttachedImage(result.imageUrl || null);
        // Ne pas ecraser une saisie deja commencee par l'utilisateur.
        setMessage((current) => (current === fallbackMessage ? result.message : current));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [order.id, fallbackMessage]);

  const send = () => {
    startTransition(async () => {
      const result = await sendOrderWhatsAppMessage({ orderId: order.id, message });
      if (!result.success) {
        showToast(result.error, "error");
        return;
      }
      showToast("Message WhatsApp envoyé au client ✓", "success");
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={`WhatsApp — Commande ${order?.ref || ""}`}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E8DED4] bg-[#FCFAF7] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F0FDF4] text-[#16a34a]">
              <MessageCircle size={16} />
            </span>
            <div>
              <div className="text-[13px] font-black text-[#1A1410]">{order?.customerName || "Client"}</div>
              <div className="flex items-center gap-1 font-mono text-[11px] font-bold text-[#806A58]">
                <Smartphone size={11} /> {phone || "Numéro manquant"}
              </div>
            </div>
          </div>
          {message !== initialMessage && (
            <button
              type="button"
              onClick={() => setMessage(initialMessage)}
              className="inline-flex items-center gap-1 text-[11px] font-black text-[#C2410C] hover:underline"
            >
              <RotateCcw size={12} /> Réinitialiser
            </button>
          )}
        </div>

        {attachedImage && (
          <div className="flex items-center gap-2 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2">
            {/* Domaine R2 dynamique : next/image exigerait une config remotePatterns. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachedImage} alt="Image jointe" className="h-10 w-10 rounded-md border border-[#BBF7D0] object-cover" />
            <span className="text-[11px] font-black text-[#166534]">
              Une image sera jointe au message (configurée dans la console WhatsApp).
            </span>
          </div>
        )}

        <label className="grid gap-1">
          <span className="text-[11px] font-black uppercase text-[#806A58]">Aperçu du message (modifiable)</span>
          <textarea
            className="field-input whitespace-pre-wrap"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={12}
            maxLength={4096}
          />
          <small className="text-[10px] font-bold text-[#806A58]">
            Envoi direct via l&apos;API Cloud : le client reçoit le message sans ouvrir WhatsApp de votre côté.
          </small>
        </label>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {onOpenWaMe && (
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#E8DED4] bg-white px-3 text-[12px] font-black text-[#6B4F3B] hover:bg-[#FCFAF7]"
              onClick={() => onOpenWaMe(order)}
              title="Ouvre WhatsApp Web avec le message marketing complet (liens application)"
            >
              <ExternalLink size={14} /> wa.me (message complet)
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[#16a34a] px-4 text-[12px] font-black text-white hover:bg-[#15803d] disabled:opacity-60"
            disabled={isPending || !phone || !message.trim()}
            onClick={send}
          >
            <Send size={14} /> {isPending ? "Envoi..." : "Envoyer maintenant"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
