"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { ensureAuth } from "@/lib/auth";
import { uploadImage, deleteImageFromR2 } from "@/lib/upload";
import { Prisma, Role } from "@prisma/client";
import { getOrCreateDefaultWarehouse } from "@/modules/orders/helpers";
import { syncProductStock } from "@/lib/stock-sync";
import { getBestAutomaticDiscount, validatePromoCode, CartItem } from "@/lib/promo-engine";
import { setVariantWarehouseStock } from "@/modules/orders/actions/stock";


function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

// ============ FETCH ============
export async function getProducts(filters?: {
  search?: string;
  category?: string;
  subCategory?: string;
  inStock?: boolean;
  outOfStock?: boolean;
}) {
  const where: any = {};
  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { ref: { contains: filters.search, mode: 'insensitive' } },
      { supplier: { name: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }
  if (filters?.category) {
    where.category = { name: filters.category };
  }
  if (filters?.subCategory) {
    where.subCategory = { name: filters.subCategory };
  }
  if (filters?.outOfStock) where.stock = 0;
  if (filters?.inStock) where.stock = { gt: 0 };

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      variants: {
        include: {
          stockLevels: {
            include: { warehouse: true }
          }
        }
      },
      images: { orderBy: { position: 'asc' } },
      createdBy: true,
      category: true,
      subCategory: true,
      supplier: true
    },
  });

  return JSON.parse(JSON.stringify(products));
}

export async function getProductById(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: {
        include: {
          stockLevels: {
            include: { warehouse: true }
          }
        }
      },
      images: { orderBy: { position: 'asc' } },
      createdBy: true,
      category: true,
      subCategory: true,
      supplier: true
    },
  });

  return JSON.parse(JSON.stringify(product));
}

// ============ CREATE ============
export async function createProduct(data: {
  name: string;
  ref?: string;
  emoji?: string;
  category: string;
  subCategory?: string;
  price: number;
  oldPrice?: number | null;
  description?: string;
  material?: string;
  origin?: string;
  supplier: string;
  location?: string;
  lowStockThreshold?: number;
  isPublished?: boolean;
  isFeatured?: boolean;
  isGift?: boolean;
  variants: Array<{
    size: string;
    color: string;
    image?: string | null;
    stock: number;
    location?: string;
  }>;
  images?: Array<{ name: string; dataUrl: string }>;
  warehouseId?: string;
  creatorId?: string;
}) {
  const session = await ensureAuth(["admin", "stock", "commercial"]);
  const canAssignCreator = ["admin", "developer"].includes(session.role?.toLowerCase());
  const creatorId = canAssignCreator && data.creatorId ? data.creatorId : session.id;

  if (creatorId !== session.id) {
    const creator = await prisma.user.findFirst({
      where: { id: creatorId, role: { in: [Role.ADMIN, Role.COMMERCIAL] } },
      select: { id: true },
    });
    if (!creator) throw new Error("Commercial attribue introuvable.");
  }

  // 1. Upload images to S3
  const imageUrls = [];
  if (data.images) {
    for (const img of data.images) {
      if (img.dataUrl.startsWith('http')) {
        imageUrls.push({ name: img.name, url: img.dataUrl });
      } else {
        const url = await uploadImage(img.dataUrl, img.name);
        imageUrls.push({ name: img.name, url });
      }
    }
  }

  const variantsWithImages = await Promise.all(data.variants.map(async (v) => ({
    ...v,
    image: await resolveVariantImage(v.image, `${data.name}-${v.size}-${v.color}`),
  })));

  const totalStock = variantsWithImages.reduce((sum, v) => sum + cleanStock(v.stock), 0);
  const mainLocation = data.variants.find(v => v.location)?.location || data.location || '';
  const slug = `${slugify(data.name)}-${Math.floor(Math.random() * 1000)}`;

  let resolvedCategoryId: string | undefined = undefined;
  if (data.category && data.category.trim() !== '') {
    const cat = await prisma.category.upsert({
      where: { name: data.category.trim() },
      update: {},
      create: { name: data.category.trim(), slug: slugify(data.category) }
    });
    resolvedCategoryId = cat.id;
  }

  let resolvedSubCategoryId: string | undefined = undefined;
  if (data.subCategory && data.subCategory.trim() !== '' && resolvedCategoryId) {
    const subCatSlug = slugify(data.subCategory);
    const subCat = await prisma.subCategory.upsert({
      where: { slug: subCatSlug },
      update: {},
      create: { name: data.subCategory.trim(), slug: subCatSlug, categoryId: resolvedCategoryId }
    });
    resolvedSubCategoryId = subCat.id;
  }

  const product = await prisma.product.create({
    data: {
      name: data.name,
      ref: data.ref || null,
      emoji: data.emoji || '📦',
      slug,
      price: new Prisma.Decimal(data.price),
      oldPrice: data.oldPrice ? new Prisma.Decimal(data.oldPrice) : null,
      description: data.description || '',
      material: data.material || '',
      origin: data.origin || '',
      stock: totalStock,
      location: mainLocation,
      lowStockThreshold: data.lowStockThreshold,
      status: data.isPublished === false ? 'DRAFT' : 'PUBLISHED',
      isFeatured: data.isFeatured ?? false,
      isGift: data.isGift ?? false,
      createdBy: { connect: { id: creatorId } },
      category: resolvedCategoryId ? { connect: { id: resolvedCategoryId } } : undefined,
      subCategory: resolvedSubCategoryId ? { connect: { id: resolvedSubCategoryId } } : undefined,
      supplier: data.supplier ? {
        connectOrCreate: {
          where: { name: data.supplier },
          create: { name: data.supplier }
        }
      } : undefined,
      variants: {
        create: variantsWithImages.map(v => ({
          size: v.size,
          color: v.color,
          image: v.image || null,
          stock: cleanStock(v.stock),
          location: v.location || '',
        })),
      },
      images: {
        create: imageUrls,
      },
    },
    include: { variants: true, images: true },
  });

  // Initialize stock levels in selected or default warehouse
  const targetWarehouseId = data.warehouseId || (await getOrCreateDefaultWarehouse()).id;
  await Promise.all(product.variants.map(v => {
    const initialQty = cleanStock(variantsWithImages.find(dv => dv.size === v.size && dv.color === v.color)?.stock || 0);
    return prisma.stockLevel.create({
      data: {
        variantId: v.id,
        warehouseId: targetWarehouseId,
        quantity: initialQty,
        position: v.location || null
      }
    });
  }));

  revalidatePath("/zangochap-manager/products");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/");
  return JSON.parse(JSON.stringify(product));
}

