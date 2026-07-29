"use server";

import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createOrder } from "@/modules/orders/actions/order-actions";
import { fixAllProductStocks } from "@/modules/products/actions/actions";
import { recordDeveloperAudit } from "./audit";

function maskPhone(value?: string | null) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function maskText(value?: string | null) {
  if (!value) return "";
  return "[masque]";
}

/**
 * Recalculate and synchronize all product stocks based on warehouse values.
 */
export async function runStockSyncAction() {
  await ensureAuth(["developer"]);
  try {
    const res = await fixAllProductStocks();
    return { success: true, message: "La synchronisation globale des stocks a été effectuée avec succès." };
  } catch (e: any) {
    console.error("Error during stock sync action:", e);
    return { success: false, error: e.message || "Une erreur est survenue lors de la synchronisation." };
  }
}

/**
 * Purges static render caches for critical customer-facing paths.
 */
export async function clearSystemCacheAction() {
  await ensureAuth(["developer"]);
  try {
    revalidatePath("/");
    revalidatePath("/cart");
    revalidatePath("/zangochap-manager/dashboard");
    return { success: true, message: "Les caches des pages critiques ont été purgés avec succès." };
  } catch (e: any) {
    console.error("Error during cache purge action:", e);
    return { success: false, error: e.message || "Impossible de purger les caches." };
  }
}

/**
 * Simulates a realistic public order in the database for debugging/testing.
 */
export async function simulateTestOrderAction() {
  await ensureAuth(["developer"]);
  try {
    // 1. Find a published product with variants and active stock
    const product = await prisma.product.findFirst({
      where: { 
        status: "PUBLISHED" 
      },
      include: { 
        variants: {
          where: {
            stock: { gt: 0 }
          }
        },
        images: { take: 1, orderBy: { position: "asc" } }
      }
    });

    // Fallback: if no product has active stock > 0, just pick any published product
    let selectedProduct = product;
    if (!selectedProduct || selectedProduct.variants.length === 0) {
      selectedProduct = await prisma.product.findFirst({
        where: { status: "PUBLISHED" },
        include: { variants: true, images: { take: 1, orderBy: { position: "asc" } } }
      });
    }

    if (!selectedProduct || selectedProduct.variants.length === 0) {
      return { 
        success: false, 
        error: "Aucun produit publié contenant des variantes n'a été trouvé pour la simulation." 
      };
    }

    const variant = selectedProduct.variants[0];

    // 2. Call createOrder to simulate a complete cycle (stock reduction, history logging, etc.)
    const res = await createOrder({
      customerName: "[TEST] Simulation Développeur",
      customerPhone: "0700000000",
      customerPhone2: "0500000000",
      customerLocation: "Boulevard des Lignes de Code, Terminal 42",
      commune: "Cocody",
      deliveryFee: 2000,
      status: "TO_PROCESS",
      source: "public",
      items: [
        {
          productId: selectedProduct.id,
          variantId: variant.id,
          name: selectedProduct.name,
          size: variant.size,
          color: variant.color,
          qty: 1,
          price: Number(selectedProduct.price),
          image: selectedProduct.images?.[0]?.url || undefined
        }
      ]
    });

    return { 
      success: true, 
      message: `Commande de test simulée avec succès. Réf: ${res.order?.ref || 'N/A'}`, 
      orderRef: res.order?.ref 
    };
  } catch (e: any) {
    console.error("Error during test order simulation action:", e);
    return { success: false, error: e.message || "Échec lors de la création de la commande de simulation." };
  }
}

/**
 * Recalculate totalOrders and totalSpent for every customer from their actual orders.
 */
