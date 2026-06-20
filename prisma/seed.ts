import "dotenv/config";
import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";
import { DELIVERY_FEES } from "../lib/constants";

type SeedVariant = {
  size: string;
  color: string;
  stock: number;
  location: string;
};

type SeedProduct = {
  ref: string;
  name: string;
  emoji: string;
  description: string;
  price: number;
  oldPrice?: number;
  category: string;
  subCategory: string;
  material: string;
  origin: string;
  supplier: string;
  lowStockThreshold: number;
  isFeatured?: boolean;
  isGift?: boolean;
  images: Array<{
    name: string;
    url: string;
    altText: string;
    type?: "THUMBNAIL" | "GALLERY" | "FEATURED";
  }>;
  variants: SeedVariant[];
};

const seedProducts: SeedProduct[] = [
  {
    ref: "SEED-ROBE-AYA-001",
    name: "Robe Aya Premium",
    emoji: "ROBE",
    description: "Robe fluide pour sorties, shooting et evenements. Coupe confortable, rendu premium.",
    price: 18500,
    oldPrice: 23000,
    category: "Mode Femme",
    subCategory: "Robes",
    material: "Crepe doux",
    origin: "Abidjan",
    supplier: "Atelier Aya",
    lowStockThreshold: 6,
    isFeatured: true,
    images: [
      {
        name: "robe-aya-cover",
        url: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=80",
        altText: "Robe feminine premium",
        type: "THUMBNAIL",
      },
      {
        name: "robe-aya-detail",
        url: "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=900&q=80",
        altText: "Detail tissu robe",
      },
    ],
    variants: [
      { size: "S", color: "Noir", stock: 14, location: "A1-01" },
      { size: "M", color: "Noir", stock: 22, location: "A1-02" },
      { size: "L", color: "Bordeaux", stock: 9, location: "A1-03" },
    ],
  },
  {
    ref: "SEED-SAC-NAYA-002",
    name: "Sac Naya Business",
    emoji: "SAC",
    description: "Sac structure pour bureau, boutique et sorties. Compartiments pratiques et finition elegante.",
    price: 24500,
    oldPrice: 30000,
    category: "Accessoires",
    subCategory: "Sacs",
    material: "Simili cuir renforce",
    origin: "Import",
    supplier: "Naya Supply",
    lowStockThreshold: 5,
    isFeatured: true,
    images: [
      {
        name: "sac-naya-cover",
        url: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80",
        altText: "Sac business noir",
        type: "THUMBNAIL",
      },
    ],
    variants: [
      { size: "Standard", color: "Noir", stock: 18, location: "B2-01" },
      { size: "Standard", color: "Camel", stock: 12, location: "B2-02" },
      { size: "Standard", color: "Vert", stock: 7, location: "B2-03" },
    ],
  },
  {
    ref: "SEED-TENUE-KIDS-003",
    name: "Ensemble Kids Soleil",
    emoji: "KIDS",
    description: "Ensemble enfant leger, facile a porter, ideal week-end et vacances.",
    price: 9500,
    category: "Enfants",
    subCategory: "Ensembles",
    material: "Coton melange",
    origin: "Cote d'Ivoire",
    supplier: "Mini Style CI",
    lowStockThreshold: 8,
    images: [
      {
        name: "kids-soleil-cover",
        url: "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=80",
        altText: "Vetement enfant colore",
        type: "THUMBNAIL",
      },
    ],
    variants: [
      { size: "2 ans", color: "Jaune", stock: 10, location: "C1-01" },
      { size: "4 ans", color: "Bleu", stock: 16, location: "C1-02" },
      { size: "6 ans", color: "Vert", stock: 11, location: "C1-03" },
    ],
  },
  {
    ref: "SEED-PARFUM-ELYA-004",
    name: "Parfum Elya Intense",
    emoji: "BEAUTY",
    description: "Parfum intense, notes florales et bois doux. Format compact pour cadeau ou usage quotidien.",
    price: 12500,
    oldPrice: 15000,
    category: "Beaute",
    subCategory: "Parfums",
    material: "Flacon verre",
    origin: "Import",
    supplier: "Elya Beauty",
    lowStockThreshold: 10,
    isGift: true,
    images: [
      {
        name: "parfum-elya-cover",
        url: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=900&q=80",
        altText: "Flacon parfum premium",
        type: "THUMBNAIL",
      },
    ],
    variants: [
      { size: "50 ml", color: "Rose", stock: 26, location: "D1-01" },
      { size: "100 ml", color: "Or", stock: 13, location: "D1-02" },
    ],
  },
  {
    ref: "SEED-SANDALE-LINA-005",
    name: "Sandales Lina Confort",
    emoji: "SHOE",
    description: "Sandales legeres avec semelle confortable pour marche quotidienne.",
    price: 14500,
    category: "Chaussures",
    subCategory: "Sandales",
    material: "Cuir synthetique",
    origin: "Import",
    supplier: "Lina Shoes",
    lowStockThreshold: 7,
    images: [
      {
        name: "sandales-lina-cover",
        url: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=900&q=80",
        altText: "Sandales confort femme",
        type: "THUMBNAIL",
      },
    ],
    variants: [
      { size: "37", color: "Beige", stock: 8, location: "E1-01" },
      { size: "38", color: "Beige", stock: 15, location: "E1-02" },
      { size: "39", color: "Noir", stock: 12, location: "E1-03" },
      { size: "40", color: "Noir", stock: 6, location: "E1-04" },
    ],
  },
  {
    ref: "SEED-MONTRE-KORA-006",
    name: "Montre Kora Minimal",
    emoji: "WATCH",
    description: "Montre minimaliste avec bracelet ajustable. Look propre pour bureau et ceremonie.",
    price: 19500,
    category: "Accessoires",
    subCategory: "Montres",
    material: "Acier inoxydable",
    origin: "Import",
    supplier: "Kora Time",
    lowStockThreshold: 4,
    images: [
      {
        name: "montre-kora-cover",
        url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80",
        altText: "Montre minimaliste",
        type: "THUMBNAIL",
      },
    ],
    variants: [
      { size: "Standard", color: "Argent", stock: 9, location: "B3-01" },
      { size: "Standard", color: "Noir", stock: 5, location: "B3-02" },
    ],
  },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeName(str: string) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function ensureSeedCreator() {
  const adminEmail = "admin@zangochap.in";
  const adminPassword = "Password123!";

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log(`Admin deja present: ${adminEmail}`);
    return existingAdmin.id;
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  const admin = await prisma.user.create({
    data: {
      name: "Administrateur",
      email: adminEmail,
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  console.log("Admin seed cree.");
  console.log(`Email: ${adminEmail}`);
  console.log(`Mot de passe: ${adminPassword}`);
  return admin.id;
}

async function seedCommunes() {
  console.log("Seeding communes...");

  const dbCommunes = await prisma.commune.findMany();
  const dbNormalizedNames = new Set(dbCommunes.map((commune) => normalizeName(commune.name)));

  for (const [name, fee] of Object.entries(DELIVERY_FEES)) {
    const normalized = normalizeName(name);
    if (!dbNormalizedNames.has(normalized)) {
      await prisma.commune.create({
        data: {
          name,
          deliveryFee: fee as number,
          isActive: true,
        },
      });
      console.log(`Commune ajoutee: ${name}`);
    }
  }
}

async function seedProductCatalog(creatorId: string) {
  console.log("Seeding catalogue produits...");

  const warehouse = await prisma.warehouse.upsert({
    where: { name: "Entrepot Seed ZangoChap" },
    update: { isActive: true, location: "Zone seed / demo" },
    create: { name: "Entrepot Seed ZangoChap", location: "Zone seed / demo", isActive: true },
  });

  for (const productSeed of seedProducts) {
    const category = await prisma.category.upsert({
      where: { name: productSeed.category },
      update: {},
      create: { name: productSeed.category, slug: slugify(productSeed.category) },
    });

    const subCategory = await prisma.subCategory.upsert({
      where: {
        name_categoryId: {
          name: productSeed.subCategory,
          categoryId: category.id,
        },
      },
      update: {},
      create: {
        name: productSeed.subCategory,
        slug: `${slugify(productSeed.category)}-${slugify(productSeed.subCategory)}`,
        categoryId: category.id,
      },
    });

    const supplier = await prisma.supplier.upsert({
      where: { name: productSeed.supplier },
      update: { contact: "seed@zangochap.local" },
      create: { name: productSeed.supplier, contact: "seed@zangochap.local" },
    });

    const totalStock = productSeed.variants.reduce((sum, variant) => sum + variant.stock, 0);
    const product = await prisma.product.upsert({
      where: { ref: productSeed.ref },
      update: {
        name: productSeed.name,
        emoji: productSeed.emoji,
        description: productSeed.description,
        price: productSeed.price,
        oldPrice: productSeed.oldPrice,
        categoryId: category.id,
        subCategoryId: subCategory.id,
        material: productSeed.material,
        origin: productSeed.origin,
        supplierId: supplier.id,
        stock: totalStock,
        lowStockThreshold: productSeed.lowStockThreshold,
        status: "PUBLISHED",
        isFeatured: Boolean(productSeed.isFeatured),
        isGift: Boolean(productSeed.isGift),
        location: warehouse.name,
      },
      create: {
        ref: productSeed.ref,
        slug: slugify(productSeed.name),
        name: productSeed.name,
        emoji: productSeed.emoji,
        description: productSeed.description,
        price: productSeed.price,
        oldPrice: productSeed.oldPrice,
        categoryId: category.id,
        subCategoryId: subCategory.id,
        material: productSeed.material,
        origin: productSeed.origin,
        supplierId: supplier.id,
        stock: totalStock,
        lowStockThreshold: productSeed.lowStockThreshold,
        location: warehouse.name,
        status: "PUBLISHED",
        isFeatured: Boolean(productSeed.isFeatured),
        isGift: Boolean(productSeed.isGift),
        creatorId,
      },
      include: { variants: true, images: true },
    });

    for (const [position, image] of productSeed.images.entries()) {
      const imageExists = product.images.some((item) => item.url === image.url);
      if (!imageExists) {
        await prisma.productImage.create({
          data: {
            productId: product.id,
            name: image.name,
            url: image.url,
            altText: image.altText,
            type: image.type || "GALLERY",
            position,
            width: 900,
            height: 1200,
            size: 0,
          },
        });
      }
    }

    for (const variantSeed of productSeed.variants) {
      const existingVariant = product.variants.find(
        (variant) => variant.size === variantSeed.size && variant.color === variantSeed.color,
      );

      const variant = existingVariant
        ? await prisma.productVariant.update({
            where: { id: existingVariant.id },
            data: {
              stock: variantSeed.stock,
              location: variantSeed.location,
            },
          })
        : await prisma.productVariant.create({
            data: {
              productId: product.id,
              size: variantSeed.size,
              color: variantSeed.color,
              stock: variantSeed.stock,
              location: variantSeed.location,
            },
          });

      await prisma.stockLevel.upsert({
        where: {
          variantId_warehouseId: {
            variantId: variant.id,
            warehouseId: warehouse.id,
          },
        },
        update: {
          quantity: variantSeed.stock,
          position: variantSeed.location,
        },
        create: {
          variantId: variant.id,
          warehouseId: warehouse.id,
          quantity: variantSeed.stock,
          position: variantSeed.location,
        },
      });
    }

    console.log(`Produit seed OK: ${productSeed.ref} - ${productSeed.name}`);
  }
}

async function main() {
  console.log("Debut du seed de la base de donnees...");

  const creatorId = await ensureSeedCreator();
  await seedCommunes();
  await seedProductCatalog(creatorId);

  console.log("Seed termine.");
}

main()
  .catch((error) => {
    console.error("Erreur lors du seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