// ============ UPDATE VARIANTS ============
export async function updateProductVariants(productId: string, variants: Array<{
  id?: string;
  size: string;
  color: string;
  image?: string | null;
  stock: number;
  location?: string;
}>) {
  await ensureAuth(["admin", "stock", "packing", "collection", "commercial"]);

  await prisma.$transaction(async (tx) => {
    let defaultWarehouse = await tx.warehouse.findFirst({
      where: { name: { in: ["Entrepôt Principal", "Entrepôt  principal", "Entrepot Principal", "Magasin Principal"] } }
    });
    if (!defaultWarehouse) {
      defaultWarehouse = await tx.warehouse.create({ data: { name: "Entrepôt Principal", location: "Siège Zangochap" } });
    }

    const existingVariants = await tx.productVariant.findMany({ where: { productId } });
    const existingIds = existingVariants.map(v => v.id);
    const incomingIds = variants.map(v => v.id).filter(Boolean);

    // Delete removed variants
    const toDelete = existingIds.filter(id => !incomingIds.includes(id));
    if (toDelete.length > 0) {
      await tx.productVariant.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const v of variants) {
      if (v.id && existingIds.includes(v.id)) {
        await tx.productVariant.update({
          where: { id: v.id },
            data: { size: v.size, color: v.color, image: v.image || null, stock: cleanStock(v.stock), location: v.location || '' }
        });

        const stockLvl = await tx.stockLevel.findFirst({ where: { variantId: v.id, warehouseId: defaultWarehouse.id } });
        if (stockLvl) {
          await tx.stockLevel.update({
            where: { id: stockLvl.id },
            data: { quantity: cleanStock(v.stock), position: v.location || null }
          });
        } else {
          await tx.stockLevel.create({
            data: { variantId: v.id, warehouseId: defaultWarehouse.id, quantity: cleanStock(v.stock), position: v.location || null }
          });
        }
      } else {
        const newVariant = await tx.productVariant.create({
          data: { productId, size: v.size, color: v.color, image: v.image || null, stock: cleanStock(v.stock), location: v.location || '' }
        });
        await tx.stockLevel.create({
          data: { variantId: newVariant.id, warehouseId: defaultWarehouse.id, quantity: cleanStock(v.stock), position: v.location || null }
        });
      }
    }
  });

  // Synchronize stock totals
  await syncProductStock(productId);

  revalidatePath("/zangochap-manager/products");
  revalidatePath("/zangochap-manager/logistics");
  revalidatePath("/zangochap-manager/logistics/packing");
  revalidatePath("/zangochap-manager/logistics/collection");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/");
  return { success: true };
}