export async function recalcCustomerStatsAction() {
  await ensureAuth(["developer"]);
  try {
    const customers = await prisma.customer.findMany({
      select: { id: true },
    });

    let updatedCount = 0;

    for (const customer of customers) {
      const orders = await prisma.order.findMany({
        where: {
          customerId: customer.id,
          deletedAt: null,
          status: { notIn: ["CANCELLED"] },
        },
        select: { total: true, deliveryFee: true, updatedAt: true },
      });

      const totalOrders = orders.length;
      const totalSpent = orders.reduce(
        (sum, o) => sum + o.total + o.deliveryFee,
        0
      );
      const lastOrderAt =
        orders.length > 0
          ? orders.sort(
              (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
            )[0].updatedAt
          : new Date();

      await prisma.customer.update({
        where: { id: customer.id },
        data: { totalOrders, totalSpent, lastOrderAt },
      });
      updatedCount++;
    }

    return {
      success: true,
      message: `Statistiques recalculées pour ${updatedCount} client(s).`,
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || "Erreur lors du recalcul des statistiques clients.",
    };
  }
}

/**
 * Run a database integrity check: find orphaned order items, orders without items,
 * variants without products, and customers with 0 valid orders.
 */
export async function dbIntegrityCheckAction() {
  await ensureAuth(["developer"]);
  try {
    const [
      ordersWithoutItems,
      itemsWithoutProduct,
      variantsWithoutProduct,
      ordersWithoutRef,
      customersNoOrders,
      duplicatePhones,
    ] = await Promise.all([
      // Orders with zero items
      prisma.order.count({
        where: {
          deletedAt: null,
          items: { none: {} },
        },
      }),
      // OrderItems referencing a productId that no longer exists
      prisma.orderItem.count({
        where: {
          productId: { not: null },
          product: null,
        },
      }),
      // Variants whose parent product was deleted
      prisma.productVariant.count({
        where: {
          product: { status: "ARCHIVED" },
        },
      }),
      // Active orders without a ref
      prisma.order.count({
        where: {
          deletedAt: null,
          ref: null,
          status: { notIn: ["TO_PROCESS", "PENDING"] },
        },
      }),
      // Customers with zero remaining orders
      prisma.customer.count({
        where: {
          orders: { none: {} },
        },
      }),
      // Check for duplicate phone numbers in customers (edge case)
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM (
          SELECT phone, COUNT(*) as c FROM "Customer" GROUP BY phone HAVING COUNT(*) > 1
        ) as dupes
      `,
    ]);

    const dupeCount = Number(duplicatePhones[0]?.count ?? 0);

    const issues: string[] = [];
    if (ordersWithoutItems > 0)
      issues.push(`${ordersWithoutItems} commande(s) sans articles`);
    if (itemsWithoutProduct > 0)
      issues.push(
        `${itemsWithoutProduct} article(s) liés à un produit supprimé`
      );
    if (variantsWithoutProduct > 0)
      issues.push(
        `${variantsWithoutProduct} variante(s) de produits archivés`
      );
    if (ordersWithoutRef > 0)
      issues.push(`${ordersWithoutRef} commande(s) confirmée(s) sans REF`);
    if (customersNoOrders > 0)
      issues.push(`${customersNoOrders} client(s) orphelin(s) (0 commandes)`);
    if (dupeCount > 0)
      issues.push(`${dupeCount} numéro(s) de téléphone en doublon`);

    return {
      success: true,
      message:
        issues.length === 0
          ? "✅ Aucun problème d'intégrité détecté. La base de données est saine."
          : `⚠️ ${issues.length} problème(s) détecté(s):\n• ${issues.join("\n• ")}`,
      data: {
        ordersWithoutItems,
        itemsWithoutProduct,
        variantsWithoutProduct,
        ordersWithoutRef,
        customersNoOrders,
        duplicatePhones: dupeCount,
        totalIssues: issues.length,
      },
    };
  } catch (e: any) {
    return {
      success: false,
      error:
        e.message || "Erreur lors de la vérification d'intégrité de la BDD.",
    };
  }
}

/**
 * Delete all test/simulation orders created by the developer console.
 */
export async function cleanTestOrdersAction() {
  await ensureAuth(["developer"]);
  try {
    const testOrders = await prisma.order.findMany({
      where: {
        customerName: { startsWith: "[TEST]" },
      },
      select: { id: true, ref: true, customerName: true, total: true, status: true },
    });

    if (testOrders.length === 0) {
      return {
        success: true,
        message: "Aucune commande de test trouvée à supprimer.",
      };
    }

    const ids = testOrders.map((o) => o.id);

    // Delete related promo usages, order items, then orders
    await prisma.promoUsage.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });

    // Suppression physique : l'history part avec les commandes, on garde la
    // liste des refs détruites dans le log central avant qu'elle ne disparaisse.
    await recordDeveloperAudit("orders.clean_test", "success", {
      count: testOrders.length,
      orders: testOrders.map((o) => ({ id: o.id, ref: o.ref, name: o.customerName, total: o.total, status: o.status })),
    });

    revalidatePath("/zangochap-manager/orders");

    return {
      success: true,
      message: `${testOrders.length} commande(s) de test supprimée(s) définitivement.`,
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || "Erreur lors du nettoyage des commandes de test.",
    };
  }
}

/**
 * Deep cache purge: revalidate ALL known application paths at once.
 */
export async function deepCachePurgeAction() {
  await ensureAuth(["developer"]);
  try {
    const paths = [
      "/",
      "/cart",
      "/zangochap-manager/dashboard",
      "/zangochap-manager/orders",
      "/zangochap-manager/orders/to-process",
      "/zangochap-manager/orders/non-packed",
      "/zangochap-manager/products",
      "/zangochap-manager/products/shortages",
      "/zangochap-manager/admin/crm",
      "/zangochap-manager/admin/delivery",
      "/zangochap-manager/admin/delivery-sheet",
      "/zangochap-manager/admin/promos",
      "/zangochap-manager/admin/settlements",
      "/zangochap-manager/admin/performance",
      "/zangochap-manager/admin/top-products",
      "/zangochap-manager/admin/settings",
      "/zangochap-manager/logistics/packing",
      "/zangochap-manager/logistics/collection",
      "/zangochap-manager/logistics/warehouses",
      "/zangochap-manager/logistics/verification",
      "/zangochap-manager/logistics/labels",
      "/zangochap-manager/inventory/history",
      "/zangochap-manager/developer/logs",
      "/zangochap-manager/directory",
    ];

    for (const path of paths) {
      revalidatePath(path);
    }

    // Also revalidate product detail pages
    const publishedProducts = await prisma.product.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true },
      take: 100,
    });
    for (const p of publishedProducts) {
      revalidatePath(`/product/${p.id}`);
    }

    return {
      success: true,
      message: `Cache purgé pour ${paths.length} routes + ${publishedProducts.length} fiches produits.`,
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || "Erreur lors de la purge profonde du cache.",
    };
  }
}

/**
 * Find products with missing images and variants with stock inconsistencies.
 */
export async function auditCatalogAction() {
  await ensureAuth(["developer"]);
  try {
    const [
      productsNoImages,
      productsNoVariants,
      publishedNoStock,
      draftWithOrders,
      variantsNegativeStock,
    ] = await Promise.all([
      // Published products without any image
      prisma.product.count({
        where: {
          status: "PUBLISHED",
          images: { none: {} },
        },
      }),
      // Published products without any variant
      prisma.product.count({
        where: {
          status: "PUBLISHED",
          variants: { none: {} },
        },
      }),
      // Published products with 0 total stock across all variants
      prisma.product.count({
        where: {
          status: "PUBLISHED",
          stock: { lte: 0 },
        },
      }),
      // Draft products that have been ordered
      prisma.product.count({
        where: {
          status: "DRAFT",
          orderItems: { some: {} },
        },
      }),
      // Variants with negative stock (data corruption)
      prisma.productVariant.count({
        where: { stock: { lt: 0 } },
      }),
    ]);

    const issues: string[] = [];
    if (productsNoImages > 0)
      issues.push(`${productsNoImages} produit(s) publié(s) sans image`);
    if (productsNoVariants > 0)
      issues.push(`${productsNoVariants} produit(s) publié(s) sans variante`);
    if (publishedNoStock > 0)
      issues.push(
        `${publishedNoStock} produit(s) publié(s) avec stock ≤ 0`
      );
    if (draftWithOrders > 0)
      issues.push(
        `${draftWithOrders} brouillon(s) avec des commandes actives`
      );
    if (variantsNegativeStock > 0)
      issues.push(
        `${variantsNegativeStock} variante(s) avec stock négatif`
      );

    return {
      success: true,
      message:
        issues.length === 0
          ? "✅ Audit catalogue terminé. Aucune anomalie détectée."
          : `⚠️ ${issues.length} anomalie(s) catalogue:\n• ${issues.join("\n• ")}`,
      data: {
        productsNoImages,
        productsNoVariants,
        publishedNoStock,
        draftWithOrders,
        variantsNegativeStock,
        totalIssues: issues.length,
      },
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || "Erreur lors de l'audit du catalogue.",
    };
  }
}

/**
 * Health check on all promo codes: expired, unused, high-usage, misconfigured.
 */
export async function promoHealthCheckAction() {
  await ensureAuth(["developer"]);
  try {
    const now = new Date();

    const [
      expiredStillActive,
      unusedPromos,
      noProductNoCategory,
      totalUsages,
      promosCount,
    ] = await Promise.all([
      // Promos expired but still marked as active
      prisma.promoCode.count({
        where: {
          isActive: true,
          endDate: { lt: now },
        },
      }),
      // Promos with zero usage ever
      prisma.promoCode.count({
        where: {
          usages: { none: {} },
        },
      }),
      // Promos targeting no specific product or category (global)
      prisma.promoCode.count({
        where: {
          products: { none: {} },
          categories: { none: {} },
        },
      }),
      prisma.promoUsage.count(),
      prisma.promoCode.count(),
    ]);

    const issues: string[] = [];
    if (expiredStillActive > 0)
      issues.push(
        `${expiredStillActive} code(s) expiré(s) encore marqués actifs`
      );
    if (unusedPromos > 0)
      issues.push(`${unusedPromos} code(s) jamais utilisés`);
    if (noProductNoCategory > 0)
      issues.push(
        `${noProductNoCategory} code(s) sans produit ni catégorie ciblée (portée globale)`
      );

    return {
      success: true,
      message:
        issues.length === 0
          ? `✅ ${promosCount} code(s) promo vérifiés. ${totalUsages} utilisation(s) enregistrées. Aucun problème.`
          : `📊 ${promosCount} code(s), ${totalUsages} utilisation(s):\n• ${issues.join("\n• ")}`,
      data: {
        expiredStillActive,
        unusedPromos,
        noProductNoCategory,
        totalUsages,
        promosCount,
        totalIssues: issues.length,
      },
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message || "Erreur lors de l'audit des codes promo.",
    };
  }
}

// ─────────────────────────────────────────────────────────
// Advanced Data Export
// ─────────────────────────────────────────────────────────

type ExportEntity = "orders" | "products" | "customers" | "stock_movements" | "promos" | "all";
type ExportFormat = "csv" | "json";

/**
 * Flatten a nested object into a single-level object with dot-notation keys.
 */
function flattenObject(obj: any, prefix = ""): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      Object.assign(result, flattenObject(val, fullKey));
    } else if (Array.isArray(val)) {
      result[fullKey] = val.length > 0 ? JSON.stringify(val) : "";
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

/**
 * Convert an array of objects into CSV string with BOM for Excel compatibility.
 */
function toCsv(rows: any[]): string {
  if (rows.length === 0) return "";
  const flat = rows.map((r) => flattenObject(r));
  const headers = [...new Set(flat.flatMap((r) => Object.keys(r)))];

  const escape = (val: any) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headers.join(","),
    ...flat.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];

  // UTF-8 BOM for proper accented character handling in Excel
  return "\uFEFF" + csvLines.join("\n");
}

/**
 * Advanced data export: fetch data by entity type with date filtering,
 * return formatted as CSV or JSON string for client-side download.
 */
export async function exportDataAction(params: {
  entity: ExportEntity;
  format: ExportFormat;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  redactSensitive?: boolean;
}) {
  await ensureAuth(["developer"]);

  const { entity, format, dateFrom, dateTo, limit = 5000, redactSensitive = true } = params;

  try {
    const dateFilter: any = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    let data: any[] = [];
    let entityLabel = "";

    switch (entity) {
      case "orders": {
        entityLabel = "Commandes";
        const orders = await prisma.order.findMany({
          where: {
            deletedAt: null,
            ...(hasDateFilter ? { createdAt: dateFilter } : {}),
          },
          include: {
            items: {
              select: {
                name: true,
                size: true,
                color: true,
                qty: true,
                price: true,
                isGift: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        data = orders.map((o) => ({
          id: o.id,
          ref: o.ref || "",
          status: o.status,
          customerName: o.customerName,
          customerPhone: redactSensitive ? maskPhone(o.customerPhone) : o.customerPhone,
          customerPhone2: redactSensitive ? maskPhone(o.customerPhone2) : o.customerPhone2 || "",
          customerLocation: redactSensitive ? maskText(o.customerLocation) : o.customerLocation || "",
          commune: o.commune || "",
          total: o.total,
          deliveryFee: o.deliveryFee,
          discount: o.discount,
          promoCode: o.promoCode || "",
          type: o.type || "",
          commercialName: o.commercialName || "",
          deliverymanName: o.deliverymanName || "",
          deliveryDate: o.deliveryDate?.toISOString() || "",
          paymentMethod: o.paymentMethod || "",
          amountReceived: o.amountReceived ?? "",
          notes: redactSensitive ? maskText(o.notes) : o.notes || "",
          itemsCount: o.items.length,
          itemsDetail: o.items.map((i) => `${i.qty}x ${i.name} (${i.size}/${i.color}) ${i.price}F`).join(" | "),
          packedByName: o.packedByName || "",
          packedAt: o.packedAt?.toISOString() || "",
          confirmedAt: o.confirmedAt?.toISOString() || "",
          confirmedByName: o.confirmedByName || "",
          stockDecremented: o.stockDecremented,
          createdAt: o.createdAt.toISOString(),
          updatedAt: o.updatedAt.toISOString(),
        }));
        break;
      }

      case "products": {
        entityLabel = "Produits";
        const products = await prisma.product.findMany({
          where: hasDateFilter ? { createdAt: dateFilter } : {},
          include: {
            category: { select: { name: true } },
            subCategory: { select: { name: true } },
            supplier: { select: { name: true } },
            variants: {
              select: { size: true, color: true, stock: true },
            },
            images: {
              select: { url: true },
              take: 1,
              orderBy: { position: "asc" },
            },
            _count: { select: { orderItems: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        data = products.map((p) => ({
          id: p.id,
          ref: p.ref || "",
          name: p.name,
          slug: p.slug,
          status: p.status,
          price: Number(p.price),
          oldPrice: p.oldPrice ? Number(p.oldPrice) : "",
          stock: p.stock,
          lowStockThreshold: p.lowStockThreshold,
          category: p.category?.name || "",
          subCategory: p.subCategory?.name || "",
          supplier: p.supplier?.name || "",
          material: p.material || "",
          origin: p.origin || "",
          isFeatured: p.isFeatured,
          isGift: p.isGift,
          variantsCount: p.variants.length,
          variantsDetail: p.variants.map((v) => `${v.size}/${v.color}:${v.stock}`).join(" | "),
          totalOrders: p._count.orderItems,
          imageUrl: p.images[0]?.url || "",
          description: p.description || "",
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }));
        break;
      }

      case "customers": {
        entityLabel = "Clients";
        const customers = await prisma.customer.findMany({
          where: hasDateFilter ? { createdAt: dateFilter } : {},
          include: {
            _count: { select: { orders: true } },
          },
          orderBy: { lastOrderAt: "desc" },
          take: limit,
        });

        data = customers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: redactSensitive ? maskPhone(c.phone) : c.phone,
          phone2: redactSensitive ? maskPhone(c.phone2) : c.phone2 || "",
          location: redactSensitive ? maskText(c.location) : c.location || "",
          commune: c.commune || "",
          totalOrders: c.totalOrders,
          totalSpent: c.totalSpent,
          actualOrdersCount: c._count.orders,
          lastOrderAt: c.lastOrderAt.toISOString(),
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        }));
        break;
      }

      case "stock_movements": {
        entityLabel = "Mouvements de Stock";
        const movements = await prisma.stockMovement.findMany({
          where: hasDateFilter ? { createdAt: dateFilter } : {},
          include: {
            variant: {
              include: {
                product: { select: { name: true, ref: true } },
              },
            },
            warehouse: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        data = movements.map((m) => ({
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          productName: m.variant?.product?.name || "",
          productRef: m.variant?.product?.ref || "",
          variantSize: m.variant?.size || "",
          variantColor: m.variant?.color || "",
          warehouse: m.warehouse?.name || "",
          reason: m.reason || "",
          orderId: m.orderId || "",
          by: m.by,
          byName: m.byName,
          createdAt: m.createdAt.toISOString(),
        }));
        break;
      }

      case "promos": {
        entityLabel = "Codes Promo";
        const promos = await prisma.promoCode.findMany({
          where: hasDateFilter ? { createdAt: dateFilter } : {},
          include: {
            products: { select: { name: true } },
            categories: { select: { name: true } },
            _count: { select: { usages: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        data = promos.map((p) => ({
          code: p.code,
          label: p.label || "",
          type: p.type,
          value: p.value,
          rule: p.rule,
          isActive: p.isActive,
          isAutomatic: p.isAutomatic,
          minAmount: p.minAmount,
          minQuantity: p.minQuantity,
          maxGlobalUses: p.maxGlobalUses ?? "",
          startDate: p.startDate?.toISOString() || "",
          endDate: p.endDate?.toISOString() || "",
          totalUsages: p._count.usages,
          targetProducts: p.products.map((pr) => pr.name).join(", "),
          targetCategories: p.categories.map((c) => c.name).join(", "),
          giftProductId: p.giftProductId || "",
          createdAt: p.createdAt.toISOString(),
        }));
        break;
      }

      case "all": {
        entityLabel = "Export Complet de la Base";
        const [
          orders,
          products,
          customers,
          movements,
          promos,
          categories,
          warehouses,
          users,
          settlements
        ] = await Promise.all([
          prisma.order.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1000 }),
          prisma.product.findMany({ include: { variants: true }, orderBy: { createdAt: "desc" }, take: 1000 }),
          prisma.customer.findMany({ orderBy: { lastOrderAt: "desc" }, take: 1000 }),
          prisma.stockMovement.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
          prisma.promoCode.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
          prisma.category.findMany(),
          prisma.warehouse.findMany(),
          prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, createdAt: true } }),
          prisma.settlement.findMany({ orderBy: { createdAt: "desc" }, take: 1000 })
        ]);

        const safeOrders = orders.map((order) => ({
          ...order,
          customerPhone: redactSensitive ? maskPhone(order.customerPhone) : order.customerPhone,
          customerPhone2: redactSensitive ? maskPhone(order.customerPhone2) : order.customerPhone2,
          customerLocation: redactSensitive ? maskText(order.customerLocation) : order.customerLocation,
          notes: redactSensitive ? maskText(order.notes) : order.notes,
        }));
        const safeCustomers = customers.map((customer) => ({
          ...customer,
          phone: redactSensitive ? maskPhone(customer.phone) : customer.phone,
          phone2: redactSensitive ? maskPhone(customer.phone2) : customer.phone2,
          location: redactSensitive ? maskText(customer.location) : customer.location,
        }));

        data = [{
          metadata: {
            exportedAt: new Date().toISOString(),
            version: "1.0",
            dbType: "postgresql",
            sensitiveDataRedacted: redactSensitive,
          },
          tables: {
            orders: safeOrders,
            products,
            customers: safeCustomers,
            stockMovements: movements,
            promos,
            categories,
            warehouses,
            users,
            settlements
          }
        }];
        break;
      }

      default:
        return { success: false, error: "Type d'entité non reconnu." };
    }

    if (data.length === 0) {
      return {
        success: true,
        message: `Aucune donnée trouvée pour "${entityLabel}" avec les filtres appliqués.`,
        fileContent: null,
      };
    }

    if (entity === "all") {
      const fileContent = JSON.stringify(data[0], null, 2);
      const fileName = `export_complet_${new Date().toISOString().slice(0, 10)}.json`;
      await recordDeveloperAudit("data.export", "success", {
        entity,
        format: "json",
        rowCount: 1,
        redactSensitive,
        dateFrom,
        dateTo,
      });
      return {
        success: true,
        message: "Export complet de la base de données généré avec succès.",
        fileContent,
        fileName,
        rowCount: 1,
      };
    }

    const fileContent = format === "csv" ? toCsv(data) : JSON.stringify(data, null, 2);
    const fileName = `export_${entity}_${new Date().toISOString().slice(0, 10)}.${format}`;
    await recordDeveloperAudit("data.export", "success", {
      entity,
      format,
      rowCount: data.length,
      redactSensitive,
      dateFrom,
      dateTo,
    });

    return {
      success: true,
      message: `${data.length} ${entityLabel.toLowerCase()} exporté(e)s.`,
      fileContent,
      fileName,
      rowCount: data.length,
    };
  } catch (e: any) {
    await recordDeveloperAudit("data.export", "failure", {
      entity,
      format,
      dateFrom,
      dateTo,
      error: e.message,
    });
    return {
      success: false,
      error: e.message || "Erreur lors de l'exportation des données.",
    };
  }
}

// ─────────────────────────────────────────────────────────
// Preview / Scan Actions (for modal pre-confirmation)
// ─────────────────────────────────────────────────────────

/**
 * Preview: scan stock state before sync.
 */
export async function previewStockSyncAction() {
  await ensureAuth(["developer"]);
  try {
    const variants = await prisma.productVariant.findMany({
      include: {
        product: { select: { name: true, ref: true, stock: true } },
        stockLevels: {
          include: { warehouse: { select: { name: true } } },
        },
      },
    });

    let mismatchCount = 0;
    const mismatches: any[] = [];

    for (const v of variants) {
      const warehouseTotal = v.stockLevels.reduce(
        (sum, sl) => sum + sl.quantity,
        0
      );
      if (v.stock !== warehouseTotal) {
        mismatchCount++;
        if (mismatches.length < 20) {
          mismatches.push({
            product: v.product?.name || "Inconnu",
            ref: v.product?.ref || "",
            variant: `${v.size} / ${v.color}`,
            currentStock: v.stock,
            warehouseTotal,
            diff: warehouseTotal - v.stock,
          });
        }
      }
    }

    return {
      success: true,
      data: {
        totalVariants: variants.length,
        mismatchCount,
        mismatches,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Preview: list test orders that would be deleted.
 */
export async function previewCleanTestOrdersAction() {
  await ensureAuth(["developer"]);
  try {
    const testOrders = await prisma.order.findMany({
      where: { customerName: { startsWith: "[TEST]" } },
      select: {
        id: true,
        ref: true,
        customerName: true,
        total: true,
        status: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return {
      success: true,
      data: {
        count: testOrders.length,
        orders: testOrders.map((o) => ({
          ref: o.ref || "—",
          total: o.total,
          status: o.status,
          items: o._count.items,
          createdAt: o.createdAt.toISOString(),
        })),
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Preview: sample of customers whose stats would be recalculated.
 */
export async function previewCustomerStatsAction() {
  await ensureAuth(["developer"]);
  try {
    const totalCustomers = await prisma.customer.count();

    // Sample 15 customers to show potential changes
    const sample = await prisma.customer.findMany({
      take: 15,
      orderBy: { lastOrderAt: "desc" },
      select: {
        id: true,
        name: true,
        phone: true,
        totalOrders: true,
        totalSpent: true,
      },
    });

    const sampleWithActual = [];
    for (const c of sample) {
      const orders = await prisma.order.findMany({
        where: {
          customerId: c.id,
          deletedAt: null,
          status: { notIn: ["CANCELLED"] },
        },
        select: { total: true, deliveryFee: true },
      });
      const actualOrders = orders.length;
      const actualSpent = orders.reduce(
        (sum, o) => sum + o.total + o.deliveryFee,
        0
      );
      const hasChanged =
        c.totalOrders !== actualOrders || c.totalSpent !== actualSpent;

      sampleWithActual.push({
        name: c.name,
        phone: c.phone,
        storedOrders: c.totalOrders,
        actualOrders,
        storedSpent: c.totalSpent,
        actualSpent,
        hasChanged,
      });
    }

    return {
      success: true,
      data: {
        totalCustomers,
        sample: sampleWithActual,
        changedInSample: sampleWithActual.filter((c) => c.hasChanged).length,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
