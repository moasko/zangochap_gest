"use client";

import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "@/components/Modal";

// Remplace les window.prompt() pour les actions sensibles : un motif obligatoire,
// saisi dans un vrai modal, avec le contexte de l'action sous les yeux.
export default function ReasonModal({
  title,
  description,
  confirmLabel,
  danger,
  placeholder,
  label = "Motif obligatoire",
  singleLine = false,
  initialValue = "",
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  placeholder?: string;
  label?: string;
  singleLine?: boolean;
  initialValue?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(initialValue);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim() || pending) return;
    setPending(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={title}>
      <form onSubmit={submit} className="grid gap-3">
        {description && (
          <div className={`flex items-start gap-2 rounded-md border p-3 text-[12px] font-semibold ${danger ? "border-[var(--red-soft)] bg-[var(--red-soft)] text-[var(--red)]" : "border-[var(--line)] bg-[var(--cream)] text-[var(--brown-soft)]"}`}>
            {danger && <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
            <span>{description}</span>
          </div>
        )}
        <label className="grid gap-1">
          <span className="text-[11px] font-bold uppercase text-[var(--brown-soft)]">{label}</span>
          {singleLine ? (
            <input
              className="field-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              autoFocus
              maxLength={120}
              placeholder={placeholder}
            />
          ) : (
            <textarea
              className="field-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              required
              autoFocus
              maxLength={500}
              placeholder={placeholder || "Expliquez la raison de cette action..."}
            />
          )}
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Annuler</button>
          <button
            type="submit"
            disabled={pending || !reason.trim()}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[12px] font-black text-white disabled:opacity-60 ${danger ? "bg-[var(--red)] hover:bg-[#A83318]" : "bg-[var(--ink)] hover:bg-[var(--navy-2)]"}`}
          >
            {pending ? "En cours..." : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
