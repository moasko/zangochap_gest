"use client";

import React, { useState, useTransition, useMemo, useCallback, useEffect } from "react";
import { 
  Database, 
  Activity, 
  Cpu, 
  Wrench, 
  Sparkles, 
  RefreshCw, 
  Trash2, 
  Terminal, 
  Search, 
  FileText, 
  CheckCircle2, 
  AlertTriangle,
  Play,
  Server,
  Layers,
  ChevronRight,
  Download,
  ShieldCheck,
  Users,
  Eraser,
  Zap,
  Package,
  Tag,
  Calendar,
  X,
  Loader2,
  Cloud,
  UploadCloud,
  HardDrive,
  History
} from "lucide-react";
import { formatPrice } from "@/lib/constants";
import { useToast } from "@/components/Toast";
import { TableCard } from "@/components/UI";
import { 
  runStockSyncAction, 
  clearSystemCacheAction, 
  simulateTestOrderAction,
  recalcCustomerStatsAction,
  dbIntegrityCheckAction,
  cleanTestOrdersAction,
  deepCachePurgeAction,
  auditCatalogAction,
  promoHealthCheckAction,
  exportDataAction,
  previewStockSyncAction,
  previewCleanTestOrdersAction,
  previewCustomerStatsAction
} from "@/modules/developer/actions";
import {
  createSystemBackupAction,
  listSystemBackupsAction,
  importSystemBackupAction,
  deleteSystemBackupAction,
  uploadBackupToCloudAction,
  simulateRestoreBackupAction,
  downloadBackupAction,
  restoreSystemBackupAction
} from "@/modules/developer/backup-actions";

interface DeveloperConsoleClientProps {
  sysInfo: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpus: number;
    uptime: string;
    rss: string;
    heapTotal: string;
    heapUsed: string;
  };
  dbMetrics: {
    orders: number;
    products: number;
    variants: number;
    users: number;
    promos: number;
    warehouses: number;
    stockMovements: number;
    settlements: number;
    categories: number;
  };
  stockMovements: any[];
  orderLogs: any[];
  developerAuditLogs: any[];
}