// ============ GET PRODUCT VARIANTS BY ID ============
export async function getProductVariantsById(productId: string) {
  await ensureAuth(["admin", "stock", "packing", "collection", "commercial"]);

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    include: {
      stockLevels: {
        include: {
          warehouse: true,
        },
      },
    },
    orderBy: { size: "asc" },
  });

  return JSON.parse(JSON.stringify(variants));
}

// ============ UPDATE PRODUCT VARIANTS BY ID (DÉDIÉ & SANS DESTRUCTION) ============
export async function updateProductVariantsById(productId: string, variants: Array<{
  id?: string;
  size: string;
  color: string;
  image?: string | null;
  stock: number;
  location?: string;
}>) {
  await ensureAuth(["admin", "stock", "packing", "collection", "commercial"]);

  await prisma.$transaction(async (tx) => {
    let defaultWarehouse = await tx.warehouse.findFirst({
      where: { name: { in: ["Entrepôt Principal", "Entrepôt  principal", "Entrepot Principal", "Magasin Principal"] } }
    });
    if (!defaultWarehouse) {
      defaultWarehouse = await tx.warehouse.create({ data: { name: "Entrepôt Principal", location: "Siège Zangochap" } });
    }

    const existingVariants = await tx.productVariant.findMany({
      where: { productId },
      include: { stockLevels: { include: { warehouse: true } } }
    });
    const existingIds = existingVariants.map(v => v.id);

    // AUCUNE SUPPRESSION DESTRUCTIVE ICI (pas de deleteMany toDelete)

    for (const v of variants) {
      let targetVariantId = v.id;

      if (targetVariantId && existingIds.includes(targetVariantId)) {
        await tx.productVariant.update({
          where: { id: targetVariantId },
          data: { size: v.size, color: v.color, image: v.image || null, stock: cleanStock(v.stock), location: v.location || '' }
        });
      } else {
        const newVariant = await tx.productVariant.create({
          data: { productId, size: v.size, color: v.color, image: v.image || null, stock: cleanStock(v.stock), location: v.location || '' }
        });
        targetVariantId = newVariant.id;
      }

      const stockLvl = await tx.stockLevel.findFirst({
        where: { variantId: targetVariantId, warehouseId: defaultWarehouse.id }
      });

      if (stockLvl) {
        await tx.stockLevel.update({
          where: { id: stockLvl.id },
          data: { quantity: cleanStock(v.stock), position: v.location || null }
        });
      } else {
        await tx.stockLevel.create({
          data: { variantId: targetVariantId, warehouseId: defaultWarehouse.id, quantity: cleanStock(v.stock), position: v.location || null }
        });
      }
    }
  });

  // Synchronisation globale du stock total
  await syncProductStock(productId);

  revalidatePath("/zangochap-manager/products");
  revalidatePath("/zangochap-manager/logistics");
  revalidatePath("/zangochap-manager/logistics/packing");
  revalidatePath("/zangochap-manager/logistics/collection");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/");
  return { success: true };
}

function cleanStock(value: number) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

async function resolveVariantImage(image?: string | null, fallbackName = "variant") {
  if (!image) return null;
  if (image.startsWith("http") || image.startsWith("/")) return image;
  if (image.startsWith("data:image")) return uploadImage(image, `${fallbackName}.webp`);
  return image;
}

