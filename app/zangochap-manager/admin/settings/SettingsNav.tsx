"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Gift, LayoutGrid, MapPin, Settings, Store, Users } from "lucide-react";

const NAV_ITEMS = [
  {
    label: "Vue d'ensemble",
    href: "/zangochap-manager/admin/settings",
    icon: <Settings size={16} />,
    desc: "Accueil",
    exact: true,
  },
  {
    label: "Catégories",
    href: "/zangochap-manager/admin/settings/categories",
    icon: <LayoutGrid size={16} />,
    desc: "Catalogue",
  },
  {
    label: "Fournisseurs",
    href: "/zangochap-manager/admin/settings/suppliers",
    icon: <Store size={16} />,
    desc: "Sources",
  },
  {
    label: "Communes",
    href: "/zangochap-manager/admin/settings/communes",
    icon: <MapPin size={16} />,
    desc: "Livraison",
  },
  {
    label: "Équipe",
    href: "/zangochap-manager/admin/settings/team",
    icon: <Users size={16} />,
    desc: "Accès",
  },
  {
    label: "Cadeaux",
    href: "/zangochap-manager/admin/settings/gifts",
    icon: <Gift size={16} />,
    desc: "Quotas & demandes",
  },
];

export default function SettingsNav() {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <aside className="settings-nav">
      <div className="nav-header">
        <Link href="/zangochap-manager" className="nav-back">
          <ChevronLeft size={14} />
          <span>Manager</span>
        </Link>
        <div className="nav-title">
          <Settings size={16} />
          Configuration
        </div>
      </div>

      <nav className="nav-list" aria-label="Sections configuration">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${isActive(item.href, item.exact) ? "active" : ""}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-text">
              <span className="nav-label">{item.label}</span>
              <span className="nav-desc">{item.desc}</span>
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
