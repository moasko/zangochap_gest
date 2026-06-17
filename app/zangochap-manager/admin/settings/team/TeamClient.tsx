"use client";

import React, { useState, useTransition, useMemo } from "react";
import { TableCard, StatCard, EmptyState, DetailCard, StatusBadge } from "@/components/UI";
import Modal from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { createAccount, updateAccount, deleteAccount } from "@/modules/auth/actions";
import { ROLE_LABELS, getInitials } from "@/lib/constants";
import { useRouter } from "next/navigation";
import "./team-client.css";
import {
  Plus, Edit3, Trash2, Mail, Phone, Shield,
  ShoppingBag, Package, Truck, Box, User,
  MoreVertical, Search, Filter, PauseCircle, Clock,
  X, Landmark
} from "lucide-react";

const ROLE_ICONS: Record<string, React.ReactNode> = {
  developer: <Shield size={18} />,
  comptable: <Landmark size={18} />,
  admin: <Shield size={18} />,
  commercial: <ShoppingBag size={18} />,
  packing: <Package size={18} />,
  collection: <Truck size={18} />,
  stock: <Box size={18} />,
  livreur: <Truck size={18} />,
};

const ROLE_COLORS: Record<string, string> = {
  developer: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
  comptable: 'linear-gradient(135deg, #0F766E 0%, #134E4A 100%)',
  admin: 'linear-gradient(135deg, #4F46E5 0%, #3730A3 100%)',
  commercial: 'linear-gradient(135deg, #D4541C 0%, #A34015 100%)',
  packing: 'linear-gradient(135deg, #059669 0%, #065F46 100%)',
  collection: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
  stock: 'linear-gradient(135deg, #2563EB 0%, #1E40AF 100%)',
  livreur: 'linear-gradient(135deg, #D97706 0%, #92400E 100%)',
};

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

