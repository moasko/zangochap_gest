"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  large?: boolean;
  xl?: boolean;
  full?: boolean;
  className?: string;
}

export default function Modal({ isOpen, onClose, title, children, footer, large = false, xl = false, full = false, className = "" }: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isOpen) {
      document.body.style.overflow = "hidden";
      const mainArea = document.querySelector('.main-scroll-area') as HTMLElement;
      if (mainArea) mainArea.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = "";
      const mainArea = document.querySelector('.main-scroll-area') as HTMLElement;
      if (mainArea) mainArea.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = "";
      const mainArea = document.querySelector('.main-scroll-area') as HTMLElement;
      if (mainArea) mainArea.style.overflow = '';
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className={`modal-root ${className}`}>
      {/* Backdrop */}
      <div className="modal-overlay-new" onClick={onClose} />

      {/* Modal Content */}
      <div className="modal-container">
        <div className={`modal-content-new ${full ? "full" : xl ? "xl" : large ? "large" : ""}`}>
          <div className="modal-header-new">
            <div className="modal-title-wrapper">
              <h3 className="modal-title-new">{title}</h3>
            </div>
            <button className="modal-close-new" onClick={onClose} aria-label="Fermer">
              <X size={18} />
            </button>
          </div>

          <div className="modal-body-new">
            {children}
          </div>

          {footer && (
            <div className="modal-footer-new">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
