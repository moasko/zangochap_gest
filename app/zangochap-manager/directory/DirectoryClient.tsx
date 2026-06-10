"use client";

import React, { useState, useMemo } from "react";
import { TableCard, EmptyState } from "@/components/UI";
import { Phone, Search, User as UserIcon, Shield, Briefcase, Truck, Package, Hammer, Copy, Mail, Check, X, PauseCircle } from "lucide-react";
import { ROLE_LABELS, getInitials } from "@/lib/constants";
import { useToast } from "@/components/Toast";

interface DirectoryUser {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  serviceLabel: string | null;
  role: string;
  email: string;
  isPaused?: boolean;
  pausedAt?: string | null;
  pauseReason?: string | null;
}

function formatPauseDuration(value?: string | null) {
  if (!value) return "depuis peu";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h${remainingMinutes ? ` ${remainingMinutes}min` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days}j`;
}

export default function DirectoryClient({ users, canViewPauses = false }: { users: DirectoryUser[]; canViewPauses?: boolean }) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const { showToast } = useToast();

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { all: users.length };
    users.forEach((u) => {
      const r = u.role.toLowerCase();
      counts[r] = (counts[r] || 0) + 1;
    });
    return counts;
  }, [users]);

  const activeTabs = useMemo(() => {
    const tabs = [
      { key: "all", label: "Tous" },
      { key: "admin", label: "Admins" },
      { key: "commercial", label: "Commerciaux" },
      { key: "livreur", label: "Livreurs" },
      { key: "packing", label: "Emballage" },
      { key: "collection", label: "Collecte" },
      { key: "stock", label: "Stock" },
    ];
    return tabs.filter((t) => t.key === "all" || (roleCounts[t.key] && roleCounts[t.key] > 0));
  }, [roleCounts]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        (u.phone || "").includes(search) ||
        (u.phone2 || "").includes(search) ||
        ROLE_LABELS[u.role.toLowerCase()]?.toLowerCase().includes(search.toLowerCase());

      const matchesRole = roleFilter === "all" || u.role.toLowerCase() === roleFilter.toLowerCase();

      return matchesSearch && matchesRole;
    });
  }, [users, search, roleFilter]);

  const getRoleIcon = (role: string) => {
    switch (role.toUpperCase()) {
      case "ADMIN":
        return <Shield size={12} />;
      case "COMMERCIAL":
        return <Briefcase size={12} />;
      case "LIVREUR":
        return <Truck size={12} />;
      case "PACKING":
        return <Package size={12} />;
      case "COLLECTION":
        return <Hammer size={12} />;
      default:
        return <UserIcon size={12} />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role.toUpperCase()) {
      case "ADMIN":
        return "var(--red)";
      case "COMMERCIAL":
        return "var(--blue)";
      case "LIVREUR":
        return "var(--green)";
      case "PACKING":
        return "var(--amber)";
      case "COLLECTION":
        return "#8B5CF6";
      default:
        return "var(--brown-soft)";
    }
  };

  const getAvatarStyles = (role: string) => {
    const r = role.toUpperCase();
    switch (r) {
      case "ADMIN":
        return { backgroundColor: "var(--red-soft)", color: "var(--red)" };
      case "COMMERCIAL":
        return { backgroundColor: "var(--blue-soft)", color: "var(--blue)" };
      case "LIVREUR":
        return { backgroundColor: "var(--green-soft)", color: "var(--green)" };
      case "PACKING":
        return { backgroundColor: "var(--amber-soft)", color: "var(--amber)" };
      case "COLLECTION":
        return { backgroundColor: "#F3E5F5", color: "#4A148C" };
      default:
        return { backgroundColor: "var(--cream-2)", color: "var(--brown)" };
    }
  };

  const handleCopy = (text: string, label: string, uniqueId: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(uniqueId);
    showToast(`${label} copié !`, "success");
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="px-5 py-4 animate-fade-in">
      <div className="mb-4">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Barre de recherche */}
          <div className="relative w-full">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brown-soft)] opacity-60" />
            <input
              type="text"
              placeholder="Rechercher un membre de l'équipe..."
              className="w-full pl-10 pr-10 py-2.5 border border-[var(--line)] rounded-md text-sm font-medium bg-white focus:outline-none focus:border-[var(--orange)] shadow-none transition-all duration-150"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-[var(--line)] hover:bg-[var(--line-2)] border-none w-5 h-5 rounded-full flex items-center justify-center cursor-pointer text-[var(--brown-soft)] transition-colors"
                aria-label="Effacer"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Filtres de Rôles (Chips) */}
          <div className="filters-bar" style={{ margin: 0, padding: "6px 8px" }}>
            {activeTabs.map((tab) => (
              <button
                key={tab.key}
                className={`filter-chip ${roleFilter === tab.key ? "active" : ""}`}
                onClick={() => setRoleFilter(tab.key)}
                style={{ padding: "4px 10px", fontSize: 11 }}
              >
                {tab.label}
                <span className="chip-count" style={{ marginLeft: 4 }}>{roleCounts[tab.key] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <TableCard
        title="Répertoire d'équipe"
        meta={`${filteredUsers.length} membre(s)`}
      >
        {filteredUsers.length === 0 ? (
          <EmptyState
            icon="👤"
            title="Aucun membre trouvé"
            description="Essayez d'ajuster vos critères de recherche ou vos filtres."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 py-1">
            {filteredUsers.map((u) => {
              const phone1CopyId = `${u.id}-phone1`;
              const phone2CopyId = `${u.id}-phone2`;
              const emailCopyId = `${u.id}-email`;

              return (
                <div key={u.id} className="group flex flex-col gap-3 bg-white border border-[var(--line)] rounded-md p-4 relative transition-all duration-200 hover:border-[var(--line-2)] hover:bg-[#FAF6F1]/40 shadow-none">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-md flex items-center justify-center text-sm font-bold shrink-0 border border-black/5"
                      style={getAvatarStyles(u.role)}
                    >
                      {getInitials(u.name)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[var(--ink)] truncate mb-0.5 group-hover:text-[var(--orange)] transition-colors duration-150">{u.name}</div>
                      <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-[3px] border border-[var(--line)] bg-white/70" style={{ color: getRoleColor(u.role) }}>
                        {getRoleIcon(u.role)}
                        <span>
                          {ROLE_LABELS[u.role.toLowerCase()] || u.role}
                        </span>
                      </div>
                      {canViewPauses && u.role.toUpperCase() === "COMMERCIAL" && u.isPaused && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-[3px] border border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]" title={u.pauseReason || "Commercial en pause"}>
                          <PauseCircle size={11} />
                          <span>Pause {formatPauseDuration(u.pausedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {canViewPauses && u.role.toUpperCase() === "COMMERCIAL" && u.isPaused && u.pauseReason && (
                      <div className="text-[11px] font-semibold text-[#9A3412] bg-[#FFF7ED] border border-[#FED7AA] rounded-sm px-2 py-1">
                        Motif pause: {u.pauseReason}
                      </div>
                    )}
                    {/* Principal Phone */}
                    <div className="flex items-center gap-1.5 w-full">
                      {u.phone ? (
                        <>
                          <a href={`tel:${u.phone}`} className="flex items-center gap-2 p-1.5 rounded-sm bg-[var(--cream)] border border-transparent hover:bg-[var(--cream-2)] hover:border-[var(--line)] transition-all duration-150 flex-1 min-w-0">
                            <div className="w-6 h-6 rounded-[3px] bg-white text-[var(--brown-soft)] flex items-center justify-center border border-[var(--line)] shrink-0">
                              <Phone size={11} />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="text-xs font-bold text-[var(--ink)] truncate">{u.phone}</div>
                              <div className="text-[8px] text-[var(--brown-soft)] uppercase font-semibold tracking-wider">Principal</div>
                            </div>
                          </a>
                          <button
                            className="w-7 h-7 rounded-sm border border-[var(--line)] bg-white hover:bg-[var(--orange-soft)] hover:border-[var(--orange)] text-[var(--brown-soft)] hover:text-[var(--orange)] flex items-center justify-center cursor-pointer transition-colors duration-150 active:scale-95 shrink-0"
                            onClick={() => handleCopy(u.phone || "", "Numéro principal", phone1CopyId)}
                            title="Copier le numéro"
                          >
                            {copiedId === phone1CopyId ? <Check size={12} style={{ color: "var(--green)" }} /> : <Copy size={12} />}
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 p-1.5 rounded-sm bg-neutral-50 border border-neutral-200 cursor-not-allowed opacity-60 flex-1 min-w-0">
                          <div className="w-6 h-6 rounded-[3px] bg-white text-[var(--brown-soft)] flex items-center justify-center border border-[var(--line)] shrink-0">
                            <Phone size={11} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="text-xs font-bold text-[var(--ink)] truncate">Aucun numéro</div>
                            <div className="text-[8px] text-[var(--brown-soft)] uppercase font-semibold tracking-wider">Principal</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Secondary Phone / Service */}
                    {u.phone2 && (
                      <div className="flex items-center gap-1.5 w-full">
                        <a href={`tel:${u.phone2}`} className="flex items-center gap-2 p-1.5 rounded-sm bg-[var(--cream)] border border-transparent hover:bg-[var(--cream-2)] hover:border-[var(--line)] transition-all duration-150 flex-1 min-w-0">
                          <div className="w-6 h-6 rounded-[3px] bg-[var(--orange-soft)] text-[var(--orange)] flex items-center justify-center border border-[var(--line)] shrink-0">
                            <Phone size={11} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="text-xs font-bold text-[var(--ink)] truncate">{u.phone2}</div>
                            <div className="text-[8px] text-[var(--brown-soft)] uppercase font-semibold tracking-wider">
                              {u.serviceLabel ? `Service : ${u.serviceLabel}` : "Secondaire"}
                            </div>
                          </div>
                        </a>
                        <button
                          className="w-7 h-7 rounded-sm border border-[var(--line)] bg-white hover:bg-[var(--orange-soft)] hover:border-[var(--orange)] text-[var(--brown-soft)] hover:text-[var(--orange)] flex items-center justify-center cursor-pointer transition-colors duration-150 active:scale-95 shrink-0"
                          onClick={() => handleCopy(u.phone2 || "", "Numéro secondaire", phone2CopyId)}
                          title="Copier le numéro secondaire"
                        >
                          {copiedId === phone2CopyId ? <Check size={12} style={{ color: "var(--green)" }} /> : <Copy size={12} />}
                        </button>
                      </div>
                    )}

                    {!u.phone2 && u.serviceLabel && (
                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--brown-soft)] bg-[var(--cream-2)] px-2 py-1 rounded-sm font-semibold border border-dashed border-[var(--line-2)]">
                        <Briefcase size={10} />
                        <span>Service : {u.serviceLabel}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-auto pt-2.5 border-t border-[var(--line)] flex items-center justify-between gap-1.5">
                    <a href={`mailto:${u.email}`} className="flex items-center gap-1.5 no-underline text-[var(--brown-soft)] hover:text-[var(--orange)] text-xs font-medium min-w-0 transition-colors duration-150" title="Envoyer un e-mail">
                      <Mail size={12} className="text-[var(--brown-soft)] group-hover:text-[var(--orange)] transition-colors duration-150" />
                      <span className="truncate">{u.email}</span>
                    </a>
                    <button
                      className="w-6 h-6 rounded-[3px] border border-[var(--line)] bg-white hover:bg-[var(--orange-soft)] hover:border-[var(--orange)] text-[var(--brown-soft)] hover:text-[var(--orange)] flex items-center justify-center cursor-pointer transition-colors duration-150 active:scale-95 shrink-0"
                      onClick={() => handleCopy(u.email, "E-mail", emailCopyId)}
                      title="Copier l'adresse e-mail"
                    >
                      {copiedId === emailCopyId ? <Check size={11} style={{ color: "var(--green)" }} /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </TableCard>
    </div>
  );
}
