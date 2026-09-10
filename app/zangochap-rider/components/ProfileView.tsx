"use client";

import { useState } from "react";
import { LogOut, ShieldCheck, Mail, MessageCircle, ChevronRight, Package, Wallet, History, BookOpen } from "lucide-react";
import { openTeamChat } from "@/components/GlobalChatAccess";
import { RiderStats } from "../types";

interface UserProps {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export function ProfileView({ user, stats, navigate, logout, gpsSettingsRef }: {
  user: UserProps;
  stats: RiderStats;
  navigate: (tab: "missions" | "history" | "wallet") => void;
  logout: () => void;
  gpsSettingsRef?: (element: HTMLDivElement | null) => void;
}) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join("").toUpperCase();
  const role = ({ LIVREUR: "Livreur", ADMIN: "Administrateur", DEVELOPER: "Développeur" } as Record<string, string>)[user.role?.toUpperCase() || ""] || "Équipe";

  return <section className="space-y-3">
    <h2 className="text-xl font-bold text-slate-900">Mon profil</h2>
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-orange-50 text-lg font-extrabold text-orange-700">{initials || "Z"}</div>
        <div className="min-w-0">
          <h3 className="break-words text-lg font-extrabold text-slate-900">{user.name}</h3>
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><ShieldCheck size={13} />{role}</span>
        </div>
      </div>
      <div className="mt-3 flex items-start gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600"><Mail size={15} className="mt-0.5 shrink-0" /><span className="break-all">{user.email}</span></div>
    </div>
    {user.role?.toUpperCase() === "LIVREUR" && <div ref={gpsSettingsRef} />}
    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => navigate("missions")} className="rounded-lg border border-slate-200 bg-white p-3 text-left"><span className="text-xs text-slate-500">Missions à traiter</span><strong className="mt-1 block text-xl text-slate-900">{stats.count}</strong></button>
      <button onClick={() => navigate("history")} className="rounded-lg border border-slate-200 bg-white p-3 text-left"><span className="text-xs text-slate-500">Livrées aujourd’hui</span><strong className="mt-1 block text-xl text-slate-900">{stats.deliveredToday}</strong></button>
    </div>
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white divide-y divide-slate-100" aria-label="Accès rapides">
      {[
        { label: "Mes missions", helper: "Commandes et tournée", icon: Package, action: () => navigate("missions") },
        { label: "Ma caisse", helper: "Encaissements et règlements", icon: Wallet, action: () => navigate("wallet") },
        { label: "Mon historique", helper: "Retrouver une livraison", icon: History, action: () => navigate("history") },
        { label: "Contacter le bureau", helper: "Ouvrir la messagerie de l’équipe", icon: MessageCircle, action: openTeamChat },
      ].map(({ label, helper, icon: Icon, action }) => <button key={label} onClick={action} className="flex min-h-14 w-full items-center gap-3 p-3 text-left active:bg-slate-50">
        <Icon size={18} className="shrink-0 text-slate-500" /><span className="flex-1"><strong className="block text-sm text-slate-900">{label}</strong><span className="block text-xs text-slate-500">{helper}</span></span><ChevronRight size={16} className="text-slate-400" />
      </button>)}
    </section>
    <details className="rounded-lg border border-slate-200 bg-white px-3">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 text-sm font-bold text-slate-700"><BookOpen size={17} />Guide de tournée</summary>
      <ol className="space-y-2 pb-3 text-sm leading-relaxed text-slate-600">
        <li><strong>1. Préparez.</strong> Retrouvez vos missions par commune et vérifiez les retards.</li>
        <li><strong>2. Contactez.</strong> Appelez le client depuis sa commande ou alertez le bureau.</li>
        <li><strong>3. Livrez.</strong> Vérifiez les articles et saisissez le montant réellement reçu. Utilisez le mode partiel si nécessaire.</li>
        <li><strong>4. Signalez.</strong> Motivez les retours et choisissez une nouvelle date en cas de report.</li>
        <li><strong>5. Faites le point.</strong> Vérifiez votre caisse avec le bureau.</li>
      </ol>
    </details>
    <details className="rounded-lg border border-slate-200 bg-white px-3">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-bold text-slate-700">Besoin de corriger une information ?</summary>
      <p className="pb-3 text-sm leading-relaxed text-slate-600">Pour modifier vos coordonnées ou corriger une erreur de livraison, contactez le bureau. Sans réseau, attendez la reconnexion avant de valider vos actions.</p>
      <button onClick={openTeamChat} className="mb-3 min-h-11 text-sm font-bold text-orange-700">Ouvrir la messagerie</button>
    </details>
    {confirmLogout ? <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-sm font-semibold text-red-900">Se déconnecter de ce compte ?</p>
      <div className="mt-2 flex gap-2"><button onClick={() => setConfirmLogout(false)} className="min-h-11 flex-1 rounded-md border border-red-200 bg-white text-sm font-semibold">Annuler</button><button onClick={logout} className="min-h-11 flex-1 rounded-md bg-red-700 text-sm font-bold text-white">Se déconnecter</button></div>
    </div> : <button onClick={() => setConfirmLogout(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-white text-sm font-bold text-red-700"><LogOut size={17} />Déconnexion</button>}
  </section>;
}