// ============ UPDATE VARIANT STOCK LEVELS (PACKING MODAL) ============
export async function updateProductVariantStockLevels(productId: string, data: {
  lowStockThreshold?: number;
  variants: Array<{
    id?: string;
    size: string;
    color: string;
    image?: string | null;
    stock?: number;
    location?: string;
    stockLevels?: Array<{
      id?: string;
      warehouseId?: string;
      warehouseName?: string;
      quantity: number;
      position?: string;
    }>;
  }>;
}) {
  const session = await ensureAuth(["admin", "stock", "packing", "collection", "commercial"]);

  await prisma.$transaction(async (tx) => {
    const defaultWarehouse = await tx.warehouse.upsert({
      where: { name: "Entrepôt Principal" },
      update: {},
      create: { name: "Entrepôt Principal", location: "Siège Zangochap" },
    });

    const existingVariants = await tx.productVariant.findMany({
      where: { productId },
      select: { id: true },
    });
    const existingIds = new Set(existingVariants.map((variant) => variant.id));

    for (const variant of data.variants) {
      const levels = variant.stockLevels?.length
        ? variant.stockLevels
        : [{
          warehouseId: defaultWarehouse.id,
          warehouseName: defaultWarehouse.name,
          quantity: variant.stock || 0,
          position: variant.location,
        }];

      const totalStock = levels.reduce((sum, level) => sum + cleanStock(level.quantity), 0);
      const defaultLocation = levels.find((level) => level.position?.trim())?.position?.trim() || variant.location || "";
      let variantId = variant.id;

      if (variantId && existingIds.has(variantId)) {
        await tx.productVariant.update({
          where: { id: variantId },
          data: {
            size: variant.size,
            color: variant.color,
            image: variant.image || null,
            stock: totalStock,
            location: defaultLocation,
          },
        });
      } else {
        const created = await tx.productVariant.create({
          data: {
            productId,
            size: variant.size,
            color: variant.color,
            image: variant.image || null,
            stock: totalStock,
            location: defaultLocation,
          },
        });
        variantId = created.id;
      }

      for (const level of levels) {
        const quantity = cleanStock(level.quantity);
        let warehouseId = level.warehouseId;

        if (!warehouseId) {
          const warehouseName = level.warehouseName?.trim() || defaultWarehouse.name;
          const warehouse = await tx.warehouse.upsert({
            where: { name: warehouseName },
            update: {},
            create: { name: warehouseName },
          });
          warehouseId = warehouse.id;
        }

        await setVariantWarehouseStock({
          variantId,
          warehouseId,
          newQuantity: quantity,
          reason: "Edition stock depuis le modal packing",
          session,
          sync: false,
        }, tx as any);

        await tx.stockLevel.update({
          where: {
            variantId_warehouseId: {
              variantId,
              warehouseId,
            },
          },
          data: { position: level.position?.trim() || null },
        });
      }
    }

    if (data.lowStockThreshold !== undefined) {
      await tx.product.update({
        where: { id: productId },
        data: { lowStockThreshold: Math.max(0, Number(data.lowStockThreshold) || 0) },
      });
    }
  }, { timeout: 15000 });

  await syncProductStock(productId);

  revalidatePath("/zangochap-manager/products");
  revalidatePath("/zangochap-manager/logistics");
  revalidatePath("/zangochap-manager/logistics/packing");
  revalidatePath("/zangochap-manager/logistics/collection");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/");
  return { success: true };
}

