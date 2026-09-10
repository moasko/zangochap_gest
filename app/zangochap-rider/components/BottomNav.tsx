"use client";

import React from "react";
import { History, LayoutDashboard, Wallet, User, LucideIcon } from "lucide-react";

type Tab = "missions" | "history" | "wallet" | "profile";

interface BottomNavProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  pendingCount?: number;
  historyCount?: number;
}

interface NavItem {
  key: Tab;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: "missions", label: "Missions", icon: LayoutDashboard },
  { key: "history",  label: "Historique", icon: History },
  { key: "wallet",   label: "Caisse",  icon: Wallet },
  { key: "profile",  label: "Compte",   icon: User },
];

export function BottomNav({ activeTab, setActiveTab, pendingCount, historyCount }: BottomNavProps) {
  return (
    <nav
      aria-label="Navigation principale"
      className="rider-bottom-nav"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="rider-nav-inner">
        {NAV_ITEMS.map((item) => (
          <NavBtn
            key={item.key}
            icon={item.icon}
            label={item.label}
            active={activeTab === item.key}
            badge={item.key === "missions" ? pendingCount : item.key === "history" ? historyCount : undefined}
            onClick={() => setActiveTab(item.key)}
          />
        ))}
      </div>
    </nav>
  );
}

interface NavBtnProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}

function NavBtn({ icon: Icon, label, active, badge, onClick }: NavBtnProps) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`rider-nav-item ${active ? "is-active" : ""}`}
    >
      <div className="rider-nav-icon">
        <Icon
          size={20}
          strokeWidth={active ? 2.5 : 2}
          className={active ? "text-[#111827]" : "text-[#9CA3AF]"}
        />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-sm bg-[#FF453A] text-[8px] font-bold text-white px-1">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <span
        className={`text-[11px] font-bold tracking-wide ${
          active ? "text-[#111827]" : "text-[#9CA3AF]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