export default function DeveloperConsoleClient({
  sysInfo,
  dbMetrics,
  stockMovements: initialStockMovements,
  orderLogs: initialOrderLogs,
  developerAuditLogs: initialDeveloperAuditLogs
}: DeveloperConsoleClientProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<"dashboard" | "tools" | "logs" | "export">("dashboard");
  const [isPending, startTransition] = useTransition();

  // Search filter for logs
  const [logSearch, setLogSearch] = useState("");
  const [logTypeFilter, setLogTypeFilter] = useState<"all" | "stock" | "orders" | "developer">("all");

  // Export state
  const [exportEntity, setExportEntity] = useState<"orders" | "products" | "customers" | "stock_movements" | "promos" | "all">("orders");
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const [lastExportInfo, setLastExportInfo] = useState<string | null>(null);

  // Backup states
  const [backups, setBackups] = useState<any[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupStoreCloud, setBackupStoreCloud] = useState(false);
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupImporting, setBackupImporting] = useState(false);
  const [backupImportInfo, setBackupImportInfo] = useState<string | null>(null);
  const [cloudActionLoading, setCloudActionLoading] = useState<string | null>(null);
  const [cloudLogs, setCloudLogs] = useState<string[]>([]);

  // Modal system for action pre-confirmation & interactive results
  const [modal, setModal] = useState<{
    isOpen: boolean;
    actionId: string;
    title: string;
    description: string;
    status: "scanning" | "idle" | "executing" | "done" | "error";
    data?: any;
    error?: string;
  } | null>(null);

  const fetchBackups = useCallback(async () => {
    setBackupsLoading(true);
    try {
      const res = await listSystemBackupsAction();
      if (res.success && res.backups) {
        setBackups(res.backups);
      } else {
        showToast(res.error || "Impossible de charger les sauvegardes.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Erreur de chargement des sauvegardes.", "error");
    } finally {
      setBackupsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (activeTab === "export") {
      fetchBackups();
    }
  }, [activeTab, fetchBackups]);

  const handleCreateBackup = async () => {
    setBackupCreating(true);
    setCloudLogs([]);
    try {
      const res = await createSystemBackupAction(backupStoreCloud);
      if (res.success) {
        showToast(res.message || "Sauvegarde complète créée avec succès.", "success");
        if (res.data?.externalLogs && res.data.externalLogs.length > 0) {
          setCloudLogs(res.data.externalLogs);
        }
        fetchBackups();
      } else {
        showToast(res.error || "Impossible de créer la sauvegarde.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Erreur lors de la sauvegarde.", "error");
    } finally {
      setBackupCreating(false);
    }
  };

  const handleImportBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      showToast("Selectionnez un fichier de backup JSON.", "error");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      showToast("Fichier trop volumineux. Limite actuelle: 25 Mo.", "error");
      return;
    }

    setBackupImporting(true);
    setBackupImportInfo(null);
    try {
      const fileContent = await file.text();
      const res = await importSystemBackupAction({
        originalFileName: file.name,
        fileContent,
      });

      if (res.success) {
        const importedName = res.data?.fileName || file.name;
        showToast(res.message || "Backup importe dans l'historique.", "success");
        setBackupImportInfo(`${importedName} importe dans l'historique. Aucune restauration DB executee.`);
        fetchBackups();
      } else {
        showToast(res.error || "Impossible d'importer ce backup.", "error");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'import du backup.";
      showToast(message, "error");
    } finally {
      setBackupImporting(false);
    }
  };

  const handleDownloadBackup = async (fileName: string) => {
    try {
      const res = await downloadBackupAction(fileName);
      if (!res.success || !res.fileContent) {
        showToast(res.error || "Fichier introuvable.", "error");
        return;
      }
      const blob = new Blob([res.fileContent], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("Téléchargement lancé !", "success");
    } catch (err: any) {
      showToast(err.message || "Impossible de télécharger.", "error");
    }
  };

  const handleDeleteBackup = async (fileName: string) => {
    if (!confirm(`Supprimer définitivement la sauvegarde '${fileName}' ?`)) return;
    try {
      const res = await deleteSystemBackupAction(fileName);
      if (res.success) {
        showToast(res.message || "Sauvegarde supprimée avec succès.", "success");
        fetchBackups();
      } else {
        showToast(res.error || "Échec de suppression.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Erreur lors de la suppression.", "error");
    }
  };

  const handleCloudUpload = async (fileName: string) => {
    setCloudActionLoading(fileName);
    setCloudLogs([]);
    try {
      const res = await uploadBackupToCloudAction(fileName);
      if (res.success) {
        showToast(res.message || "Sauvegarde répliquée sur le Cloud avec succès.", "success");
        if (res.logs && res.logs.length > 0) {
          setCloudLogs(res.logs);
        }
        fetchBackups();
      } else {
        showToast(res.error || "Échec du transfert cloud.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Erreur lors du transfert cloud.", "error");
    } finally {
      setCloudActionLoading(null);
    }
  };

  const handleSimulateRestore = async (fileName: string) => {
    setModal({
      isOpen: true,
      actionId: "restore_sim",
      title: `Simulation de Restauration : ${fileName}`,
      description: "Cette simulation inspecte la structure du fichier de sauvegarde et dresse un rapport complet d'intégrité relationnelle.",
      status: "scanning"
    });

    try {
      const res = await simulateRestoreBackupAction(fileName);
      if (res.success && res.data) {
        setModal(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            status: "idle",
            data: res.data
          };
        });
      } else {
        setModal(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            status: "error",
            error: res.error || "Structure de fichier invalide."
          };
        });
      }
    } catch (err: any) {
      setModal(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          status: "error",
          error: err.message || "Erreur système pendant la simulation."
        };
      });
    }
  };

  const handleExport = useCallback(async () => {
    setExportLoading(true);
    setLastExportInfo(null);
    try {
      const res = await exportDataAction({
        entity: exportEntity,
        format: exportFormat,
        dateFrom: exportDateFrom || undefined,
        dateTo: exportDateTo || undefined,
      });
      if (!res.success) {
        showToast(res.error || "Erreur d'exportation.", "error");
        return;
      }
      if (!res.fileContent) {
        showToast(res.message || "Aucune donnée.", "error");
        return;
      }
      // Trigger browser download
      const blob = new Blob([res.fileContent], {
        type: exportFormat === "csv" ? "text/csv;charset=utf-8;" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = res.fileName || `export.${exportFormat}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setLastExportInfo(`${res.rowCount} ligne(s) exportées → ${res.fileName}`);
      showToast(res.message || "Exportation réussie !", "success");
    } catch (e: any) {
      showToast(e.message || "Erreur inattendue.", "error");
    } finally {
      setExportLoading(false);
    }
  }, [exportEntity, exportFormat, exportDateFrom, exportDateTo, showToast]);

  // Filtering logs
  const filteredStockMovements = useMemo(() => {
    return initialStockMovements.filter(m => {
      const productName = m.variant?.product?.name || "";
      const variantDesc = m.variant ? `${m.variant.size} ${m.variant.color}` : "";
      const reason = m.reason || "";
      const by = m.byName || "";
      const search = logSearch.toLowerCase();
      
      return productName.toLowerCase().includes(search) || 
             variantDesc.toLowerCase().includes(search) || 
             reason.toLowerCase().includes(search) || 
             by.toLowerCase().includes(search);
    });
  }, [initialStockMovements, logSearch]);

  const filteredOrderLogs = useMemo(() => {
    return initialOrderLogs.filter(log => {
      const ref = log.orderRef || "";
      const client = log.customerName || "";
      const action = log.action || "";
      const operator = log.by || "";
      const search = logSearch.toLowerCase();

      return ref.toLowerCase().includes(search) ||
             client.toLowerCase().includes(search) ||
             action.toLowerCase().includes(search) ||
             operator.toLowerCase().includes(search);
    });
  }, [initialOrderLogs, logSearch]);

  const filteredDeveloperAuditLogs = useMemo(() => {
    return initialDeveloperAuditLogs.filter(log => {
      const search = logSearch.toLowerCase();
      const details = log.details ? JSON.stringify(log.details) : "";
      return String(log.action || "").toLowerCase().includes(search) ||
             String(log.status || "").toLowerCase().includes(search) ||
             String(log.actorName || "").toLowerCase().includes(search) ||
             String(log.actorEmail || "").toLowerCase().includes(search) ||
             details.toLowerCase().includes(search);
    });
  }, [initialDeveloperAuditLogs, logSearch]);

  const handleOpenAction = useCallback((actionId: string, title: string, description: string) => {
    const needsPreview = ["stock_sync", "clean_test", "customer_stats", "db_check", "catalog_audit", "promo_health"].includes(actionId);
    
    setModal({
      isOpen: true,
      actionId,
      title,
      description,
      status: needsPreview ? "scanning" : "idle"
    });

    if (needsPreview) {
      startTransition(async () => {
        try {
          let res: any;
          if (actionId === "stock_sync") {
            res = await previewStockSyncAction();
          } else if (actionId === "clean_test") {
            res = await previewCleanTestOrdersAction();
          } else if (actionId === "customer_stats") {
            res = await previewCustomerStatsAction();
          } else if (actionId === "db_check") {
            res = await dbIntegrityCheckAction();
          } else if (actionId === "catalog_audit") {
            res = await auditCatalogAction();
          } else if (actionId === "promo_health") {
            res = await promoHealthCheckAction();
          }

          if (res && res.success) {
            setModal(prev => {
              if (!prev || prev.actionId !== actionId) return prev;
              const isAudit = ["db_check", "catalog_audit", "promo_health"].includes(actionId);
              return {
                ...prev,
                status: isAudit ? "done" : "idle",
                data: res.data || res
              };
            });
          } else {
            setModal(prev => {
              if (!prev || prev.actionId !== actionId) return prev;
              return {
                ...prev,
                status: "error",
                error: res?.error || "Impossible de charger les données de prévisualisation."
              };
            });
          }
        } catch (err: any) {
          setModal(prev => {
            if (!prev || prev.actionId !== actionId) return prev;
            return {
              ...prev,
              status: "error",
              error: err.message || "Une erreur est survenue lors de l'appel système."
            };
          });
        }
      });
    }
  }, []);

  const handleConfirmAction = useCallback(() => {
    if (!modal) return;
    const { actionId } = modal;

    setModal(prev => prev ? { ...prev, status: "executing" } : null);

    startTransition(async () => {
      try {
        let res: any;
        if (actionId === "stock_sync") {
          res = await runStockSyncAction();
        } else if (actionId === "order_sim") {
          res = await simulateTestOrderAction();
        } else if (actionId === "cache_purge") {
          res = await clearSystemCacheAction();
        } else if (actionId === "customer_stats") {
          res = await recalcCustomerStatsAction();
        } else if (actionId === "clean_test") {
          res = await cleanTestOrdersAction();
        } else if (actionId === "deep_purge") {
          res = await deepCachePurgeAction();
        } else if (actionId === "restore_sim" && modal.data?.fileName) {
          res = await restoreSystemBackupAction(modal.data.fileName);
        }

        if (res && res.success) {
          setModal(prev => {
            if (!prev || prev.actionId !== actionId) return prev;
            return {
              ...prev,
              status: "done",
              data: res
            };
          });
          showToast(res.message || "Action effectuée avec succès !", "success");
        } else {
          setModal(prev => {
            if (!prev || prev.actionId !== actionId) return prev;
            return {
              ...prev,
              status: "error",
              error: res?.error || "L'exécution a échoué."
            };
          });
          showToast(res?.error || "L'exécution a échoué.", "error");
        }
      } catch (err: any) {
        setModal(prev => {
          if (!prev || prev.actionId !== actionId) return prev;
          return {
            ...prev,
            status: "error",
            error: err.message || "Une erreur est survenue pendant l'opération."
          };
        });
        showToast(err.message || "Une erreur est survenue.", "error");
      }
    });
  }, [modal, showToast]);

  return (
    <div className="px-5 py-4 flex flex-col gap-6 animate-fade-in font-body">
      
      {/* Tab Navigation */}
      <div className="flex border-b border-[var(--line)] gap-8">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`pb-3.5 text-xs font-semibold tracking-wider uppercase bg-none border-none cursor-pointer transition-all flex items-center gap-2 ${
            activeTab === "dashboard"
              ? "text-[var(--orange)] border-b-2 border-[var(--orange)] font-bold"
              : "text-[var(--brown-soft)] opacity-70 hover:opacity-100"
          }`}
        >
          <Activity size={15} /> Tableau de Bord
        </button>
        <button
          onClick={() => setActiveTab("tools")}
          className={`pb-3.5 text-xs font-semibold tracking-wider uppercase bg-none border-none cursor-pointer transition-all flex items-center gap-2 ${
            activeTab === "tools"
              ? "text-[var(--orange)] border-b-2 border-[var(--orange)] font-bold"
              : "text-[var(--brown-soft)] opacity-70 hover:opacity-100"
          }`}
        >
          <Wrench size={15} /> Outils & Actions
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className={`pb-3.5 text-xs font-semibold tracking-wider uppercase bg-none border-none cursor-pointer transition-all flex items-center gap-2 ${
            activeTab === "logs"
              ? "text-[var(--orange)] border-b-2 border-[var(--orange)] font-bold"
              : "text-[var(--brown-soft)] opacity-70 hover:opacity-100"
          }`}
        >
          <Terminal size={15} /> Journaux Système
        </button>
        <button
          onClick={() => setActiveTab("export")}
          className={`pb-3.5 text-xs font-semibold tracking-wider uppercase bg-none border-none cursor-pointer transition-all flex items-center gap-2 ${
            activeTab === "export"
              ? "text-[var(--orange)] border-b-2 border-[var(--orange)] font-bold"
              : "text-[var(--brown-soft)] opacity-70 hover:opacity-100"
          }`}
        >
          <Download size={15} /> Exportation
        </button>
      </div>

      {/* ======================================================== */}
      {/* 📊 TAB 1: DASHBOARD */}
      {/* ======================================================== */}
      {activeTab === "dashboard" && (
        <div className="flex flex-col gap-6 animate-[fadeIn_0.3s_ease]">
          
          {/* System resource metrics */}
          <div>
            <h3 className="text-xs font-extrabold uppercase text-[var(--brown-soft)] mb-3 tracking-wider flex items-center gap-1.5">
              <Cpu size={14} /> Ressources Système
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white border border-[var(--line)] rounded-sm p-4 flex flex-col justify-between min-h-[90px]">
                <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Uptime Serveur</span>
                <span className="text-lg font-bold text-[var(--ink)] mt-1">{sysInfo.uptime}</span>
              </div>
              <div className="bg-white border border-[var(--line)] rounded-sm p-4 flex flex-col justify-between min-h-[90px]">
                <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Heap Mémoire</span>
                <span className="text-lg font-bold text-[var(--ink)] mt-1">{sysInfo.heapUsed} <span className="text-[11px] font-normal text-neutral-400">/ {sysInfo.heapTotal}</span></span>
              </div>
              <div className="bg-white border border-[var(--line)] rounded-sm p-4 flex flex-col justify-between min-h-[90px]">
                <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Mémoire RSS</span>
                <span className="text-lg font-bold text-[var(--ink)] mt-1">{sysInfo.rss}</span>
              </div>
              <div className="bg-white border border-[var(--line)] rounded-sm p-4 flex flex-col justify-between min-h-[90px]">
                <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Plateforme & OS</span>
                <span className="text-sm font-semibold text-[var(--ink)] mt-2 uppercase">{sysInfo.platform} ({sysInfo.arch}) · Node {sysInfo.nodeVersion}</span>
              </div>
            </div>
          </div>

          {/* Database Metrics Grid */}
          <div>
            <h3 className="text-xs font-extrabold uppercase text-[var(--brown-soft)] mb-3 tracking-wider flex items-center gap-1.5">
              <Database size={14} /> Métriques de la Base de Données
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Commandes</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.orders.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Fiches Produits</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.products.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Variantes Stock</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.variants.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Mouvements Stock</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.stockMovements.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Utilisateurs</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.users.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Codes Promos</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.promos.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Règlements</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.settlements.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Catégories</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.categories.toLocaleString()}</span>
              </div>
              <div className="bg-[#FAF9F5] border border-[#E9E5DB] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Entrepôts</span>
                <span className="text-2xl font-bold text-[var(--ink)] mt-1">{dbMetrics.warehouses.toLocaleString()}</span>
              </div>
              <div className="bg-gradient-to-br from-[#1A1614] to-[#3A3330] text-white border border-[#1A1614] rounded-sm p-4 flex flex-col justify-between min-h-[85px]">
                <span className="text-[9px] font-bold text-neutral-300 uppercase tracking-wider">Status Système</span>
                <span className="text-xs font-bold mt-1 flex items-center gap-1.5 text-green-400">
                  <CheckCircle2 size={14} /> PRÊT & ACTIF
                </span>
              </div>
            </div>
          </div>
          
        </div>
      )}

      {/* ======================================================== */}
      {/* 🛠️ TAB 2: TOOLS */}
      {/* ======================================================== */}
      {activeTab === "tools" && (
        <div className="flex flex-col gap-6 animate-[fadeIn_0.3s_ease]">
          
          {/* Row 1: Core ops */}
          <div>
            <h3 className="text-xs font-extrabold uppercase text-[var(--brown-soft)] mb-3 tracking-wider flex items-center gap-1.5">
              <Wrench size={14} /> Opérations Système
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Stock sync */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3">
                    <RefreshCw size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Synchronisation des Stocks</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Recalcul complet des stocks en consolidant les entrées/sorties des variantes enregistrées dans les entrepôts.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("stock_sync", "Synchronisation des Stocks", "Analyse les écarts entre les stocks déclarés en base et les niveaux de stock physiques dans les entrepôts avant d'appliquer une harmonisation.")} className="w-full h-9 bg-[#1A1614] text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-[#333] transition-colors">
                  Prévérifier & Lancer <ChevronRight size={11} />
                </button>
              </div>
              {/* Test order sim */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-orange-50 border border-orange-100 flex items-center justify-center text-[var(--orange)] mb-3">
                    <Sparkles size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Simuler Commande Client</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Simule un achat public complet. Sélectionne un produit publié, crée une commande valide, déduit le stock.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("order_sim", "Simulation de Commande Client", "Cette action simule le parcours complet d'un acheteur sur le site public en commandant un produit disponible aléatoire.")} className="w-full h-9 bg-[var(--orange)] text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-[#d4541c] transition-colors">
                  Configurer & Lancer <ChevronRight size={11} />
                </button>
              </div>
              {/* Cache purge */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 mb-3">
                    <Trash2 size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Purge du Cache Statique</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Revalide les chemins critiques du site (accueil, panier, dashboard) pour forcer la mise à jour du cache de rendu.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("cache_purge", "Purge du Cache Statique", "Revalide immédiatement les routes Next.js d'accueil (/), du panier (/cart) et du tableau de bord manager.")} className="w-full h-9 bg-neutral-800 text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-neutral-900 transition-colors">
                  Confirmer la Purge <ChevronRight size={11} />
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Maintenance & Audits */}
          <div>
            <h3 className="text-xs font-extrabold uppercase text-[var(--brown-soft)] mb-3 tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={14} /> Maintenance & Audits
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* DB Integrity check */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 mb-3">
                    <Database size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Intégrité Base de Données</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Détecte les enregistrements orphelins, commandes sans articles, clients fantômes et doublons téléphone.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("db_check", "Intégrité de la Base de Données", "Exécute un scan d'intégrité relationnelle sur l'ensemble de la base PostgreSQL pour déceler toute anomalie.")} className="w-full h-9 bg-purple-700 text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-purple-800 transition-colors">
                  Lancer l'Analyse <ChevronRight size={11} />
                </button>
              </div>
              {/* Catalog Audit */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 mb-3">
                    <Package size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Audit du Catalogue</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Produits publiés sans image, sans variante, stock négatif, brouillons commandés.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("catalog_audit", "Audit du Catalogue", "Scanne les anomalies de configuration et d'affichage dans le catalogue de produits publiés et les brouillons.")} className="w-full h-9 bg-teal-700 text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-teal-800 transition-colors">
                  Lancer l'Audit <ChevronRight size={11} />
                </button>
              </div>
              {/* Promo Health */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-pink-50 border border-pink-100 flex items-center justify-center text-pink-600 mb-3">
                    <Tag size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Santé Codes Promo</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Codes expirés encore actifs, promos jamais utilisées, portée globale non ciblée.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("promo_health", "Santé des Codes Promo", "Inspecte les dates de validité, l'activation et les règles restrictives associées à chaque coupon.")} className="w-full h-9 bg-pink-700 text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-pink-800 transition-colors">
                  Vérifier les Codes <ChevronRight size={11} />
                </button>
              </div>
            </div>
          </div>

          {/* Row 3: Data actions */}
          <div>
            <h3 className="text-xs font-extrabold uppercase text-[var(--brown-soft)] mb-3 tracking-wider flex items-center gap-1.5">
              <Eraser size={14} /> Actions sur les Données
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Recalculate customer stats */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3">
                    <Users size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Recalcul Stats Clients</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Recalcule totalOrders et totalSpent pour chaque client à partir de ses commandes réelles.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("customer_stats", "Recalcul des Statistiques Clients", "Compare les indicateurs enregistrés sur la fiche client avec le volume réel facturé en base.")} className="w-full h-9 bg-indigo-700 text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-indigo-800 transition-colors">
                  Prévérifier & Recalculer <ChevronRight size={11} />
                </button>
              </div>
              {/* Clean test orders */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-red-50 border border-red-100 flex items-center justify-center text-red-600 mb-3">
                    <Eraser size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Nettoyer Commandes Test</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Supprime définitivement toutes les commandes [TEST] créées par le simulateur développeur.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("clean_test", "Nettoyage des Commandes de Test", "Supprime de la base de données toutes les commandes factices portant le préfixe [TEST] ainsi que leurs articles.")} className="w-full h-9 bg-red-700 text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-red-800 transition-colors">
                  Scanner & Nettoyer <ChevronRight size={11} />
                </button>
              </div>
              {/* Deep cache purge */}
              <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between min-h-[200px]">
                <div>
                  <div className="w-9 h-9 rounded-sm bg-yellow-50 border border-yellow-100 flex items-center justify-center text-yellow-600 mb-3">
                    <Zap size={18} />
                  </div>
                  <h4 className="text-[13px] font-bold text-[var(--ink)] mb-1.5">Purge Profonde (Toutes Routes)</h4>
                  <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                    Revalide les 24 routes de l'application + les fiches produit publiées (max 100). Purge totale.
                  </p>
                </div>
                <button onClick={() => handleOpenAction("deep_purge", "Purge Profonde du Cache Next.js", "Vide le cache HTML statique sur 24 routes applicatives majeures et les fiches produit afin de forcer le rendu dynamique.")} className="w-full h-9 bg-yellow-600 text-white border-none text-[10px] font-bold tracking-[0.1em] uppercase cursor-pointer flex items-center justify-center gap-2 hover:bg-yellow-700 transition-colors">
                  Lancer la Purge Profonde <ChevronRight size={11} />
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ======================================================== */}
      {/* 📋 TAB 3: LOGS */}
      {/* ======================================================== */}
      {activeTab === "logs" && (
        <div className="flex flex-col gap-4 animate-[fadeIn_0.3s_ease]">
          
          {/* Logs Filter bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-[#FAF9F5] p-3.5 border border-[#E9E5DB] rounded-sm">
            <div className="relative w-full sm:max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                placeholder="Rechercher produit, ref, auteur..."
                className="w-full pl-9 pr-4 py-2 border border-[#E1DBD0] bg-white text-xs rounded-none outline-none focus:border-[#1A1614] tracking-wide"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => setLogTypeFilter("all")}
                className={`flex-1 sm:flex-none px-3.5 py-2 text-[10px] font-bold tracking-wider uppercase border cursor-pointer ${
                  logTypeFilter === "all"
                    ? "bg-[#1A1614] text-white border-[#1A1614]"
                    : "bg-white text-neutral-600 border-[#E1DBD0] hover:bg-neutral-50"
                }`}
              >
                Tous
              </button>
              <button
                onClick={() => setLogTypeFilter("stock")}
                className={`flex-1 sm:flex-none px-3.5 py-2 text-[10px] font-bold tracking-wider uppercase border cursor-pointer ${
                  logTypeFilter === "stock"
                    ? "bg-[#1A1614] text-white border-[#1A1614]"
                    : "bg-white text-neutral-600 border-[#E1DBD0] hover:bg-neutral-50"
                }`}
              >
                Mouvements Stock
              </button>
              <button
                onClick={() => setLogTypeFilter("orders")}
                className={`flex-1 sm:flex-none px-3.5 py-2 text-[10px] font-bold tracking-wider uppercase border cursor-pointer ${
                  logTypeFilter === "orders"
                    ? "bg-[#1A1614] text-white border-[#1A1614]"
                    : "bg-white text-neutral-600 border-[#E1DBD0] hover:bg-neutral-50"
                }`}
              >
                Activité Commandes
              </button>
              <button
                onClick={() => setLogTypeFilter("developer")}
                className={`flex-1 sm:flex-none px-3.5 py-2 text-[10px] font-bold tracking-wider uppercase border cursor-pointer ${
                  logTypeFilter === "developer"
                    ? "bg-[#1A1614] text-white border-[#1A1614]"
                    : "bg-white text-neutral-600 border-[#E1DBD0] hover:bg-neutral-50"
                }`}
              >
                Audit Dev
              </button>
            </div>
          </div>
          {/* Render Stock Movement Table */}
          {(logTypeFilter === "all" || logTypeFilter === "developer") && (
            <TableCard
              title="Audit Developpeur"
              meta={`${filteredDeveloperAuditLogs.length} action(s) sensible(s)`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--cream)] text-[var(--brown-soft)]">
                      <th className="p-3 font-semibold">Date</th>
                      <th className="p-3 font-semibold">Action</th>
                      <th className="p-3 font-semibold">Statut</th>
                      <th className="p-3 font-semibold">Auteur</th>
                      <th className="p-3 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeveloperAuditLogs.map((log) => (
                      <tr key={log.id} className="border-b border-[var(--line)] hover:bg-[var(--cream)]/30">
                        <td className="p-3 font-mono text-[10px] text-neutral-500">
                          {new Date(log.createdAt).toLocaleString("fr-FR")}
                        </td>
                        <td className="p-3 font-mono font-bold text-[var(--ink)]">{log.action}</td>
                        <td className="p-3">
                          <span className={`inline-flex px-1.5 py-0.5 rounded-[3px] font-bold text-[9px] uppercase border ${
                            log.status === "success"
                              ? "bg-green-50 text-green-700 border-green-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="p-3 text-neutral-700">{log.actorName || log.actorEmail || "Systeme"}</td>
                        <td className="p-3 text-neutral-500 font-mono text-[10px] max-w-[420px] truncate">
                          {log.details ? JSON.stringify(log.details) : "-"}
                        </td>
                      </tr>
                    ))}
                    {filteredDeveloperAuditLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-neutral-400">
                          Aucune action developpeur journalisee.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TableCard>
          )}

          {/* Render Stock Movement Table */}
          {(logTypeFilter === "all" || logTypeFilter === "stock") && (
            <TableCard 
              title="Journal des Mouvements de Stock" 
              meta={`${filteredStockMovements.length} événement(s) correspondants`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--cream)] text-[var(--brown-soft)]">
                      <th className="p-3 font-semibold">Date</th>
                      <th className="p-3 font-semibold">Produit / Variante</th>
                      <th className="p-3 font-semibold">Type</th>
                      <th className="p-3 font-semibold" style={{ textAlign: "right" }}>Quantité</th>
                      <th className="p-3 font-semibold">Auteur</th>
                      <th className="p-3 font-semibold">Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStockMovements.map((m) => (
                      <tr key={m.id} className="border-b border-[var(--line)] hover:bg-[var(--cream)]/30">
                        <td className="p-3 font-mono text-[10px] text-neutral-500">
                          {new Date(m.createdAt).toLocaleString("fr-FR")}
                        </td>
                        <td className="p-3">
                          <span className="font-bold text-[var(--ink)]">
                            {m.variant?.product?.name || "Produit inconnu"}
                          </span>
                          {m.variant && (
                            <span className="text-neutral-500 ml-1">
                              ({m.variant.size} / {m.variant.color})
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex px-1.5 py-0.5 rounded-[3px] font-bold text-[9px] uppercase border ${
                              m.type === "SALE"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : m.type === "RESTOCK"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                            }`}
                          >
                            {m.type}
                          </span>
                        </td>
                        <td className={`p-3 font-mono font-bold text-right ${m.quantity > 0 ? "text-green-600" : "text-red-600"}`}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </td>
                        <td className="p-3 font-medium text-neutral-700">{m.byName}</td>
                        <td className="p-3 text-neutral-500">{m.reason || "—"}</td>
                      </tr>
                    ))}
                    {filteredStockMovements.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-neutral-400">
                          Aucun mouvement de stock correspondant.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TableCard>
          )}

          {/* Render Order History Logs */}
          {(logTypeFilter === "all" || logTypeFilter === "orders") && (
            <div className="mt-4">
              <TableCard 
                title="Logs d'Activité des Commandes" 
                meta={`${filteredOrderLogs.length} action(s) d'historique`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--cream)] text-[var(--brown-soft)]">
                        <th className="p-3 font-semibold">Date</th>
                        <th className="p-3 font-semibold">Commande Ref</th>
                        <th className="p-3 font-semibold">Client</th>
                        <th className="p-3 font-semibold">Action</th>
                        <th className="p-3 font-semibold">Opérateur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrderLogs.map((log, index) => (
                        <tr key={index} className="border-b border-[var(--line)] hover:bg-[var(--cream)]/30">
                          <td className="p-3 font-mono text-[10px] text-neutral-500">
                            {log.at.toLocaleString("fr-FR")}
                          </td>
                          <td className="p-3 font-mono font-bold text-[var(--orange)]">{log.orderRef}</td>
                          <td className="p-3 text-neutral-700">{log.customerName}</td>
                          <td className="p-3 font-medium text-[var(--ink)]">{log.action}</td>
                          <td className="p-3 text-neutral-500">{log.by}</td>
                        </tr>
                      ))}
                      {filteredOrderLogs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-neutral-400">
                            Aucune activité de commande correspondante dans l'historique.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TableCard>
            </div>
          )}

        </div>
      )}

      {/* ======================================================== */}
      {/* 📦 TAB 4: EXPORT */}
      {/* ======================================================== */}
      {activeTab === "export" && (
        <div className="flex flex-col gap-6 animate-[fadeIn_0.3s_ease]">

          {/* Export config panel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* COLUMN 1: EXPORTATION */}
            <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-extrabold uppercase text-[var(--brown-soft)] mb-5 tracking-wider flex items-center gap-1.5">
                  <Download size={14} /> Exportation de Données
                </h3>

                <div className="flex flex-col gap-4 mb-6">
                  {/* Entity selector */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Type de données</label>
                    <select
                      value={exportEntity}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        setExportEntity(val);
                        if (val === "all") {
                          setExportFormat("json");
                        }
                      }}
                      className="h-10 px-3 border border-[#E1DBD0] bg-white text-xs text-[var(--ink)] outline-none focus:border-[#1A1614] cursor-pointer"
                    >
                      <option value="orders">📦 Commandes</option>
                      <option value="products">🏷️ Produits</option>
                      <option value="customers">👥 Clients</option>
                      <option value="stock_movements">📊 Mouvements de Stock</option>
                      <option value="promos">🎟️ Codes Promo</option>
                      <option value="all">🔥 Export Complet de la Base (JSON)</option>
                    </select>
                  </div>

                  {/* Format selector */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Format</label>
                    <div className="flex h-10 border border-[#E1DBD0]">
                      <button
                        onClick={() => {
                          if (exportEntity !== "all") setExportFormat("csv");
                        }}
                        disabled={exportEntity === "all"}
                        className={`flex-1 text-[11px] font-bold tracking-wider border-none cursor-pointer transition-colors disabled:opacity-40 ${
                          exportFormat === "csv"
                            ? "bg-[#1A1614] text-white"
                            : "bg-white text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => setExportFormat("json")}
                        className={`flex-1 text-[11px] font-bold tracking-wider border-none border-l border-[#E1DBD0] cursor-pointer transition-colors ${
                          exportFormat === "json"
                            ? "bg-[#1A1614] text-white"
                            : "bg-white text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        JSON
                      </button>
                    </div>
                    {exportEntity === "all" && (
                      <span className="text-[9px] text-[var(--orange)] font-bold uppercase tracking-wide">
                        L'export complet est disponible uniquement au format JSON.
                      </span>
                    )}
                  </div>

                  {/* Date range filters */}
                  {exportEntity !== "all" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider flex items-center gap-1">
                          <Calendar size={10} /> Date début
                        </label>
                        <input
                          type="date"
                          value={exportDateFrom}
                          onChange={(e) => setExportDateFrom(e.target.value)}
                          className="h-10 px-3 border border-[#E1DBD0] bg-white text-xs text-[var(--ink)] outline-none focus:border-[#1A1614]"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider flex items-center gap-1">
                          <Calendar size={10} /> Date fin
                        </label>
                        <input
                          type="date"
                          value={exportDateTo}
                          onChange={(e) => setExportDateTo(e.target.value)}
                          className="h-10 px-3 border border-[#E1DBD0] bg-white text-xs text-[var(--ink)] outline-none focus:border-[#1A1614]"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                {/* Export button */}
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleExport}
                    disabled={exportLoading}
                    className="w-full h-11 bg-[var(--orange)] text-white border-none text-[11px] font-bold tracking-[0.12em] uppercase cursor-pointer flex items-center justify-center gap-2.5 hover:bg-[#d4541c] transition-colors disabled:opacity-50"
                  >
                    {exportLoading ? (
                      <><RefreshCw size={13} className="animate-spin" /> Exportation...</>
                    ) : (
                      <><Download size={13} /> Exporter les données</>
                    )}
                  </button>
                </div>

                {/* Last export info */}
                {lastExportInfo && (
                  <div className="mt-4 flex items-center gap-2 text-[10px] text-green-700 bg-green-50 border border-green-200 px-3 py-2">
                    <CheckCircle2 size={13} />
                    <span className="font-semibold truncate">{lastExportInfo}</span>
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN 2: BACKUP MANAGER */}
            <div className="bg-white border border-[var(--line)] rounded-sm p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-extrabold uppercase text-[var(--brown-soft)] mb-5 tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5"><HardDrive size={14} /> Sauvegarde du Système</span>
                  <span className="text-[9px] font-bold text-neutral-400 font-mono">BACKUPS / SIMULATION CLOUD</span>
                </h3>

                <div className="flex flex-col gap-4 mb-4">
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    Créez un point de restauration complet contenant l'ensemble de la base de données.
                    Vous pouvez également répliquer cette sauvegarde de manière redondante sur notre stockage Cloud AWS S3 externe sécurisé.
                  </p>

                  <div className="flex items-center justify-between bg-[#FAF9F5] border border-[#E9E5DB] p-3">
                    <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider flex items-center gap-1.5">
                      <Cloud size={12} className="text-[var(--orange)]" />
                      Réplication Cloud AWS S3
                    </span>
                    <label className="relative inline-flex inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={backupStoreCloud}
                        onChange={(e) => setBackupStoreCloud(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--orange)]"></div>
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <button
                  onClick={handleCreateBackup}
                  disabled={backupCreating}
                  className="w-full h-11 bg-[#1A1614] text-white border-none text-[11px] font-bold tracking-[0.12em] uppercase cursor-pointer flex items-center justify-center gap-2.5 hover:bg-neutral-800 transition-colors disabled:opacity-50"
                >
                  {backupCreating ? (
                    <><Loader2 size={13} className="animate-spin" /> Sauvegarde en cours...</>
                  ) : (
                    <><HardDrive size={13} /> Lancer une sauvegarde complète</>
                  )}
                </button>

                <div className="mt-3 grid grid-cols-1 gap-2">
                  <input
                    id="backup-json-import"
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportBackup}
                    disabled={backupImporting}
                    className="sr-only"
                  />
                  <label
                    htmlFor="backup-json-import"
                    className={`w-full h-10 border border-[#D9D2C5] bg-white text-[var(--ink)] text-[10px] font-extrabold tracking-[0.12em] uppercase flex items-center justify-center gap-2 transition-colors ${
                      backupImporting
                        ? "opacity-50 cursor-wait"
                        : "cursor-pointer hover:bg-[#FAF9F5] hover:border-[var(--orange)]"
                    }`}
                  >
                    {backupImporting ? (
                      <><Loader2 size={13} className="animate-spin" /> Import en cours...</>
                    ) : (
                      <><UploadCloud size={13} /> Importer un backup JSON</>
                    )}
                  </label>

                  <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
                    <div className="flex items-start gap-2">
                      <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                      <span>
                        Import securise: le fichier est ajoute a l'historique local et audite. Aucune restauration de base de donnees n'est executee.
                      </span>
                    </div>
                  </div>

                  {backupImportInfo && (
                    <div className="flex items-center gap-2 border border-green-200 bg-green-50 px-3 py-2 text-[10px] font-semibold text-green-700">
                      <CheckCircle2 size={13} />
                      <span className="truncate">{backupImportInfo}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* S3 transfer console logs */}
          {cloudLogs.length > 0 && (
            <div className="bg-[#1A1614] text-green-400 font-mono text-[10px] p-3 border border-neutral-800 flex flex-col gap-1 leading-relaxed rounded-none">
              <div className="flex items-center justify-between text-neutral-400 border-b border-neutral-800 pb-1.5 mb-1.5 font-bold uppercase tracking-wider text-[9px]">
                <span className="flex items-center gap-1.5"><UploadCloud size={11} /> Journal de transmission Cloud S3</span>
                <button onClick={() => setCloudLogs([])} className="bg-none border-none text-neutral-400 hover:text-white cursor-pointer font-bold text-[8px] uppercase tracking-wide">Fermer</button>
              </div>
              {cloudLogs.map((log, idx) => (
                <div key={idx} className="flex gap-1.5">
                  <span className="text-neutral-600 select-none">&gt;&gt;</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          )}

          {/* BACKUPS HISTORY LIST */}
          <TableCard 
            title="Historique des Points de Restauration" 
            meta={backupsLoading ? "Chargement..." : `${backups.length} sauvegarde(s) disponible(s)`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--cream)] text-[var(--brown-soft)]">
                    <th className="p-3 font-semibold">Date de création</th>
                    <th className="p-3 font-semibold">Nom de fichier</th>
                    <th className="p-3 font-semibold text-center">Taille</th>
                    <th className="p-3 font-semibold text-center">Destination</th>
                    <th className="p-3 font-semibold text-center">Volume de données</th>
                    <th className="p-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.fileName} className="border-b border-[var(--line)] hover:bg-[var(--cream)]/30">
                      <td className="p-3 font-mono text-[10px] text-neutral-500">
                        {new Date(b.timestamp).toLocaleString("fr-FR")}
                      </td>
                      <td className="p-3 font-mono text-[11px] font-bold text-[var(--ink)] truncate max-w-[200px]">
                        {b.fileName}
                      </td>
                      <td className="p-3 font-mono text-center font-medium">
                        {b.sizeKb} Ko
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] font-bold text-[9px] uppercase border ${
                            String(b.location).includes("simulation")
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {String(b.location).includes("simulation") ? (
                            <><Cloud size={9} /> Local & S3</>
                          ) : (
                            <><HardDrive size={9} /> Local</>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-center text-[10px] text-neutral-500 font-medium leading-relaxed">
                        {b.stats ? (
                          <span>
                            📦 {b.stats.orders} cmds · 🏷️ {b.stats.products} prods · 👥 {b.stats.customers} clis
                          </span>
                        ) : (
                          "N/A"
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="inline-flex gap-1.5 uppercase font-bold text-[9px] tracking-wider">
                          <button
                            onClick={() => handleDownloadBackup(b.fileName)}
                            className="px-2 py-1 bg-white border border-[#E1DBD0] text-neutral-600 hover:bg-neutral-50 cursor-pointer"
                          >
                            Télécharger
                          </button>
                          
                          {b.location === "Local" && (
                            <button
                              onClick={() => handleCloudUpload(b.fileName)}
                              disabled={cloudActionLoading === b.fileName}
                              className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 disabled:opacity-50 cursor-pointer flex items-center gap-1"
                            >
                              {cloudActionLoading === b.fileName ? "Copie..." : <><UploadCloud size={9} /> Répliquer</>}
                            </button>
                          )}

                          <button
                            onClick={() => handleSimulateRestore(b.fileName)}
                            className="px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 cursor-pointer flex items-center gap-1"
                          >
                            <History size={9} /> Simuler Restauration
                          </button>

                          <button
                            onClick={() => handleDeleteBackup(b.fileName)}
                            className="px-2 py-1 bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 cursor-pointer"
                          >
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {backups.length === 0 && !backupsLoading && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-neutral-400">
                        Aucun point de restauration disponible. Lancez une sauvegarde complète ci-dessus.
                      </td>
                    </tr>
                  )}
                  {backupsLoading && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-neutral-400">
                        <Loader2 className="animate-spin text-[var(--orange)] inline mr-2" size={14} />
                        Chargement de l'historique...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>

          {/* Entity descriptions */}
          <div>
            <h4 className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider mb-2.5">
              Types de données d'exportation disponibles
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
              {[
                { key: "orders", emoji: "📦", label: "Commandes", desc: "Ref, client, statut, articles, montants, livraison, promos, dates" },
                { key: "products", emoji: "🏷️", label: "Produits", desc: "Nom, prix, stock, catégorie, variantes, fournisseur, nb commandes" },
                { key: "customers", emoji: "👥", label: "Clients", desc: "Nom, téléphone, commune, total dépensé, nb commandes" },
                { key: "stock_movements", emoji: "📊", label: "Stocks", desc: "Type, quantité, produit, variante, entrepôt, auteur, motif" },
                { key: "promos", emoji: "🎟️", label: "Promos", desc: "Code, type, valeur, règle, cibles, nb utilisations" },
                { key: "all", emoji: "🔥", label: "Export Complet", desc: "Dump JSON de toutes les tables, incluant les structures de paramétrage" },
              ].map((item) => (
                <div
                  key={item.key}
                  onClick={() => {
                    setExportEntity(item.key as any);
                    if (item.key === "all") setExportFormat("json");
                  }}
                  className={`p-3 border cursor-pointer transition-all ${
                    exportEntity === item.key
                      ? "bg-[#FAF9F5] border-[var(--orange)] border-l-[3px]"
                      : "bg-white border-[var(--line)] hover:bg-[#FAF9F5]"
                  }`}
                >
                  <div className="text-xs mb-1 font-bold text-[var(--ink)]">{item.emoji} {item.label}</div>
                  <p className="text-[9px] text-neutral-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Modal system */}
      {modal && modal.isOpen && (
        <div className="fixed inset-0 z-50 bg-[#1A1614]/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white border border-[#E9E5DB] w-full max-w-2xl flex flex-col max-h-[85vh] rounded-none shadow-none">
            
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between bg-[#FAF9F5]">
              <span className="text-[11px] font-extrabold uppercase text-[var(--ink)] tracking-wider flex items-center gap-2">
                <Terminal size={14} className="text-[var(--orange)]" />
                {modal.title}
              </span>
              <button 
                onClick={() => setModal(null)} 
                className="p-1 border border-transparent bg-none text-neutral-400 hover:text-[var(--ink)] hover:border-[#E1DBD0] cursor-pointer transition-all"
              >
                <X size={14} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto text-xs text-[var(--ink)] leading-relaxed flex flex-col gap-4">
              <p className="text-neutral-500 font-medium">{modal.description}</p>

              {/* Status: Scanning / Loading */}
              {modal.status === "scanning" && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-neutral-400 border border-dashed border-[#E1DBD0] bg-[#FAF9F5]">
                  <Loader2 className="animate-spin text-[var(--orange)]" size={24} />
                  <span className="font-bold text-[10px] uppercase tracking-wider">Analyse du système et collecte des métriques...</span>
                </div>
              )}

              {/* Status: Executing */}
              {modal.status === "executing" && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-neutral-400 border border-dashed border-[#E1DBD0] bg-[#FAF9F5]">
                  <Loader2 className="animate-spin text-[var(--orange)]" size={24} />
                  <span className="font-bold text-[10px] uppercase tracking-wider">Application des modifications sur le serveur...</span>
                </div>
              )}

              {/* Status: Error */}
              {modal.status === "error" && (
                <div className="border border-red-200 bg-red-50 p-4 text-red-700 flex flex-col gap-1.5">
                  <span className="font-extrabold text-[10px] uppercase tracking-wider flex items-center gap-1.5"><AlertTriangle size={13} /> Échec de l'opération</span>
                  <p className="font-mono text-[11px]">{modal.error}</p>
                </div>
              )}

              {/* Status: Idle (Preview display or confirmation) */}
              {modal.status === "idle" && (
                <div className="flex flex-col gap-4">
                  {/* Stock sync preview data */}
                  {modal.actionId === "stock_sync" && modal.data && (
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between items-center bg-[#FAF9F5] border border-[#E9E5DB] p-3">
                        <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Variantes vérifiées: {modal.data.totalVariants}</span>
                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-[3px] border ${modal.data.mismatchCount > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                          Écarts détectés: {modal.data.mismatchCount}
                        </span>
                      </div>
                      
                      {modal.data.mismatchCount > 0 ? (
                        <div className="border border-[var(--line)]">
                          <div className="max-h-[250px] overflow-y-auto">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="bg-[var(--cream)] border-b border-[var(--line)] text-[var(--brown-soft)] sticky top-0">
                                  <th className="p-2.5 font-bold">Produit</th>
                                  <th className="p-2.5 font-bold">Variante</th>
                                  <th className="p-2.5 font-bold text-center">Stock DB</th>
                                  <th className="p-2.5 font-bold text-center">Physique</th>
                                  <th className="p-2.5 font-bold text-right">Ajustement</th>
                                </tr>
                              </thead>
                              <tbody>
                                {modal.data.mismatches.map((m: any, idx: number) => (
                                  <tr key={idx} className="border-b border-[var(--line)] hover:bg-[#FAF9F5]/40">
                                    <td className="p-2.5 font-bold truncate max-w-[180px]">{m.product} <span className="text-[9px] font-mono text-neutral-400">({m.ref})</span></td>
                                    <td className="p-2.5 text-neutral-500 font-medium">{m.variant}</td>
                                    <td className="p-2.5 font-mono text-center">{m.currentStock}</td>
                                    <td className="p-2.5 font-mono text-center font-bold text-blue-600">{m.warehouseTotal}</td>
                                    <td className={`p-2.5 font-mono font-bold text-right ${m.diff > 0 ? "text-green-600" : "text-red-600"}`}>
                                      {m.diff > 0 ? `+${m.diff}` : m.diff}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-green-700 bg-green-50 border border-green-200 font-bold uppercase text-[10px] tracking-wider">
                          ✅ Aucune anomalie de stock. Tous les produits sont synchronisés.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clean test orders preview data */}
                  {modal.actionId === "clean_test" && modal.data && (
                    <div className="flex flex-col gap-3">
                      <div className="bg-[#FAF9F5] border border-[#E9E5DB] p-3 text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">
                        Commandes factices trouvées: <span className="text-[var(--orange)] font-extrabold">{modal.data.count}</span>
                      </div>

                      {modal.data.count > 0 ? (
                        <div className="border border-[var(--line)]">
                          <div className="max-h-[250px] overflow-y-auto">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="bg-[var(--cream)] border-b border-[var(--line)] text-[var(--brown-soft)] sticky top-0">
                                  <th className="p-2.5 font-bold">Référence</th>
                                  <th className="p-2.5 font-bold">Articles</th>
                                  <th className="p-2.5 font-bold text-center">Total</th>
                                  <th className="p-2.5 font-bold text-center">Statut</th>
                                  <th className="p-2.5 font-bold text-right">Créée le</th>
                                </tr>
                              </thead>
                              <tbody>
                                {modal.data.orders.map((o: any, idx: number) => (
                                  <tr key={idx} className="border-b border-[var(--line)] hover:bg-[#FAF9F5]/40">
                                    <td className="p-2.5 font-mono font-bold text-[var(--orange)]">{o.ref}</td>
                                    <td className="p-2.5 text-neutral-500 font-medium">{o.items} article(s)</td>
                                    <td className="p-2.5 font-mono font-bold text-center">{formatPrice(o.total)}</td>
                                    <td className="p-2.5 text-center">
                                      <span className="inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-[3px] bg-neutral-100 text-neutral-600 border border-neutral-200">
                                        {o.status}
                                      </span>
                                    </td>
                                    <td className="p-2.5 font-mono text-neutral-400 text-right text-[10px]">
                                      {new Date(o.createdAt).toLocaleDateString("fr-FR")}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-neutral-400 bg-neutral-50 border border-dashed border-[#E1DBD0] font-bold uppercase text-[10px] tracking-wider">
                          Aucune commande de simulation [TEST] dans la base de données.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Customer stats preview data */}
                  {modal.actionId === "customer_stats" && modal.data && (
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between items-center bg-[#FAF9F5] border border-[#E9E5DB] p-3">
                        <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider">Fiches clients scannées: {modal.data.totalCustomers}</span>
                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-[3px] border bg-indigo-50 text-indigo-700 border-indigo-200">
                          Écarts dans l'échantillon: {modal.data.changedInSample}
                        </span>
                      </div>

                      <div className="border border-[var(--line)]">
                        <div className="max-h-[250px] overflow-y-auto">
                          <table className="w-full text-left border-collapse text-[11px]">
                            <thead>
                              <tr className="bg-[var(--cream)] border-b border-[var(--line)] text-[var(--brown-soft)] sticky top-0">
                                <th className="p-2.5 font-bold">Client / Tél</th>
                                <th className="p-2.5 font-bold text-center">Cmds Enr vs Réel</th>
                                <th className="p-2.5 font-bold text-center">Dépenses Enr vs Réel</th>
                                <th className="p-2.5 font-bold text-right">Statut</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modal.data.sample.map((c: any, idx: number) => (
                                <tr key={idx} className="border-b border-[var(--line)] hover:bg-[#FAF9F5]/40">
                                  <td className="p-2.5 truncate max-w-[180px]">
                                    <div className="font-bold text-[var(--ink)]">{c.name}</div>
                                    <div className="text-[9px] font-mono text-neutral-400">{c.phone}</div>
                                  </td>
                                  <td className="p-2.5 text-center font-mono font-medium">
                                    {c.storedOrders} <span className="text-neutral-400">→</span> <span className={c.storedOrders !== c.actualOrders ? "font-bold text-[var(--orange)]" : ""}>{c.actualOrders}</span>
                                  </td>
                                  <td className="p-2.5 text-center font-mono font-medium">
                                    {formatPrice(c.storedSpent)} <span className="text-neutral-400">→</span> <span className={c.storedSpent !== c.actualSpent ? "font-bold text-[var(--orange)]" : ""}>{formatPrice(c.actualSpent)}</span>
                                  </td>
                                  <td className="p-2.5 text-right">
                                    {c.hasChanged ? (
                                      <span className="inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-[3px] bg-amber-50 text-amber-700 border border-amber-200">
                                        À Ajuster
                                      </span>
                                    ) : (
                                      <span className="inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-[3px] bg-green-50 text-green-600 border border-green-100">
                                        Correct
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Basic confirmations */}
                  {["order_sim", "cache_purge", "deep_purge", "restore_sim"].includes(modal.actionId) && (
                    <div className="bg-[#FAF9F5] border border-[#E9E5DB] p-4 flex items-center gap-3">
                      <AlertTriangle className="text-[var(--orange)]" size={18} />
                      <span className="font-bold text-[10px] uppercase tracking-wider text-[var(--brown-soft)]">
                        Confirmation requise avant exécution système.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Status: Done (Results display) */}
              {modal.status === "done" && (
                <div className="flex flex-col gap-4 animate-[fadeIn_0.2s_ease]">
                  
                  {/* General feedback message */}
                  <div className="border border-green-200 bg-green-50 p-4 text-green-800 flex items-center gap-3">
                    <CheckCircle2 className="text-green-600 flex-shrink-0" size={18} />
                    <div>
                      <span className="font-extrabold text-[10px] uppercase tracking-wider block">Opération accomplie avec succès !</span>
                      <p className="font-medium mt-0.5 text-[11px]">{modal.data?.message || "L'action a été exécutée et consignée."}</p>
                    </div>
                  </div>

                  {/* DB Integrity check results */}
                  {modal.actionId === "db_check" && modal.data && modal.data.data && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider mb-1">Rapport d'Intégrité Relationnelle</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        {[
                          { label: "Commandes orphelines (0 articles)", val: modal.data.data.ordersWithoutItems },
                          { label: "Articles sans produit existant", val: modal.data.data.itemsWithoutProduct },
                          { label: "Variantes de produits archivés", val: modal.data.data.variantsWithoutProduct },
                          { label: "Commandes confirmées sans REF", val: modal.data.data.ordersWithoutRef },
                          { label: "Clients sans aucune commande", val: modal.data.data.customersNoOrders },
                          { label: "Numéros de téléphone en doublon", val: modal.data.data.duplicatePhones },
                        ].map((issue, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 border border-[var(--line)] bg-white hover:bg-neutral-50">
                            <span className="font-medium text-neutral-600">{issue.label}</span>
                            <span className={`font-mono font-bold px-1.5 py-0.5 rounded-[3px] ${issue.val > 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-100"}`}>
                              {issue.val}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Catalog Audit results */}
                  {modal.actionId === "catalog_audit" && modal.data && modal.data.data && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider mb-1">Rapport d'Audit Catalogue</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        {[
                          { label: "Produits publiés sans image", val: modal.data.data.productsNoImages },
                          { label: "Produits publiés sans variante", val: modal.data.data.productsNoVariants },
                          { label: "Produits publiés en rupture totale (stock ≤ 0)", val: modal.data.data.publishedNoStock },
                          { label: "Produits brouillons avec des commandes actives", val: modal.data.data.draftWithOrders },
                          { label: "Variantes avec stock négatif (corruption)", val: modal.data.data.variantsNegativeStock },
                        ].map((issue, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 border border-[var(--line)] bg-white hover:bg-neutral-50">
                            <span className="font-medium text-neutral-600">{issue.label}</span>
                            <span className={`font-mono font-bold px-1.5 py-0.5 rounded-[3px] ${issue.val > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-100"}`}>
                              {issue.val}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Promo Health results */}
                  {modal.actionId === "promo_health" && modal.data && modal.data.data && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] font-bold text-[var(--brown-soft)] uppercase tracking-wider mb-1">Rapport Santé Codes Promo</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        {[
                          { label: "Codes expiré(s) encore marqués actifs", val: modal.data.data.expiredStillActive },
                          { label: "Codes promo jamais utilisés", val: modal.data.data.unusedPromos },
                          { label: "Codes sans produit/catégorie (globaux)", val: modal.data.data.noProductNoCategory },
                          { label: "Nombre global de coupons vérifiés", val: modal.data.data.promosCount, infoOnly: true },
                          { label: "Utilisations de coupons enregistrées", val: modal.data.data.totalUsages, infoOnly: true },
                        ].map((issue, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 border border-[var(--line)] bg-white hover:bg-neutral-50">
                            <span className="font-medium text-neutral-600">{issue.label}</span>
                            <span className={`font-mono font-bold px-1.5 py-0.5 rounded-[3px] ${issue.infoOnly ? "bg-blue-50 text-blue-700 border-blue-100" : issue.val > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-100"}`}>
                              {issue.val}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Restore simulation results */}
                  {modal.actionId === "restore_sim" && modal.data && (
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between items-center bg-indigo-50 border border-indigo-200 p-3.5 text-indigo-800">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="text-indigo-600" size={16} />
                          <div>
                            <span className="font-extrabold text-[10px] uppercase tracking-wider block">Fichier validé avec succès !</span>
                            <span className="font-mono text-[9px] text-indigo-600 block mt-0.5">Origine : {modal.data.fileName}</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-neutral-400 font-mono">
                          {new Date(modal.data.timestamp).toLocaleDateString("fr-FR")}
                        </span>
                      </div>

                      {/* Display validation log lines */}
                      <div className="bg-[#1A1614] text-green-400 font-mono text-[10px] p-4 border border-neutral-800 flex flex-col gap-1.5 leading-relaxed rounded-none max-h-[220px] overflow-y-auto">
                        {modal.data.report.map((line: string, idx: number) => (
                          <div key={idx} className="flex gap-1.5">
                            <span className="text-neutral-600 select-none">&gt;&gt;</span>
                            <span>{line}</span>
                          </div>
                        ))}
                      </div>

                      <div className="bg-[#FAF9F5] border border-[#E9E5DB] p-4 text-[11px] leading-relaxed flex flex-col gap-2">
                        <span className="font-bold text-[10px] text-[var(--brown-soft)] uppercase tracking-wider">
                          Statistiques de restructuration :
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="bg-white border border-[var(--line)] p-2">
                            <div className="text-[9px] text-neutral-400 uppercase font-bold">Commandes</div>
                            <div className="text-sm font-bold">{modal.data.stats.orders}</div>
                          </div>
                          <div className="bg-white border border-[var(--line)] p-2">
                            <div className="text-[9px] text-neutral-400 uppercase font-bold">Produits</div>
                            <div className="text-sm font-bold">{modal.data.stats.products}</div>
                          </div>
                          <div className="bg-white border border-[var(--line)] p-2">
                            <div className="text-[9px] text-neutral-400 uppercase font-bold">Clients</div>
                            <div className="text-sm font-bold">{modal.data.stats.customers}</div>
                          </div>
                          <div className="bg-white border border-[var(--line)] p-2">
                            <div className="text-[9px] text-neutral-400 uppercase font-bold">Stocks</div>
                            <div className="text-sm font-bold">{modal.data.stats.stockMovements}</div>
                          </div>
                          <div className="bg-white border border-[var(--line)] p-2">
                            <div className="text-[9px] text-neutral-400 uppercase font-bold">Promos</div>
                            <div className="text-sm font-bold">{modal.data.stats.promos}</div>
                          </div>
                          <div className="bg-white border border-[var(--line)] p-2">
                            <div className="text-[9px] text-neutral-400 uppercase font-bold">Règlements</div>
                            <div className="text-sm font-bold">{modal.data.stats.settlements}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-[var(--line)] bg-[#FAF9F5] flex justify-end gap-2 text-[10px] font-bold tracking-wider uppercase">
              
              {/* If idle state and can proceed with write */}
              {modal.status === "idle" && (
                <>
                  <button 
                    onClick={() => setModal(null)} 
                    className="h-9 px-4 bg-white border border-[#E1DBD0] text-neutral-600 hover:bg-neutral-50 cursor-pointer transition-colors"
                  >
                    Annuler
                  </button>
                  
                  {/* Condition for confirming the sync/clean/sim */}
                  {modal.actionId === "stock_sync" && (
                    <button 
                      onClick={handleConfirmAction} 
                      disabled={modal.data && modal.data.mismatchCount === 0}
                      className="h-9 px-5 bg-[#1A1614] text-white border-none hover:bg-neutral-800 disabled:opacity-40 cursor-pointer transition-colors"
                    >
                      Appliquer la Synchronisation
                    </button>
                  )}

                  {modal.actionId === "clean_test" && (
                    <button 
                      onClick={handleConfirmAction} 
                      disabled={modal.data && modal.data.count === 0}
                      className="h-9 px-5 bg-red-700 text-white border-none hover:bg-red-800 disabled:opacity-40 cursor-pointer transition-colors"
                    >
                      Supprimer Définitivement
                    </button>
                  )}

                  {modal.actionId === "customer_stats" && (
                    <button 
                      onClick={handleConfirmAction} 
                      className="h-9 px-5 bg-indigo-700 text-white border-none hover:bg-indigo-800 cursor-pointer transition-colors"
                    >
                      Recalculer les Statistiques
                    </button>
                  )}

                  {modal.actionId === "order_sim" && (
                    <button 
                      onClick={handleConfirmAction} 
                      className="h-9 px-5 bg-[var(--orange)] text-white border-none hover:bg-[#d4541c] cursor-pointer transition-colors"
                    >
                      Lancer la Simulation
                    </button>
                  )}

                  {modal.actionId === "cache_purge" && (
                    <button 
                      onClick={handleConfirmAction} 
                      className="h-9 px-5 bg-neutral-800 text-white border-none hover:bg-neutral-900 cursor-pointer transition-colors"
                    >
                      Confirmer la Purge
                    </button>
                  )}

                  {modal.actionId === "deep_purge" && (
                    <button 
                      onClick={handleConfirmAction} 
                      className="h-9 px-5 bg-yellow-600 text-white border-none hover:bg-yellow-700 cursor-pointer transition-colors"
                    >
                      Lancer la Purge Profonde
                    </button>
                  )}

                  {modal.actionId === "restore_sim" && (
                    <button 
                      onClick={handleConfirmAction} 
                      className="h-9 px-5 bg-red-700 text-white border-none hover:bg-red-800 cursor-pointer transition-colors flex items-center gap-2"
                    >
                      <AlertTriangle size={12} /> Appliquer la Restauration
                    </button>
                  )}
                </>
              )}

              {/* If done, error, scanning, or executing, show standard close button */}
              {(modal.status === "done" || modal.status === "error" || modal.status === "scanning" || modal.status === "executing") && (
                <button 
                  onClick={() => setModal(null)} 
                  disabled={modal.status === "executing"}
                  className="h-9 px-5 bg-[#1A1614] text-white border-none hover:bg-neutral-800 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  Fermer
                </button>
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