// ============ UPDATE PRODUCT ============
export async function updateProduct(id: string, data: Partial<{
  name: string;
  ref: string | null;
  emoji: string;
  category: string;
  subCategory: string;
  price: number;
  oldPrice: number | null;
  description: string;
  material: string;
  origin: string;
  supplier: string;
  location: string;
  lowStockThreshold: number;
  isPublished: boolean;
  isFeatured: boolean;
  isGift: boolean;
  variants?: Array<{ id?: string; size: string; color: string; image?: string | null; stock: number; location: string }>;
  images?: Array<{ name: string; dataUrl: string }>;
  warehouseId?: string;
  creatorId?: string;
}>) {
  const session = await ensureAuth(["admin", "stock", "commercial"]);
  const updateData: any = { ...data };

  // Remove UI-only fields and relation strings to prevent Prisma validation errors
  delete updateData.category;
  delete updateData.subCategory;
  delete updateData.supplier;
  delete updateData.isPublished;
  delete updateData.variants;
  delete updateData.images;
  delete updateData.warehouseId;
  delete updateData.creatorId;

  if (data.price !== undefined) updateData.price = new Prisma.Decimal(data.price);
  if (data.oldPrice !== undefined) updateData.oldPrice = data.oldPrice ? new Prisma.Decimal(data.oldPrice) : null;
  if (data.isPublished !== undefined) updateData.status = data.isPublished ? 'PUBLISHED' : 'DRAFT';

  if (data.creatorId !== undefined && ["admin", "developer"].includes(session.role?.toLowerCase())) {
    const creator = await prisma.user.findFirst({
      where: { id: data.creatorId, role: { in: [Role.ADMIN, Role.COMMERCIAL] } },
      select: { id: true },
    });
    if (!creator) throw new Error("Commercial attribue introuvable.");
    updateData.createdBy = { connect: { id: creator.id } };
  }

  // Handle Category & SubCategory
  if (data.category !== undefined) {
    if (data.category && data.category.trim() !== "") {
      const cat = await prisma.category.upsert({
        where: { name: data.category.trim() },
        update: {},
        create: { name: data.category.trim(), slug: slugify(data.category) }
      });
      updateData.category = { connect: { id: cat.id } };

      if (data.subCategory && data.subCategory.trim() !== "") {
        const subCatSlug = slugify(data.subCategory);
        const subCat = await prisma.subCategory.upsert({
          where: { slug: subCatSlug },
          update: {},
          create: { name: data.subCategory.trim(), slug: subCatSlug, categoryId: cat.id }
        });
        updateData.subCategory = { connect: { id: subCat.id } };
      } else if (data.subCategory === "") {
        updateData.subCategory = { disconnect: true };
      }
    } else {
      updateData.category = { disconnect: true };
      updateData.subCategory = { disconnect: true };
    }
  }

  // Handle Supplier
  if (data.supplier !== undefined) {
    if (data.supplier && data.supplier.trim() !== "") {
      updateData.supplier = {
        connectOrCreate: {
          where: { name: data.supplier.trim() },
          create: { name: data.supplier.trim() }
        }
      };
    } else {
      updateData.supplier = { disconnect: true };
    }
  }

  // Handle Variants
  if (data.variants) {
    const targetWarehouseId = data.warehouseId || (await getOrCreateDefaultWarehouse()).id;
    const existingVariants = await prisma.productVariant.findMany({
      where: { productId: id },
      include: { stockLevels: true },
    });

    const variantsWithImages = await Promise.all(data.variants.map(async (v) => ({
      ...v,
      image: await resolveVariantImage(v.image, `${data.name || id}-${v.size}-${v.color}`),
    })));

    const incomingIds = variantsWithImages.map(v => v.id).filter(Boolean);
    const removedIds = existingVariants
      .map(variant => variant.id)
      .filter(variantId => !incomingIds.includes(variantId));

    if (removedIds.length > 0) {
      await prisma.productVariant.deleteMany({
        where: { id: { in: removedIds }, productId: id },
      });
    }

    const activeExistingVariants = existingVariants.filter(variant => !removedIds.includes(variant.id));

    for (const v of variantsWithImages) {
      const stock = cleanStock(v.stock);
      const existing = (v.id && activeExistingVariants.find(variant => variant.id === v.id))
        || activeExistingVariants.find(variant => variant.size === v.size && variant.color === v.color);

      const targetVariant = existing
        ? await prisma.productVariant.update({
          where: { id: existing.id },
          data: {
            size: v.size,
            color: v.color,
            image: v.image || null,
            stock,
            location: v.location || '',
          }
        })
        : await prisma.productVariant.create({
          data: {
            productId: id,
            size: v.size,
            color: v.color,
            image: v.image || null,
            stock,
            location: v.location || '',
          }
        });

      const otherWarehouseStock = existing
        ? existing.stockLevels
          .filter(level => level.warehouseId !== targetWarehouseId)
          .reduce((sum, level) => sum + cleanStock(level.quantity), 0)
        : 0;
      const targetWarehouseStock = Math.max(0, stock - otherWarehouseStock);

      await prisma.stockLevel.upsert({
        where: {
          variantId_warehouseId: {
            variantId: targetVariant.id,
            warehouseId: targetWarehouseId,
          },
        },
        update: { quantity: targetWarehouseStock, position: v.location || null },
        create: {
          variantId: targetVariant.id,
          warehouseId: targetWarehouseId,
          quantity: targetWarehouseStock,
          position: v.location || null,
        },
      });
    }

    // Sync total stock
    const totalStock = variantsWithImages.reduce((sum, v) => sum + cleanStock(v.stock), 0);
    updateData.stock = totalStock;
  }

  // Handle Images
  if (data.images) {
    // 1. Get current images to cleanup R2 later
    const oldImages = await prisma.productImage.findMany({
      where: { productId: id }
    });

    // Delete old image records
    await prisma.productImage.deleteMany({ where: { productId: id } });

    const imageUrls = [];
    for (const img of data.images) {
      if (img.dataUrl.startsWith('http')) {
        imageUrls.push({ name: img.name, url: img.dataUrl });
      } else {
        const url = await uploadImage(img.dataUrl, img.name);
        imageUrls.push({ name: img.name, url });
      }
    }

    updateData.images = {
      create: imageUrls
    };

    // 2. Cleanup R2 for removed images
    const newUrls = imageUrls.map(i => i.url);
    for (const oldImg of oldImages) {
      if (!newUrls.includes(oldImg.url)) {
        // Check if this image URL is used by other products before deleting from R2
        const isUsedElsewhere = await prisma.productImage.findFirst({
          where: {
            url: oldImg.url,
            productId: { not: id }
          }
        });

        if (!isUsedElsewhere) {
          await deleteImageFromR2(oldImg.url);
        }
      }
    }
  }

  await prisma.product.update({
    where: { id },
    data: updateData,
  });

  if (data.variants) {
    await syncProductStock(id);
  }

  revalidatePath("/zangochap-manager/products");
  revalidatePath("/");
  return { success: true };
}

