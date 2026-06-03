"use server";

import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import * as fs from "fs";
import * as path from "path";
import { recordDeveloperAudit } from "./audit";

const BACKUP_DIR = path.join(process.cwd(), "backups");

interface BackupMetadata {
  version: string;
  timestamp: string;
  fileName: string;
  sizeKb: number;
  location: "Local" | "Local & Cloud S3 (simulation)";
  stats: {
    orders: number;
    products: number;
    customers: number;
    stockMovements: number;
    promos: number;
    categories: number;
    warehouses: number;
    users: number;
    settlements: number;
  };
}

function ensureBackupDirectory() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function resolveBackupFile(fileName: string) {
  const safeName = path.basename(fileName || "");
  if (!/^backup_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/.test(safeName)) {
    throw new Error("Nom de sauvegarde invalide.");
  }

  const backupRoot = path.resolve(BACKUP_DIR);
  const filePath = path.resolve(BACKUP_DIR, safeName);
  if (!filePath.startsWith(backupRoot + path.sep)) {
    throw new Error("Chemin de sauvegarde invalide.");
  }

  return { safeName, filePath };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erreur inconnue.";
}

async function getBackupPayload(storeExternally: boolean, fileName: string) {
  const [
    orders,
    products,
    customers,
    movements,
    promos,
    categories,
    warehouses,
    users,
    settlements,
  ] = await Promise.all([
    prisma.order.findMany({ include: { items: true } }),
    prisma.product.findMany({ include: { variants: true, images: true } }),
    prisma.customer.findMany(),
    prisma.stockMovement.findMany(),
    prisma.promoCode.findMany(),
    prisma.category.findMany(),
    prisma.warehouse.findMany(),
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        role: true,
        initials: true,
        phone2: true,
        serviceLabel: true,
        createdAt: true,
      },
    }),
    prisma.settlement.findMany(),
  ]);

  const stats = {
    orders: orders.length,
    products: products.length,
    customers: customers.length,
    stockMovements: movements.length,
    promos: promos.length,
    categories: categories.length,
    warehouses: warehouses.length,
    users: users.length,
    settlements: settlements.length,
  };

  const location = storeExternally ? "Local & Cloud S3 (simulation)" : "Local";

  return {
    metadata: {
      version: "1.0",
      timestamp: new Date().toISOString(),
      fileName,
      location,
      stats,
      warning: "User password hashes are intentionally excluded from this backup.",
    },
    tables: {
      orders,
      products,
      customers,
      stockMovements: movements,
      promos,
      categories,
      warehouses,
      users,
      settlements,
    },
  };
}

export async function createSystemBackupAction(storeExternally: boolean) {
  await ensureAuth(["developer"]);
  try {
    ensureBackupDirectory();

    const formattedDate = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const fileName = `backup_${formattedDate}.json`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const backupPayload = await getBackupPayload(storeExternally, fileName);

    fs.writeFileSync(filePath, JSON.stringify(backupPayload, null, 2), "utf-8");

    const statsObj = fs.statSync(filePath);
    const sizeKb = Math.round((statsObj.size / 1024) * 10) / 10;
    const externalLogs = storeExternally
      ? [
          "Simulation active : aucun fichier n'est envoye vers S3/R2.",
          `Empreinte locale de demonstration : ${Math.random().toString(36).substring(7).toUpperCase()}`,
          "La sauvegarde reste uniquement sur le serveur local.",
        ]
      : [];

    await recordDeveloperAudit("backup.create", "success", {
      fileName,
      sizeKb,
      location: backupPayload.metadata.location,
      stats: backupPayload.metadata.stats,
    });

    return {
      success: true,
      message: storeExternally
        ? `Sauvegarde locale '${fileName}' (${sizeKb} Ko) creee. Cloud S3: simulation seulement.`
        : `Sauvegarde locale '${fileName}' (${sizeKb} Ko) creee avec succes.`,
      data: {
        fileName,
        sizeKb,
        location: backupPayload.metadata.location,
        stats: backupPayload.metadata.stats,
        externalLogs,
        timestamp: backupPayload.metadata.timestamp,
      },
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.error("Error creating system backup:", error);
    await recordDeveloperAudit("backup.create", "failure", { error: message });
    return { success: false, error: message || "Une erreur est survenue lors de la creation de la sauvegarde." };
  }
}

export async function listSystemBackupsAction() {
  await ensureAuth(["developer"]);
  try {
    ensureBackupDirectory();

    const backupFiles = fs.readdirSync(BACKUP_DIR)
      .filter((file) => /^backup_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/.test(file));

    const backups: BackupMetadata[] = [];
    for (const file of backupFiles) {
      try {
        const { filePath } = resolveBackupFile(file);
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const fileStats = fs.statSync(filePath);

        if (parsed.metadata) {
          backups.push({
            version: parsed.metadata.version || "1.0",
            timestamp: parsed.metadata.timestamp || fileStats.birthtime.toISOString(),
            fileName: file,
            sizeKb: Math.round((fileStats.size / 1024) * 10) / 10,
            location: parsed.metadata.location || "Local",
            stats: parsed.metadata.stats || {
              orders: parsed.tables?.orders?.length || 0,
              products: parsed.tables?.products?.length || 0,
              customers: parsed.tables?.customers?.length || 0,
              stockMovements: parsed.tables?.stockMovements?.length || 0,
              promos: parsed.tables?.promos?.length || 0,
              categories: parsed.tables?.categories?.length || 0,
              warehouses: parsed.tables?.warehouses?.length || 0,
              users: parsed.tables?.users?.length || 0,
              settlements: parsed.tables?.settlements?.length || 0,
            },
          });
        }
      } catch (err) {
        console.error(`Error parsing backup file ${file}:`, err);
      }
    }

    backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return { success: true, backups };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    return { success: false, error: message || "Impossible de lister les sauvegardes." };
  }
}

export async function deleteSystemBackupAction(fileName: string) {
  await ensureAuth(["developer"]);
  try {
    ensureBackupDirectory();
    const { safeName, filePath } = resolveBackupFile(fileName);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: "Le fichier de sauvegarde specifie est introuvable." };
    }

    fs.unlinkSync(filePath);
    await recordDeveloperAudit("backup.delete", "success", { fileName: safeName });
    return { success: true, message: `Sauvegarde '${safeName}' supprimee definitivement du serveur.` };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    await recordDeveloperAudit("backup.delete", "failure", { fileName, error: message });
    return { success: false, error: message || "Erreur lors de la suppression de la sauvegarde." };
  }
}