export default function TeamClient({ accounts, currentUser }: { accounts: any[]; currentUser: any }) {
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { showToast } = useToast();
  const router = useRouter();

  const availableRoles = useMemo(() => {
    return Object.entries(ROLE_LABELS).filter(([role]) => {
      if (currentUser?.role === "admin" && role === "developer") {
        return false;
      }
      return true;
    });
  }, [currentUser]);

  const byRole = useMemo(() => {
    const map: Record<string, any[]> = {};
    accounts.forEach(a => {
      const role = a.role.toLowerCase();
      if (!map[role]) map[role] = [];
      map[role].push(a);
    });
    return map;
  }, [accounts]);

  const pausedCommercials = useMemo(() => {
    return accounts.filter((account) => account.role?.toLowerCase() === "commercial" && account.isPaused);
  }, [accounts]);

  const filteredRoles = useMemo(() => {
    return Object.entries(ROLE_LABELS)
      .filter(([role]) => {
        if (currentUser?.role === "admin" && role === "developer") {
          return false;
        }
        return true;
      })
      .filter(([role]) => {
        const users = byRole[role] || [];
        return users.some(u =>
          u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.email.toLowerCase().includes(searchTerm.toLowerCase())
        );
      });
  }, [byRole, searchTerm, currentUser]);

  const handleDelete = (email: string) => {
    if (!confirm(`Supprimer définitivement le compte de ${email} ?`)) return;
    deleteAccount(email).then(() => {
      showToast('Compte supprimé ✓', 'success');
      router.refresh();
    });
  };

  return (
    <div className="content animate-fade-in">
      {/* HEADER STATS */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <StatCard
          label="Total Équipe"
          value={accounts.length}
          icon={<User size={20} />}
          accent
        />
        <StatCard
          label="Administrateurs"
          value={(byRole['admin'] || []).length}
          icon={<Shield size={20} />}
          color="var(--blue)"
        />
        <StatCard
          label="Terrain"
          value={(byRole['commercial'] || []).length + (byRole['livreur'] || []).length}
          icon={<Truck size={20} />}
          color="var(--orange)"
        />
        <StatCard
          label="Commerciaux en pause"
          value={pausedCommercials.length}
          icon={<PauseCircle size={20} />}
          color="#C2410C"
        />
        <StatCard
          label="Logistique"
          value={(byRole['packing'] || []).length + (byRole['collection'] || []).length}
          icon={<Package size={20} />}
          color="var(--green)"
        />
      </div>

      {/* SEARCH & ACTION */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--brown-soft)' }} />
          <input
            type="text"
            className="field-input"
            placeholder="Rechercher par nom, email, rôle..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ paddingLeft: 40, borderRadius: 12, height: 44, fontSize: 14, fontWeight: 500 }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: '#DEE2E6', border: 'none', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--brown-soft)' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button className="btn-orange" onClick={() => setShowNew(true)} style={{ height: 44 }}>
          <Plus size={16} /> Nouveau membre
        </button>
      </div>

      {/* TEAM SECTIONS BY ROLE */}
      <div className="team-sections">
        {filteredRoles.length === 0 ? (
          <EmptyState icon="👥" title="Aucun membre trouvé" description="Essayez une autre recherche." />
        ) : (
          filteredRoles.map(([role, label]) => {
            const roleUsers = (byRole[role] || []).filter(a =>
              a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
              a.email.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (roleUsers.length === 0) return null;

            return (
              <div key={role} className="role-section">
                <div className="role-header-premium">
                  <div className="role-info-pill" style={{ background: ROLE_COLORS[role] }}>
                    {ROLE_ICONS[role]}
                    <span>{label}</span>
                  </div>
                  <div className="role-meta-badge">{roleUsers.length} membres</div>
                </div>

                <div className="team-grid">
                  {roleUsers.map(member => (
                    <div key={member.id} className="member-card">
                      <div className="member-card-inner">
                        <div className="member-avatar" style={{ background: ROLE_COLORS[role] }}>
                          {member.initials || getInitials(member.name)}
                        </div>

                        <div className="member-info">
                          <div className="member-name">{member.name}</div>
                          <div className="member-email">
                            <Mail size={12} />
                            <span>{member.email}</span>
                          </div>
                          {member.phone && (
                            <div className="member-phone">
                              <Phone size={12} />
                              <span>{member.phone}</span>
                            </div>
                          )}
                          {role === "commercial" && member.isPaused && (
                            <div className="member-phone" style={{ color: "#C2410C", background: "#FFF7ED", borderColor: "#FED7AA" }}>
                              <Clock size={12} />
                              <span>Pause {formatPauseDuration(member.pausedAt)}{member.pauseReason ? ` - ${member.pauseReason}` : ""}</span>
                            </div>
                          )}
                        </div>

                        <div className="member-actions">
                          <button className="action-btn-circle" onClick={() => setEditing(member)} title="Modifier">
                            <Edit3 size={14} />
                          </button>
                          {member.email !== currentUser.email && (
                            <button
                              className="action-btn-circle delete"
                              onClick={() => handleDelete(member.email)}
                              title="Supprimer"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MODALS */}
      {showNew && <AccountModal onClose={() => setShowNew(false)} />}
      {editing && <AccountModal account={editing} onClose={() => setEditing(null)} />}

      
    </div>
  );

  function AccountModal({ account, onClose }: { account?: any; onClose: () => void }) {
    const [name, setName] = useState(account?.name || '');
    const [email, setEmail] = useState(account?.email || '');
    const [phone, setPhone] = useState(account?.phone || '');
    const [phone2, setPhone2] = useState(account?.phone2 || '');
    const [serviceLabel, setServiceLabel] = useState(account?.serviceLabel || '');
    const [role, setRole] = useState(account?.role?.toLowerCase() || '');
    const [password, setPassword] = useState('');
    const [isPending, startTransition] = useTransition();

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      startTransition(async () => {
        try {
          if (account) {
            await updateAccount(account.email, { name, email, phone, phone2, serviceLabel, role, password: password || undefined });
            showToast('Compte mis à jour ✓', 'success');
          } else {
            if (!password) { showToast('Mot de passe requis', 'error'); return; }
            const result = await createAccount({ name, email, phone, phone2, serviceLabel, password, role });
            if (!result.success) { showToast(result.error || 'Erreur', 'error'); return; }
            showToast('Nouveau membre ajouté ✓', 'success');
          }
          router.refresh();
          onClose();
        } catch (e: any) {
          showToast(e.message || 'Erreur', 'error');
        }
      });
    };

    return (
      <Modal
        isOpen={true}
        onClose={onClose}
        title={account ? 'Modifier le membre' : 'Ajouter un membre'}
        footer={
          <>
            <button className="btn-secondary" onClick={onClose}>Annuler</button>
            <button
              className="btn-orange"
              onClick={() => (document.getElementById('accForm') as HTMLFormElement)?.requestSubmit()}
              disabled={isPending}
            >
              {isPending ? 'Enregistrement...' : account ? 'Enregistrer' : 'Ajouter au hub'}
            </button>
          </>
        }
      >
        <form id="accForm" onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-row span-2">
              <label className="field-label">Nom complet *</label>
              <input className="field-input" value={name} onChange={e => setName(e.target.value)} required placeholder="Ex. Marc Kouassi" />
            </div>
            <div className="form-row">
              <label className="field-label">Email professionnel *</label>
              <input className="field-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="nom@zangochap.ci" />
            </div>
            <div className="form-row">
              <label className="field-label">Rôle au sein de l'équipe *</label>
              <select className="field-input" value={role} onChange={e => setRole(e.target.value)} required>
                <option value="">Sélectionner un rôle...</option>
                {availableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label className="field-label">Numéro WhatsApp</label>
              <input className="field-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="07 00 00 00 00" />
            </div>
            <div className="form-row">
              <label className="field-label">Second numéro / Service</label>
              <input className="field-input" value={phone2} onChange={e => setPhone2(e.target.value)} placeholder="01 00 00 00 00" />
            </div>
            <div className="form-row span-2">
              <label className="field-label">Libellé du service (si applicable)</label>
              <input className="field-input" value={serviceLabel} onChange={e => setServiceLabel(e.target.value)} placeholder="Ex. Service Client, Support Tech..." />
            </div>
            <div className="form-row span-2">
              <label className="field-label">{account ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe temporaire *'}</label>
              <input className="field-input" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••" minLength={account ? 0 : 4} required={!account} />
              <p style={{ fontSize: 11, color: 'var(--brown-soft)', marginTop: 4 }}>
                {account ? 'Laissez vide pour conserver le mot de passe actuel.' : 'Le membre pourra le changer lors de sa première connexion.'}
              </p>
            </div>
          </div>
        </form>
      </Modal>
    );
  }
}