// ============ DELETE ============
export async function deleteProduct(id: string) {
  await ensureAuth(["admin", "commercial"]);

  // Fetch product with images to cleanup R2
  const product = await prisma.product.findUnique({
    where: { id },
    include: { images: true }
  });

  if (product) {
    for (const img of product.images) {
      // Check if this image URL is used by other products before deleting from R2
      const isUsedElsewhere = await prisma.productImage.findFirst({
        where: {
          url: img.url,
          productId: { not: id }
        }
      });

      if (!isUsedElsewhere) {
        await deleteImageFromR2(img.url);
      }
    }
  }

  await prisma.product.delete({ where: { id } });
  revalidatePath("/zangochap-manager/products");
  revalidatePath("/");
  return { success: true };
}

// ============ MARK SENT TO SUPPLIER ============
export async function markProductSent(productId: string) {
  await ensureAuth(["admin", "stock", "collection", "commercial"]);
  await prisma.product.update({
    where: { id: productId },
    data: { sentToSupplierAt: new Date() },
  });
  revalidatePath("/zangochap-manager/products");
  return { success: true };
}

// ============ MAINTENANCE ============
export async function fixAllProductStocks() {
  await ensureAuth(["admin"]);
  const products = await prisma.product.findMany({
    select: { id: true }
  });

  let fixedCount = 0;
  for (const p of products) {
    await syncProductStock(p.id);
    fixedCount++;
  }

  revalidatePath("/zangochap-manager/products");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/");

  return { success: true, count: fixedCount };
}

// ============ STOCK MOVEMENTS ============
export async function getStockMovements(productId?: string) {
  const where: any = {};
  if (productId) {
    where.variant = { productId };
  }

  return prisma.stockMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      variant: {
        include: { product: true }
      },
      warehouse: true
    },
    take: 50
  });
}

export async function getAutomaticDiscountAction(
  cart: CartItem[],
  customerPhone?: string,
  customerId?: string
) {
  try {
    return await getBestAutomaticDiscount(cart, customerPhone, customerId);
  } catch (e) {
    console.error("Error getting automatic discount:", e);
    return { code: null, amount: 0, label: null, type: null, giftProductId: null };
  }
}

export async function validatePromoCodeAction(
  code: string,
  cart: CartItem[],
  customerPhone?: string,
  customerId?: string
) {
  try {
    return await validatePromoCode(code, cart, customerPhone, customerId);
  } catch (e) {
    console.error("Error validating promo code:", e);
    return { success: false, error: "Une erreur est survenue lors de la validation du code promo." };
  }
}
