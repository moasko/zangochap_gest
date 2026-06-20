"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, LayoutGrid, MapPin, MessageCircle, Settings, Store, Users } from "lucide-react";

const SECTIONS = [
  {
    title: "Catégories",
    description: "Structurez le catalogue et ses sous-catégories.",
    href: "/zangochap-manager/admin/settings/categories",
    icon: <LayoutGrid size={20} />,
    iconColor: "#4F46E5",
    bgColor: "#EEF2FF",
  },
  {
    title: "Fournisseurs",
    description: "Centralisez les sources, contacts et approvisionnements.",
    href: "/zangochap-manager/admin/settings/suppliers",
    icon: <Store size={20} />,
    iconColor: "#D97706",
    bgColor: "#FFF7ED",
  },
  {
    title: "Communes & livraison",
    description: "Réglez les zones de livraison et les frais par commune.",
    href: "/zangochap-manager/admin/settings/communes",
    icon: <MapPin size={20} />,
    iconColor: "#059669",
    bgColor: "#ECFDF5",
  },
  {
    title: "Équipe & accès",
    description: "Administrez les comptes, rôles et accès staff.",
    href: "/zangochap-manager/admin/settings/team",
    icon: <Users size={20} />,
    iconColor: "#2563EB",
    bgColor: "#EFF6FF",
  },
  {
    title: "WhatsApp Business",
    description: "Connectez Meta Cloud API, testez les messages et vérifiez le webhook.",
    href: "/zangochap-manager/admin/whatsapp",
    icon: <MessageCircle size={20} />,
    iconColor: "#128C5A",
    bgColor: "#EAF8F0",
  },
];

export default function SettingsClient() {
  return (
    <div className="settings-overview">
      <div className="overview-header">
        <div className="overview-icon">
          <Settings size={24} />
        </div>
        <div>
          <h1>Centre de configuration</h1>
          <p>Les réglages qui structurent le catalogue, la livraison et les accès équipe.</p>
        </div>
      </div>

      <div className="overview-strip">
        <span>{SECTIONS.length} modules</span>
        <span>Catalogue</span>
        <span>Livraison</span>
        <span>Équipe</span>
      </div>

      <div className="overview-grid">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="overview-card">
            <div className="card-icon" style={{ backgroundColor: section.bgColor, color: section.iconColor }}>
              {section.icon}
            </div>
            <div className="card-body">
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </div>
            <ArrowRight size={16} className="card-arrow" />
          </Link>
        ))}
      </div>
    </div>
  );
}