export async function uploadBackupToCloudAction(fileName: string) {
  await ensureAuth(["developer"]);
  try {
    ensureBackupDirectory();
    const { safeName, filePath } = resolveBackupFile(fileName);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: "Fichier de sauvegarde introuvable." };
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (parsed.metadata) {
      parsed.metadata.location = "Local & Cloud S3 (simulation)";
      parsed.metadata.cloudSimulationOnly = true;
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf-8");
    }

    const logs = [
      "Simulation uniquement : aucun transfert cloud reel.",
      `Controle local du fichier : ${Math.random().toString(36).substring(4).toUpperCase()}`,
      "Pour activer un vrai cloud, connecter AWS S3 ou Cloudflare R2 dans cette action.",
    ];

    await recordDeveloperAudit("backup.cloud_simulation", "success", { fileName: safeName });
    return {
      success: true,
      message: `Sauvegarde '${safeName}' marquee comme simulation cloud. Aucun transfert externe reel.`,
      logs,
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    await recordDeveloperAudit("backup.cloud_simulation", "failure", { fileName, error: message });
    return { success: false, error: message || "Impossible de simuler le transfert cloud." };
  }
}

export async function simulateRestoreBackupAction(fileName: string) {
  await ensureAuth(["developer"]);
  try {
    ensureBackupDirectory();
    const { safeName, filePath } = resolveBackupFile(fileName);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: "Fichier de sauvegarde introuvable." };
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed.metadata || !parsed.tables) {
      return { success: false, error: "Structure de sauvegarde invalide ou corrompue." };
    }

    const { stats } = parsed.metadata;
    const { tables } = parsed;
    const validationReport = [
      "1. Structure JSON backup valide.",
      "2. Simulation uniquement : aucune ecriture en base.",
      `3. Produits detectes : ${tables.products?.length || 0}.`,
      `4. Commandes detectees : ${tables.orders?.length || 0}.`,
      `5. Clients detectes : ${tables.customers?.length || 0}.`,
      "6. Les mots de passe utilisateurs ne sont pas inclus dans les backups recents.",
    ];

    await recordDeveloperAudit("backup.restore_simulation", "success", { fileName: safeName });
    return {
      success: true,
      message: "Simulation de restauration effectuee avec succes. Aucune donnee n'a ete ecrite.",
      data: {
        fileName: safeName,
        timestamp: parsed.metadata.timestamp,
        stats,
        report: validationReport,
      },
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    await recordDeveloperAudit("backup.restore_simulation", "failure", { fileName, error: message });
    return { success: false, error: message || "Impossible de simuler la restauration." };
  }
}

export async function downloadBackupAction(fileName: string) {
  await ensureAuth(["developer"]);
  try {
    const { safeName, filePath } = resolveBackupFile(fileName);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "Le fichier de sauvegarde specifie est introuvable." };
    }

    const fileContent = fs.readFileSync(filePath, "utf-8");
    await recordDeveloperAudit("backup.download", "success", { fileName: safeName });
    return { success: true, fileContent };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    await recordDeveloperAudit("backup.download", "failure", { fileName, error: message });
    return { success: false, error: message || "Erreur de telechargement du fichier." };
  }
}
