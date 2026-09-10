"use client";

import React from "react";
import { LogOut, Shield, User } from "lucide-react";
import { motion } from "framer-motion";

interface UserProps {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export function ProfileView({ user, logout }: { user: UserProps; logout: () => void }) {
  const roleLabel = user.role?.toUpperCase() === "LIVREUR" ? "Livreur" : (user.role || "Compte equipe");

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 py-2 pb-10">
      <h2 className="px-1 text-[20px] font-black text-[#111827]">Mon compte</h2>

      <section className="flex items-center gap-4 rounded-md border border-[#F3F4F6] bg-white p-5 shadow-sm">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-[#334155] text-xl font-black text-white">
          {user.name?.[0]?.toUpperCase() || <User size={22} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="mb-0.5 truncate text-[16px] font-black text-[#111827]">{user.name}</h3>
          <p className="truncate text-[12px] font-bold uppercase tracking-wider text-[#9CA3AF]">{user.email}</p>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-[10px] font-black uppercase text-[#475569]">
            <Shield size={11} />
            {roleLabel}
          </span>
        </div>
      </section>

      <p className="rounded-md border border-[#E5E7EB] bg-white p-4 text-[12px] font-semibold leading-relaxed text-[#64748B] shadow-sm">
        Les performances et les notes seront affichees ici lorsqu&apos;elles seront calculees depuis les livraisons enregistrees.
      </p>

      <button type="button" onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-4 py-4 text-[14px] font-black text-[#B91C1C] active:scale-[0.99]">
        <LogOut size={17} />
        Deconnexion
      </button>
    </motion.div>
  );
}
